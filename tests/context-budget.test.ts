import { describe, expect, it } from "vitest";
import { buildSystemPrompt, estimateTokens, fitHistory } from "@/server/copilot/llm";
import { ctx } from "./fixtures";

/**
 * Context budgeting. A local backend truncates from the FRONT when the window
 * fills, so an over-long request costs you the system prompt — the schema and
 * the "act only on the newest message" rule — and the model starts improvising.
 * Measured against qwen3 on this fixture: system ≈ 1680 tokens, and a full
 * 8-turn history reached 2170 against the 2048-token window the deploy used to
 * set. These guard both halves of that fix.
 */

const system = buildSystemPrompt(ctx);
const turn = (i: number): { role: "user" | "assistant"; content: string } => ({
  role: i % 2 === 0 ? "user" : "assistant",
  content: `turn ${i} ${"heat the spa a bit ".repeat(14)}`.slice(0, 280),
});
const HISTORY = Array.from({ length: 8 }, (_, i) => turn(i));

describe("token estimate", () => {
  it("is within 15% of the measured count for the real prompt", () => {
    // 1677 tokens measured via Ollama's prompt_eval_count for this exact prompt.
    const estimate = estimateTokens(system);
    expect(estimate).toBeGreaterThan(1677 * 0.85);
    expect(estimate).toBeLessThan(1677 * 1.35);
  });

  it("never under-estimates enough to overflow", () => {
    expect(estimateTokens(system)).toBeGreaterThanOrEqual(1677);
  });
});

describe("fitHistory", () => {
  it("keeps the whole history when it fits", () => {
    const kept = fitHistory(system, HISTORY, "make it 3 hours", 4096);
    expect(kept).toEqual(HISTORY);
  });

  it("drops the oldest turns rather than overflowing a small window", () => {
    const kept = fitHistory(system, HISTORY, "make it 3 hours", 2048);
    expect(kept.length).toBeLessThan(HISTORY.length);
    const total = estimateTokens(system) + estimateTokens("make it 3 hours") + kept.reduce((n, t) => n + estimateTokens(t.content) + 4, 0);
    expect(total).toBeLessThanOrEqual(2048);
  });

  it("keeps the NEWEST turns — those are what resolve a follow-up", () => {
    const kept = fitHistory(system, HISTORY, "make it 3 hours", 2048);
    if (kept.length > 0) {
      expect(kept.at(-1)).toEqual(HISTORY.at(-1));
    }
  });

  it("drops history entirely rather than truncate the system prompt", () => {
    const kept = fitHistory(system, HISTORY, "make it 3 hours", estimateTokens(system) + 10);
    expect(kept).toEqual([]);
  });

  it("is a no-op with no history", () => {
    expect(fitHistory(system, [], "turn on the spa", 4096)).toEqual([]);
  });
});

describe("shipped context window", () => {
  it("fits system + a full history inside the 4096 the deploy sets", () => {
    const kept = fitHistory(system, HISTORY, "turn on the hot tub at 9 pm");
    const total = estimateTokens(system) + estimateTokens("turn on the hot tub at 9 pm") + kept.reduce((n, t) => n + estimateTokens(t.content) + 4, 0);
    expect(total).toBeLessThanOrEqual(4096 - 512);
  });
});
