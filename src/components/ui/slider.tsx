"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

export function Slider({
  value,
  onValueChange,
  onValueCommit,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  className,
  accent = "accent",
  "aria-label": ariaLabel,
}: {
  value: number;
  onValueChange?: (value: number) => void;
  onValueCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  accent?: "accent" | "heat";
  "aria-label"?: string;
}): React.JSX.Element {
  return (
    <SliderPrimitive.Root
      className={cn("relative flex h-8 w-full touch-none items-center select-none", disabled && "opacity-40", className)}
      value={[value]}
      onValueChange={(v) => onValueChange?.(v[0] ?? value)}
      onValueCommit={(v) => onValueCommit?.(v[0] ?? value)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      <SliderPrimitive.Track className="relative h-2 grow rounded-full bg-abyss/70 border border-line">
        <SliderPrimitive.Range
          className={cn(
            "absolute h-full rounded-full",
            accent === "heat"
              ? "bg-gradient-to-r from-heat/50 to-heat shadow-[0_0_10px] shadow-heat/40"
              : "bg-gradient-to-r from-accent/50 to-accent shadow-[0_0_10px] shadow-accent/40"
          )}
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className={cn(
          "block h-6 w-6 rounded-full border-2 bg-ink shadow-lg transition-transform focus-visible:outline-none focus-visible:ring-2 hover:scale-110",
          accent === "heat" ? "border-heat ring-heat/40" : "border-accent ring-accent/40"
        )}
      />
    </SliderPrimitive.Root>
  );
}
