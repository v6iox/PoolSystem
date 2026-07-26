import { getAppSettings } from "@/server/settings";
import type { Advisory, WeatherData } from "@/types/weather";

/**
 * Server-side Open-Meteo client (keyless) with caching, plus the advisory
 * generator behind weather-aware confirmations ("Heat the pool? Rain is
 * forecast tomorrow 3–4 PM"). The only external call in the system; every
 * consumer degrades gracefully when it's unavailable.
 */

export interface HourlyForecast {
  at: number;
  tempF: number;
  precipProbability: number;
  windMph: number;
}

export interface DailyWater {
  /** YYYY-MM-DD local */
  day: string;
  /** Reference evapotranspiration, mm (open water evaporates ≈ 1.1×). */
  et0Mm: number;
  /** Actual/forecast precipitation, mm. */
  precipMm: number;
}

export interface Forecast {
  current: WeatherData;
  hourly: HourlyForecast[]; // next ~48h
  /** Past 7 days (actuals) + next 3 (forecast) — powers the water-balance estimate. */
  daily: DailyWater[];
  fetchedAt: number;
}

let cache: Forecast | null = null;

/**
 * MOCK_MODE forecast: plausible synthetic weather so every weather-driven
 * feature (widget, heat advisories, water balance) is demoable offline.
 * Includes a rain window tomorrow 3–4 PM on purpose.
 */
function mockForecast(): Forecast {
  const nowMs = Date.now();
  const hourTemp = (at: number): number => {
    const h = new Date(at).getHours();
    return 70 + 14 * Math.sin(((h - 10) / 24) * Math.PI * 2);
  };
  const tomorrow3pm = new Date();
  tomorrow3pm.setDate(tomorrow3pm.getDate() + 1);
  tomorrow3pm.setHours(15, 0, 0, 0);
  const hourly: HourlyForecast[] = [];
  for (let i = 0; i < 48; i++) {
    const at = nowMs + i * 3600_000;
    const inRainWindow = at >= tomorrow3pm.getTime() && at < tomorrow3pm.getTime() + 3600_000;
    hourly.push({ at, tempF: Math.round(hourTemp(at)), precipProbability: inRainWindow ? 80 : 10, windMph: 6 });
  }
  const daily: DailyWater[] = [];
  for (let offset = -7; offset <= 2; offset++) {
    const d = new Date(nowMs + offset * 86400_000);
    daily.push({
      day: d.toLocaleDateString("sv-SE"),
      et0Mm: 5.4,
      precipMm: offset === 1 ? 6 : 0,
    });
  }
  const tempF = Math.round(hourTemp(nowMs));
  return {
    current: {
      tempF,
      tempC: Math.round((((tempF - 32) * 5) / 9) * 10) / 10,
      code: new Date().getHours() < 18 ? 1 : 0,
      windMph: 6,
      isDay: new Date().getHours() >= 6 && new Date().getHours() < 20,
      high: 84,
      low: 58,
      fetchedAt: nowMs,
    },
    hourly,
    daily,
    fetchedAt: nowMs,
  };
}

export async function getForecast(): Promise<Forecast | null> {
  if (process.env.MOCK_MODE === "true") {
    if (!cache || Date.now() - cache.fetchedAt > 10 * 60_000) cache = mockForecast();
    return cache;
  }
  if (cache && Date.now() - cache.fetchedAt < 10 * 60_000) return cache;
  const { latitude, longitude } = getAppSettings();
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,weather_code,wind_speed_10m,is_day` +
      `&hourly=temperature_2m,precipitation_probability,wind_speed_10m` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=3&past_days=7`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const json = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number; is_day?: number };
      hourly?: { time?: string[]; temperature_2m?: number[]; precipitation_probability?: number[]; wind_speed_10m?: number[] };
      daily?: {
        time?: string[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_sum?: number[];
        et0_fao_evapotranspiration?: number[];
      };
    };
    const tempF = json.current?.temperature_2m ?? 0;
    const times = json.hourly?.time ?? [];
    const nowMs = Date.now();
    const hourly: HourlyForecast[] = times
      .map((t, i) => ({
        at: new Date(t).getTime(),
        tempF: json.hourly?.temperature_2m?.[i] ?? tempF,
        precipProbability: json.hourly?.precipitation_probability?.[i] ?? 0,
        windMph: json.hourly?.wind_speed_10m?.[i] ?? 0,
      }))
      .filter((h) => h.at >= nowMs - 3600_000 && h.at <= nowMs + 48 * 3600_000);
    const dayList = json.daily?.time ?? [];
    // past_days=7 shifts indexes: find "today" for the current high/low.
    const todayStr = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD
    const todayIdx = Math.max(0, dayList.indexOf(todayStr));
    const daily: DailyWater[] = dayList.map((day, i) => ({
      day,
      et0Mm: json.daily?.et0_fao_evapotranspiration?.[i] ?? 0,
      precipMm: json.daily?.precipitation_sum?.[i] ?? 0,
    }));
    cache = {
      current: {
        tempF,
        tempC: Math.round((((tempF - 32) * 5) / 9) * 10) / 10,
        code: json.current?.weather_code ?? 0,
        windMph: json.current?.wind_speed_10m ?? 0,
        isDay: (json.current?.is_day ?? 1) === 1,
        high: json.daily?.temperature_2m_max?.[todayIdx] ?? tempF,
        low: json.daily?.temperature_2m_min?.[todayIdx] ?? tempF,
        fetchedAt: Date.now(),
      },
      hourly,
      daily,
      fetchedAt: Date.now(),
    };
    return cache;
  } catch {
    return cache; // stale is better than nothing; null only if never fetched
  }
}

