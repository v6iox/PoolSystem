import dgram from "node:dgram";
import { getDb, localDay, now } from "@/server/db";
import { sendAlert } from "@/server/push";
import { getSetting, setSetting } from "@/server/settings";

/**
 * WeatherFlow Tempest integration — local-first.
 *
 * Primary path: the Tempest hub broadcasts JSON on UDP :50222 on the LAN, so
 * we just listen — no API key, no cloud, perfectly in keeping with everything
 * else living on the Pi. Fallback path (for Docker bridge networks that can't
 * see LAN broadcasts): poll WeatherFlow's REST API with a personal token.
 *
 * What the rest of the system gets:
 *  - getTempestCurrent(): fresh hyper-local conditions merged into /api/weather
 *    and the heat advisories (real wind beats modeled wind)
 *  - measured daily rainfall sampled into history (metric tempest:rain_today_mm),
 *    which the water-balance estimator prefers over Open-Meteo's modeled precip
 *  - lightning strike push alerts ("out of the pool") with a cooldown
 */

export interface TempestCurrent {
  at: number;
  tempF: number;
  humidity: number;
  windMph: number;
  gustMph: number;
  uv: number;
  solarWm2: number;
  pressureMb: number;
  /** Measured rain accumulation today (local day), mm. */
  rainTodayMm: number;
  lightningCount3h: number;
}

interface TempestState {
  current: TempestCurrent | null;
  rainTodayMm: number;
  rainDay: string;
  lastSampleAt: number;
  lastLightningAlertAt: number;
  socket: dgram.Socket | null;
  restTimer: ReturnType<typeof setInterval> | null;
  udpPacketsSeen: number;
  /** Where the freshest observation came from. */
  source: "udp" | "rest" | null;
  lastRestOkAt: number | null;
  lastRestError: string | null;
}

const globalForTempest = globalThis as unknown as { __moonpoolTempest?: TempestState };

const LIGHTNING_COOLDOWN_MS = 30 * 60_000;
const LIGHTNING_MAX_MILES = 15;
const SAMPLE_EVERY_MS = 5 * 60_000;
const FRESH_MS = 10 * 60_000;

function state(): TempestState {
  if (!globalForTempest.__moonpoolTempest) {
    globalForTempest.__moonpoolTempest = {
      current: null,
      rainTodayMm: 0,
      rainDay: localDay(),
      lastSampleAt: 0,
      lastLightningAlertAt: 0,
      socket: null,
      restTimer: null,
      udpPacketsSeen: 0,
      source: null,
      lastRestOkAt: null,
      lastRestError: null,
    };
  }
  return globalForTempest.__moonpoolTempest;
}

/* ── configuration: Settings-UI values override .env, sparse like the rest ── */

export interface TempestSettings {
  /** Listen for hub broadcasts on UDP :50222. */
  udp: boolean;
  /** WeatherFlow personal access token (REST fallback / supplement). */
  token: string;
  /** Station to poll via REST. */
  stationId: string;
}

const TEMPEST_KEY = "tempest";

export function getTempestSettings(): { effective: TempestSettings; storedKeys: string[] } {
  const stored = getSetting<Partial<TempestSettings>>(TEMPEST_KEY, {});
  return {
    effective: {
      udp: stored.udp ?? process.env.TEMPEST_UDP !== "false",
      token: stored.token ?? process.env.TEMPEST_TOKEN ?? "",
      stationId: stored.stationId ?? process.env.TEMPEST_STATION_ID ?? "",
    },
    storedKeys: Object.keys(stored),
  };
}

/** Sparse save: only explicitly-set keys are stored; null deletes a key so .env wins again. */
export function saveTempestSettings(patch: { udp?: boolean | null; token?: string | null; stationId?: string | null }): void {
  const stored = getSetting<Record<string, unknown>>(TEMPEST_KEY, {});
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete stored[key];
    else if (value !== undefined) stored[key] = value;
  }
  setSetting(TEMPEST_KEY, stored);
}

function cToF(c: number): number {
  return (c * 9) / 5 + 32;
}
function msToMph(ms: number): number {
  return ms * 2.23694;
}

function rollRainDay(s: TempestState): void {
  const today = localDay();
  if (s.rainDay !== today) {
    s.rainDay = today;
    s.rainTodayMm = 0;
  }
}

function sampleToHistory(s: TempestState): void {
  if (now() - s.lastSampleAt < SAMPLE_EVERY_MS) return;
  s.lastSampleAt = now();
  const c = s.current;
  if (!c) return;
  try {
    const insert = getDb().prepare("INSERT OR REPLACE INTO history_samples (at, metric, value) VALUES (?, ?, ?)");
    insert.run(now(), "tempest:rain_today_mm", s.rainTodayMm);
    insert.run(now(), "tempest:temp", Math.round(c.tempF * 10) / 10);
    insert.run(now(), "tempest:wind", Math.round(c.windMph * 10) / 10);
    insert.run(now(), "tempest:uv", c.uv);
  } catch {
    // history write failure is never fatal
  }
}

