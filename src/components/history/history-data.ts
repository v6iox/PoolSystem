"use client";

/**
 * Shared data layer for the History page: range definitions, TanStack Query
 * hooks over /api/history + /api/history/runtime + /api/chemistry, and the
 * row-shaping helpers that turn API responses into recharts-friendly rows.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiGet } from "@/lib/client/api";
import { DAY_LABELS, formatClock } from "@/lib/utils";

/* ── Ranges ────────────────────────────────────────────────────── */

export interface RangeDef {
  key: "24h" | "3d" | "7d" | "30d" | "90d";
  label: string;
  days: number;
}

export type RangeKey = RangeDef["key"];

export const DEFAULT_RANGE: RangeDef = { key: "24h", label: "24h", days: 1 };

export const RANGES: readonly RangeDef[] = [
  DEFAULT_RANGE,
  { key: "3d", label: "3d", days: 3 },
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
];

export function rangeByKey(key: RangeKey): RangeDef {
  return RANGES.find((r) => r.key === key) ?? DEFAULT_RANGE;
}

/** Human phrase for subtitles: "24 hours", "7 days"… */
export function rangeTitle(range: RangeDef): string {
  return range.days === 1 ? "24 hours" : `${range.days} days`;
}

/** ≤3 days → raw bucketed samples; beyond → daily min/max/avg rollups. */
export type ChartMode = "raw" | "rollup";

export function rangeMode(range: RangeDef): ChartMode {
  return range.days <= 3 ? "raw" : "rollup";
}

/* ── Chart colors (CSS variables — theme-aware by construction) ── */

export const CHART_COLORS = {
  accent: "var(--accent)",
  heat: "var(--heat)",
  warn: "var(--warn)",
  ok: "var(--ok)",
  grid: "var(--line)",
  cursor: "var(--line-bright)",
  tick: "var(--ink-faint)",
} as const;

/* ── /api/history ──────────────────────────────────────────────── */

export interface SeriesPoint {
  at: number;
  value: number;
}

export interface RollupPoint {
  day: string;
  min: number;
  max: number;
  avg: number;
}

export interface HistoryResponse {
  series: Record<string, SeriesPoint[] | undefined>;
  rollups: Record<string, RollupPoint[] | undefined>;
  from: number;
  to: number;
}

export function useHistory(range: RangeDef, metrics: readonly string[]): UseQueryResult<HistoryResponse> {
  return useQuery({
    queryKey: ["history", range.key, metrics.join(",")],
    enabled: metrics.length > 0,
    refetchInterval: 60_000,
    queryFn: () => {
      const to = Date.now();
      const from = to - range.days * 86_400_000;
      return apiGet<HistoryResponse>(
        `/api/history?metrics=${encodeURIComponent(metrics.join(","))}&from=${from}&to=${to}`
      );
    },
  });
}

/* ── /api/history/runtime ──────────────────────────────────────── */

export interface RuntimeRow {
  day: string;
  key: string;
  hours: number;
  kwh: number;
  cost: number;
}

export interface RuntimeResponse {
  costPerKwh: number;
  rows: RuntimeRow[];
}

export function useRuntime(range: RangeDef): UseQueryResult<RuntimeResponse> {
  return useQuery({
    queryKey: ["history-runtime", range.key],
    refetchInterval: 5 * 60_000,
    queryFn: () => apiGet<RuntimeResponse>(`/api/history/runtime?days=${range.days}`),
  });
}

/* ── /api/chemistry (manual water tests) ───────────────────────── */

export interface ChemReadingPoint {
  id: number;
  at: number;
  ph: number | null;
  orp: number | null;
}

export function useChemReadings(): UseQueryResult<{ readings: ChemReadingPoint[] }> {
  return useQuery({
    queryKey: ["history-chem-readings"],
    refetchInterval: 5 * 60_000,
    queryFn: () => apiGet<{ readings: ChemReadingPoint[] }>("/api/chemistry?limit=1000"),
  });
}

/* ── Row shaping ───────────────────────────────────────────────── */

/**
 * One recharts row. `x` is epoch ms. Raw mode stores values under the metric
 * key itself; rollup mode stores `<metric>__avg` and `<metric>__band` [min,max].
 */
export type ChartRow = Record<string, number | [number, number] | null | undefined> & { x: number };

export function buildRawRows(res: HistoryResponse, metrics: readonly string[]): ChartRow[] {
  const byX = new Map<number, ChartRow>();
  for (const metric of metrics) {
    for (const point of res.series[metric] ?? []) {
      let row = byX.get(point.at);
      if (!row) {
        row = { x: point.at };
        byX.set(point.at, row);
      }
      row[metric] = point.value;
    }
  }
  return [...byX.values()].sort((a, b) => a.x - b.x);
}

/** Anchor a rollup day at local noon so the tick label lands on the right date. */
function dayToMs(day: string): number {
  const at = new Date(`${day}T12:00:00`).getTime();
  return Number.isFinite(at) ? at : 0;
}

export function buildRollupRows(res: HistoryResponse, metrics: readonly string[]): ChartRow[] {
  const byX = new Map<number, ChartRow>();
  for (const metric of metrics) {
    for (const point of res.rollups[metric] ?? []) {
      const x = dayToMs(point.day);
      let row = byX.get(x);
      if (!row) {
        row = { x };
        byX.set(x, row);
      }
      row[`${metric}__avg`] = point.avg;
      row[`${metric}__band`] = [point.min, point.max];
    }
  }
  return [...byX.values()].sort((a, b) => a.x - b.x);
}

/* ── Axis / tooltip label formatting ───────────────────────────── */

function shortDate(x: number): string {
  return new Date(x).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** X-axis tick formatter for a given mode + range span. */
export function makeTickFormatter(mode: ChartMode, rangeDays: number): (x: number) => string {
  if (mode === "rollup" || rangeDays > 3) return shortDate;
  if (rangeDays <= 1) return (x) => formatClock(x);
  return (x) => `${DAY_LABELS[new Date(x).getDay()] ?? ""} ${formatClock(x)}`;
}

/** Tooltip header label for a given mode + range span. */
export function formatTooltipLabel(mode: ChartMode, rangeDays: number, x: number): string {
  const d = new Date(x);
  if (mode === "rollup") {
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }
  if (rangeDays > 3) return `${shortDate(x)} · ${formatClock(x)}`;
  return `${DAY_LABELS[d.getDay()] ?? ""} ${formatClock(x)}`;
}

/** "2026-07-12" → "Jul 12" (runtime rows key days as strings). */
export function dayLabel(day: string): string {
  return shortDate(dayToMs(day));
}
