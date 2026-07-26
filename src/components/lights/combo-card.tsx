"use client";

import { motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import type { LightThemeDef } from "@/types/pool";
import type { LightCombo } from "@/components/lights/combos";
import { glowShadow } from "@/components/lights/glow";
import { cn, formatRelative } from "@/lib/utils";

/** One saved look. Tapping the card re-applies it; the small ✕ deletes it. */
export function ComboCard({
  combo,
  themesByVal,
  disabled,
  applying,
  index,
  onApply,
  onDelete,
}: {
  combo: LightCombo;
  themesByVal: Map<number, LightThemeDef>;
  disabled: boolean;
  applying: boolean;
  index: number;
  onApply: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const reduced = useReducedMotion();
  const onEntries = combo.entries.filter((e) => e.on);
  const litSwatches = onEntries
    .map((e) => (e.theme !== null ? themesByVal.get(e.theme)?.swatch : undefined))
    .filter((s): s is string => Boolean(s));
  const glow = litSwatches
    .slice(0, 2)
    .map((s) => glowShadow(s, 20, 26))
    .join(", ");

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { delay: Math.min(index * 0.05, 0.3), type: "spring", stiffness: 350, damping: 30 },
      }}
      exit={{ opacity: 0, scale: 0.92 }}
      whileTap={disabled || reduced ? undefined : { scale: 0.97 }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      onClick={() => {
        if (!disabled && !applying) onApply();
      }}
      className={cn(
        "group relative flex flex-col gap-2.5 rounded-panel p-4 transition-all duration-500",
        applying ? "glass-bright pulse-active" : "glass",
        disabled ? "cursor-default opacity-70" : "cursor-pointer hover:border-line-bright"
      )}
      style={glow.length > 0 ? { boxShadow: glow } : undefined}
    >
      <button
        type="button"
        aria-label={`Delete ${combo.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        className="absolute right-2.5 top-2.5 rounded-md p-1 text-ink-faint opacity-70 transition-colors hover:bg-danger/15 hover:text-danger group-hover:opacity-100"
      >
        <X size={13} />
      </button>

      <div className="pr-6">
        <p className="truncate text-sm font-medium text-ink">{combo.name}</p>
        <p className="mt-0.5 text-[11px] text-ink-faint">
          {onEntries.length} of {combo.entries.length} on
          {combo.savedAt > 0 ? ` · saved ${formatRelative(combo.savedAt)}` : ""}
        </p>
      </div>

      <div className="mt-auto flex items-center gap-1.5">
        {combo.entries.map((entry) => {
          const swatch = entry.theme !== null ? themesByVal.get(entry.theme)?.swatch : undefined;
          return (
            <span
              key={entry.circuitId}
              className={cn(
                "h-2.5 w-2.5 shrink-0 rounded-full",
                swatch === undefined && "border border-line bg-abyss/60",
                !entry.on && "opacity-30"
              )}
              style={swatch !== undefined ? { background: swatch } : undefined}
            />
          );
        })}
        {applying && (
          <span className="ml-auto text-[10px] font-semibold tracking-[0.14em] text-accent uppercase">Applying…</span>
        )}
      </div>
    </motion.div>
  );
}
