"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

/** Spring-physics toggle with an underwater-glow ON state. */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}): React.JSX.Element {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "relative h-8 w-14 shrink-0 cursor-pointer rounded-full border transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-40",
        checked
          ? "border-accent/40 bg-accent-soft shadow-[inset_0_0_12px] shadow-accent/20"
          : "border-line bg-abyss/60",
        className
      )}
    >
      <SwitchPrimitive.Thumb asChild>
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className={cn(
            "block h-6 w-6 rounded-full",
            checked
              ? "ml-[26px] bg-accent shadow-[0_0_12px] shadow-accent/60"
              : "ml-1 bg-ink-faint"
          )}
        />
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  );
}
