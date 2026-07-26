import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getForecast } from "@/server/weather";
import { getTempestCurrent } from "@/server/tempest";
import type { WeatherData } from "@/types/weather";

export const dynamic = "force-dynamic";

/**
 * Current conditions. When a Tempest station is on the LAN its hyper-local
 * readings override Open-Meteo's modeled ones; forecast fields (high/low,
 * weather code) still come from Open-Meteo.
 */
export async function GET(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const forecast = await getForecast();
  const tempest = getTempestCurrent();
  if (!forecast && !tempest) return NextResponse.json({ weather: null });

  let weather: WeatherData | null = forecast?.current ? { ...forecast.current, source: "open-meteo" } : null;
  if (tempest) {
    weather = {
      tempF: tempest.tempF,
      tempC: Math.round((((tempest.tempF - 32) * 5) / 9) * 10) / 10,
      code: forecast?.current.code ?? 0,
      windMph: tempest.windMph,
      isDay: forecast?.current.isDay ?? true,
      high: forecast?.current.high ?? tempest.tempF,
      low: forecast?.current.low ?? tempest.tempF,
      fetchedAt: tempest.at,
      source: "tempest",
      humidity: tempest.humidity,
      uv: tempest.uv,
      solarWm2: tempest.solarWm2,
      gustMph: tempest.gustMph,
      rainTodayIn: Math.round((tempest.rainTodayMm / 25.4) * 100) / 100,
    };
  }
  return NextResponse.json({ weather });
}
