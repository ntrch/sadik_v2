import http from './http';

export type WeatherGroup =
  | 'clear' | 'partly_cloudy' | 'clouds' | 'rain' | 'drizzle' | 'thunderstorm'
  | 'snow' | 'mist' | 'unknown';

export interface CurrentWeather {
  temp_c: number;
  feels_like_c: number;
  condition_code: number;
  condition_group: WeatherGroup;
  description: string;
  city: string;
  updated_at: number;
}

export interface GeocodeResult {
  label: string;
  name: string;
  state: string;
  country: string;
  lat: number;
  lon: number;
}

export const weatherApi = {
  getCurrent: () => http.get<CurrentWeather>('/api/weather/current').then((r) => r.data),
  geocode: (q: string) => http.get<GeocodeResult[]>('/api/weather/geocode', { params: { q } }).then((r) => r.data),
};
