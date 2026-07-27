import { beforeEach, describe, expect, it } from "vitest";
import {
  POOL_STALL_MS,
  SPA_STALL_MS,
  STOP_GRACE_MS,
  assessHeaters,
  resetHeaterWatchdog,
  type WatchedBody,
  type WatchedSnapshot,
} from "@/server/alerts/heater-watchdog";

function spa(overrides: Partial<WatchedBody> = {}): WatchedBody {
  return {
    id: 2,
    name: "Spa",
    kind: "spa",
    temp: 90,
    setPoint: 102,
    heatMode: "heater",
    heatStatus: "heater",
    ...overrides,
  };
}

function snap(bodies: WatchedBody[], overrides: Partial<WatchedSnapshot> = {}): WatchedSnapshot {
  return { bodies, units: "F", delay: false, ...overrides };
}

function condition(conditions: ReturnType<typeof assessHeaters>, key: string) {
  const hit = conditions.find((c) => c.key === key);
  expect(hit).toBeDefined();
  return hit!;
}

const T0 = 1_700_000_000_000;

describe("heater watchdog", () => {
  beforeEach(() => resetHeaterWatchdog());

  it("flags a spa that says heating but never warms", () => {
    expect(condition(assessHeaters(snap([spa()]), T0), "heater:stall:2").active).toBe(false);
    const later = assessHeaters(snap([spa()]), T0 + SPA_STALL_MS);
    const stall = condition(later, "heater:stall:2");
    expect(stall.active).toBe(true);
    expect(stall.title).toContain("may not be working");
    expect(stall.body).toContain("hasn't warmed");
  });

  it("stays quiet while the water is actually rising", () => {
    assessHeaters(snap([spa({ temp: 90 })]), T0);
    assessHeaters(snap([spa({ temp: 91.2 })]), T0 + 10 * 60_000); // baseline slides
    const later = assessHeaters(snap([spa({ temp: 92.3 })]), T0 + SPA_STALL_MS + 10 * 60_000);
    expect(condition(later, "heater:stall:2").active).toBe(false);
  });

  it("uses the wider, gentler window for pools", () => {
    const pool = spa({ id: 1, name: "Pool", kind: "pool", temp: 78, setPoint: 86 });
    assessHeaters(snap([pool]), T0);
    expect(condition(assessHeaters(snap([pool]), T0 + SPA_STALL_MS), "heater:stall:1").active).toBe(false);
    expect(condition(assessHeaters(snap([pool]), T0 + POOL_STALL_MS), "heater:stall:1").active).toBe(true);
  });

  it("flags a heater that quits far below the setpoint (after a grace period)", () => {
    assessHeaters(snap([spa({ temp: 95 })]), T0);
    const justStopped = assessHeaters(snap([spa({ temp: 95, heatStatus: "off" })]), T0 + 5 * 60_000);
    expect(condition(justStopped, "heater:stopped:2").active).toBe(false); // grace
    const later = assessHeaters(
      snap([spa({ temp: 95, heatStatus: "off" })]),
      T0 + 5 * 60_000 + STOP_GRACE_MS
    );
    const stopped = condition(later, "heater:stopped:2");
    expect(stopped.active).toBe(true);
    expect(stopped.body).toContain("shut off mid-heat");
  });

  it("treats stopping near the setpoint as normal cycling", () => {
    assessHeaters(snap([spa({ temp: 101 })]), T0);
    assessHeaters(snap([spa({ temp: 101.5, heatStatus: "off" })]), T0 + 5 * 60_000);
    const later = assessHeaters(
      snap([spa({ temp: 101.5, heatStatus: "off" })]),
      T0 + 5 * 60_000 + STOP_GRACE_MS
    );
    expect(condition(later, "heater:stopped:2").active).toBe(false);
  });

  it("ignores drops during a panel delay", () => {
    assessHeaters(snap([spa({ temp: 95 })]), T0);
    assessHeaters(snap([spa({ temp: 95, heatStatus: "off" })], { delay: true }), T0 + 5 * 60_000);
    const later = assessHeaters(
      snap([spa({ temp: 95, heatStatus: "off" })], { delay: true }),
      T0 + 5 * 60_000 + STOP_GRACE_MS
    );
    expect(condition(later, "heater:stopped:2").active).toBe(false);
  });

  it("clears the early-stop watch when heating resumes", () => {
    assessHeaters(snap([spa({ temp: 95 })]), T0);
    assessHeaters(snap([spa({ temp: 95, heatStatus: "off" })]), T0 + 5 * 60_000);
    assessHeaters(snap([spa({ temp: 95 })]), T0 + 6 * 60_000); // resumed
    const later = assessHeaters(
      snap([spa({ temp: 96, heatStatus: "off" })]),
      T0 + 6 * 60_000 + STOP_GRACE_MS
    );
    // The resume restarted tracking; this stop is a fresh grace window.
    expect(condition(later, "heater:stopped:2").active).toBe(false);
  });

  it("halves thresholds for °C systems", () => {
    const c = spa({ temp: 32 });
    assessHeaters(snap([c], { units: "C" }), T0);
    // +0.6°C within the window ≥ the 0.5°C scaled rise → baseline slides, no stall.
    assessHeaters(snap([spa({ temp: 32.6 })], { units: "C" }), T0 + 10 * 60_000);
    const later = assessHeaters(snap([spa({ temp: 32.6 })], { units: "C" }), T0 + SPA_STALL_MS);
    expect(condition(later, "heater:stall:2").active).toBe(false);
  });
});
