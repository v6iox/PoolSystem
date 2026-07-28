import type { CopilotContext } from "@/server/copilot/tools";
import { EMPTY_SNAPSHOT, type CircuitState, type PoolStateSnapshot } from "@/types/pool";

/**
 * The reference pool used by every copilot test: two bodies, eight circuits,
 * a chlorinator, one scene and two automations. Pool heat is OFF and the spa's
 * is ON, which is what makes "heat the pool to 85" (a target with no heater)
 * and "heat the hot tub" (right body, wrong name) interesting.
 */

export function circuit(id: number, name: string, type: string, opts: Partial<CircuitState> = {}): CircuitState {
  return { id, name, type, isOn: false, isLight: false, isFeature: false, lightTheme: null, showInFeatures: true, ...opts };
}

export const snapshot: PoolStateSnapshot = {
  ...EMPTY_SNAPSHOT,
  connected: true,
  mock: true,
  lastUpdate: Date.now(),
  units: "F",
  airTemp: 75,
  bodies: [
    {
      id: 1, name: "Pool", kind: "pool", isOn: true, temp: 78.2, setPoint: 86,
      minSetPoint: 60, maxSetPoint: 95, heatMode: "off",
      supportedHeatModes: ["off", "heater", "solar", "solarpref"], heatStatus: "off", circuitId: 6,
    },
    {
      id: 2, name: "Spa", kind: "spa", isOn: false, temp: 84, setPoint: 100,
      minSetPoint: 60, maxSetPoint: 104, heatMode: "heater",
      supportedHeatModes: ["off", "heater"], heatStatus: "off", circuitId: 1,
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
  pumps: [
    {
      id: 1, name: "IntelliFlo VSF", type: "vsf", isRunning: true, rpm: 1800,
      watts: 320, flow: null, minSpeed: 450, maxSpeed: 3450, circuits: [],
    },
  ],
  chlorinators: [
    {
      id: 1, name: "IntelliChlor IC40", isActive: true, currentOutput: 50,
      poolSetpoint: 50, spaSetpoint: 10, saltLevel: 3200, saltTarget: 3400,
      saltRequired: false, superChlor: false, superChlorHours: 24, status: "ok",
    },
  ],
};

export const ctx: CopilotContext = {
  snapshot,
  scenes: [{ id: 5, name: "Spa Night", guestVisible: false }],
  automations: [
    { id: 1, name: "Sunset lights", enabled: true, trigger: { type: "sun", event: "sunset", offsetMinutes: 0, days: [] } },
    { id: 2, name: "Morning cleaner", enabled: false, trigger: { type: "time", at: "09:00", days: [1] } },
  ],
  pendingPlan: null,
  role: "owner",
  guestVisibleCircuitIds: new Set<number>(),
};

/** Same pool, with a plan awaiting confirmation (for cancel_pending cases). */
export const ctxWithPending: CopilotContext = {
  ...ctx,
  pendingPlan: { messageId: 42, summary: ["Spa — heater ON"] },
};
