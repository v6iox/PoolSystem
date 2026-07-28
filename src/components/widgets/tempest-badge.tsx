"use client";

import { formatRelative } from "@/lib/utils";

/**
 * "Verified by Tempest" badge — a minimal outline of the WeatherFlow Tempest
 * (capsule body, vent slats, mounting stem) shown wherever a reading came
 * straight from the user's own station. Hover/focus reveals the label.
 */
export function TempestBadge({ observedAt }: { observedAt?: number }): React.JSX.Element {
  const label = `Verified by Tempest — live reading from your weather station${
    observedAt ? `, ${formatRelative(observedAt)}` : ""
  }`;
  return (
    <span tabIndex={0} className="group relative inline-flex cursor-help items-center outline-none" aria-label={label}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        className="text-accent"
        aria-hidden
      >
        {/* capsule body */}
        <rect x="7.5" y="2.5" width="9" height="14" rx="4.5" />
        {/* vent slats */}
        <line x1="9.8" y1="6.5" x2="14.2" y2="6.5" />
        <line x1="9.8" y1="9" x2="14.2" y2="9" />
        <line x1="9.8" y1="11.5" x2="14.2" y2="11.5" />
        {/* mounting stem */}
        <line x1="12" y1="16.5" x2="12" y2="21.5" />
      </svg>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-40 mt-1.5 w-max max-w-56 -translate-x-1/2 rounded-lg border border-line bg-abyss px-2.5 py-1.5 text-[11px] font-medium normal-case tracking-normal text-ink opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
