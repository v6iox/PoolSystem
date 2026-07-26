"use client";

import { motion, useReducedMotion } from "motion/react";
import { Lightbulb } from "lucide-react";
import type { CircuitState, LightThemeDef } from "@/types/pool";
import { Switch } from "@/components/ui/switch";
import { glowShadow } from "@/components/lights/glow";
import { cn } from "@/lib/utils";

/**
 * One individual light fixture. The whole card is a tap target; a lit card
 * glows in its current theme's colors instead of the generic accent.
 */
export function LightCircuitCard({
  circuit,
  theme,
  disabled,
  index,
  onToggle,
}: {
  circuit: CircuitState;
  /** Resolved current theme, when one is set. */
  theme: LightThemeDef | null;
  disabled: boolean;
  /** Position in the grid, for entry stagger. */
  index: number;
  onToggle: (on: boolean) => void;
}): React.JSX.Element {
  const reduced = useReducedMotion();
  const on = circuit.isOn;
  const glow = on && theme ? glowShadow(theme.swatch, 42, 36) : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { delay: Math.min(index * 0.05, 0.4), type: "spring", stiffness: 350, damping: 30 },
      }}
      whileTap={disabled || reduced ? undefined : { scale: 0.96 }}
      transition={{ type: "spring", stiffness: 420, damping: 28 }}
      onClick={() => {
        if (!disabled) onToggle(!on);
      }}
      className={cn(
        "relative flex min-h-[8rem] flex-col rounded-panel p-4 text-left transition-all duration-500",
        on ? "glass-bright" : "glass",
        on && !theme && "pulse-active",
        disabled ? "cursor-default" : "cursor-pointer"
      )}
      style={glow ? { boxShadow: glow } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "rounded-full p-2.5 transition-colors duration-300",
            !on && "bg-abyss/50 text-ink-faint",
            on && !theme && "bg-accent-soft text-accent"
          )}
          style={on && theme ? { background: theme.swatch, boxShadow: glowShadow(theme.swatch, 55, 18) } : undefined}
        >
          <Lightbulb size={20} className={on && theme ? "text-abyss" : undefined} />
        </span>
        {/* Stop propagation so the Radix switch doesn't double-fire the card tap. */}
        <span onClick={(event) => event.stopPropagation()}>
          <Switch checked={on} onCheckedChange={onToggle} disabled={disabled} aria-label={circuit.name} />
        </span>
      </div>

      <p className={cn("mt-3 truncate text-sm font-medium", on ? "text-ink" : "text-ink-dim")}>{circuit.name}</p>

      <div className="mt-auto pt-1.5">
        {theme ? (
          <span
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-abyss/40 px-2 py-0.5 text-[10px] font-medium",
              on ? "text-ink-dim" : "text-ink-faint"
            )}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: theme.swatch }} />
            <span className="truncate">{theme.name}</span>
          </span>
        ) : (
          <span
            className={cn(
              "text-[10px] font-semibold tracking-[0.14em] uppercase",
              on ? "text-accent" : "text-ink-faint"
            )}
          >
            {on ? "On" : "Off"}
          </span>
        )}
      </div>
    </motion.div>
  );
}
