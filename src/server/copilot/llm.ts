import type { CopilotContext } from "./tools";
import { RESPONSE_JSON_SCHEMA, TOOL_DEFS, allCircuits, toolSignature } from "./tools";

/**
 * OpenAI-compatible chat client (Ollama by default) that translates natural
 * language into structured tool calls. Plain fetch, no SDK. The coarse
 * response_format json_schema guarantees parseable {tool_calls, reply?} JSON;
 * validateToolCall enforces the real per-tool contracts server-side. Facts
 * and action results always come from templates, never the model.
 *
 * Env: COPILOT_BASE_URL (default http://localhost:11434/v1),
 *      COPILOT_MODEL (default "qwen3:1.7b"), COPILOT_API_KEY (optional),
 *      COPILOT_TIMEOUT_MS (default 60000).
 */

// Local models can be slow: a cold Ollama request reloads the model from
// disk, and small "thinking" models reason at length before the JSON comes
// out. 60s keeps real requests from dying mid-think; hosted providers pass
// tighter overrides.
const TIMEOUT_MS = Number(process.env.COPILOT_TIMEOUT_MS ?? "") || 60_000;

/**
 * Token budget for everything we send. A local backend silently truncates from
 * the FRONT once the context window fills — which drops the system prompt's
 * schema and "act only on the newest message" rules and leaves the model
 * improvising. Measured against qwen3: the system prompt is ~1680 tokens and a
 * full 8-turn history adds ~500, which overflows a 2048-token window. Rather
 * than trust the deployment to be configured generously, drop the oldest turns
 * until the request provably fits.
 *
 * Set COPILOT_CONTEXT_TOKENS to match OLLAMA_CONTEXT_LENGTH if you change it.
 */
const CONTEXT_TOKENS = Number(process.env.COPILOT_CONTEXT_TOKENS ?? "") || 4096;
/** Headroom left for the model's own JSON answer. */
const RESERVED_OUTPUT_TOKENS = 512;

/** Chars-per-token on this prompt shape, measured at ~3.6 for Qwen; 3.2 is a safe margin. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.2);
}

/**
 * Trim history from the oldest end until system + history + user fits the
 * budget. The newest turns are the ones that resolve "make it 3 hours instead".
 */
export function fitHistory(
  system: string,
  history: Array<{ role: string; content: string }>,
  user: string,
  budget: number = CONTEXT_TOKENS - RESERVED_OUTPUT_TOKENS
): Array<{ role: string; content: string }> {
  const fixed = estimateTokens(system) + estimateTokens(user);
  const kept: Array<{ role: string; content: string }> = [];
  let used = fixed;
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (!turn) continue;
    const cost = estimateTokens(turn.content) + 4; // role/format overhead
    if (used + cost > budget) break;
    used += cost;
    kept.unshift(turn);
  }
  return kept;
}

export class CopilotBackendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CopilotBackendError";
  }
}

export interface LlmPlan {
  tool_calls: unknown[];
  needs_confirmation_note?: string;
  /** Model-written conversational reply — only honored when tool_calls is empty. */
  reply?: string;
}

