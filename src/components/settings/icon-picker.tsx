"use client";

import { useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Wand2 } from "lucide-react";
import { CIRCUIT_ICONS, CircuitIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

/**
 * Popover grid of assignable circuit icons. "Auto" clears the override so the
 * icon falls back to the circuit's function type.
 */
export function IconPicker({
  icon,
  circuitType,
  isLight,
  disabled,
  onPick,
}: {
  /** Current stored override (null = auto). */
  icon: string | null;
  circuitType: string;
  isLight: boolean;
  disabled?: boolean;
  onPick: (icon: string | null) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Change icon"
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors",
            open ? "border-accent/50 bg-accent-soft text-accent" : "border-line bg-abyss/40 text-ink-dim hover:border-line-bright hover:text-ink",
            disabled && "pointer-events-none opacity-40"
          )}
        >
          <CircuitIcon icon={icon} type={circuitType} isLight={isLight} size={18} />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="glass-bright z-50 w-56 rounded-xl p-2"
        >
          <div className="grid grid-cols-4 gap-1">
            {Object.entries(CIRCUIT_ICONS).map(([key, Icon]) => (
              <button
                key={key}
                type="button"
                title={key}
                aria-label={`Icon ${key}`}
                onClick={() => {
                  onPick(key);
                  setOpen(false);
                }}
                className={cn(
                  "flex h-11 items-center justify-center rounded-lg transition-colors",
                  icon === key
                    ? "bg-accent-soft text-accent shadow-[inset_0_0_0_1px] shadow-accent/30"
                    : "text-ink-dim hover:bg-accent-soft/50 hover:text-ink"
                )}
              >
                <Icon size={18} />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              onPick(null);
              setOpen(false);
            }}
            className={cn(
              "mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors",
              icon === null ? "bg-accent-soft text-accent" : "text-ink-dim hover:bg-accent-soft/50 hover:text-ink"
            )}
          >
            <Wand2 size={13} /> Auto (match function)
          </button>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