function onLightning(distanceKm: number): void {
  const s = state();
  const miles = Math.round(distanceKm * 0.621371);
  if (miles > LIGHTNING_MAX_MILES) return;
  if (now() - s.lastLightningAlertAt < LIGHTNING_COOLDOWN_MS) return;
  s.lastLightningAlertAt = now();
  void sendAlert(
    "lightning",
    "Lightning nearby ⚡",
    `Your Tempest detected a strike ~${Math.max(1, miles)} mi away. Time to get out of the pool.`
  );
}

/** obs_st array layout per WeatherFlow UDP reference (v143+). */
function handleObsSt(obs: number[]): void {
  const s = state();
  rollRainDay(s);
  const rainMinuteMm = obs[12] ?? 0;
  s.rainTodayMm += rainMinuteMm;
  s.current = {
    at: (obs[0] ?? 0) * 1000 || now(),
    tempF: Math.round(cToF(obs[7] ?? 0) * 10) / 10,
    humidity: obs[8] ?? 0,
    windMph: Math.round(msToMph(obs[2] ?? 0) * 10) / 10,
    gustMph: Math.round(msToMph(obs[3] ?? 0) * 10) / 10,
    uv: obs[10] ?? 0,
    solarWm2: obs[11] ?? 0,
    pressureMb: obs[6] ?? 0,
    rainTodayMm: s.rainTodayMm,
    lightningCount3h: obs[15] ?? 0,
  };
  sampleToHistory(s);
}

function handlePacket(raw: Buffer): void {
  const s = state();
  let msg: { type?: string; obs?: number[][]; evt?: number[]; ob?: number[] };
  try {
    msg = JSON.parse(raw.toString("utf8")) as typeof msg;
  } catch {
    return;
  }
  s.udpPacketsSeen += 1;
  if (msg.type === "obs_st" && Array.isArray(msg.obs) && Array.isArray(msg.obs[0])) {
    handleObsSt(msg.obs[0]);
    s.source = "udp";
  } else if (msg.type === "evt_strike" && Array.isArray(msg.evt)) {
    onLightning(msg.evt[1] ?? 999);
  } else if (msg.type === "rapid_wind" && Array.isArray(msg.ob) && s.current) {
    // rapid_wind carries its data in "ob" ([epoch, m/s, dir]), not "evt".
    s.current = { ...s.current, windMph: Math.round(msToMph(msg.ob[1] ?? 0) * 10) / 10 };
  }
}

