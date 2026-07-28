import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolStateSnapshot } from "@/types/pool";

/**
 * Temperature calibration on touch-family panels is applied BY MOONPOOL:
 * njsPC stores /config/tempSensors offsets for EasyTouch et al. without ever
 * applying them (that only happens in standalone/Nixie mode), and Pentair
 * provides no RS-485 message to calibrate the panel remotely. So the njsPC
 * adapter keeps offsets in Moonpool's DB and adds them in normalize().
 *
 * Also covered here: tempStale — with a body's circulation off, the panel
 * repeats its last reading, which must not be presented as live.
 */

let NjspcAdapter: typeof import("@/server/adapters/njspc").NjspcAdapter;
let setSetting: typeof import("@/server/settings").setSetting;
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "moonpool-calib-"));
  process.env.DATABASE_PATH = path.join(dir, "test.db");
  ({ setSetting } = await import("@/server/settings"));
  ({ NjspcAdapter } = await import("@/server/adapters/njspc"));
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Trimmed to the shape of a real EasyTouch2 8 /state/all payload. */
function easytouchState(): Record<string, unknown> {
  return {
    controllerType: "easytouch",
    equipment: { model: "EasyTouch2 8", controllerType: "easytouch", shared: true, dual: false },
    delay: { val: 32, name: "nodelay", desc: "No Delay" },
    freeze: false,
    mode: { val: 0, name: "auto", desc: "Auto" },
    temps: {
      units: { val: 0, name: "F" },
      air: 77,
      solar: 0,
      bodies: [
        { id: 1, name: "Pool", type: { val: 0, name: "pool" }, circuit: 6, temp: 85, setPoint: 85, isOn: true, heatMode: { val: 0, name: "off" }, heatStatus: { val: 0, name: "off" } },
        { id: 2, name: "Spa", type: { val: 1, name: "spa" }, circuit: 1, temp: 83, setPoint: 100, isOn: false, heatMode: { val: 0, name: "off" }, heatStatus: { val: 0, name: "off" } },
      ],
    },
    circuits: [],
    features: [],
    pumps: [],
    chlorinators: [],
    lightGroups: [],
    schedules: [],
    chemControllers: [],
  };
}

function normalize(adapter: InstanceType<typeof NjspcAdapter>, state: Record<string, unknown>): PoolStateSnapshot {
  return (adapter as unknown as { normalize: (s: Record<string, unknown>) => PoolStateSnapshot }).normalize(state);
}

describe("moonpool-side temp calibration", () => {
  it("applies stored offsets to touch-panel readings", () => {
    setSetting("njspcTempCalibration", { water1: 2, air: -3 });
    const snap = normalize(new NjspcAdapter("http://test:4200"), easytouchState());
    expect(snap.airTemp).toBe(74); // 77 - 3
    expect(snap.bodies.find((b) => b.id === 1)?.temp).toBe(87); // 85 + 2
    // Shared equipment = one physical water sensor → spa gets water1 too.
    expect(snap.bodies.find((b) => b.id === 2)?.temp).toBe(85); // 83 + 2
  });

  it("uses the water2 offset for body 2 only on dual-equipment systems", () => {
    setSetting("njspcTempCalibration", { water1: 2, water2: -1, air: 0 });
    const state = easytouchState();
    (state.equipment as Record<string, unknown>).dual = true;
    (state.equipment as Record<string, unknown>).shared = false;
    const snap = normalize(new NjspcAdapter("http://test:4200"), state);
    expect(snap.bodies.find((b) => b.id === 2)?.temp).toBe(82); // 83 - 1
  });

  it("does not touch standalone/Nixie readings — njsPC already calibrated them", () => {
    setSetting("njspcTempCalibration", { water1: 5, air: 5 });
    const state = easytouchState();
    state.controllerType = "nixie";
    (state.equipment as Record<string, unknown>).controllerType = "nixie";
    const snap = normalize(new NjspcAdapter("http://test:4200"), state);
    expect(snap.airTemp).toBe(77);
    expect(snap.bodies.find((b) => b.id === 1)?.temp).toBe(85);
  });
});

describe("stale temp flag", () => {
  it("marks a body whose circulation is off as stale, live otherwise", () => {
    setSetting("njspcTempCalibration", { water1: 0, air: 0 });
    const snap = normalize(new NjspcAdapter("http://test:4200"), easytouchState());
    expect(snap.bodies.find((b) => b.id === 1)?.tempStale).toBe(false); // pool circulating
    expect(snap.bodies.find((b) => b.id === 2)?.tempStale).toBe(true); // spa off — last reading only
  });
});
