"use client";

import { motion } from "motion/react";
import { CalendarRange, List, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ScheduleView = "week" | "list";

const OPTIONS: Array<{ value: ScheduleView; label: string; icon: LucideIcon }> = [
  { value: "week", label: "Week", icon: CalendarRange },
  { value: "list", label: "List", icon: List },
];

/** Animated week/list segmented control — selected pill slides via layoutId. */
export function ViewToggle({
  value,
  onChange,
}: {
  value: ScheduleView;
  onChange: (view: ScheduleView) => void;
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="Schedule view"
      className="flex rounded-xl border border-line bg-abyss/40 p-1"
    >
      {OPTIONS.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={selected}
            onClick={() => {
              if (!selected) onChange(opt.value);
            }}
            className={cn(
              "relative flex h-9 items-center justify-center gap-1.5 rounded-lg px-3.5 text-xs font-medium transition-colors duration-200",
              selected ? "text-accent" : "text-ink-faint hover:text-ink-dim"
            )}
          >
            {selected && (
              <motion.span
                layoutId="schedules-view-pill"
                className="absolute inset-0 rounded-lg bg-accent-soft"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <opt.icon size={14} className="relative z-10 shrink-0" />
            <span className="relative z-10">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
