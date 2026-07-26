/** Weather-aware confirmation advisory (see src/server/weather.ts). */
export interface Advisory {
  severity: "info" | "caution";
  message: string;
}

export interface WeatherData {
  tempF: number;
  tempC: number;
  /** WMO weather code from Open-Meteo. */
  code: number;
  windMph: number;
  isDay: boolean;
  high: number;
  low: number;
  fetchedAt: number;
  /** Where the current conditions came from. */
  source?: "open-meteo" | "tempest";
  /** Extras available when a Tempest station is feeding us. */
  humidity?: number;
  uv?: number;
  solarWm2?: number;
  gustMph?: number;
  /** Measured rainfall today, inches. */
  rainTodayIn?: number;
}
