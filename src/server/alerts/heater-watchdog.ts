/**
 * Heater watchdog: notices when a heater SAYS it's heating but the water
 * isn't warming (stall), or when it drops out well short of the setpoint
 * with heat mode still on (stopped mid-heat). Pure state-machine over
 * snapshots — no DB, no push — so it's directly unit-testable; the alert
 * engine turns the returned conditions into edge-triggered pushes.
 */

export interface WatchedBody {
  id: number;
  name: string;
  kind: string;
  temp: number | null;
  setPoint: number;
  heatMode: string;
  heatStatus: string;
}

export interface WatchedSnapshot {
  bodies: WatchedBody[];
  units: string;
  /** Panel delay (heater cool-down etc.) — heat drops during one are normal. */
  delay: boolean;
}

export interface HeaterCondition {
  key: string;
  active: boolean;
  title: string;
  body: string;
}

// Spas heat fast (~1°F every few minutes); pools are slow-and-steady, so the
// stall window is wider and the expected rise smaller. °C thresholds are half.
export const SPA_STALL_MS = 15 * 60_000;
export const POOL_STALL_MS = 45 * 60_000;
export const SPA_STALL_RISE_F = 1.0;
export const POOL_STALL_RISE_F = 0.5;
export const STOP_DEFICIT_F = 3;
export const STOP_GRACE_MS = 5 * 60_000;

interface BodyTrack {
  /** Rolling progress baseline while heating. */
  baseTemp: number;
  baseAt: number;
  heating: boolean;
  /** Set when heat dropped out suspiciously far from the setpoint. */
  stoppedAt: number | null;
  stopTemp: number | null;
}

const tracks = new Map<number, BodyTrack>();

export function resetHeaterWatchdog(): void {
  tracks.clear();
}

function fmt(n: number): number {
  return Math.round(n * 10) / 10;
}

export function assessHeaters(snap: WatchedSnapshot, nowMs: number = Date.now()): HeaterCondition[] {
  const celsius = snap.units.toUpperCase() === "C";
  const scale = celsius ? 0.5 : 1;
  const deg = `°${snap.units}`;
  const out: HeaterCondition[] = [];

  for (const b of snap.bodies) {
    const heating = b.heatStatus !== "off";
    const stallMs = b.kind === "spa" ? SPA_STALL_MS : POOL_STALL_MS;
    const stallRise = (b.kind === "spa" ? SPA_STALL_RISE_F : POOL_STALL_RISE_F) * scale;
    const stopDeficit = STOP_DEFICIT_F * scale;

    let track = tracks.get(b.id);

    if (b.temp === null) {
      // No reading → nothing to judge; drop any in-progress tracking.
      tracks.delete(b.id);
      out.push({ key: `heater:stall:${b.id}`, active: false, title: "", body: "" });
      out.push({ key: `heater:stopped:${b.id}`, active: false, title: "", body: "" });
      continue;
    }

    if (heating) {
      if (!track || !track.heating) {
        track = { baseTemp: b.temp, baseAt: nowMs, heating: true, stoppedAt: null, stopTemp: null };
        tracks.set(b.id, track);
      }
      // Water is rising → slide the baseline forward; the clock restarts.
      if (b.temp - track.baseTemp >= stallRise) {
        track.baseTemp = b.temp;
        track.baseAt = nowMs;
      }
      track.stoppedAt = null;

      const stalled = nowMs - track.baseAt >= stallMs && b.temp - track.baseTemp < stallRise;
      const minutes = Math.round((nowMs - track.baseAt) / 60_000);
      out.push({
        key: `heater:stall:${b.id}`,
        active: stalled,
        title: `${b.name} heater may not be working`,
        body: `${b.name} says it's heating (${b.heatStatus}) but the water hasn't warmed in ${minutes} min — stuck around ${fmt(b.temp)}${deg}, target ${b.setPoint}${deg}. Worth checking the heater.`,
      });
      out.push({ key: `heater:stopped:${b.id}`, active: false, title: "", body: "" });
      continue;
    }

    // Not heating. Did it just drop out mid-heat?
    if (track?.heating) {
      const deficit = b.setPoint - b.temp;
      const suspicious = b.heatMode !== "off" && deficit >= stopDeficit && !snap.delay;
      track.heating = false;
      track.stoppedAt = suspicious ? nowMs : null;
      track.stopTemp = suspicious ? b.temp : null;
    }

    // Heat came back on / mode turned off / target reached → all clear.
    if (track && track.stoppedAt !== null && (b.heatMode === "off" || b.setPoint - b.temp < stopDeficit)) {
      track.stoppedAt = null;
    }

    const stopped =
      track !== undefined && track.stoppedAt !== null && nowMs - track.stoppedAt >= STOP_GRACE_MS;
    const deficit = fmt(b.setPoint - b.temp);
    out.push({ key: `heater:stall:${b.id}`, active: false, title: "", body: "" });
    out.push({
      key: `heater:stopped:${b.id}`,
      active: stopped,
      title: `${b.name} heater stopped early`,
      body: `${b.name} stopped heating at ${fmt(b.temp)}${deg} — ${deficit}${deg} short of its ${b.setPoint}${deg} target, with heat mode still on. It may have shut off mid-heat.`,
    });
  }

  return out;
}
