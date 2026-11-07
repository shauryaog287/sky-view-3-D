import { signal } from '@preact/signals';
import type { WeatherInfo } from '../../shared/types';

/** Weather at the current focus (followed or selected aircraft, or a low camera). */
export const focusWeather = signal<{ key: string; info: WeatherInfo } | null>(null);
