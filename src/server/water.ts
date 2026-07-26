import { getForecast, rainWindows } from "@/server/weather";
import { getAppSettings, getSetting, setSetting } from "@/server/settings";

/**
 * Water-level estimator. The panel has no level sensor, so we run a water
 * balance instead: daily evaporation (Open-Meteo reference evapotranspiration
 * × 1.1 open-water factor) minus rainfall, integrated since the last recorded
 * top-off. Good enough to say "you're down about an inch and no rain is
 * coming — add water", with a one-tap reset when the user refills.
 *
 * If real level hardware ever shows up (GPIO ultrasonic sensor, autofill
 * controller reported through njsPC), prefer its reading over this estimate.
 */

const OPEN_WATER_FACTOR = 1.1;
const LOW_THRESHOLD_IN = 1.0;
/** Rain below this in the next 48h doesn't count as "rain coming". */
const MEANINGFUL_RAIN_MM = 4;

interface RefillState {
  /** Epoch ms of the last "I topped it off". */
  refillAt: number;
}

export interface WaterEstimate {
  available: boolean;
  /** Inches lost to evaporation since refill. */
  lossInches: number;
  /** Inches gained from rain since refill. */
  rainInches: number;
  /** Negative = down. */
  netInches: number;
  /** Approximate gallons needed to top off (0 when not down). */
  gallonsNeeded: number;
  sinceDays: number;
  refillAt: number;
  /** Meaningful rain expected within 48h, if any. */
  nextRain: { at: number; peakProbability: number; expectedMm: number } | null;
  low: boolean;
  message: string;
}

function getRefillState(): RefillState {
  const stored = getSetting<RefillState | null>("waterRefill", null);
  if (stored && typeof stored.refillAt === "number") return stored;
  const initial = { refillAt: Date.now() - 7 * 86400_000 };
  setSetting("waterRefill", initial);
  return initial;
}

export function recordRefill(): void {
  setSetting("waterRefill", { refillAt: Date.now() });
}

export async function estimateWaterLevel(): Promise<WaterEstimate> {
  const settings = getAppSettings();
  const forecast = await getForecast();
  const { refillAt } = getRefillState();

  const empty: WaterEstimate = {
    available: false,
    lossInches: 0,
    rainInches: 0,
    netInches: 0,
    gallonsNeeded: 0,
    sinceDays: 0,
    refillAt,
    nextRain: null,
    low: false,
    message: "Water-level estimate unavailable (no weather data).",
  };
  if (!forecast) return empty;

  const todayStr = new Date().toLocaleDateString("sv-SE");
  const refillStr = new Date(refillAt).toLocaleDateString("sv-SE");
  // Only count full days from the refill day through today, capped at what we have.
  const counted = forecast.daily.filter((d) => d.day >= refillStr && d.day <= todayStr);
  let lossMm = 0;
  let rainMm = 0;
  for (const d of counted) {
    lossMm += d.et0Mm * OPEN_WATER_FACTOR;
    rainMm += d.precipMm;
  }
  const lossInches = lossMm / 25.4;
  const rainInches = rainMm / 25.4;
  const netInches = rainInches - lossInches;
  const sinceDays = Math.max(1, Math.round((Date.now() - refillAt) / 86400_000));

  // Upcoming rain: probability windows + forecast precip totals for the next 2 days.
  const windows = rainWindows(forecast.hourly, 50);
  const futureRainMm = forecast.daily
    .filter((d) => d.day >= todayStr)
    .reduce((sum, d) => sum + d.precipMm, 0);
  const nextRain =
    windows.length > 0 && futureRainMm >= MEANINGFUL_RAIN_MM
      ? { at: windows[0]!.from, peakProbability: windows[0]!.peak, expectedMm: Math.round(futureRainMm) }
      : null;

  const down = Math.max(0, -netInches);
  const gallonsNeeded = Math.round((down / 12) * settings.poolSurfaceAreaSqFt * 7.48);
  const low = down >= LOW_THRESHOLD_IN && nextRain === null;

  let message: string;
  if (down < 0.25) {
    message = `Water level looks fine — net ${netInches >= 0 ? "+" : ""}${netInches.toFixed(1)} in over ${sinceDays}d.`;
  } else if (nextRain) {
    message = `Down ~${down.toFixed(1)} in, but rain is expected ${new Date(nextRain.at).toLocaleDateString("en-US", { weekday: "long" })} (~${(nextRain.expectedMm / 25.4).toFixed(1)} in) — maybe wait.`;
  } else {
    message = `Down ~${down.toFixed(1)} in (≈${gallonsNeeded} gal) over ${sinceDays}d with no rain in sight — time to add water.`;
  }

  return {
    available: true,
    lossInches: Math.round(lossInches * 100) / 100,
    rainInches: Math.round(rainInches * 100) / 100,
    netInches: Math.round(netInches * 100) / 100,
    gallonsNeeded,
    sinceDays,
    refillAt,
    nextRain,
    low,
    message,
  };
}
