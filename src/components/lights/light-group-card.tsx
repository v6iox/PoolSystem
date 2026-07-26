"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Layers } from "lucide-react";
import type { LightGroupState, LightThemeDef } from "@/types/pool";
import type { PoolAction } from "@/types/actions";
import { usePool } from "@/lib/client/pool-state";
import { Switch } from "@/components/ui/switch";
import { glowShadow } from "@/components/lights/glow";
import { cn } from "@/lib/utils";

/**
 * One IntelliBrite light group. Toggling sends a `setCircuit` per member
 * circuit in a single batch; since batched sends have no built-in optimistic
 * patch, the card keeps a short-lived local pending state so the switch flips
 * instantly and reconciles against the next SSE frame.
 */
export function LightGroupCard({
  group,
  theme,
  memberNames,
  disabled,
  index,
}: {
  group: LightGroupState;
  /** Resolved current group theme, when one is set. */
  theme: LightThemeDef | null;
  memberNames: string[];
  disabled: boolean;
  /** Position in the grid, for entry stagger. */
  index: number;
}): React.JSX.Element {
  const { sendActions } = usePool();
  const reduced = useReducedMotion();
  const [pending, setPending] = useState<boolean | null>(null);
  const releaseRef = useRef<number | null>(null);

  // Server state caught up with our optimistic flip — release it.
  useEffect(() => {
    if (pending !== null && group.isOn === pending) setPending(null);
  }, [group.isOn, pending]);

  useEffect(
    () => () => {
      if (releaseRef.current !== null) window.clearTimeout(releaseRef.current);
    },
    []
  );

  const on = pending ?? group.isOn;
  const glow = on && theme ? glowShadow(theme.swatch, 40, 44) : undefined;

  const toggle = (next: boolean): void => {
    if (disabled) return;
    setPending(next);
    if (releaseRef.current !== null) window.clearTimeout(releaseRef.current);
    const actions = group.circuitIds.map(
      (circuitId): PoolAction => ({ type: "setCircuit", circuitId, state: next })
    );
    void sendActions(actions).then((ok) => {
      if (!ok) {
        setPending(null);
        return;
      }
      // Safety release in case the confirming SSE frame never lands.
      releaseRef.current = window.setTimeout(() => setPending(null), 5000);
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { delay: Math.min(index * 0.06, 0.3), type: "spring", stiffness: 320, damping: 30 },
      }}
      whileTap={disabled || reduced ? undefined : { scale: 0.98 }}
      transition={{ type: "spring", stiffness: 420, damping: 28 }}
      onClick={() => toggle(!on)}
      className={cn(
        "relative flex flex-col gap-3 rounded-panel p-4 transition-all duration-500 sm:p-5",
        on ? "glass-bright" : "glass",
        on && !theme && "pulse-active",
        disabled ? "cursor-default" : "cursor-pointer"
      )}
      style={glow ? { boxShadow: glow } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "shrink-0 rounded-full p-2.5 transition-colors duration-300",
              !on && "bg-abyss/50 text-ink-faint",
              on && !theme && "bg-accent-soft text-accent"
            )}
            style={on && theme ? { background: theme.swatch, boxShadow: glowShadow(theme.swatch, 55, 18) } : undefined}
          >
            <Layers size={20} className={on && theme ? "text-abyss" : undefined} />
          </span>
          <div className="min-w-0">
            <p className={cn("truncate text-sm font-medium", on ? "text-ink" : "text-ink-dim")}>{group.name}</p>
            <p className="truncate text-xs text-ink-faint">
              {memberNames.length > 0 ? memberNames.join(" · ") : `${group.circuitIds.length} lights`}
            </p>
          </div>
        </div>
        {/* Stop propagation so the Radix switch doesn't double-fire the card tap. */}
        <span onClick={(event) => event.stopPropagation()}>
          <Switch checked={on} onCheckedChange={toggle} disabled={disabled} aria-label={group.name} />
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
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
          <span className={cn("text-[10px] font-semibold tracking-[0.14em] uppercase", on ? "text-accent" : "text-ink-faint")}>
            {on ? "On" : "Off"}
          </span>
        )}
        <span className="shrink-0 text-[10px] font-semibold tracking-[0.14em] text-ink-faint uppercase">
          {group.circuitIds.length} fixtures
        </span>
      </div>
    </motion.div>
  );
}
