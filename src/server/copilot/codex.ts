import { randomUUID } from "node:crypto";
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
        `ChatGPT backend returned ${res.status}${detail ? ` (${detail.slice(0, 120)})` : ""} — if this persists, the unofficial Codex route may have changed; switch to an API key`
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

export async function parseWithCodex(text: string, ctx: CopilotContext, model: string): Promise<LlmPlan> {
  const output = await callCodex(text, ctx, model);
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
