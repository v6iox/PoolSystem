"use client";

import Link from "next/link";
import { useId } from "react";
import { motion } from "motion/react";
import { ChevronRight, Lock, type LucideIcon } from "lucide-react";
import { EmptyState, Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Shared building blocks for the settings area: sections, rows, pills, segments. */

export function SettingsSection({
  icon,
  title,
  description,
  children,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <section>
      <div className="mb-2 px-1">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">
          {icon ? <span className="text-accent">{icon}</span> : null}
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-xs text-ink-faint">{description}</p> : null}
      </div>
      <Panel className={cn("divide-y divide-line overflow-hidden", className)}>{children}</Panel>
    </section>
  );
}

export function SettingRow({
  icon,
  label,
  hint,
  children,
  stacked = false,
}: {
  icon?: React.ReactNode;
  label: string;
  hint?: React.ReactNode;
  children?: React.ReactNode;
  /** Control renders under the label instead of beside it (for wide controls). */
  stacked?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "gap-3 px-4 py-3.5",
        stacked ? "flex flex-col" : "flex min-h-[3.5rem] items-center justify-between gap-4"
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {icon ? <span className="shrink-0 text-ink-faint">{icon}</span> : null}
        <div className="min-w-0">
          <p className="text-sm text-ink">{label}</p>
          {hint ? <p className="mt-0.5 text-xs text-ink-faint">{hint}</p> : null}
        </div>
      </div>
      {children ? <div className={cn(stacked ? "" : "shrink-0")}>{children}</div> : null}
    </div>
  );
}

export type PillTone = "ok" | "warn" | "bad" | "accent" | "neutral";

export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: PillTone;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize",
        tone === "ok" && "bg-ok/10 text-ok",
        tone === "warn" && "bg-warn/10 text-warn",
        tone === "bad" && "bg-danger/10 text-danger",
        tone === "accent" && "bg-accent-soft text-accent",
        tone === "neutral" && "bg-abyss/50 text-ink-dim",
        className
      )}
    >
      {children}
    </span>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

/** Sliding-pill segmented control matching the schedule-type picker style. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  disabled,
  "aria-label": ariaLabel,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<SegmentOption<T>>;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
}): React.JSX.Element {
  const pillId = useId();
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "flex rounded-xl border border-line bg-abyss/40 p-1",
        disabled && "pointer-events-none opacity-40",
        className
      )}
    >
      {options.map((opt) => {
        const selected = value === opt.value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative flex h-9 min-w-16 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors duration-200",
              selected ? "text-accent" : "text-ink-faint hover:text-ink-dim"
            )}
          >
            {selected && (
              <motion.span
                layoutId={pillId}
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
                className="absolute inset-0 rounded-lg bg-accent-soft shadow-[inset_0_0_0_1px] shadow-accent/25"
              />
            )}
            {Icon ? <Icon size={14} className="relative" /> : null}
            <span className="relative">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Big tappable card linking into a settings sub-page. */
export function SettingsLinkCard({
  href,
  icon,
  title,
  detail,
  index = 0,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  detail: string;
  index?: number;
}): React.JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, type: "spring", stiffness: 300, damping: 30 }}
    >
      <Link href={href} className="block">
        <Panel className="flex items-center gap-3.5 p-4 transition-colors hover:border-line-bright">
          <span className="rounded-xl bg-accent-soft p-2.5 text-accent">{icon}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink">{title}</span>
            <span className="block truncate text-xs text-ink-dim">{detail}</span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-ink-faint" />
        </Panel>
      </Link>
    </motion.div>
  );
}

/** Friendly gate shown when a non-owner opens an owner-only settings page. */
export function OwnerOnlyState(): React.JSX.Element {
  return (
    <EmptyState
      icon={<Lock size={32} />}
      title="Owner only"
      detail="This area is limited to the pool owner account. Ask an owner if something here needs changing."
      action={
        <Link href="/settings">
          <Button variant="glass" size="sm">
            Back to settings
          </Button>
        </Link>
      }
    />
  );
}
