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
