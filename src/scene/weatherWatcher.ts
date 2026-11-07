import { haversineM } from '../../shared/geo';
import type { WeatherInfo } from '../../shared/types';
import { api } from '../api';
import { focusWeather } from '../state/weather';

/**
 * Fetches weather for the focus point at most every 10 minutes, or after it moves 25 km (the Worker caches on a
 * 0.25° grid, so nearby users share requests). Failures are silent: weather is decoration, not data.
 */
export class WeatherWatcher {
  private last?: { lat: number; lon: number; t: number; key: string };
  private busy = false;

  constructor(private readonly onWeather: (w: WeatherInfo | null) => void) {}

  async check(focus: { key: string; lat: number; lon: number } | undefined, enabled: boolean) {
    if (!enabled || !focus) {
      if (this.last) {
        this.last = undefined;
        focusWeather.value = null;
        this.onWeather(null);
      }
      return;
    }
    const now = Date.now();
    const l = this.last;
    if (l && l.key === focus.key && now - l.t < 10 * 60_000 && haversineM(l.lat, l.lon, focus.lat, focus.lon) < 25_000) return;
    if (l && l.key !== focus.key && haversineM(l.lat, l.lon, focus.lat, focus.lon) < 25_000 && now - l.t < 10 * 60_000) {
      // Same area, different aircraft: reuse.
      this.last = { ...l, key: focus.key };
      if (focusWeather.value) focusWeather.value = { ...focusWeather.value, key: focus.key };
      return;
    }
    if (this.busy) return;
    this.busy = true;
    try {
      const w = await api.weather(focus.lat, focus.lon);
      this.last = { lat: focus.lat, lon: focus.lon, t: now, key: focus.key };
      focusWeather.value = { key: focus.key, info: w };
      this.onWeather(w);
    } catch {
      this.last = { lat: focus.lat, lon: focus.lon, t: now - 8 * 60_000, key: focus.key }; // retry in ~2 min
    } finally {
      this.busy = false;
    }
  }
}