export type { Advisory } from "@/types/weather";

function formatHour(at: number): string {
  const d = new Date(at);
  const h = d.getHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12} ${h >= 12 ? "PM" : "AM"}`;
}

function dayWord(at: number): string {
  const target = new Date(at);
  const today = new Date();
  const diffDays = Math.floor((target.setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86400_000);
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "tomorrow";
  return target.toLocaleDateString("en-US", { weekday: "long" });
}

/** Find contiguous rain windows (probability ≥ threshold) in the next 36h. */
export function rainWindows(hourly: HourlyForecast[], threshold = 55): Array<{ from: number; to: number; peak: number }> {
  const windows: Array<{ from: number; to: number; peak: number }> = [];
  let open: { from: number; to: number; peak: number } | null = null;
  for (const h of hourly.filter((x) => x.at <= Date.now() + 36 * 3600_000)) {
    if (h.precipProbability >= threshold) {
      if (!open) open = { from: h.at, to: h.at + 3600_000, peak: h.precipProbability };
      else {
        open.to = h.at + 3600_000;
        open.peak = Math.max(open.peak, h.precipProbability);
      }
    } else if (open) {
      windows.push(open);
      open = null;
    }
  }
  if (open) windows.push(open);
  return windows;
}

/**
 * Advisories for a "start heating / raise setpoint" intent. Empty array =
 * nothing worth interrupting the user about (no nag dialogs).
 */
export async function heatAdvisories(kind: "pool" | "spa", setPoint?: number): Promise<Advisory[]> {
  const forecast = await getForecast();
  if (!forecast) return [];
  const advisories: Advisory[] = [];

  // Rain coming — mostly relevant for the pool (long heat-up, open water).
  const windows = rainWindows(forecast.hourly);
  if (windows.length > 0 && kind === "pool") {
    const w = windows[0]!;
    advisories.push({
      severity: "caution",
      message: `Rain is forecast ${dayWord(w.from)} ${formatHour(w.from)}–${formatHour(w.to)} (${w.peak}% chance).`,
    });
  }

  // Cold night ahead → expensive heat, big losses.
  const next18h = forecast.hourly.filter((h) => h.at <= Date.now() + 18 * 3600_000);
  const coldest = next18h.reduce<HourlyForecast | null>((min, h) => (min === null || h.tempF < min.tempF ? h : min), null);
  if (kind === "pool" && coldest && coldest.tempF <= 50) {
    advisories.push({
      severity: "caution",
      message: `Air drops to ${Math.round(coldest.tempF)}° overnight — heating the pool will be slow and pricey.`,
    });
  }

  // Already hot out and pool nearly there → may not need the heater at all.
  if (kind === "pool" && setPoint !== undefined && forecast.current.high >= setPoint) {
    advisories.push({
      severity: "info",
      message: `Today's high is ${Math.round(forecast.current.high)}° — the sun may get you to ${setPoint}° for free.`,
    });
  }

  // Very windy right now → spa heat loss is dramatic with the cover off.
  // Prefer the on-site Tempest reading over the modeled wind when available.
  const { getTempestCurrent } = await import("@/server/tempest");
  const windMph = getTempestCurrent()?.windMph ?? forecast.current.windMph;
  if (kind === "spa" && windMph >= 20) {
    advisories.push({
      severity: "info",
      message: `It's blowing ${Math.round(windMph)} mph at the pool — expect the spa to lose heat fast.`,
    });
  }

  return advisories;
}
