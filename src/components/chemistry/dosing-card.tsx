"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import { ArrowDownRight, ArrowUpRight, CheckCircle2, Clock3 } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { doseSuggestions, type CurrentLevels, type DoseSuggestion } from "@/lib/dosing";
import { cn } from "@/lib/utils";
import {
  METRIC_KEYS,
  type IdealRanges,
  type LatestValue,
  type ReadingField,
} from "@/components/chemistry/chem-shared";

/** Computed chemical doses for every metric sitting outside its ideal band. */

function SuggestionRow({ suggestion, index }: { suggestion: DoseSuggestion; index: number }): React.JSX.Element {
  const [first, ...rest] = suggestion.options;
  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, type: "spring", stiffness: 380, damping: 32 }}
      className="rounded-xl border border-line bg-abyss/30 p-3.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        {suggestion.direction === "raise" ? (
          <ArrowUpRight size={15} className="shrink-0 text-warn" />
        ) : (
          <ArrowDownRight size={15} className="shrink-0 text-warn" />
        )}
        <p className="text-sm font-medium text-ink">{suggestion.summary}</p>
        <span className="rounded-md bg-warn/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-warn uppercase">
          {suggestion.direction === "raise" ? "below range" : "above range"}
        </span>
      </div>

      {first ? (
        <p className="mt-2 text-sm text-ink">
          Add <span className="font-semibold text-accent">{first.label}</span>
          {rest.map((option) => (
            <span key={option.chemical}>
              {" "}
              <span className="text-ink-faint">or</span>{" "}
              <span className="font-semibold text-accent">{option.label}</span>
            </span>
          ))}{" "}
          to {suggestion.direction} {suggestion.metricLabel.toLowerCase()}.
        </p>
      ) : null}

      {suggestion.note && <p className={cn("text-xs text-ink-faint", first ? "mt-1.5" : "mt-2")}>{suggestion.note}</p>}
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-dim">
        <Clock3 size={12} className="shrink-0" /> {suggestion.retestAfter}
      </p>
    </motion.li>
  );
}

export function DosingCard({
  latest,
  ranges,
  gallons,
}: {
  latest: Partial<Record<ReadingField, LatestValue>>;
  ranges: IdealRanges;
  gallons: number;
}): React.JSX.Element | null {
  const suggestions = useMemo(() => {
    const current: CurrentLevels = {};
    for (const key of METRIC_KEYS) {
      const entry = latest[key];
      if (entry) current[key] = entry.value;
    }
    return doseSuggestions(current, ranges, gallons);
  }, [latest, ranges, gallons]);

  const hasAnyReading = METRIC_KEYS.some((key) => latest[key] !== undefined);
  if (!hasAnyReading) return null;

  return (
    <Panel className="p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">Dosing suggestions</p>
        <p className="text-[11px] text-ink-faint">for {gallons.toLocaleString()} gal</p>
      </div>

      {suggestions.length === 0 ? (
        <div className="flex items-center gap-2.5 text-sm text-ink-dim">
          <CheckCircle2 size={18} className="shrink-0 text-ok" />
          Everything measured is inside its ideal range — nothing to add.
        </div>
      ) : (
        <ul className="space-y-2.5">
          {suggestions.map((suggestion, index) => (
            <SuggestionRow key={suggestion.metric} suggestion={suggestion} index={index} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
