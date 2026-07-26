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

export interface Forecast {
  current: WeatherData;
  hourly: HourlyForecast[]; // next ~48h
  fetchedAt: number;
}

let cache: Forecast | null = null;

export async function getForecast(): Promise<Forecast | null> {
  if (cache && Date.now() - cache.fetchedAt < 10 * 60_000) return cache;
  const { latitude, longitude } = getAppSettings();
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,weather_code,wind_speed_10m,is_day` +
      `&hourly=temperature_2m,precipitation_probability,wind_speed_10m` +
      `&daily=temperature_2m_max,temperature_2m_min` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=3`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const json = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number; is_day?: number };
      hourly?: { time?: string[]; temperature_2m?: number[]; precipitation_probability?: number[]; wind_speed_10m?: number[] };
      daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
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
    cache = {
      current: {
        tempF,
        tempC: Math.round((((tempF - 32) * 5) / 9) * 10) / 10,
        code: json.current?.weather_code ?? 0,
        windMph: json.current?.wind_speed_10m ?? 0,
        isDay: (json.current?.is_day ?? 1) === 1,
        high: json.daily?.temperature_2m_max?.[0] ?? tempF,
        low: json.daily?.temperature_2m_min?.[0] ?? tempF,
        fetchedAt: Date.now(),
      },
      hourly,
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
function rainWindows(hourly: HourlyForecast[], threshold = 55): Array<{ from: number; to: number; peak: number }> {
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
  if (kind === "spa" && forecast.current.windMph >= 20) {
    advisories.push({
      severity: "info",
      message: `It's blowing ${Math.round(forecast.current.windMph)} mph — expect the spa to lose heat fast.`,
    });
  }

  return advisories;
}
