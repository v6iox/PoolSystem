import type { CopilotContext } from "./tools";
import { RESPONSE_JSON_SCHEMA, TOOL_DEFS, allCircuits } from "./tools";

/**
 * OpenAI-compatible chat client (Ollama by default) used only to translate
 * natural language into structured tool calls. Plain fetch, no SDK. The
 * response_format json_schema makes malformed output impossible — the model
 * can only return {tool_calls: [...], needs_confirmation_note?}. It never
 * writes the reply the user sees; templates do that from executed results.
 *
 * Env: COPILOT_BASE_URL (default http://localhost:11434/v1),
 *      COPILOT_MODEL (default "qwen3:1.7b"), COPILOT_API_KEY (optional).
 */

const TIMEOUT_MS = 10_000;

export class CopilotBackendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CopilotBackendError";
  }
}

export interface LlmPlan {
  tool_calls: unknown[];
  needs_confirmation_note?: string;
}

/** Compact live-state summary — kept well under ~600 tokens. */
export function buildSystemPrompt(ctx: CopilotContext): string {
  const snap = ctx.snapshot;
  const deg = `°${snap.units}`;
  const bodies = snap.bodies
    .map(
      (b) =>
        `${b.name}(${b.kind}): ${b.temp !== null ? `${Math.round(b.temp)}${deg}` : "?"} now, target ${b.setPoint}${deg}, heat ${b.heatMode}${b.heatStatus !== "off" ? " (heating)" : ""}`
    )
    .join("; ");
  const circuits = allCircuits(snap)
    .map((c) => `${c.id}:${c.name}${c.isLight ? "*" : ""}${c.isOn ? "(ON)" : ""}`)
    .join(" ");
  const scenes = ctx.scenes.map((s) => `${s.id}:"${s.name}"`).join(" ") || "none";
  const themes = snap.lightThemes.map((t) => t.name).join(", ") || "none";
  const automations = ctx.automations.map((a) => `${a.id}:"${a.name}"${a.enabled ? "" : "(paused)"}`).join(" ") || "none";
  const tools = TOOL_DEFS.map((d) => `${d.name} — ${d.description}`).join("\n");

  return [
    "You translate pool-owner requests into STRUCTURED TOOL CALLS ONLY. You never chat. Reply with JSON matching the schema: {\"tool_calls\":[{\"tool\":\"…\",\"args\":{…}}], \"needs_confirmation_note\":\"optional caveat\"}. If the request is unclear or not pool-related, return {\"tool_calls\":[]}.",
    `LIVE STATE — bodies: ${bodies || "none"}. air ${snap.airTemp !== null ? Math.round(snap.airTemp) + deg : "?"}.`,
    `circuits (id:name, * = light): ${circuits || "none"}`,
    `scenes: ${scenes} | light themes: ${themes}`,
    `automations (${ctx.automations.length}): ${automations}`,
    ctx.pendingPlan ? "There IS a pending unconfirmed plan (cancel_pending applies to it)." : "No pending plan.",
    `TOOLS:\n${tools}`,
    'Rules: use numeric ids from the state above. Times are "HH:MM" 24h ("8" in the evening = "20:00", midnight = "00:00") or ISO. days: 0=Sun..6=Sat, [] = every day. Questions → get_status. "a bit warmer" = current setpoint +2.',
    'Examples: "turn on the waterfall" → {"tool_calls":[{"tool":"set_circuit","args":{"circuitId":<id of Waterfall>,"state":true}}]} · "warm the spa a bit" → {"tool_calls":[{"tool":"set_heat","args":{"body":"spa","setpoint":<current spa target + 2>}}]} · "everything off at 11pm" → {"tool_calls":[{"tool":"schedule_once","args":{"at":"23:00","actions":[{"tool":"all_off","args":{}}]}}]} · "lights blue at sunset every friday" → {"tool_calls":[{"tool":"create_automation","args":{"name":"Lights blue at sunset","trigger":{"type":"sun","event":"sunset","offsetMinutes":0,"days":[5]},"actions":[{"tool":"set_light_theme","args":{"theme":"Blue"}}]}}]}',
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
        messages: [
          { role: "system", content: buildSystemPrompt(ctx) },
          { role: "user", content: text },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "copilot_plan", strict: true, schema: RESPONSE_JSON_SCHEMA },
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
    const plan = parsed as { tool_calls?: unknown; needs_confirmation_note?: unknown };
    if (!Array.isArray(plan.tool_calls)) throw new CopilotBackendError("LLM response was missing tool_calls");
    return {
      tool_calls: plan.tool_calls,
      needs_confirmation_note:
        typeof plan.needs_confirmation_note === "string" && plan.needs_confirmation_note.trim().length > 0
          ? plan.needs_confirmation_note.trim()
          : undefined,
    };
  } catch (err) {
    if (err instanceof CopilotBackendError) throw err;
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new CopilotBackendError(aborted ? "the model took too long to answer" : "copilot backend unreachable");
  } finally {
    clearTimeout(timer);
  }
}
