"use client";

import { motion } from "motion/react";
import { AlertTriangle, ChevronRight, Flame, MoonStar, Repeat1, Timer } from "lucide-react";
import type { CircuitState, ScheduleState } from "@/types/pool";
import { Panel } from "@/components/ui/panel";
import { CircuitIcon } from "@/lib/icons";
import { cn, formatDays, formatMinutes } from "@/lib/utils";
import { circuitTint, eggTimerDuration, formatDuration } from "@/components/schedules/helpers";

function Chip({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: "neutral" | "warn" | "heat" | "accent";
  icon?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap",
        tone === "neutral" && "border border-line bg-abyss/40 text-ink-dim",
        tone === "warn" && "bg-warn/10 text-warn",
        tone === "heat" && "bg-heat-soft text-heat",
        tone === "accent" && "bg-accent-soft text-accent"
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function ScheduleRow({
  schedule,
  circuit,
  index,
  hasConflict,
  canEdit,
  onEdit,
}: {
  schedule: ScheduleState;
  circuit: CircuitState | undefined;
  index: number;
  hasConflict: boolean;
  canEdit: boolean;
  onEdit: (schedule: ScheduleState) => void;
}): React.JSX.Element {
  const s = schedule;
  const tint = circuitTint(s.circuitId);
  const overnight = !s.isEggTimer && s.endTime <= s.startTime;

  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { delay: Math.min(index * 0.05, 0.4), type: "spring", stiffness: 380, damping: 30 },
      }}
    >
      <button
        type="button"
        onClick={canEdit ? () => onEdit(s) : undefined}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
          canEdit ? "cursor-pointer hover:bg-accent-soft/30" : "cursor-default",
          s.disabled && "opacity-50"
        )}
      >
        <span
          className={cn("shrink-0 rounded-full p-2.5", s.isActive && !s.disabled && "pulse-active")}
          style={{ background: tint.bg, color: tint.text }}
        >
          <CircuitIcon type={circuit?.type ?? s.circuitName.toLowerCase()} isLight={circuit?.isLight ?? false} size={18} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">{s.circuitName}</span>
            {s.isActive && !s.disabled && <Chip tone="accent">On now</Chip>}
          </span>
          <span className="mt-0.5 block font-display text-sm tracking-tight text-ink-dim tabular-nums">
            {s.isEggTimer
              ? `Runs ${formatDuration(eggTimerDuration(s))} after turn-on`
              : `${formatMinutes(s.startTime)} – ${formatMinutes(s.endTime)}${overnight ? " (+1 day)" : ""}`}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {!s.isEggTimer && <Chip>{formatDays(s.days)}</Chip>}
            {s.scheduleType === "runonce" && <Chip icon={<Repeat1 size={10} />}>Once</Chip>}
            {s.isEggTimer && <Chip icon={<Timer size={10} />}>Egg timer</Chip>}
            {s.heatSetpoint !== null && (
              <Chip tone="heat" icon={<Flame size={10} />}>
                {s.heatSetpoint}°{s.heatSource && s.heatSource !== "off" ? ` · ${s.heatSource}` : ""}
              </Chip>
            )}
            {overnight && <Chip icon={<MoonStar size={10} />}>Overnight</Chip>}
            {s.disabled && <Chip>Disabled</Chip>}
            {hasConflict && (
              <Chip tone="warn" icon={<AlertTriangle size={10} />}>
                Overlap
              </Chip>
            )}
          </span>
        </span>

        {canEdit && <ChevronRight size={16} className="shrink-0 text-ink-faint" />}
      </button>
    </motion.li>
  );
}

/** Flat list of schedules sorted by start time, tap to edit. */
export function ScheduleList({
  schedules,
  conflicts,
  circuitFor,
  canEdit,
  onEdit,
}: {
  schedules: ScheduleState[];
  conflicts: Set<number>;
  circuitFor: (circuitId: number) => CircuitState | undefined;
  canEdit: boolean;
  onEdit: (schedule: ScheduleState) => void;
}): React.JSX.Element {
  const sorted = [...schedules].sort(
    (a, b) =>
      Number(a.isEggTimer) - Number(b.isEggTimer) ||
      a.startTime - b.startTime ||
      a.circuitName.localeCompare(b.circuitName)
  );
  return (
    <Panel className="overflow-hidden">
      <ul className="divide-y divide-line">
        {sorted.map((s, i) => (
          <ScheduleRow
            key={s.id}
            schedule={s}
            circuit={circuitFor(s.circuitId)}
            index={i}
            hasConflict={conflicts.has(s.id)}
            canEdit={canEdit}
            onEdit={onEdit}
          />
        ))}
      </ul>
    </Panel>
  );
}
