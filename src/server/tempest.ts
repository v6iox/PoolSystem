import dgram from "node:dgram";
import { getDb, localDay, now } from "@/server/db";
import { sendAlert } from "@/server/push";

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
    };
  }
  return globalForTempest.__moonpoolTempest;
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
  let msg: { type?: string; obs?: number[][]; evt?: number[] };
  try {
    msg = JSON.parse(raw.toString("utf8")) as typeof msg;
  } catch {
    return;
  }
  s.udpPacketsSeen += 1;
  if (msg.type === "obs_st" && Array.isArray(msg.obs) && Array.isArray(msg.obs[0])) {
    handleObsSt(msg.obs[0]);
  } else if (msg.type === "evt_strike" && Array.isArray(msg.evt)) {
    onLightning(msg.evt[1] ?? 999);
  } else if (msg.type === "rapid_wind" && Array.isArray(msg.evt) && s.current) {
    s.current = { ...s.current, windMph: Math.round(msToMph(msg.evt[1] ?? 0) * 10) / 10 };
  }
}

async function pollRest(token: string, stationId: string): Promise<void> {
  const s = state();
  try {
    const res = await fetch(
      `https://swd.weatherflow.com/swd/rest/observations/station/${stationId}?token=${token}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return;
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
    // Recent strike (within the poll interval) → alert.
    if (o.lightning_strike_last_epoch && o.lightning_strike_last_epoch * 1000 > now() - 6 * 60_000) {
      onLightning(o.lightning_strike_last_distance ?? 999);
    }
    sampleToHistory(s);
  } catch {
    // offline / bad token — stay silent, UDP or Open-Meteo still cover us
  }
}

export function startTempest(): void {
  const s = state();
  if (s.socket || s.restTimer) return;
  if (process.env.MOCK_MODE === "true") return;

  // UDP listener (default on — harmless when no hub exists).
  if (process.env.TEMPEST_UDP !== "false") {
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
  const token = process.env.TEMPEST_TOKEN;
  const stationId = process.env.TEMPEST_STATION_ID;
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

/** Fresh station conditions, or null if we haven't heard from the Tempest lately. */
export function getTempestCurrent(): TempestCurrent | null {
  const c = state().current;
  if (!c || now() - c.at > FRESH_MS) return null;
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
