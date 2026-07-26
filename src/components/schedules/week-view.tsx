"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import { AlertTriangle, MoonStar } from "lucide-react";
import type { ScheduleState } from "@/types/pool";
import { Panel } from "@/components/ui/panel";
import { cn, DAY_LABELS } from "@/lib/utils";
import {
  blocksForDay,
  circuitTint,
  hourLabel,
  layoutLanes,
  type LaidOutBlock,
} from "@/components/schedules/helpers";

const HOUR_PX = 40;
const GUTTER = "3rem";

/** "6a", "6:30p" — tight enough for narrow calendar blocks. */
function compactTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h >= 12 ? "p" : "a";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

function Block({
  block,
  index,
  rangeStart,
  hasConflict,
  canEdit,
  onEdit,
}: {
  block: LaidOutBlock;
  index: number;
  rangeStart: number;
  hasConflict: boolean;
  canEdit: boolean;
  onEdit: (schedule: ScheduleState) => void;
}): React.JSX.Element {
  const s = block.schedule;
  const tint = circuitTint(s.circuitId);
  const visibleStart = Math.max(block.start, rangeStart);
  const top = ((visibleStart - rangeStart) / 60) * HOUR_PX;
  const height = Math.max(18, ((block.end - visibleStart) / 60) * HOUR_PX);
  const showTime = height >= 34;
  const timeText = block.isWrapTail
    ? `→ ${compactTime(block.end)}`
    : `${compactTime(block.start)}–${compactTime(s.endTime <= s.startTime ? s.endTime + 1440 : block.end)}`;

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1, transition: { delay: Math.min(index * 0.03, 0.3), type: "spring", stiffness: 400, damping: 30 } }}
      whileTap={canEdit ? { scale: 0.96 } : undefined}
      onClick={canEdit ? () => onEdit(s) : undefined}
      aria-label={`${s.circuitName} schedule, ${timeText}`}
      className={cn(
        "absolute z-[5] flex flex-col items-stretch justify-start overflow-hidden rounded-lg border px-1.5 py-1 text-left",
        s.isActive && !s.disabled && "pulse-active",
        s.disabled && "border-dashed opacity-40",
        block.isWrapTail && "rounded-t-none border-t-0",
        canEdit ? "cursor-pointer" : "cursor-default"
      )}
      style={{
        top,
        height,
        left: `calc(${(block.lane / block.laneCount) * 100}% + 2px)`,
        width: `calc(${100 / block.laneCount}% - 4px)`,
        background: s.isActive && !s.disabled ? tint.bg.replace("0.13", "0.24") : tint.bg,
        borderColor: tint.border,
      }}
    >
      <span className="flex items-center gap-1">
        <span className="truncate text-[11px] leading-tight font-semibold" style={{ color: tint.text }}>
          {s.circuitName}
        </span>
        {hasConflict && (
          <span
            className="flex shrink-0 items-center rounded-sm bg-warn/15 p-px text-warn"
            title="Overlaps another schedule for this circuit"
          >
            <AlertTriangle size={10} />
          </span>
        )}
      </span>
      {showTime && <span className="mt-0.5 block truncate text-[10px] leading-tight text-ink-dim">{timeText}</span>}
    </motion.button>
  );
}

/**
 * Seven-day calendar: schedules drawn as positioned blocks colored by circuit.
 * Scrolls horizontally with snap on phones; the time gutter stays pinned.
 */
