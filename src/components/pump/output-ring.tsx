"use client";

import { NumberTicker } from "@/components/ui/number-ticker";
import { cn } from "@/lib/utils";

/** Circular gauge for the chlorinator's current output %. */
export function OutputRing({
  value,
  heat = false,
  size = 136,
}: {
  value: number;
  /** Render in heat colors (super-chlorinate active). */
  heat?: boolean;
  size?: number;
}): React.JSX.Element {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Output ${pct}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-abyss/60"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct / 100)}
          className={cn(heat ? "text-heat" : "text-accent")}
          style={{
            transition: "stroke-dashoffset 0.7s cubic-bezier(0.22, 1, 0.36, 1), stroke 0.45s ease",
            filter: `drop-shadow(0 0 5px color-mix(in oklab, ${heat ? "var(--heat)" : "var(--accent)"} 55%, transparent))`,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="temp-display text-2xl text-ink">
          <NumberTicker value={pct} />
          <span className="text-xs text-ink-dim">%</span>
        </span>
        <span className="text-[10px] tracking-wider text-ink-faint uppercase">output</span>
      </div>
    </div>
  );
}
