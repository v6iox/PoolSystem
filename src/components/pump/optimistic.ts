import type { ChlorinatorState, PoolStateSnapshot, PumpState } from "@/types/pool";

/** Optimistic snapshot patches for pump + chlorinator controls. */

export const patchPump =
  (pumpId: number, patch: Partial<PumpState>) =>
  (snap: PoolStateSnapshot): PoolStateSnapshot => ({
    ...snap,
    pumps: snap.pumps.map((p) => (p.id === pumpId ? { ...p, ...patch } : p)),
  });

export const patchChlorinator =
  (chlorId: number, patch: Partial<ChlorinatorState>) =>
  (snap: PoolStateSnapshot): PoolStateSnapshot => ({
    ...snap,
    chlorinators: snap.chlorinators.map((c) => (c.id === chlorId ? { ...c, ...patch } : c)),
  });
