import type { PoolStateSnapshot } from "@/types/pool";
import { patchCircuit } from "@/lib/client/pool-state";

/**
 * patchCircuit plus the matching body's isOn — for pool/spa body circuits the
 * body chip/dial state should flip optimistically along with the circuit.
 */
export const patchCircuitWithBody =
  (circuitId: number, isOn: boolean) =>
  (snap: PoolStateSnapshot): PoolStateSnapshot => {
    const next = patchCircuit(circuitId, isOn)(snap);
    return {
      ...next,
      bodies: next.bodies.map((b) => (b.circuitId === circuitId ? { ...b, isOn } : b)),
    };
  };

/** Optimistic patch for the panic-button `allOff` action. */
export const patchAllOff = (snap: PoolStateSnapshot): PoolStateSnapshot => ({
  ...snap,
  bodies: snap.bodies.map((b) => ({ ...b, isOn: false })),
  circuits: snap.circuits.map((c) => ({ ...c, isOn: false })),
  features: snap.features.map((c) => ({ ...c, isOn: false })),
});
