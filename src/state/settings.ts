import { signal, effect } from '@preact/signals';
import { readPref, writePref } from '../lib/device';
import { defaultQuality, type QualityLevel } from '../config/quality';

/** User preferences (per device, localStorage). */
export const quality = signal<QualityLevel>(readPref<QualityLevel>('quality', defaultQuality()));
export const photoreal = signal<boolean>(readPref('photoreal', true));
/** Photoreal 3D only at airports (city as a flat 2D map) or everywhere. */
export const photorealScope = signal<'airports' | 'everywhere'>(readPref<'airports' | 'everywhere'>('photoreal_scope', 'airports'));
/** Real 3D terrain (open elevation data) under the satellite map. */
export const terrain3d = signal<boolean>(readPref('terrain3d', true));
export const showLabels = signal<boolean>(readPref('labels', true));
export const weatherOn = signal<boolean>(readPref('weather', true));
export const analyticsOptOut = signal<boolean>(readPref('analytics_opt_out', false));
export const settingsOpen = signal(false);

effect(() => writePref('quality', quality.value));
effect(() => writePref('photoreal', photoreal.value));
effect(() => writePref('photoreal_scope', photorealScope.value));
effect(() => writePref('terrain3d', terrain3d.value));
effect(() => writePref('labels', showLabels.value));
effect(() => writePref('weather', weatherOn.value));
effect(() => writePref('analytics_opt_out', analyticsOptOut.value));
