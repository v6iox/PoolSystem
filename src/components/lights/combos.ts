import type { CircuitState } from "@/types/pool";
import type { PoolAction } from "@/types/actions";

/**
 * Saved light combos — named snapshots of every light's power + theme,
 * persisted per-user under the `lightCombos` key of /api/settings/prefs.
 */

/** One light's captured state inside a saved combo. */
export interface LightComboEntry {
  circuitId: number;
  /** Theme value at save time; null for lights with no theme set. */
  theme: number | null;
  on: boolean;
}

export interface LightCombo {
  id: string;
  name: string;
  savedAt: number;
  entries: LightComboEntry[];
}

/** Defensive parse of the `lightCombos` prefs blob (arbitrary JSON from the server). */
export function parseCombos(value: unknown): LightCombo[] {
  if (!Array.isArray(value)) return [];
  const combos: LightCombo[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== "string" || typeof rec.name !== "string" || !Array.isArray(rec.entries)) continue;
    const entries: LightComboEntry[] = [];
    for (const entry of rec.entries) {
      if (typeof entry !== "object" || entry === null) continue;
      const er = entry as Record<string, unknown>;
      if (typeof er.circuitId !== "number") continue;
      entries.push({
        circuitId: er.circuitId,
        theme: typeof er.theme === "number" ? er.theme : null,
        on: typeof er.on === "boolean" ? er.on : true,
      });
    }
    combos.push({
      id: rec.id,
      name: rec.name,
      savedAt: typeof rec.savedAt === "number" ? rec.savedAt : 0,
      entries,
    });
  }
  return combos;
}

/** Snapshot the current light circuits into combo entries. */
export function captureEntries(lights: CircuitState[]): LightComboEntry[] {
  return lights.map((l) => ({ circuitId: l.id, theme: l.lightTheme, on: l.isOn }));
}

/** Actions that re-create a combo, restricted to lights that still exist. */
export function comboActions(combo: LightCombo, availableIds: Set<number>): PoolAction[] {
  return combo.entries
    .filter((e) => availableIds.has(e.circuitId))
    .map((e): PoolAction => {
      if (!e.on) return { type: "setCircuit", circuitId: e.circuitId, state: false };
      if (e.theme !== null) return { type: "setLightTheme", circuitId: e.circuitId, theme: e.theme };
      return { type: "setCircuit", circuitId: e.circuitId, state: true };
    });
}
