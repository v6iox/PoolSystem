"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { RANGES, type RangeKey } from "./history-data";

/** Animated 24h/3d/7d/30d/90d segmented control — active pill slides via layoutId. */
export function RangeSelector({
  value,
  onChange,
}: {
  value: RangeKey;
  onChange: (key: RangeKey) => void;
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="History range"
      className="flex rounded-xl border border-line bg-abyss/40 p-1"
    >
      {RANGES.map((range) => {
        const selected = range.key === value;
        return (
          <button
            key={range.key}
            role="radio"
            aria-checked={selected}
            onClick={() => {
              if (!selected) onChange(range.key);
            }}
            className={cn(
              "relative h-8 rounded-lg px-2.5 text-xs font-medium transition-colors duration-200 sm:px-3.5",
              selected ? "text-accent" : "text-ink-faint hover:text-ink-dim"
            )}
          >
            {selected && (
              <motion.span
                layoutId="history-range-pill"
                className="absolute inset-0 rounded-lg bg-accent-soft"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative z-10">{range.label}</span>
          </button>
        );
      })}
    </div>
  );
}
