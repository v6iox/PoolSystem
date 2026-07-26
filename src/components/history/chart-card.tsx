"use client";

/**
 * Presentation shell shared by every History chart: glass panel, uppercase
 * title, inline legend, and the loading / error / empty states. Also home of
 * the glass tooltip recharts renders through `content={<GlassTooltip …/>}`.
 */

import { motion } from "motion/react";
import { AlertTriangle, Hourglass } from "lucide-react";
import { Panel } from "@/components/ui/panel";

export interface LegendItem {
  label: string;
  color: string;
  dashed?: boolean;
}

function ChartLegend({ items }: { items: LegendItem[] }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-[11px] text-ink-dim">
          <span
            aria-hidden
            className="w-4 rounded-full"
            style={
              item.dashed
                ? { borderTop: `2px dashed ${item.color}` }
                : { height: 3, background: item.color }
            }
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function ChartCard({
  title,
  legend,
  loading = false,
  error,
  empty = false,
  emptyDetail = "Collecting data — check back in an hour.",
  height = 260,
  delay = 0,
  children,
}: {
  title: string;
  legend?: LegendItem[];
  loading?: boolean;
  error?: string;
  empty?: boolean;
  emptyDetail?: string;
  height?: number;
  delay?: number;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: "spring", stiffness: 300, damping: 30 }}
    >
      <Panel className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">{title}</p>
          {legend && legend.length > 1 && !loading && !empty && !error ? <ChartLegend items={legend} /> : null}
        </div>
        {loading ? (
          <div className="skeleton w-full rounded-xl" style={{ height }} />
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-2 text-center" style={{ height }}>
            <AlertTriangle size={22} className="text-warn" />
            <p className="text-sm font-medium text-ink">Couldn&apos;t load history</p>
            <p className="max-w-xs text-xs text-ink-faint">{error}</p>
          </div>
        ) : empty ? (
          <div className="flex flex-col items-center justify-center gap-2 text-center" style={{ height }}>
            <Hourglass size={22} className="text-ink-faint" />
            <p className="max-w-xs text-sm text-ink-dim">{emptyDetail}</p>
          </div>
        ) : (
          children
        )}
      </Panel>
    </motion.div>
  );
}

/* ── Glass tooltip ─────────────────────────────────────────────── */

export interface GlassTooltipEntry {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string | Array<number | string>;
  color?: string;
}

/**
 * Custom recharts tooltip content. Handles plain values and [min,max] band
 * tuples; `format` receives the base metric key (band/avg suffix stripped).
 */
export function GlassTooltip({
  active,
  label,
  payload,
  labelFormatter,
  format,
}: {
  active?: boolean;
  label?: number | string;
  payload?: GlassTooltipEntry[];
  labelFormatter: (x: number) => string;
  format: (value: number, metric: string) => string;
}): React.JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const x = typeof label === "number" ? label : Number(label);
  return (
    <div className="glass-bright rounded-xl px-3 py-2 text-xs shadow-xl">
      <p className="mb-1.5 font-medium text-ink-dim">
        {Number.isFinite(x) ? labelFormatter(x) : String(label ?? "")}
      </p>
      <div className="space-y-1">
        {payload.map((entry, i) => {
          if (entry.value === undefined || entry.value === null) return null;
          const key = String(entry.dataKey ?? i);
          const metric = key.replace(/__(avg|band)$/, "");
          const text = Array.isArray(entry.value)
            ? entry.value.map((v) => format(Number(v), metric)).join(" – ")
            : typeof entry.value === "number"
              ? format(entry.value, metric)
              : String(entry.value);
          const dot = entry.color && !entry.color.startsWith("url(") ? entry.color : "var(--ink-faint)";
          return (
            <p key={key} className="flex items-center justify-between gap-5">
              <span className="flex items-center gap-1.5 text-ink-dim">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: dot }} />
                {String(entry.name ?? metric)}
              </span>
              <span className="font-medium text-ink">{text}</span>
            </p>
          );
        })}
      </div>
    </div>
  );
}
