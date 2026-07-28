import { describe, expect, it, vi } from "vitest";
import { assess, expectationsFor, verifyAction, type VerificationOutcome } from "@/server/verify";
import type { PoolAction } from "@/types/actions";
import type { PoolStateSnapshot } from "@/types/pool";
import { circuit, snapshot } from "./fixtures";

/**
 * The command heartbeat. njsPC accepts a command and says nothing about
 * whether the panel obeyed, so these cases cover the three outcomes that
 * matter: it took, it was silently dropped (retry, then tell the user), or
 * something else moved it (report, don't fight it).
 */

function withCircuit(id: number, isOn: boolean): PoolStateSnapshot {
  return { ...snapshot, circuits: snapshot.circuits.map((c) => (c.id === id ? { ...c, isOn } : c)) };
}

function withHeat(bodyId: number, patch: { heatMode?: string; setPoint?: number }): PoolStateSnapshot {
  return {
    ...snapshot,
    bodies: snapshot.bodies.map((b) => (b.id === bodyId ? { ...b, ...patch } : b)),
  } as PoolStateSnapshot;
}

const ON_WATERFALL: PoolAction = { type: "setCircuit", circuitId: 2, state: true };

describe("expectations", () => {
  it("knows what a circuit command should produce", () => {
    const [exp] = expectationsFor(ON_WATERFALL);
    expect(exp?.want).toBe("on");
    expect(exp?.read(withCircuit(2, true))).toBe("on");
    expect(exp?.read(withCircuit(2, false))).toBe("off");
  });

  it("checks both halves of a heat command", () => {
    const exps = expectationsFor({ type: "setHeat", bodyId: 2, mode: "heater", setPoint: 102 });
    expect(exps.map((e) => e.want)).toEqual(["heater", "102"]);
  });

  it("does not check pump RPM — it ramps, and a false alarm is worse than none", () => {
    expect(expectationsFor({ type: "setPumpSpeed", pumpId: 1, rpm: 2400 })).toEqual([]);
  });

  it("verifies a scene through its expanded actions, not the scene itself", () => {
    expect(expectationsFor({ type: "runScene", sceneId: 5 })).toEqual([]);
  });
});

describe("assess", () => {
  const exp = { label: "circuit 2", want: "on", read: () => null };

  it("confirms a value that matches", () => {
    expect(assess(exp, "off", "on")).toEqual({ state: "confirmed" });
  });

  it("calls an unchanged value dropped", () => {
    expect(assess(exp, "off", "off")).toEqual({ state: "dropped", got: "off" });
  });

  it("calls a third value an override", () => {
    expect(assess({ ...exp, want: "102" }, "100", "104")).toEqual({ state: "overridden", got: "104" });
  });

  it("stays quiet when the panel reports nothing", () => {
    expect(assess(exp, "off", null)).toEqual({ state: "unknown" });
  });
});

describe("verifyAction", () => {
  function harness(sequence: PoolStateSnapshot[]) {
    const outcomes: VerificationOutcome[] = [];
    const resend = vi.fn(async () => undefined);
    let reads = 0;
    return {
      outcomes,
      resend,
      deps: {
        snapshot: () => sequence[Math.min(reads++, sequence.length - 1)] as PoolStateSnapshot,
        resend,
        wait: async () => undefined,
        onResult: (o: VerificationOutcome) => outcomes.push(o),
      },
    };
  }

  it("says nothing when the command took", async () => {
    const h = harness([withCircuit(2, true)]);
    await verifyAction(ON_WATERFALL, withCircuit(2, false), h.deps);
    expect(h.outcomes).toEqual([]);
    expect(h.resend).not.toHaveBeenCalled();
  });

  it("re-sends a dropped command, then stays quiet if the retry lands", async () => {
    const h = harness([withCircuit(2, false), withCircuit(2, true)]);
    await verifyAction(ON_WATERFALL, withCircuit(2, false), h.deps);
    expect(h.resend).toHaveBeenCalledTimes(1);
    expect(h.outcomes).toEqual([]);
  });

  it("reports a command that never lands, even after a retry", async () => {
    const h = harness([withCircuit(2, false), withCircuit(2, false)]);
    await verifyAction(ON_WATERFALL, withCircuit(2, false), h.deps);
    expect(h.resend).toHaveBeenCalledTimes(1);
    expect(h.outcomes).toHaveLength(1);
    expect(h.outcomes[0]).toMatchObject({ state: "dropped", want: "on", got: "off", retried: true });
  });

  it("reports an override without fighting it", async () => {
    const before = withHeat(2, { setPoint: 100 });
    const after = withHeat(2, { setPoint: 96 }); // someone used the panel
    const h = harness([after]);
    await verifyAction({ type: "setHeat", bodyId: 2, setPoint: 102 }, before, h.deps);
    expect(h.resend).not.toHaveBeenCalled();
    expect(h.outcomes[0]).toMatchObject({ state: "overridden", want: "102", got: "96" });
  });

  it("flags only the half of a heat command that failed", async () => {
    const before = withHeat(2, { heatMode: "off", setPoint: 100 });
    const after = withHeat(2, { heatMode: "heater", setPoint: 100 }); // mode took, setpoint didn't
    const h = harness([after, after]);
    await verifyAction({ type: "setHeat", bodyId: 2, mode: "heater", setPoint: 102 }, before, h.deps);
    expect(h.outcomes).toHaveLength(1);
    expect(h.outcomes[0]).toMatchObject({ want: "102", got: "100" });
  });

  it("treats an unknown circuit as unverifiable rather than failed", async () => {
    const bare = { ...snapshot, circuits: [circuit(9, "Other", "generic")], features: [] } as PoolStateSnapshot;
    const h = harness([bare]);
    await verifyAction(ON_WATERFALL, bare, h.deps);
    expect(h.outcomes).toEqual([]);
  });
});
