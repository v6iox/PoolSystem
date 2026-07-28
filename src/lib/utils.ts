import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatMinutes(minutes: number, clock: "12" | "24" = "12"): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  if (clock === "24") return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

export function formatClock(at: number, clock: "12" | "24" = "12"): string {
  const d = new Date(at);
  return formatMinutes(d.getHours() * 60 + d.getMinutes(), clock);
}

/**
 * A clock time plus enough date to be unambiguous. "9:00 PM" alone can't tell
 * tonight from tomorrow night from next Tuesday, which matters a great deal on
 * a confirmation card that is about to heat a spa.
 */
export function formatWhen(at: number, clock: "12" | "24" = "12"): string {
  const time = formatClock(at, clock);
  const target = new Date(at);
  const today = new Date();
  const midnight = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(target) - midnight(today)) / 86_400_000);
  if (days === 0) return time;
  if (days === 1) return `${time} tomorrow`;
  if (days > 1 && days < 7) {
    return `${time} on ${target.toLocaleDateString(undefined, { weekday: "long" })}`;
  }
  return `${time} on ${target.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export function formatRelative(at: number): string {
  const diff = Date.now() - at;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "ago" : "from now";
  if (abs < 60_000) return diff >= 0 ? "just now" : "in under a minute";
  if (abs < 3600_000) return `${Math.round(abs / 60_000)}m ${suffix}`;
  if (abs < 86400_000) return `${Math.round(abs / 3600_000)}h ${suffix}`;
  return `${Math.round(abs / 86400_000)}d ${suffix}`;
}

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function formatDays(days: number[]): string {
  if (days.length === 7) return "Every day";
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return "Weekdays";
  if (days.length === 2 && days.includes(0) && days.includes(6)) return "Weekends";
  return [...days].sort((a, b) => a - b).map((d) => DAY_LABELS[d]).join(" · ");
}

export function convertTemp(value: number, from: "F" | "C", to: "F" | "C"): number {
  if (from === to) return value;
  return to === "C" ? Math.round(((value - 32) * 5) / 9 * 10) / 10 : Math.round((value * 9) / 5 + 32);
}
