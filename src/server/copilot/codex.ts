import { randomUUID } from "node:crypto";
import { getSetting, setSetting } from "@/server/settings";
import { CopilotBackendError, buildSystemPrompt, cleanReply, type LlmPlan } from "./llm";
import { getOauthCredentials } from "./openai-oauth";
import type { CopilotContext } from "./tools";

/**
 * ChatGPT Codex backend client — the endpoint "Sign in with ChatGPT" tokens
 * are valid for (same one Codex CLI and OpenClaw use). Responses-API-shaped
 * streaming request; we assemble the streamed text and parse the JSON plan.
 * The engine validates every tool call afterwards, so a malformed reply can
 * never touch equipment — it just reads as "didn't catch that".
 */

const CODEX_URL = "https://chatgpt.com/backend-api/codex/responses";
const TIMEOUT_MS = 30_000;

/**
 * The Codex backend only accepts Codex-tuned models, and the accepted set
 * drifts as OpenAI ships new ones (rejections read "The 'gpt-5' model is not
 * supported when using Codex with a ChatGPT account"). Auto mode walks this
 * chain on that error and remembers what worked, so discovery costs one extra
 * round-trip once; an explicit Settings model override is used verbatim.
 */
const CODEX_MODEL_CANDIDATES = ["gpt-5.1-codex", "gpt-5-codex", "gpt-5.1", "gpt-5-codex-mini", "codex-mini-latest"];
const WORKING_MODEL_KEY = "codexWorkingModel";

function isModelRejection(err: unknown): boolean {
  return (
    err instanceof CopilotBackendError &&
    (err.status === 400 || err.status === 404) &&
    /model|not supported/i.test(err.message)
  );
}

interface SseEvent {
  type?: string;
  delta?: string;
  response?: { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
}

function extractTextFromSse(raw: string): string {
  let streamed = "";
  let finalText = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let event: SseEvent;
    try {
      event = JSON.parse(payload) as SseEvent;
    } catch {
      continue;
    }
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      streamed += event.delta;
    }
    if (event.type === "response.completed" && event.response?.output) {
      for (const item of event.response.output) {
        if (item.type !== "message") continue;
        for (const part of item.content ?? []) {
          if (part.type === "output_text" && typeof part.text === "string") finalText += part.text;
        }
      }
    }
  }
  return (finalText || streamed).trim();
}

async function callCodex(text: string, ctx: CopilotContext, model: string, retryOn401 = true): Promise<string> {
  const creds = await getOauthCredentials();
  if (!creds) throw new CopilotBackendError("ChatGPT sign-in has expired — reconnect it in Settings → Voice & AI");

  const instructions =
    buildSystemPrompt(ctx) +
    '\nOutput STRICTLY one JSON object, no prose, no markdown fences: {"tool_calls":[…],"needs_confirmation_note":"optional"}';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(CODEX_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${creds.accessToken}`,
        "chatgpt-account-id": creds.accountId,
        "OpenAI-Beta": "responses=experimental",
        originator: "codex_cli_rs",
        session_id: randomUUID(),
      },
      body: JSON.stringify({
        model,
        instructions,
        input: [
          ...(ctx.history ?? []).map((h) => ({
            type: "message",
            role: h.role,
            content: [h.role === "assistant" ? { type: "output_text", text: h.content } : { type: "input_text", text: h.content }],
          })),
          { type: "message", role: "user", content: [{ type: "input_text", text }] },
        ],
        tools: [],
        tool_choice: "auto",
        parallel_tool_calls: false,
        store: false,
        stream: true,
        include: [],
      }),
      signal: controller.signal,
    });
    if (res.status === 401 && retryOn401) {
      // Force refresh via getOauthCredentials on the retry.
      return callCodex(text, ctx, model, false);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new CopilotBackendError(
        `ChatGPT backend returned ${res.status}${detail ? ` (${detail.slice(0, 120)})` : ""} — if this persists, the unofficial Codex route may have changed; switch to an API key`,
        res.status
      );
    }
    const raw = await res.text();
    const output = extractTextFromSse(raw);
    if (!output) throw new CopilotBackendError("ChatGPT returned an empty response");
    return output;
  } catch (err) {
    if (err instanceof CopilotBackendError) throw err;
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new CopilotBackendError(aborted ? "ChatGPT took longer than 30s to answer" : "couldn't reach chatgpt.com");
  } finally {
    clearTimeout(timer);
  }
}

/** Try the remembered model first, then walk the candidate chain on rejection. */
async function callCodexAuto(text: string, ctx: CopilotContext): Promise<string> {
  const remembered = getSetting<string>(WORKING_MODEL_KEY, "");
  const chain = [...new Set([remembered, ...CODEX_MODEL_CANDIDATES].filter(Boolean))];
  let firstRejection: CopilotBackendError | null = null;
  for (const candidate of chain) {
    try {
      const output = await callCodex(text, ctx, candidate);
      if (candidate !== remembered) {
        setSetting(WORKING_MODEL_KEY, candidate);
        console.log(`[moonpool] copilot: Codex backend accepted model "${candidate}" — remembered`);
      }
      return output;
    } catch (err) {
      // Only model rejections advance the chain; auth/network errors surface.
      if (!isModelRejection(err)) throw err;
      firstRejection ??= err as CopilotBackendError;
    }
  }
  throw new CopilotBackendError(
    `ChatGPT's Codex backend rejected every model Moonpool knows (tried ${chain.join(", ")}) — ` +
      `set a model manually in Settings → Voice & AI, or switch to an API key. First error: ${firstRejection?.message ?? "unknown"}`
  );
}

/**
 * @param model explicit Settings override, or null to auto-pick a model the
 * Codex backend accepts (self-healing as OpenAI retires model names).
 */
export async function parseWithCodex(text: string, ctx: CopilotContext, model: string | null): Promise<LlmPlan> {
  let output: string;
  if (model) {
    try {
      output = await callCodex(text, ctx, model);
    } catch (err) {
      if (isModelRejection(err)) {
        throw new CopilotBackendError(
          `${(err as Error).message}. Clear the model override in Settings → Voice & AI to let Moonpool auto-pick a supported Codex model`
        );
      }
      throw err;
    }
  } else {
    output = await callCodexAuto(text, ctx);
  }
  const cleaned = output
    .replace(/^```(?:json)?/m, "")
    .replace(/```\s*$/m, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Salvage a JSON object embedded in prose.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new CopilotBackendError("ChatGPT replied without a JSON plan");
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      throw new CopilotBackendError("ChatGPT returned malformed JSON");
    }
  }
  const plan = parsed as { tool_calls?: unknown; needs_confirmation_note?: unknown; reply?: unknown };
  if (!Array.isArray(plan.tool_calls)) throw new CopilotBackendError("ChatGPT's reply was missing tool_calls");
  return {
    tool_calls: plan.tool_calls,
    needs_confirmation_note:
      typeof plan.needs_confirmation_note === "string" && plan.needs_confirmation_note.trim().length > 0
        ? plan.needs_confirmation_note.trim()
        : undefined,
    reply: cleanReply(plan.reply),
  };
}
