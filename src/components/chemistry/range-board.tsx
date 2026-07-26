"use client";

import { motion } from "motion/react";
import { Panel } from "@/components/ui/panel";
import { formatChemNumber } from "@/lib/dosing";
import { cn, formatRelative } from "@/lib/utils";
import {
  METRICS,
  rangeStatus,
  type IdealRanges,
  type LatestValue,
  type MetricDef,
  type ReadingField,
} from "@/components/chemistry/chem-shared";

/**
 * Ideal-range indicator board: one horizontal bar per metric with the ideal
 * band highlighted and a marker at the latest logged value.
 */

const clampPct = (pct: number): number => Math.min(98, Math.max(2, pct));

function RangeBar({
  def,
  latest,
  range,
}: {
  def: MetricDef;
  latest: LatestValue | undefined;
  range: [number, number];
}): React.JSX.Element {
  const [lo, hi] = range;
  const span = Math.max(hi - lo, 0.001);
  let domainLo = Math.min(def.domain[0], lo - span);
  let domainHi = Math.max(def.domain[1], hi + span);
  if (latest) {
    domainLo = Math.min(domainLo, latest.value - span * 0.25);
    domainHi = Math.max(domainHi, latest.value + span * 0.25);
  }
  const pct = (x: number): number => ((x - domainLo) / (domainHi - domainLo)) * 100;
  const status = latest ? rangeStatus(latest.value, range) : null;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide text-ink-dim uppercase">
          {def.short}
          {def.label.toLowerCase() !== def.short.toLowerCase() && (
            <span className="ml-1.5 hidden font-normal tracking-normal normal-case text-ink-faint sm:inline">
              {def.label}
            </span>
          )}
        </span>
        <span className="temp-display text-lg text-ink">
          {latest ? formatChemNumber(latest.value) : "—"}
          {latest && def.unit ? <span className="ml-1 text-[10px] font-normal text-ink-faint">{def.unit}</span> : null}
        </span>
      </div>

      <div className="relative h-2 rounded-full bg-abyss/60">
        <div
          className="absolute inset-y-0 rounded-full bg-ok/25 ring-1 ring-ok/30 ring-inset"
          style={{ left: `${pct(lo)}%`, width: `${Math.max(pct(hi) - pct(lo), 1)}%` }}
        />
        {latest && (
          <motion.div
            aria-hidden
            className={cn(
              "absolute top-1/2 h-3.5 w-1.5 -translate-y-1/2 rounded-full shadow-[0_0_8px]",
              status === "in" ? "bg-ok shadow-ok/50" : "bg-warn shadow-warn/50"
            )}
            initial={false}
            animate={{ left: `calc(${clampPct(pct(latest.value))}% - 3px)` }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          />
        )}
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-ink-faint">
          {formatChemNumber(lo)}–{formatChemNumber(hi)} ideal
        </span>
        {latest && status ? (
          <span className={cn("font-medium", status === "in" ? "text-ok" : "text-warn")}>
            {status === "in" ? "in range" : status === "below" ? "below range" : "above range"}
            <span className="ml-1.5 font-normal text-ink-faint">{formatRelative(latest.at)}</span>
          </span>
        ) : (
          <span className="text-ink-faint">no reading yet</span>
        )}
      </div>
    </div>
  );
}

export function RangeBoard({
  latest,
  ranges,
}: {
  latest: Partial<Record<ReadingField, LatestValue>>;
  ranges: IdealRanges;
}): React.JSX.Element {
  return (
    <Panel className="p-4 sm:p-5">
      <p className="mb-4 text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">Water balance</p>
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        {METRICS.map((def) => (
          <RangeBar key={def.key} def={def} latest={latest[def.key]} range={ranges[def.key]} />
        ))}
      </div>
    </Panel>
  );
}