export function WeekView({
  schedules,
  conflicts,
  fullDay,
  canEdit,
  onEdit,
}: {
  schedules: ScheduleState[];
  conflicts: Set<number>;
  fullDay: boolean;
  canEdit: boolean;
  onEdit: (schedule: ScheduleState) => void;
}): React.JSX.Element {
  const rangeStart = fullDay ? 0 : 6 * 60;
  const rangeHours = 24 - rangeStart / 60;
  const bodyHeight = rangeHours * HOUR_PX;

  const now = new Date();
  const today = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  /** Dates for this week (Sunday-first) so headers read "Sun 21". */
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - today + i);
    return d.getDate();
  });

  const dayColumns = useMemo(
    () => Array.from({ length: 7 }, (_, day) => layoutLanes(blocksForDay(schedules, day))),
    [schedules]
  );

  const hiddenBeforeRange = useMemo(() => {
    if (fullDay) return 0;
    const ids = new Set<number>();
    for (const col of dayColumns) for (const b of col) if (b.end <= rangeStart) ids.add(b.schedule.id);
    return ids.size;
  }, [dayColumns, fullDay, rangeStart]);

  const hourMarks = useMemo(() => {
    const marks: number[] = [];
    for (let h = rangeStart / 60; h <= 24; h += 2) marks.push(h);
    return marks;
  }, [rangeStart]);

  return (
    <Panel className="overflow-hidden">
      {hiddenBeforeRange > 0 && (
        <p className="flex items-center gap-1.5 border-b border-line px-4 py-2 text-xs text-ink-faint">
          <MoonStar size={12} className="text-accent" />
          {hiddenBeforeRange} schedule{hiddenBeforeRange === 1 ? "" : "s"} run{hiddenBeforeRange === 1 ? "s" : ""} before
          6 AM — switch to 24 h to see {hiddenBeforeRange === 1 ? "it" : "them"}.
        </p>
      )}
      <div className="no-scrollbar snap-x snap-mandatory overflow-x-auto scroll-pl-12">
        <div
          className="grid min-w-[46rem]"
          style={{ gridTemplateColumns: `${GUTTER} repeat(7, minmax(6rem, 1fr))` }}
        >
          {/* Header row */}
          <div className="sticky left-0 z-20 bg-deep/85 backdrop-blur-sm" />
          {DAY_LABELS.map((label, day) => (
            <div key={label} className={cn("border-l border-line px-1 py-2.5 text-center", day === today && "bg-accent/[0.05]")}>
              <span
                className={cn(
                  "inline-flex items-baseline gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase",
                  day === today ? "bg-accent-soft text-accent" : "text-ink-faint"
                )}
              >
                {label}
                <span className={cn("text-[10px] font-normal", day === today ? "text-accent/80" : "text-ink-faint")}>
                  {weekDates[day]}
                </span>
              </span>
            </div>
          ))}

          {/* Time gutter */}
          <div className="sticky left-0 z-20 bg-deep/85 backdrop-blur-sm" style={{ height: bodyHeight }}>
            <div className="relative h-full">
              {hourMarks.map((h) => (
                <span
                  key={h}
                  className="absolute right-1.5 -translate-y-1/2 text-[10px] text-ink-faint tabular-nums"
                  style={{ top: (h - rangeStart / 60) * HOUR_PX }}
                >
                  {h === 24 ? "12a" : hourLabel(h)}
                </span>
              ))}
            </div>
          </div>

          {/* Day columns */}
          {dayColumns.map((blocks, day) => (
            <div
              key={day}
              className={cn("relative snap-start border-t border-l border-line", day === today && "bg-accent/[0.05]")}
              style={{
                height: bodyHeight,
                backgroundImage: `repeating-linear-gradient(to bottom, var(--line) 0, var(--line) 1px, transparent 1px, transparent ${HOUR_PX * 2}px)`,
              }}
            >
              {day === today && nowMin >= rangeStart && (
                <div
                  className="pointer-events-none absolute right-0 left-0 z-10"
                  style={{ top: ((nowMin - rangeStart) / 60) * HOUR_PX }}
                >
                  <div className="h-px bg-accent shadow-[0_0_8px_var(--accent)]" />
                  <div className="absolute top-1/2 -left-[3px] h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-accent" />
                </div>
              )}
              {blocks
                .filter((b) => b.end > rangeStart)
                .map((b, i) => (
                  <Block
                    key={`${b.schedule.id}-${b.isWrapTail ? "tail" : "head"}`}
                    block={b}
                    index={i}
                    rangeStart={rangeStart}
                    hasConflict={conflicts.has(b.schedule.id)}
                    canEdit={canEdit}
                    onEdit={onEdit}
                  />
                ))}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
