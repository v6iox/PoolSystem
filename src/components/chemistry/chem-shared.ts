import type { AppSettings } from "@/server/settings";

/**
 * Shared shapes + metric metadata for the chemistry page. `AppSettings` is a
 * type-only import (erased at compile time), so no server code reaches the
 * client bundle.
 */

export type IdealRanges = AppSettings["idealRanges"];

/** One row from GET /api/chemistry (snake_case straight from SQLite). */
export interface ChemReading {
  id: number;
  at: number;
  body_id: number;
  ph: number | null;
  orp: number | null;
  fc: number | null;
  ta: number | null;
  cya: number | null;
  ch: number | null;
  salt: number | null;
  notes: string;
  user_id: number | null;
}

export const METRIC_KEYS = ["ph", "fc", "ta", "cya", "ch", "salt"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
/** Everything loggable, including the probe-style extra. */
export type ReadingField = MetricKey | "orp";

export interface MetricDef {
  key: MetricKey;
  label: string;
  short: string;
  unit: string;
  /** Fallback display domain for the range bars (expanded to fit data). */
  domain: [number, number];
}

export const METRICS: MetricDef[] = [
  { key: "ph", label: "Acidity", short: "pH", unit: "", domain: [6.8, 8.4] },
  { key: "fc", label: "Free chlorine", short: "FC", unit: "ppm", domain: [0, 10] },
  { key: "ta", label: "Total alkalinity", short: "TA", unit: "ppm", domain: [0, 240] },
  { key: "cya", label: "Stabilizer", short: "CYA", unit: "ppm", domain: [0, 120] },
  { key: "ch", label: "Calcium hardness", short: "CH", unit: "ppm", domain: [0, 800] },
  { key: "salt", label: "Salt", short: "Salt", unit: "ppm", domain: [0, 4800] },
];

/** Mirrors the server defaults — used only if the settings fetch fails. */
export const FALLBACK_RANGES: IdealRanges = {
  ph: [7.4, 7.6],
  fc: [2, 4],
  ta: [80, 120],
  cya: [30, 50],
  ch: [200, 400],
  salt: [3000, 3600],
  orp: [650, 750],
};

/** Plausibility bounds enforced by POST /api/chemistry — mirrored for inline validation. */
export const PLAUSIBLE_BOUNDS: Record<ReadingField, [number, number]> = {
  ph: [5, 10],
  orp: [200, 1000],
  fc: [0, 30],
  ta: [0, 400],
  cya: [0, 300],
  ch: [0, 1500],
  salt: [0, 10000],
};

export interface LatestValue {
  value: number;
  at: number;
}

/** Newest non-null value per field across readings (any order accepted). */
export function latestPerField(readings: ChemReading[]): Partial<Record<ReadingField, LatestValue>> {
  const fields: ReadingField[] = [...METRIC_KEYS, "orp"];
  const sorted = [...readings].sort((a, b) => b.at - a.at);
  const out: Partial<Record<ReadingField, LatestValue>> = {};
  for (const reading of sorted) {
    for (const field of fields) {
      if (out[field] !== undefined) continue;
      const value = reading[field];
      if (value !== null) out[field] = { value, at: reading.at };
    }
    if (fields.every((f) => out[f] !== undefined)) break;
  }
  return out;
}

export type RangeStatus = "below" | "in" | "above";

export function rangeStatus(value: number, range: [number, number]): RangeStatus {
  if (value < range[0]) return "below";
  if (value > range[1]) return "above";
  return "in";
}
