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
}
