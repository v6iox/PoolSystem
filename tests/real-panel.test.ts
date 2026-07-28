import { describe, expect, it } from "vitest";
import { runMock } from "./pipeline";
import { EMPTY_SNAPSHOT, type CircuitState, type PoolStateSnapshot } from "@/types/pool";
import type { CopilotContext } from "@/server/copilot/tools";

/**
 * The deterministic copilot against a real Pentair EasyTouch2 8, using the
 * circuit ids and equipment actually read off the RS-485 bus rather than the
 * tidy synthetic fixture.
 *
 * This is the configuration that ships on Pi-class hardware
 * (COPILOT_FORCE_MOCK=true): no model, no memory cost, instant. The layout is
 * deliberately awkward — circuit ids are not contiguous or ordered, the spa
 * reports no temperature while it isn't circulating, and there is no pump on
 * the bus — because that is what a real panel looks like.
 */

const c = (id: number, name: string, type: string, o: Partial<CircuitState> = {}): CircuitState => ({
  id, name, type, isOn: false, isLight: false, isFeature: false, lightTheme: null, showInFeatures: true, ...o,
});

const snapshot: PoolStateSnapshot = {
  ...EMPTY_SNAPSHOT,
  connected: true, mock: false, lastUpdate: Date.now(), units: "F", airTemp: 79,
  bodies: [
    { id: 1, name: "Pool", kind: "pool", isOn: true, temp: 85, setPoint: 93, minSetPoint: 60, maxSetPoint: 104,
      heatMode: "off", supportedHeatModes: ["off", "heater", "solar", "solarpref"], heatStatus: "off", circuitId: 6 },
    // Spa reports no temperature until water is circulating through it.
    { id: 2, name: "Spa", kind: "spa", isOn: false, temp: null, setPoint: 104, minSetPoint: 60, maxSetPoint: 104,
      heatMode: "off", supportedHeatModes: ["off", "heater"], heatStatus: "off", circuitId: 1 },
  ],
  circuits: [
    c(6, "Pool", "pool", { isOn: true }), c(1, "Spa", "spa"), c(2, "Cleaner", "mastercleaner"),
    c(3, "Air Blower", "generic"), c(4, "Spillway", "generic"), c(5, "Waterfall", "generic"),
    c(7, "Jets", "generic"), c(8, "Pool Light", "intellibrite", { isLight: true, lightTheme: 0 }),
    c(9, "AUX 7", "generic"),
  ],
  lightThemes: [
    { val: 0, name: "White", type: "color", swatch: "#fff" },
    { val: 2, name: "Blue", type: "color", swatch: "#3b82f6" },
    { val: 4, name: "Red", type: "color", swatch: "#ef4444" },
  ],
  chlorinators: [
    { id: 1, name: "Intellichlor--40", isActive: true, currentOutput: 80, poolSetpoint: 80, spaSetpoint: 10,
      saltLevel: 3500, saltTarget: 3400, saltRequired: false, superChlor: false, superChlorHours: 24, status: "ok" },
  ],
};

const ctx: CopilotContext = {
  snapshot, scenes: [], automations: [], pendingPlan: null, role: "owner",
  guestVisibleCircuitIds: new Set<number>(),
};

describe("no-LLM copilot on a real EasyTouch", () => {
  const cases: Array<[string, string, Record<string, unknown> | undefined]> = [
    ["turn on the waterfall", "set_circuit", { circuitId: 5, state: true }],
    ["turn off the waterfall", "set_circuit", { circuitId: 5, state: false }],
    ["turn on the cleaner", "set_circuit", { circuitId: 2, state: true }],
    ["kill the jets", "set_circuit", { circuitId: 7, state: false }],
    ["turn on the spillway", "set_circuit", { circuitId: 4, state: true }],
    ["turn on the air blower", "set_circuit", { circuitId: 3, state: true }],
    ["everything off", "all_off", undefined],
    ["how warm is the pool?", "get_status", { scope: "temps" }],
    ["what's the salt at?", "get_status", { scope: "chemistry" }],
    ["set the pool to 90", "set_heat", { body: "pool", setpoint: 90 }],
    ["turn off the spa heater", "set_heat", { body: "spa", mode: "off" }],
    ["super chlorinate the pool", "super_chlorinate", { on: true }],
  ];

  for (const [text, tool, args] of cases) {
    it(`“${text}” → ${tool}`, () => {
      const result = runMock(text, ctx);
      expect(result.problems, result.problems.join("; ")).toEqual([]);
      expect(result.calls.map((x) => x.tool)).toEqual([tool]);
      if (args) expect(result.calls[0]?.args).toMatchObject(args);
    });
  }

  it("schedules for the requested wall-clock time, anchored to a real instant", () => {
    const result = runMock("turn everything off at 11pm", ctx);
    expect(result.problems).toEqual([]);
    const call = result.calls[0];
    if (call?.tool !== "schedule_once") throw new Error(`expected a schedule, got ${call?.tool}`);
    expect(new Date(call.args.fireAt).getHours()).toBe(23);
    expect(call.args.fireAt).toBeGreaterThan(Date.now());
    expect(call.args.actions.map((a) => a.tool)).toEqual(["all_off"]);
  });

  it("never targets a circuit this panel doesn't have", () => {
    const ids = new Set(snapshot.circuits.map((x) => x.id));
    for (const [text] of cases) {
      for (const call of runMock(text, ctx).calls) {
        if (call.tool === "set_circuit") expect(ids.has(call.args.circuitId), `“${text}”`).toBe(true);
      }
    }
  });
});