export function cleanReply(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Compact live-state summary — kept well under ~600 tokens. */
export function buildSystemPrompt(ctx: CopilotContext): string {
  const snap = ctx.snapshot;
  const deg = `°${snap.units}`;
  const nd = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][nd.getDay()] ?? "";
  const nowLine = `${day} ${nd.getFullYear()}-${pad(nd.getMonth() + 1)}-${pad(nd.getDate())} ${pad(nd.getHours())}:${pad(nd.getMinutes())}`;
  const bodies = snap.bodies
    .map(
      (b) =>
        `${b.name}(${b.kind}): ${b.temp !== null ? `${Math.round(b.temp)}${deg}${b.tempStale ? " (stale, pump off)" : ""}` : "?"} now, target ${b.setPoint}${deg}, heat ${b.heatMode}${b.heatStatus !== "off" ? " (heating)" : ""}`
    )
    .join("; ");
  const circuits = allCircuits(snap)
    .map((c) => `${c.id}:${c.name}${c.isLight ? "*" : ""}${c.isOn ? "(ON)" : ""}`)
    .join(" ");
  const scenes = ctx.scenes.map((s) => `${s.id}:"${s.name}"`).join(" ") || "none";
  const themes = snap.lightThemes.map((t) => t.name).join(", ") || "none";
  const automations = ctx.automations.map((a) => `${a.id}:"${a.name}"${a.enabled ? "" : "(paused)"}`).join(" ") || "none";
  const pumps = snap.pumps.map((p) => `${p.name} ${p.minSpeed}-${p.maxSpeed}rpm now ${p.rpm}`).join("; ") || "none";
  const schedules =
    snap.schedules.map((s) => `${s.id}:${s.circuitName}`).join(" ") || "none";
  // Signatures carry the arg shapes since the response schema no longer does
  // (a strict per-tool schema melts Ollama's grammar sampler — see tools.ts).
  const tools = TOOL_DEFS.map((d) => `${toolSignature(d)} — ${d.description}`).join("\n");

  return [
    "You are Moonpool's pool copilot. You translate pool-owner requests into STRUCTURED TOOL CALLS. Reply with JSON matching the schema: {\"tool_calls\":[{\"tool\":\"…\",\"args\":{…}}], \"needs_confirmation_note\":\"optional caveat\", \"reply\":\"optional\"}.",
    "Act ONLY on what the NEWEST user message asks. Earlier turns in the conversation are context — already handled — use them ONLY to resolve references (\"it\", \"that\", \"actually make it 3 hours\"). If the newest message doesn't clearly request a change or a question you can answer, tool_calls MUST be []. Never invent actions, and never copy the examples below — they only illustrate the format.",
    "PERSONALITY — you are a calm, capable pool assistant; friendly but never over the top (no exclamation storms, emoji only if the user uses them). Use \"reply\" for your voice: with NO tool calls (greeting/small talk/out of scope) reply IS the whole answer, 1–2 short sentences. WITH tool calls, reply is an optional short lead-in (≤1 sentence, e.g. \"Sure — here's where things stand.\" or \"Good call on a night like this —\"). CRITICAL: never put temperatures, readings, times or any facts in reply — the app appends real data from the tools; your reply must read naturally next to it.",
    `LIVE STATE — now: ${nowLine}. bodies: ${bodies || "none"}. air ${snap.airTemp !== null ? Math.round(snap.airTemp) + deg : "?"}.`,
    `circuits (id:name, * = light): ${circuits || "none"}`,
    `scenes: ${scenes} | light themes: ${themes}`,
    `automations (${ctx.automations.length}): ${automations}`,
    `pumps: ${pumps} | panel schedules (id:circuit): ${schedules}`,
    ctx.pendingPlan ? "There IS a pending unconfirmed plan (cancel_pending applies to it)." : "No pending plan.",
    `TOOLS:\n${tools}`,
    'Rules: use numeric ids from the state above. Times are "HH:MM" 24h ("8" in the evening = "20:00", midnight = "00:00") or ISO. days: 0=Sun..6=Sat, [] = every day. Questions → get_status. "a bit warmer" = current setpoint +2.',
    "Timed requests: relative (\"in 2 hours\", \"in 45 min\") → schedule_once with inMinutes counted from now — do NOT do clock math yourself. Other one-offs (\"tonight at 10\") → schedule_once with at (\"HH:MM\", or ISO \"YYYY-MM-DDTHH:MM\" computed from now above for \"tomorrow at 3pm\"). Recurring ON/OFF window for ONE circuit (\"run the cleaner 9 to 11 every weekday\") → create_schedule (a panel schedule — keeps working even if this server is off). Recurring anything else (sunset, temperatures, multi-step, lights themes) → create_automation.",
    "Also: pump speed → set_pump_speed. \"I added water / topped it off\" → log_water_refill. \"do we need water?\" → get_water_status. \"make/save a scene …\" → create_scene (saves, doesn't run).",
    'Examples: "turn on the waterfall" → {"tool_calls":[{"tool":"set_circuit","args":{"circuitId":<id of Waterfall>,"state":true}}]} · "warm the spa a bit" → {"tool_calls":[{"tool":"set_heat","args":{"body":"spa","setpoint":<current spa target + 2>}}]} · "in 2 hours heat the hot tub" → {"tool_calls":[{"tool":"schedule_once","args":{"inMinutes":120,"actions":[{"tool":"set_heat","args":{"body":"spa","mode":"heater"}}]}}]} · "everything off at 11pm" → {"tool_calls":[{"tool":"schedule_once","args":{"at":"23:00","actions":[{"tool":"all_off","args":{}}]}}]} · "lights blue at sunset every friday" → {"tool_calls":[{"tool":"create_automation","args":{"name":"Lights blue at sunset","trigger":{"type":"sun","event":"sunset","offsetMinutes":0,"days":[5]},"actions":[{"tool":"set_light_theme","args":{"theme":"Blue"}}]}}]}',
  ].join("\n");
}

