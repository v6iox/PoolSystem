import type { ScheduleState } from "@/types/pool";

/**
 * Shared schedule math: circuit color assignment, week-interval expansion
 * (with overnight wrap), conflict detection, calendar lane layout, and
 * <input type="time"> ⇄ minutes-from-midnight conversion.
 */

/* ── Circuit tints ─────────────────────────────────────────────── */

/** RGB triplets tuned to the night-swim palette; assigned per circuit id. */
const TINTS = [
  "94,234,212", // teal
  "96,165,250", // sky
  "251,191,36", // amber
  "251,113,133", // rose
  "52,211,153", // emerald
  "167,139,250", // lavender
  "251,146,60", // orange
  "34,211,238", // cyan
] as const;

export interface CircuitTint {
  bg: string;
  border: string;
  text: string;
  solid: string;
}

export function circuitTint(circuitId: number): CircuitTint {
  const rgb = TINTS[Math.abs(circuitId) % TINTS.length] ?? TINTS[0];
  return {
    bg: `rgba(${rgb},0.13)`,
    border: `rgba(${rgb},0.45)`,
    text: `rgb(${rgb})`,
    solid: `rgba(${rgb},0.9)`,
  };
}

/* ── Time conversion ───────────────────────────────────────────── */

/** Minutes from midnight → "HH:MM" for <input type="time">. */
export function minutesToTimeValue(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "HH:MM" → minutes from midnight; null when the field is empty/invalid. */
export function timeValueToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** Compact hour label for the week-view gutter: 6 AM → "6a", noon → "12p". */
export function hourLabel(hour: number): string {
  const h = hour % 24;
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

/* ── Week expansion + conflicts ────────────────────────────────── */

const DAY = 1440;
const WEEK = 7 * DAY;

interface Interval {
  start: number;
  end: number;
}

interface TimeSpan {
  startTime: number;
  endTime: number;
  days: number[];
}

/**
 * Expand a schedule into absolute [start, end) minute intervals across the
 * week. endTime ≤ startTime means the run wraps past midnight into the next
 * day; a wrap past Saturday midnight folds back onto Sunday.
 */
function weekIntervals(s: TimeSpan): Interval[] {
  const out: Interval[] = [];
  for (const day of s.days) {
    const start = day * DAY + s.startTime;
    const end = s.endTime > s.startTime ? day * DAY + s.endTime : day * DAY + s.endTime + DAY;
    if (end <= WEEK) {
      out.push({ start, end });
    } else {
      out.push({ start, end: WEEK });
      if (end - WEEK > 0) out.push({ start: 0, end: end - WEEK });
    }
  }
  return out;
}

function overlaps(a: Interval[], b: Interval[]): boolean {
  return a.some((x) => b.some((y) => x.start < y.end && y.start < x.end));
}

export interface ConflictProbe extends TimeSpan {
  id?: number;
  circuitId: number;
}

function conflictEligible(s: ScheduleState): boolean {
  return !s.disabled && !s.isEggTimer && s.days.length > 0 && s.startTime !== s.endTime;
}

/** Existing schedules the probe overlaps (same circuit, shared day + time). */
export function findConflicts(probe: ConflictProbe, all: ScheduleState[]): ScheduleState[] {
  if (probe.days.length === 0 || probe.startTime === probe.endTime) return [];
  const mine = weekIntervals(probe);
  return all.filter(
    (s) =>
      s.id !== probe.id &&
      s.circuitId === probe.circuitId &&
      conflictEligible(s) &&
      overlaps(mine, weekIntervals(s))
  );
}

/** Ids of every schedule involved in at least one same-circuit overlap. */
export function conflictIds(all: ScheduleState[]): Set<number> {
  const ids = new Set<number>();
  const eligible = all.filter(conflictEligible);
  for (let i = 0; i < eligible.length; i++) {
    const a = eligible[i];
    if (!a) continue;
    for (let j = i + 1; j < eligible.length; j++) {
      const b = eligible[j];
      if (!b || a.circuitId !== b.circuitId) continue;
      if (overlaps(weekIntervals(a), weekIntervals(b))) {
        ids.add(a.id);
        ids.add(b.id);
      }
    }
  }
  return ids;
}

/* ── Week-view blocks + lane layout ────────────────────────────── */

export interface DayBlock {
  schedule: ScheduleState;
  /** Start/end minutes clipped to this day (end > start). */
  start: number;
  end: number;
  /** True for the after-midnight tail of an overnight schedule. */
  isWrapTail: boolean;
}

/** Blocks that render inside one day column, overnight tails included. */
export function blocksForDay(schedules: ScheduleState[], day: number): DayBlock[] {
  const out: DayBlock[] = [];
  for (const s of schedules) {
    if (s.isEggTimer) continue;
    const wraps = s.endTime <= s.startTime;
    if (s.days.includes(day)) {
      out.push({ schedule: s, start: s.startTime, end: wraps ? DAY : s.endTime, isWrapTail: false });
    }
    if (wraps && s.endTime > 0 && s.days.includes((day + 6) % 7)) {
      out.push({ schedule: s, start: 0, end: s.endTime, isWrapTail: true });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

export interface LaidOutBlock extends DayBlock {
  lane: number;
  laneCount: number;
}

/**
 * Classic calendar lane assignment: overlapping blocks share the column
 * side-by-side; each contiguous cluster splits the width evenly.
 */
export function layoutLanes(blocks: DayBlock[]): LaidOutBlock[] {
  const placed: LaidOutBlock[] = [];
  let cluster: LaidOutBlock[] = [];
  let laneEnds: number[] = [];

  const flush = (): void => {
    const count = laneEnds.length;
    for (const b of cluster) b.laneCount = count;
    cluster = [];
    laneEnds = [];
  };

  for (const block of blocks) {
    if (laneEnds.length > 0 && laneEnds.every((end) => end <= block.start)) flush();
    let lane = laneEnds.findIndex((end) => end <= block.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(block.end);
    } else {
      laneEnds[lane] = block.end;
    }
    const laid: LaidOutBlock = { ...block, lane, laneCount: 1 };
    cluster.push(laid);
    placed.push(laid);
  }
  flush();
  return placed;
}

/** Duration in minutes of an egg-timer style schedule (best effort). */
export function eggTimerDuration(s: ScheduleState): number {
  const dur = (s.endTime - s.startTime + DAY) % DAY;
  return dur === 0 ? s.endTime : dur;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
