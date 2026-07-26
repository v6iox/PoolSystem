import { describe, expect, it } from "vitest";
import { parseUtterance } from "@/server/copilot/mock-parser";
import { parseWithLlm } from "@/server/copilot/llm";
import type { CopilotContext, ToolCall } from "@/server/copilot/tools";
import { EMPTY_SNAPSHOT, type CircuitState, type PoolStateSnapshot } from "@/types/pool";

/**
 * Copilot intent eval: 30+ utterances → expected structured tool calls, run
 * through the deterministic mock parser (no HTTP, no DB — the context is
 * injected). With COPILOT_LIVE=true the same table also runs against the
 * live LLM client and asserts the chosen tool names match (args stay loose).
 */

function circuit(id: number, name: string, type: string, opts: Partial<CircuitState> = {}): CircuitState {
  return {
    id,
    name,
    type,
    isOn: false,
    isLight: false,
    isFeature: false,
    lightTheme: null,
    showInFeatures: true,
    ...opts,
  };
}

const snapshot: PoolStateSnapshot = {
  ...EMPTY_SNAPSHOT,
  connected: true,
  mock: true,
  lastUpdate: Date.now(),
  units: "F",
  airTemp: 75,
  bodies: [
    {
      id: 1,
      name: "Pool",
      kind: "pool",
      isOn: true,
      temp: 78.2,
      setPoint: 86,
      minSetPoint: 60,
      maxSetPoint: 95,
      heatMode: "off",
      supportedHeatModes: ["off", "heater", "solar", "solarpref"],
      heatStatus: "off",
      circuitId: 6,
    },
    {
      id: 2,
      name: "Spa",
      kind: "spa",
      isOn: false,
      temp: 84,
      setPoint: 100,
      minSetPoint: 60,
      maxSetPoint: 104,
      heatMode: "heater",
      supportedHeatModes: ["off", "heater"],
      heatStatus: "off",
      circuitId: 1,
    },
  ],
  circuits: [
    circuit(1, "Spa", "spa"),
    circuit(2, "Waterfall", "generic"),
    circuit(3, "Pool Lights", "intellibrite", { isLight: true, lightTheme: 2 }),
    circuit(4, "Spa Light", "intellibrite", { isLight: true, lightTheme: 2 }),
    circuit(5, "Cleaner", "mastercleaner"),
    circuit(6, "Pool", "pool", { isOn: true }),
    circuit(7, "Jets", "generic"),
    circuit(8, "Landscape Lights", "light", { isLight: true }),
  ],
  lightThemes: [
    { val: 0, name: "White", type: "color", swatch: "#fff" },
    { val: 2, name: "Blue", type: "color", swatch: "#3b82f6" },
    { val: 4, name: "Red", type: "color", swatch: "#ef4444" },
    { val: 6, name: "Party", type: "show", swatch: "#f00" },
    { val: 10, name: "Sunset", type: "show", swatch: "#f97316" },
  ],
  lightGroups: [{ id: 192, name: "Pool & Spa Lights", circuitIds: [3, 4], isOn: false, theme: 2 }],
  chlorinators: [
    {
      id: 1,
      name: "IntelliChlor IC40",
      isActive: true,
      currentOutput: 50,
      poolSetpoint: 50,
      spaSetpoint: 10,
      saltLevel: 3200,
      saltTarget: 3400,
      saltRequired: false,
      superChlor: false,
      superChlorHours: 24,
      status: "ok",
    },
  ],
};

const ctx: CopilotContext = {
  snapshot,
  scenes: [{ id: 5, name: "Spa Night", guestVisible: false }],
  automations: [
    { id: 1, name: "Sunset lights", enabled: true, trigger: { type: "sun", event: "sunset", offsetMinutes: 0, days: [] } },
    { id: 2, name: "Morning cleaner", enabled: false, trigger: { type: "time", at: "09:00", days: [1] } },
  ],
  pendingPlan: { messageId: 42, summary: ["Spa — heater ON"] },
  role: "owner",
  guestVisibleCircuitIds: new Set<number>(),
};

/** Deep-partial expectation for one call: tool name + key args. */
interface ExpectedCall {
  tool: ToolCall["tool"];
  args?: Record<string, unknown>;
}

interface EvalCase {
  text: string;
  expected: ExpectedCall[];
}

