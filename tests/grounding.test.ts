import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groundPlan } from "@/server/copilot/grounding";
import { detectTimeIntent, mentionedBodyKind, mentionedCircuits } from "@/server/copilot/nlu";
import { resolveAt, validateToolCall } from "@/server/copilot/tools";
import { ctx } from "./fixtures";

/**
 * The grounding layer is what makes a weak local model safe: it re-decides,
 * from the user's own words, the things a regex can settle — which body, which
 * circuit, and when. These cases are the real failures observed from
 * qwen3:1.7b and qwen3:0.6b against this fixture, replayed without a model.
 */

// 4:10 PM, so "at 9 pm" is later today and no case is time-of-day dependent.
const NOW = new Date(2026, 6, 27, 16, 10, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("nlu primitives", () => {
  it("reads hot tub and jacuzzi as the spa", () => {
    expect(mentionedBodyKind("turn on the hot tub", ctx)).toBe("spa");
    expect(mentionedBodyKind("warm the jacuzzi", ctx)).toBe("spa");
    expect(mentionedBodyKind("heat the pool", ctx)).toBe("pool");
  });

  it("does not treat 'pool lights' as naming the pool body", () => {
    expect(mentionedBodyKind("turn on the pool lights", ctx)).toBeNull();
  });

  it("returns null when both bodies are named", () => {
    expect(mentionedBodyKind("heat the pool and the spa", ctx)).toBeNull();
  });

  it("maps spa synonyms to the spa circuit", () => {
    expect(mentionedCircuits("turn on the hot tub", ctx)).toEqual([{ id: 1, name: "Spa" }]);
  });

  it("prefers the longest matching circuit name", () => {
    expect(mentionedCircuits("turn on the pool lights", ctx).map((c) => c.name)).toEqual(["Pool Lights"]);
  });

  it("separates absolute from relative times", () => {
    expect(detectTimeIntent("turn on the hot tub at 9 pm")).toEqual({ kind: "absolute", at: "21:00", dayOffset: 0 });
    expect(detectTimeIntent("in 2 hours heat the spa")).toEqual({ kind: "relative", inMinutes: 120 });
    expect(detectTimeIntent("turn on the waterfall")).toEqual({ kind: "none" });
  });

  it("reads a spaced meridian as morning, not evening", () => {
    expect(detectTimeIntent("start the cleaner at 6 a.m.")).toEqual({ kind: "absolute", at: "06:00", dayOffset: 0 });
  });

  it("carries an explicit tomorrow", () => {
    expect(detectTimeIntent("heat the spa tomorrow at 3pm")).toEqual({ kind: "absolute", at: "15:00", dayOffset: 1 });
  });
});

describe("grounding: the reported bug", () => {
  it('"turn on the hot tub at 9 pm" — schedules the SPA for 21:00, not the pool now', () => {
    // Exactly what qwen3:1.7b returned: right tool, wrong body, invented offset.
    const model = [
      { tool: "schedule_once", args: { inMinutes: 120, actions: [{ tool: "set_heat", args: { body: "pool", mode: "heater" } }] } },
    ];
    const { calls } = groundPlan("turn on the hot tub at 9 pm", model, ctx);
    expect(calls).toEqual([
      { tool: "schedule_once", args: { at: "21:00", actions: [{ tool: "set_heat", args: { body: "spa", mode: "heater" } }] } },
    ]);
  });

  it("drops the immediate copy of an action that is also scheduled", () => {
    // The model proposed heating now AND at 9 — the reason it "did it immediately".
    const model = [
      { tool: "set_heat", args: { body: "spa", mode: "heater" } },
      { tool: "schedule_once", args: { inMinutes: 120, actions: [{ tool: "set_heat", args: { body: "spa", mode: "heater" } }] } },
    ];
    const { calls, corrections } = groundPlan("heat the hot tub at 9pm", model, ctx);
    expect(calls).toHaveLength(1);
    expect(corrections.map((c) => c.rule)).toContain("duplicate");
  });

  it("schedules an action the model wanted to run immediately", () => {
    // qwen3:0.6b ignores the time entirely.
    const model = [{ tool: "set_circuit", args: { circuitId: 1, state: true } }];
    const { calls, corrections } = groundPlan("turn on the hot tub at 9 pm", model, ctx);
    expect(calls).toEqual([
      { tool: "schedule_once", args: { at: "21:00", actions: [{ tool: "set_circuit", args: { circuitId: 1, state: true } }] } },
    ]);
    expect(corrections.map((c) => c.rule)).toContain("wrap");
  });

  it("corrects a circuit the user never named", () => {
    // qwen3:0.6b picked Waterfall (2) for "the spa".
    const model = [{ tool: "set_circuit", args: { circuitId: 2, state: true } }];
    const { calls } = groundPlan("turn on the spa", model, ctx);
    expect(calls).toEqual([{ tool: "set_circuit", args: { circuitId: 1, state: true } }]);
  });

  it("drops a setpoint the user never asked for", () => {
    const model = [{ tool: "set_heat", args: { body: "spa", mode: "heater", setpoint: 88 } }];
    const { calls } = groundPlan("warm up the hot tub", model, ctx);
    expect(calls).toEqual([{ tool: "set_heat", args: { body: "spa", mode: "heater" } }]);
  });

  it("keeps a setpoint the user did ask for", () => {
    const model = [{ tool: "set_heat", args: { body: "spa", setpoint: 102 } }];
    const { calls } = groundPlan("set the hot tub to 102", model, ctx);
    expect(calls).toEqual([{ tool: "set_heat", args: { body: "spa", setpoint: 102 } }]);
  });

  it("turns the heater on when a bare target could never heat", () => {
    // Pool heat is OFF in the fixture, so a setpoint alone does nothing.
    const model = [{ tool: "set_heat", args: { body: "pool", setpoint: 85 } }];
    const { calls, corrections } = groundPlan("heat the pool to 85", model, ctx);
    expect(calls).toEqual([{ tool: "set_heat", args: { body: "pool", setpoint: 85, mode: "heater" } }]);
    expect(corrections.map((c) => c.rule)).toContain("heat-mode");
  });

  it('"stop the shock" does not start one', () => {
    const model = [{ tool: "super_chlorinate", args: { hours: 24 } }];
    const { calls } = groundPlan("stop the super chlorinate", model, ctx);
    expect(calls).toEqual([{ tool: "super_chlorinate", args: { hours: 24, on: false } }]);
  });

  it("unwraps a schedule the user never asked for", () => {
    const model = [
      { tool: "schedule_once", args: { inMinutes: 60, actions: [{ tool: "set_circuit", args: { circuitId: 2, state: true } }] } },
    ];
    const { calls, corrections } = groundPlan("turn on the waterfall", model, ctx);
    expect(calls).toEqual([{ tool: "set_circuit", args: { circuitId: 2, state: true } }]);
    expect(corrections.map((c) => c.rule)).toContain("unwrap");
  });
});

describe("grounding: leaves correct plans alone", () => {
  const untouched: Array<[string, unknown[]]> = [
    ["turn on the waterfall", [{ tool: "set_circuit", args: { circuitId: 2, state: true } }]],
    [
      "in 2 hours heat the hot tub",
      [{ tool: "schedule_once", args: { inMinutes: 120, actions: [{ tool: "set_heat", args: { body: "spa", mode: "heater" } }] } }],
    ],
    [
      "everything off at 11pm",
      [{ tool: "schedule_once", args: { at: "23:00", actions: [{ tool: "all_off", args: {} }] } }],
    ],
    ["what's the salt at?", [{ tool: "get_status", args: { scope: "chemistry" } }]],
    [
      "lights blue at sunset every friday",
      [
        {
          tool: "create_automation",
          args: {
            name: "Lights blue at sunset",
            trigger: { type: "sun", event: "sunset", offsetMinutes: 0, days: [5] },
            actions: [{ tool: "set_light_theme", args: { theme: "Blue" } }],
          },
        },
      ],
    ],
    [
      "run the cleaner 9 to 11 every weekday",
      [{ tool: "create_schedule", args: { circuitId: 5, start: "09:00", end: "11:00", days: [1, 2, 3, 4, 5] } }],
    ],
  ];

  for (const [text, model] of untouched) {
    it(`“${text}” is not rewritten`, () => {
      const { calls, corrections } = groundPlan(text, model, ctx);
      expect(corrections).toEqual([]);
      expect(calls).toEqual(model);
    });
  }

  it("does not redistribute actions across a multi-clause request", () => {
    // "spa night at 8 but kill the waterfall" — one scheduled, one immediate.
    const model = [
      { tool: "schedule_once", args: { at: "20:00", actions: [{ tool: "run_scene", args: { sceneId: 5 } }] } },
      { tool: "set_circuit", args: { circuitId: 2, state: false } },
    ];
    const { calls } = groundPlan("spa night at 8 but kill the waterfall", model, ctx);
    expect(calls).toEqual(model);
  });
});

describe("grounded plans survive validation", () => {
  it("produces a call the engine accepts, anchored to a real instant", () => {
    const model = [
      { tool: "schedule_once", args: { inMinutes: 120, actions: [{ tool: "set_heat", args: { body: "pool", mode: "heater" } }] } },
    ];
    const { calls } = groundPlan("turn on the hot tub at 9 pm", model, ctx);
    const result = validateToolCall(calls[0], ctx);
    expect(result.ok).toBe(true);
    if (!result.ok || result.call.tool !== "schedule_once") throw new Error("expected a schedule");
    expect(result.call.args.fireAt).toBe(resolveAt("21:00", NOW.getTime()));
    expect(new Date(result.call.args.fireAt).getHours()).toBe(21);
  });
});
