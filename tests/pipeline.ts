import { groundPlan } from "@/server/copilot/grounding";
import { parseWithLlm, type LlmOverrides } from "@/server/copilot/llm";
import { isGreeting } from "@/server/copilot/mock-parser";
import { parseUtterance } from "@/server/copilot/mock-parser";
import { normalize } from "@/server/copilot/nlu";
import { validateToolCall, type CopilotContext, type ToolCall } from "@/server/copilot/tools";

/**
 * The copilot pipeline exactly as processMessage runs it — parse, drop phantom
 * calls on a greeting, ground against the user's words, validate — minus the
 * DB and HTTP layers. Evals run through this rather than inspecting raw model
 * output, so a plan the engine would refuse can never score as a pass.
 */

export interface PipelineResult {
  calls: ToolCall[];
  /** Validation errors — the engine turns these into a refusal, not an action. */
  problems: string[];
  corrections: string[];
  reply?: string;
}

function finish(text: string, raw: unknown[], ctx: CopilotContext, reply?: string): PipelineResult {
  if (raw.length > 0 && isGreeting(normalize(text))) raw = [];
  const { calls: grounded, corrections } = groundPlan(text, raw, ctx);
  const calls: ToolCall[] = [];
  const problems: string[] = [];
  for (const call of grounded.slice(0, 10)) {
    const v = validateToolCall(call, ctx);
    if (v.ok) calls.push(v.call);
    else problems.push(v.error);
  }
  return { calls, problems, corrections: corrections.map((c) => `${c.rule}: ${c.detail}`), ...(reply ? { reply } : {}) };
}

/** Deterministic parser path (MOCK_MODE). */
export function runMock(text: string, ctx: CopilotContext): PipelineResult {
  return finish(text, parseUtterance(text, ctx).calls, ctx);
}

/** Live LLM path. */
export async function runLlm(text: string, ctx: CopilotContext, overrides: LlmOverrides = {}): Promise<PipelineResult> {
  const plan = await parseWithLlm(text, ctx, overrides);
  return finish(text, plan.tool_calls, ctx, plan.reply);
}
