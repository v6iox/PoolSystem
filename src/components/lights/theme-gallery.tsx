"use client";

import { motion, useReducedMotion } from "motion/react";
import { Layers, Lightbulb } from "lucide-react";
import type { LightThemeDef } from "@/types/pool";
import { glowShadow } from "@/components/lights/glow";
import { cn } from "@/lib/utils";

/** A thing a theme can be painted onto — a light group or a single light. */
export interface LightTarget {
  kind: "group" | "circuit";
  id: number;
  name: string;
}

export function targetKey(target: LightTarget): string {
  return `${target.kind}-${target.id}`;
}

/**
 * Tappable swatch chips for every theme the installed hardware supports.
 * Solid colors and gradient shows both render straight from `theme.swatch`;
 * shows and command themes (Color Sync / Color Swim) carry a small badge.
 * The selection ring is a shared-layout element so it glides between chips.
 */
export function ThemeGallery({
  themes,
  targets,
  selected,
  onSelect,
  activeTheme,
  disabled,
  onApply,
}: {
  themes: LightThemeDef[];
  targets: LightTarget[];
  selected: LightTarget | null;
  onSelect: (target: LightTarget) => void;
  /** Current theme value of the selected target, for the active ring. */
  activeTheme: number | null;
  disabled: boolean;
  onApply: (theme: LightThemeDef) => void;
}): React.JSX.Element {
  const reduced = useReducedMotion();

  return (
    <div>
      {/* Target picker */}
      <div className="no-scrollbar -mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
        {targets.map((target) => {
          const isSelected = selected !== null && targetKey(selected) === targetKey(target);
          return (
            <button
              key={targetKey(target)}
              type="button"
              onClick={() => onSelect(target)}
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors",
                isSelected
                  ? "border-accent/40 bg-accent-soft text-accent"
                  : "border-line bg-abyss/40 text-ink-dim hover:border-line-bright hover:text-ink"
              )}
            >
              {target.kind === "group" ? <Layers size={13} /> : <Lightbulb size={13} />}
              {target.name}
            </button>
          );
        })}
      </div>

      {/* Swatches */}
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
        {themes.map((theme, i) => {
          const active = activeTheme === theme.val;
          return (
            <motion.button
              key={theme.val}
              type="button"
              disabled={disabled}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{
                opacity: 1,
                scale: 1,
                transition: { delay: Math.min(i * 0.03, 0.35), type: "spring", stiffness: 350, damping: 28 },
              }}
              whileTap={disabled || reduced ? undefined : { scale: 0.93 }}
              onClick={() => onApply(theme)}
              className={cn(
                "relative flex flex-col gap-1.5 rounded-xl p-1.5 text-left transition-colors disabled:cursor-default disabled:opacity-40",
                active ? "glass-bright" : "glass hover:border-line-bright"
              )}
              aria-pressed={active}
              aria-label={`Apply ${theme.name}`}
            >
              <span
                className="relative block h-11 w-full overflow-hidden rounded-lg transition-shadow duration-500"
                style={{
                  background: theme.swatch,
                  boxShadow: active ? glowShadow(theme.swatch, 55, 22) : undefined,
                }}
              >
                {theme.type !== "color" && (
                  <span className="absolute right-1 top-1 rounded bg-abyss/70 px-1 py-px text-[8px] font-bold tracking-wider text-ink uppercase">
                    {theme.type === "show" ? "show" : "cmd"}
                  </span>
                )}
              </span>
              <span className={cn("truncate px-0.5 pb-0.5 text-[11px] font-medium", active ? "text-ink" : "text-ink-dim")}>
                {theme.name}
              </span>
              {active && (
                <motion.span
                  layoutId="theme-selection-ring"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  className="pointer-events-none absolute -inset-px rounded-xl border-2 border-accent"
                  style={{ boxShadow: "0 0 14px color-mix(in oklab, var(--accent) 35%, transparent)" }}
                />
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
