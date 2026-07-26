import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getForecast } from "@/server/weather";

export const dynamic = "force-dynamic";

/**
 * Current conditions via the shared server-side Open-Meteo client
 * (src/server/weather.ts). Keyless, cached, degrades to null when offline.
 */
export async function GET(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const forecast = await getForecast();
  return NextResponse.json({ weather: forecast?.current ?? null });
}
