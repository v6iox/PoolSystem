import { getDb } from "@/server/db";

/**
 * App-wide settings stored as JSON rows in SQLite. Defaults live here so a
 * fresh install works with zero configuration.
 */

export interface AppSettings {
  poolVolumeGallons: number;
  /** Water surface area — used by the water-level (evaporation) estimator. */
  poolSurfaceAreaSqFt: number;
  costPerKwh: number;
  latitude: number;
  longitude: number;
  /** Default temp display; users can override per-account. */
  units: "F" | "C";
  clock: "12" | "24";
  saltLowPpm: number;
  idealRanges: {
    ph: [number, number];
    fc: [number, number];
    ta: [number, number];
    cya: [number, number];
    ch: [number, number];
    salt: [number, number];
    orp: [number, number];
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  poolVolumeGallons: 15000,
  poolSurfaceAreaSqFt: 450,
  costPerKwh: 0.14,
  latitude: Number(process.env.POOL_LATITUDE ?? 39.74),
  longitude: Number(process.env.POOL_LONGITUDE ?? -104.99),
  units: "F",
  clock: "12",
  saltLowPpm: 2800,
  idealRanges: {
    ph: [7.4, 7.6],
    fc: [2, 4],
    ta: [80, 120],
    cya: [30, 50],
    ch: [200, 400],
    salt: [3000, 3600],
    orp: [650, 750],
  },
};

export function getSetting<T>(key: string, fallback: T): T {
  const row = getDb().prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting<T>(key: string, value: T): void {
  getDb()
    .prepare(
      "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, JSON.stringify(value));
}

export function getAppSettings(): AppSettings {
  const stored = getSetting<Partial<AppSettings>>("app", {});
  return { ...DEFAULT_SETTINGS, ...stored, idealRanges: { ...DEFAULT_SETTINGS.idealRanges, ...(stored.idealRanges ?? {}) } };
}

/** A patch value of null deletes the stored key → env/default is authoritative again. */
export type AppSettingsPatch = { [K in keyof AppSettings]?: AppSettings[K] | null };

/** Keys the owner has explicitly saved (these override env/defaults). */
export function storedAppKeys(): Array<keyof AppSettings> {
  return Object.keys(getSetting<Partial<AppSettings>>("app", {})) as Array<keyof AppSettings>;
}

export function saveAppSettings(patch: AppSettingsPatch): AppSettings {
  // Store ONLY the keys the owner explicitly set. Persisting the whole merged
  // object would freeze env-derived values (POOL_LATITUDE etc.) into the DB
  // the first time ANY setting is saved — after which .env silently stops
  // mattering. Saving the clock format must not adopt the location.
  const stored = getSetting<Record<string, unknown>>("app", {});
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete stored[key];
    else if (value !== undefined) stored[key] = value;
  }
  setSetting("app", stored);
  return getAppSettings();
}
