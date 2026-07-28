import { describe, expect, it } from "vitest";
import { CASES, matchPlan } from "./copilot-cases";
import { runLlm, runMock } from "./pipeline";
import { ctx, ctxWithPending } from "./fixtures";
import { validateToolCall } from "@/server/copilot/tools";

/**
 * Copilot intent eval. Every case runs through the real pipeline — parse,
 * ground, validate — and asserts the args that decide which physical thing
 * moves and when.
 *
 * With COPILOT_LIVE=true the same table runs against the configured LLM
 * backend (Ollama by default):
 *   COPILOT_LIVE=true COPILOT_MODEL=qwen3:1.7b npx vitest run copilot-eval
 * See model-bench.test.ts to score several models side by side.
 */

const MOCK_CASES = CASES.filter((c) => !c.mockSkip && !c.history);

describe("eval corpus", () => {
  it("covers every tag", () => {
    const tags = new Set(CASES.map((c) => c.tag));
    expect(tags.size).toBeGreaterThanOrEqual(14);
    expect(CASES.length).toBeGreaterThanOrEqual(70);
  });

  it("expects a body on every heat case, so a wrong-body plan cannot pass", () => {
    for (const c of CASES) {
      for (const e of [...c.expect, ...c.expect.flatMap((x) => x.actions ?? [])]) {
        if (e.tool === "set_heat") expect(e.args?.body, `“${c.text}”`).toBeDefined();
      }
    }
  });

  it("pins a wall-clock time on every absolute-schedule case", () => {
    for (const c of CASES.filter((x) => x.tag === "schedule-absolute")) {
      const schedule = c.expect.find((e) => e.tool === "schedule_once");
      expect(schedule?.at, `“${c.text}”`).toBeDefined();
    }
  });
});

describe("deterministic parser", () => {
  for (const evalCase of MOCK_CASES) {
    it(`“${evalCase.text}”`, () => {
      const result = runMock(evalCase.text, ctx);
      expect(result.problems, `validation refused: ${result.problems.join("; ")}`).toEqual([]);
      const reason = matchPlan(result.calls, evalCase.expect, Date.now());
      expect(reason, reason ?? undefined).toBeNull();
    });
  }
});

describe("cancel_pending", () => {
  it("is proposed only when there is something to cancel", () => {
    const result = runMock("cancel that", ctxWithPending);
    expect(result.calls.map((c) => c.tool)).toEqual(["cancel_pending"]);
  });
});

describe("bounds and refusals", () => {
  const refused: Array<[string, unknown]> = [
    ["setpoint above the body max", { tool: "set_heat", args: { body: "spa", setpoint: 200 } }],
    ["setpoint below the body min", { tool: "set_heat", args: { body: "pool", setpoint: 20 } }],
    ["chlorinator over 100%", { tool: "set_chlorinator", args: { outputPct: 500 } }],
    ["an unknown circuit", { tool: "set_circuit", args: { circuitId: 99, state: true } }],
    ["an unsupported heat mode", { tool: "set_heat", args: { body: "spa", mode: "solar" } }],
    ["a malformed panel schedule time", { tool: "create_schedule", args: { circuitId: 5, start: "9pm", end: "11:00", days: [] } }],
    ["a schedule more than 7 days out", { tool: "schedule_once", args: { at: "2027-01-01T09:00", actions: [{ tool: "all_off", args: {} }] } }],
    ["a non-action inside a schedule", { tool: "schedule_once", args: { inMinutes: 30, actions: [{ tool: "get_status", args: {} }] } }],
  ];

  for (const [label, call] of refused) {
    it(`refuses ${label}`, () => {
      expect(validateToolCall(call, ctx).ok).toBe(false);
    });
  }

  it("refuses a body the system doesn't have", () => {
    const onlyPool = { ...ctx, snapshot: { ...ctx.snapshot, bodies: [ctx.snapshot.bodies[0]!] } };
    expect(validateToolCall({ tool: "set_heat", args: { body: "spa", mode: "heater" } }, onlyPool).ok).toBe(false);
  });

  it("asks which body rather than guessing when one is omitted", () => {
    const result = validateToolCall({ tool: "set_heat", args: { mode: "heater" } }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/pool or the spa/i);
  });

  it("denies guests a panel schedule", () => {
    const asGuest = { ...ctx, role: "guest" as const };
    expect(validateToolCall({ tool: "create_schedule", args: { circuitId: 5, start: "09:00", end: "11:00", days: [] } }, asGuest).ok).toBe(
      false
    );
  });
});

/* ── live model ─────────────────────────────────────────────────────────── */

const live = process.env.COPILOT_LIVE === "true";

describe.skipIf(!live)("live LLM eval", () => {
  for (const evalCase of CASES) {
    it(
      `“${evalCase.text}”`,
      async () => {
        const withHistory = evalCase.history ? { ...ctx, history: evalCase.history } : ctx;
        const result = await runLlm(evalCase.text, withHistory);
        expect(result.problems, `validation refused: ${result.problems.join("; ")}`).toEqual([]);
        const reason = matchPlan(result.calls, evalCase.expect, Date.now());
        expect(reason, reason ?? undefined).toBeNull();
      },
      90_000
    );
  }
});
