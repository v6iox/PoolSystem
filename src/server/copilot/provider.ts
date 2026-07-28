import { getSetting, setSetting } from "@/server/settings";
import { parseUtterance } from "./mock-parser";
import { parseWithLlm, type LlmPlan } from "./llm";
import { parseWithCodex } from "./codex";
import { getOauthStatus } from "./openai-oauth";
import { groundPlan } from "./grounding";
import type { CopilotContext } from "./tools";

/**
 * Copilot brain selection. Three ways to run it, switchable in Settings:
 *  - "env"           local Ollama (or whatever COPILOT_BASE_URL points at);
 *                    in MOCK_MODE this uses the deterministic parser
 *  - "openai-key"    official OpenAI API with a pasted key (stored only in
 *                    the local SQLite on the Pi)
 *  - "chatgpt-oauth" Sign in with ChatGPT (Codex/OpenClaw-style PKCE flow) —
 *                    uses the ChatGPT subscription instead of API billing.
 *                    Unofficial: may break if OpenAI changes their backend.
 */

export type CopilotProviderKind = "env" | "openai-key" | "chatgpt-oauth";

export interface CopilotProviderConfig {
  provider: CopilotProviderKind;
  /** Model override; sensible per-provider default when empty. */
  model: string;
  /** Only for openai-key. */
  apiKey: string;
}

const DEFAULTS: CopilotProviderConfig = { provider: "env", model: "", apiKey: "" };

export function getProviderConfig(): CopilotProviderConfig {
  return { ...DEFAULTS, ...getSetting<Partial<CopilotProviderConfig>>("copilotProvider", {}) };
}

export function saveProviderConfig(patch: Partial<CopilotProviderConfig>): CopilotProviderConfig {
  const merged = { ...getProviderConfig(), ...patch };
  setSetting("copilotProvider", merged);
  return merged;
}

export function defaultModelFor(provider: CopilotProviderKind): string {
  if (provider === "openai-key") return "gpt-4o-mini";
  if (provider === "chatgpt-oauth") return "gpt-5";
  return process.env.COPILOT_MODEL ?? "qwen3:1.7b";
}

export interface ParsedUtterance {
  calls: unknown[];
  note?: string;
  /** Conversational reply for no-action turns (LLM providers only). */
  reply?: string;
  /** Deterministic corrections applied on top of the model's output. */
  corrections?: string[];
}

/**
 * Every LLM answer passes through the same deterministic grounding pass, so
 * the details a regex can settle from the user's own words — which body, which
 * circuit, and when — don't depend on the model. See grounding.ts.
 */
function ground(text: string, plan: LlmPlan, ctx: CopilotContext): ParsedUtterance {
  const { calls, corrections } = groundPlan(text, plan.tool_calls, ctx);
  if (corrections.length > 0) {
    console.log(`[moonpool] copilot grounding: ${corrections.map((c) => `${c.rule}: ${c.detail}`).join(" | ")}`);
  }
  return {
    calls,
    note: plan.needs_confirmation_note,
    reply: plan.reply,
    ...(corrections.length > 0 ? { corrections: corrections.map((c) => c.detail) } : {}),
  };
}

/** Route an utterance to whichever brain is configured. */
export async function parseWithProvider(text: string, ctx: CopilotContext): Promise<ParsedUtterance> {
  const config = getProviderConfig();
  const model = config.model || defaultModelFor(config.provider);

  if (config.provider === "openai-key" && config.apiKey) {
    const plan: LlmPlan = await parseWithLlm(text, ctx, {
      baseUrl: "https://api.openai.com/v1",
      apiKey: config.apiKey,
      model,
      timeoutMs: 20_000,
    });
    return ground(text, plan, ctx);
  }

  if (config.provider === "chatgpt-oauth" && getOauthStatus().connected) {
    const plan = await parseWithCodex(text, ctx, model);
    return ground(text, plan, ctx);
  }

  // Default: env-configured backend; deterministic parser when simulating.
  // COPILOT_FORCE_LLM=true opts into the real local LLM even in MOCK_MODE
  // (useful for testing models against the simulator on a dev machine).
  const forceLlm = process.env.COPILOT_FORCE_LLM === "true";
  if (!forceLlm && (process.env.MOCK_MODE === "true" || process.env.COPILOT_FORCE_MOCK === "true")) {
    const parsed = parseUtterance(text, ctx);
    return { calls: parsed.calls, note: parsed.note };
  }
  // The Settings model override applies to the local brain too.
  const plan = await parseWithLlm(text, ctx, config.model ? { model: config.model } : {});
  return ground(text, plan, ctx);
}