export interface LlmOverrides {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export async function parseWithLlm(text: string, ctx: CopilotContext, overrides: LlmOverrides = {}): Promise<LlmPlan> {
  const base = (overrides.baseUrl ?? process.env.COPILOT_BASE_URL ?? "http://localhost:11434/v1").replace(/\/+$/, "");
  const model = overrides.model ?? process.env.COPILOT_MODEL ?? "qwen3:1.7b";
  const apiKey = overrides.apiKey ?? process.env.COPILOT_API_KEY;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), overrides.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        stream: false,
        messages: (() => {
          const system = buildSystemPrompt(ctx);
          // Qwen3 soft-switch: skip the long thinking phase — structured tool
          // calls don't benefit and a 1.7B model can think past any timeout.
          const user = /qwen3/i.test(model) ? `${text} /no_think` : text;
          const history = fitHistory(system, ctx.history ?? [], user);
          return [{ role: "system", content: system }, ...history, { role: "user", content: user }];
        })(),
        // strict:false — OpenAI's strict mode rejects optional properties, and
        // Ollama's grammar enforcement only needs the coarse shape.
        response_format: {
          type: "json_schema",
          json_schema: { name: "copilot_plan", strict: false, schema: RESPONSE_JSON_SCHEMA },
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new CopilotBackendError(`LLM backend returned ${res.status}`);
    const data = (await res.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: string } }> }
      | null;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) throw new CopilotBackendError("LLM returned an empty response");
    let parsed: unknown;
    try {
      // Some backends wrap the JSON in <think> blocks despite structured output.
      const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      throw new CopilotBackendError("LLM returned malformed JSON");
    }
    const plan = parsed as { tool_calls?: unknown; needs_confirmation_note?: unknown; reply?: unknown };
    if (!Array.isArray(plan.tool_calls)) throw new CopilotBackendError("LLM response was missing tool_calls");
    return {
      tool_calls: plan.tool_calls,
      needs_confirmation_note:
        typeof plan.needs_confirmation_note === "string" && plan.needs_confirmation_note.trim().length > 0
          ? plan.needs_confirmation_note.trim()
          : undefined,
      reply: cleanReply(plan.reply),
    };
  } catch (err) {
    if (err instanceof CopilotBackendError) throw err;
    const aborted = err instanceof Error && err.name === "AbortError";
    const limitS = Math.round((overrides.timeoutMs ?? TIMEOUT_MS) / 1000);
    throw new CopilotBackendError(aborted ? `the model took longer than ${limitS}s to answer` : "copilot backend unreachable");
  } finally {
    clearTimeout(timer);
  }
}