const CASES: EvalCase[] = [
  // status questions + greetings
  { text: "what's the salt at?", expected: [{ tool: "get_status", args: { scope: "chemistry" } }] },
  { text: "how warm is the pool?", expected: [{ tool: "get_status", args: { scope: "temps" } }] },
  { text: "is the waterfall on?", expected: [{ tool: "get_status", args: { scope: "circuits" } }] },
  { text: "is the pump running?", expected: [{ tool: "get_status", args: { scope: "equipment" } }] },
  { text: "hey there", expected: [{ tool: "get_status", args: { scope: "all" } }] },
  { text: "pool status", expected: [{ tool: "get_status", args: { scope: "all" } }] },

  // circuits by name
  { text: "turn on the waterfall", expected: [{ tool: "set_circuit", args: { circuitId: 2, state: true } }] },
  { text: "kill the jets", expected: [{ tool: "set_circuit", args: { circuitId: 7, state: false } }] },
  { text: "turn on the pool lights", expected: [{ tool: "set_circuit", args: { circuitId: 3, state: true } }] },
  {
    text: "turn off the waterfall and jets",
    expected: [
      { tool: "set_circuit", args: { circuitId: 2, state: false } },
      { tool: "set_circuit", args: { circuitId: 7, state: false } },
    ],
  },

  // heat
  { text: "warm the spa a bit", expected: [{ tool: "set_heat", args: { body: "spa", setpoint: 102 } }] },
  { text: "set spa to 102", expected: [{ tool: "set_heat", args: { body: "spa", setpoint: 102 } }] },
  { text: "heat the pool to 85", expected: [{ tool: "set_heat", args: { body: "pool", setpoint: 85 } }] },
  { text: "turn off the spa heater", expected: [{ tool: "set_heat", args: { body: "spa", mode: "off" } }] },
  { text: "start heating", expected: [{ tool: "set_heat", args: { body: "spa", mode: "heater" } }] },

  // everything off + scheduling
  { text: "everything off", expected: [{ tool: "all_off" }] },
  {
    text: "start heating and turn off around midnight",
    expected: [
      { tool: "set_heat", args: { body: "spa", mode: "heater" } },
      { tool: "schedule_once", args: { at: "00:00", actions: [{ tool: "set_heat", args: { body: "spa", mode: "off" } }] } },
    ],
  },
  {
    text: "spa night at 8 but kill the waterfall",
    expected: [
      { tool: "schedule_once", args: { at: "20:00", actions: [{ tool: "run_scene", args: { sceneId: 5 } }] } },
      { tool: "set_circuit", args: { circuitId: 2, state: false } },
    ],
  },
  {
    text: "turn everything off at 11pm",
    expected: [{ tool: "schedule_once", args: { at: "23:00", actions: [{ tool: "all_off" }] } }],
  },
  {
    text: "turn on the cleaner at 6am",
    expected: [{ tool: "schedule_once", args: { at: "06:00", actions: [{ tool: "set_circuit", args: { circuitId: 5, state: true } }] } }],
  },

  // cancel
  { text: "cancel that", expected: [{ tool: "cancel_pending" }] },

  // automations
  {
    text: "lights blue at sunset every friday",
    expected: [
      {
        tool: "create_automation",
        args: {
          trigger: { type: "sun", event: "sunset", days: [5] },
          actions: [{ tool: "set_light_theme", args: { theme: "Blue" } }],
        },
      },
    ],
  },
  { text: "list my automations", expected: [{ tool: "list_automations" }] },
  { text: "pause the sunset lights automation", expected: [{ tool: "pause_automation", args: { id: 1 } }] },
  { text: "resume sunset lights", expected: [{ tool: "resume_automation", args: { id: 1 } }] },
  { text: "delete automation 2", expected: [{ tool: "delete_automation", args: { id: 2 } }] },

  // scenes + light themes
  { text: "run spa night", expected: [{ tool: "run_scene", args: { sceneId: 5 } }] },
  { text: "lights to party", expected: [{ tool: "set_light_theme", args: { theme: "Party" } }] },
  { text: "spa lights red", expected: [{ tool: "set_light_theme", args: { theme: "Red" } }] },

  // chlorination
  { text: "super chlorinate the pool", expected: [{ tool: "super_chlorinate", args: { on: true, hours: 24 } }] },
  { text: "shock the pool for 12 hours", expected: [{ tool: "super_chlorinate", args: { on: true, hours: 12 } }] },
  { text: "set the chlorinator to 70%", expected: [{ tool: "set_chlorinator", args: { outputPct: 70 } }] },

  // chemistry logging
  { text: "ph 7.8 ta 90", expected: [{ tool: "log_chemistry", args: { readings: { ph: 7.8, ta: 90 } } }] },
  { text: "log salt 3100", expected: [{ tool: "log_chemistry", args: { readings: { salt: 3100 } } }] },
  { text: "fc 3.5 and cya 45", expected: [{ tool: "log_chemistry", args: { readings: { fc: 3.5, cya: 45 } } }] },
];

describe("copilot mock parser eval", () => {
  it("covers at least 30 utterances", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(30);
  });

  for (const evalCase of CASES) {
    it(`parses “${evalCase.text}”`, () => {
      const result = parseUtterance(evalCase.text, ctx);
      expect(result.calls).toHaveLength(evalCase.expected.length);
      expect(result.calls.map((c) => c.tool)).toEqual(evalCase.expected.map((e) => e.tool));
      expect(result.calls).toMatchObject(evalCase.expected);
    });
  }
});

/**
 * Live LLM eval — opt-in because it needs a running OpenAI-compatible backend
 * (Ollama by default): COPILOT_LIVE=true npx vitest run
 * Only the chosen tool names are asserted; args are allowed to vary.
 */
const live = process.env.COPILOT_LIVE === "true";

describe.skipIf(!live)("copilot live LLM eval", () => {
  for (const evalCase of CASES) {
    it(
      `LLM picks the right tools for “${evalCase.text}”`,
      async () => {
        const plan = await parseWithLlm(evalCase.text, ctx);
        const gotTools = plan.tool_calls
          .map((c) => (c && typeof c === "object" ? (c as { tool?: unknown }).tool : undefined))
          .filter((t): t is string => typeof t === "string")
          .sort();
        const wantTools = evalCase.expected.map((e) => e.tool as string).sort();
        expect(gotTools).toEqual(wantTools);
      },
      30_000
    );
  }
});