async function pollRest(token: string, stationId: string): Promise<void> {
  const s = state();
  try {
    const res = await fetch(
      `https://swd.weatherflow.com/swd/rest/observations/station/${encodeURIComponent(stationId)}?token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) {
      s.lastRestError =
        res.status === 401 || res.status === 403
          ? "WeatherFlow rejected the token — create one at tempestwx.com → Settings → Data Authorizations"
          : res.status === 404
            ? `Station ${stationId} not found on this account`
            : `WeatherFlow API error ${res.status}`;
      return;
    }
    const json = (await res.json()) as {
      obs?: Array<{
        timestamp?: number;
        air_temperature?: number;
        relative_humidity?: number;
        wind_avg?: number;
        wind_gust?: number;
        uv?: number;
        solar_radiation?: number;
        barometric_pressure?: number;
        precip_accum_local_day?: number;
        lightning_strike_count_last_3hr?: number;
        lightning_strike_last_distance?: number;
        lightning_strike_last_epoch?: number;
      }>;
    };
    const o = json.obs?.[0];
    if (!o) return;
    rollRainDay(s);
    s.rainTodayMm = o.precip_accum_local_day ?? s.rainTodayMm;
    s.current = {
      at: (o.timestamp ?? 0) * 1000 || now(),
      tempF: Math.round(cToF(o.air_temperature ?? 0) * 10) / 10,
      humidity: o.relative_humidity ?? 0,
      windMph: Math.round(msToMph(o.wind_avg ?? 0) * 10) / 10,
      gustMph: Math.round(msToMph(o.wind_gust ?? 0) * 10) / 10,
      uv: o.uv ?? 0,
      solarWm2: o.solar_radiation ?? 0,
      pressureMb: o.barometric_pressure ?? 0,
      rainTodayMm: s.rainTodayMm,
      lightningCount3h: o.lightning_strike_count_last_3hr ?? 0,
    };
    s.source = "rest";
    s.lastRestOkAt = now();
    s.lastRestError = null;
    // Recent strike (within the poll interval) → alert.
    if (o.lightning_strike_last_epoch && o.lightning_strike_last_epoch * 1000 > now() - 6 * 60_000) {
      onLightning(o.lightning_strike_last_distance ?? 999);
    }
    sampleToHistory(s);
  } catch {
    // offline — UDP or Open-Meteo still cover us; remember why for the UI
    s.lastRestError = "couldn't reach weatherflow.com";
  }
}

export function startTempest(): void {
  const s = state();
  if (s.socket || s.restTimer) return;
  if (process.env.MOCK_MODE === "true") return;
  const { effective } = getTempestSettings();

  // UDP listener (default on — harmless when no hub exists).
  if (effective.udp) {
    try {
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      socket.on("message", handlePacket);
      socket.on("error", () => {
        socket.close();
        s.socket = null;
      });
      socket.bind(50222);
      s.socket = socket;
      console.log("[moonpool] Tempest UDP listener on :50222");
    } catch {
      // port busy — REST fallback may still work
    }
  }

  // REST fallback / supplement when a token is configured.
  const { token, stationId } = effective;
  if (token && stationId) {
    s.restTimer = setInterval(() => {
      // Skip polling while fresh UDP data is flowing.
      if (s.current && now() - s.current.at < FRESH_MS && s.udpPacketsSeen > 0) return;
      void pollRest(token, stationId);
    }, 5 * 60_000);
    void pollRest(token, stationId);
    console.log(`[moonpool] Tempest REST fallback for station ${stationId}`);
  }
}

/** Tear down listeners/timers (settings changed, tests). */
export function stopTempest(): void {
  const s = state();
  if (s.socket) {
    try {
      s.socket.close();
    } catch {
      /* already closed */
    }
    s.socket = null;
  }
  if (s.restTimer) {
    clearInterval(s.restTimer);
    s.restTimer = null;
  }
}

/** Apply current settings live — no container restart needed. */
export function restartTempest(): void {
  stopTempest();
  startTempest();
}

/** One immediate REST poll (used by the Settings "Test" flow). */
export async function pollTempestNow(): Promise<void> {
  const { effective } = getTempestSettings();
  if (effective.token && effective.stationId) await pollRest(effective.token, effective.stationId);
}

export interface TempestStatus {
  mock: boolean;
  udpEnabled: boolean;
  udpListening: boolean;
  udpPacketsSeen: number;
  restConfigured: boolean;
  lastRestOkAt: number | null;
  lastRestError: string | null;
  /** Fresh data is flowing (any source). */
  receiving: boolean;
  source: "udp" | "rest" | null;
  lastObsAt: number | null;
  current: TempestCurrent | null;
}

export function getTempestStatus(): TempestStatus {
  const s = state();
  const { effective } = getTempestSettings();
  const current = getTempestCurrent();
  return {
    mock: process.env.MOCK_MODE === "true",
    udpEnabled: effective.udp,
    udpListening: s.socket !== null,
    udpPacketsSeen: s.udpPacketsSeen,
    restConfigured: Boolean(effective.token && effective.stationId),
    lastRestOkAt: s.lastRestOkAt,
    lastRestError: s.lastRestError,
    receiving: current !== null,
    source: process.env.MOCK_MODE === "true" ? "udp" : current ? s.source : null,
    lastObsAt: current?.at ?? null,
    current,
  };
}

/** Stations visible to a WeatherFlow token — the Settings station picker. */
export async function listTempestStations(token: string): Promise<Array<{ id: number; name: string }>> {
  const res = await fetch(`https://swd.weatherflow.com/swd/rest/stations?token=${encodeURIComponent(token)}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? "WeatherFlow rejected the token — create one at tempestwx.com → Settings → Data Authorizations"
        : `WeatherFlow API error ${res.status}`
    );
  }
  const json = (await res.json()) as { stations?: Array<{ station_id?: number; name?: string; public_name?: string }> };
  return (json.stations ?? [])
    .map((st) => ({ id: st.station_id ?? 0, name: st.public_name || st.name || `Station ${st.station_id}` }))
    .filter((st) => st.id > 0);
}

/** Fresh station conditions, or null if we haven't heard from the Tempest lately. */
export function getTempestCurrent(): TempestCurrent | null {
  const c = state().current;
  if (!c || now() - c.at > FRESH_MS) {
    // Simulator: synthesize a station so Tempest-driven UI (verified badge,
    // wind advisories, rain measurements) is demoable with zero hardware.
    if (process.env.MOCK_MODE === "true") {
      return {
        at: now() - 25_000,
        tempF: 74.8,
        humidity: 38,
        windMph: 6.2,
        gustMph: 11.5,
        uv: 5,
        solarWm2: 610,
        pressureMb: 1013,
        rainTodayMm: 0,
        lightningCount3h: 0,
      };
    }
    return null;
  }
  return c;
}

/** Measured rainfall by local day (mm) from Tempest history, for the water balance. */
export function getMeasuredRainByDay(): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const db = getDb();
    const rolled = db
      .prepare("SELECT day, max AS mm FROM history_rollups WHERE metric = 'tempest:rain_today_mm'")
      .all() as Array<{ day: string; mm: number }>;
    for (const r of rolled) out.set(r.day, r.mm);
    const today = db
      .prepare(
        `SELECT date(at / 1000, 'unixepoch', 'localtime') AS day, MAX(value) AS mm FROM history_samples
         WHERE metric = 'tempest:rain_today_mm' GROUP BY day`
      )
      .all() as Array<{ day: string; mm: number }>;
    for (const r of today) out.set(r.day, r.mm);
  } catch {
    // no data yet
  }
  return out;
}
