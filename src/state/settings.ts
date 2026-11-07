import { signal, effect } from '@preact/signals';
import { readPref, writePref } from '../lib/device';
import { defaultQuality, type QualityLevel } from '../config/quality';

/** User preferences (per device, localStorage). */
export const quality = signal<QualityLevel>(readPref<QualityLevel>('quality', defaultQuality()));
export const photoreal = signal<boolean>(readPref('photoreal', true));
export const showLabels = signal<boolean>(readPref('labels', true));
export const weatherOn = signal<boolean>(readPref('weather', true));
export const analyticsOptOut = signal<boolean>(readPref('analytics_opt_out', false));
export const settingsOpen = signal(false);

effect(() => writePref('quality', quality.value));
effect(() => writePref('photoreal', photoreal.value));
effect(() => writePref('labels', showLabels.value));
effect(() => writePref('weather', weatherOn.value));
effect(() => writePref('analytics_opt_out', analyticsOptOut.value));
