"use client";

import { motion } from "motion/react";
import { Flame, Power, Sun, ThermometerSun, type LucideIcon } from "lucide-react";
import type { HeatMode } from "@/types/pool";
import { cn } from "@/lib/utils";

const MODE_META: Record<HeatMode, { label: string; icon: LucideIcon; activeText: string; activeBg: string }> = {
  off: { label: "Off", icon: Power, activeText: "text-ink", activeBg: "bg-abyss/70 border border-line-bright" },
  heater: { label: "Heater", icon: Flame, activeText: "text-heat", activeBg: "bg-heat-soft" },
  solar: { label: "Solar", icon: Sun, activeText: "text-warn", activeBg: "bg-warn/10" },
  solarpref: { label: "Solar pref", icon: ThermometerSun, activeText: "text-warn", activeBg: "bg-warn/10" },
};

/**
 * Segmented heat-mode control built from the modes the body actually supports.
 * The selected pill slides between options via a shared layoutId.
 */
export function HeatModePicker({
  bodyId,
  modes,
  value,
  disabled,
  onChange,
}: {
  bodyId: number;
  modes: HeatMode[];
  value: HeatMode;
  disabled: boolean;
  onChange: (mode: HeatMode) => void;
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="Heat mode"
      className={cn("flex w-full rounded-xl border border-line bg-abyss/40 p-1", disabled && "opacity-60")}
    >
      {modes.map((mode) => {
        const meta = MODE_META[mode];
        const selected = value === mode;
        return (
          <button
            key={mode}
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => {
              if (!selected) onChange(mode);
            }}
            className={cn(
              "relative flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors duration-200 disabled:cursor-not-allowed",
              selected ? meta.activeText : "text-ink-faint hover:text-ink-dim"
            )}
          >
            {selected && (
              <motion.span
                layoutId={`heat-mode-${bodyId}`}
                className={cn("absolute inset-0 rounded-lg", meta.activeBg)}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <meta.icon size={14} className="relative z-10 shrink-0" />
            <span className="relative z-10 truncate">{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
