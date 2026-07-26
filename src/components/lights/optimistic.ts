import type { CircuitState, PoolStateSnapshot } from "@/types/pool";

/**
 * Optimistic patches for light control. Applying a theme also wakes the
 * fixture — IntelliBrite turns on to display the new theme — so both the
 * theme value and `isOn` flip immediately.
 */

export const patchLightTheme =
  (circuitId: number, theme: number) =>
  (snap: PoolStateSnapshot): PoolStateSnapshot => {
    const apply = (c: CircuitState): CircuitState =>
      c.id === circuitId && c.isLight ? { ...c, isOn: true, lightTheme: theme } : c;
    return {
      ...snap,
      circuits: snap.circuits.map(apply),
      features: snap.features.map(apply),
    };
  };

/** A group theme lands on the group and on every member light. */
export const patchLightGroupTheme =
  (groupId: number, theme: number) =>
  (snap: PoolStateSnapshot): PoolStateSnapshot => {
    const members = new Set(snap.lightGroups.find((g) => g.id === groupId)?.circuitIds ?? []);
    const apply = (c: CircuitState): CircuitState =>
      members.has(c.id) && c.isLight ? { ...c, isOn: true, lightTheme: theme } : c;
    return {
      ...snap,
      lightGroups: snap.lightGroups.map((g) => (g.id === groupId ? { ...g, isOn: true, theme } : g)),
      circuits: snap.circuits.map(apply),
      features: snap.features.map(apply),
    };
  };
