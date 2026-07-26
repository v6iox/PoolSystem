import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getAppSettings } from "@/server/settings";
import type { WeatherData } from "@/types/weather";

export const dynamic = "force-dynamic";

/**
 * Open-Meteo current conditions (no API key). Server-side fetch with a 10 min
 * cache; the app degrades gracefully when offline — weather is the only
 * external call in the whole system.
 */
let cache: { data: WeatherData; at: number } | null = null;

export async function GET(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (cache && Date.now() - cache.at < 10 * 60_000) {
    return NextResponse.json({ weather: cache.data });
  }
  const { latitude, longitude } = getAppSettings();
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,weather_code,wind_speed_10m,is_day&daily=temperature_2m_max,temperature_2m_min` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const json = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number; is_day?: number };
      daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
    };
    const tempF = json.current?.temperature_2m ?? 0;
    const data: WeatherData = {
      tempF,
      tempC: Math.round(((tempF - 32) * 5) / 9 * 10) / 10,
      code: json.current?.weather_code ?? 0,
      windMph: json.current?.wind_speed_10m ?? 0,
      isDay: (json.current?.is_day ?? 1) === 1,
      high: json.daily?.temperature_2m_max?.[0] ?? tempF,
      low: json.daily?.temperature_2m_min?.[0] ?? tempF,
      fetchedAt: Date.now(),
    };
    cache = { data, at: Date.now() };
    return NextResponse.json({ weather: data });
  } catch {
    // Serve stale cache if we have one; otherwise a null weather (UI hides the widget).
    if (cache) return NextResponse.json({ weather: cache.data, stale: true });
    return NextResponse.json({ weather: null });
  }
}
