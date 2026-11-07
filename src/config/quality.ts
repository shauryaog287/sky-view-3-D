/** Graphics quality presets. "high" is a Pro feature (quality_high); low/medium are free. */
export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityPreset {
  label: string;
  /** Multiplies the browser-recommended resolution. */
  resolutionScale: number;
  /** Cap device pixel ratio (phones report 3+, which is wasted GPU work for a map). */
  maxPixelRatio: number;
  /** Photoreal tileset screen-space error (higher = coarser, faster). */
  tilesSse: number;
  tilesCacheMB: number;
  globeSse: number;
  maxModels: number;
  modelDistanceM: number;
  clouds: number;
  fog: boolean;
  shadows: boolean;
  fxaa: boolean;
  targetFps: number;
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: {
    label: 'Low — battery saver',
    resolutionScale: 0.8,
    maxPixelRatio: 1.25,
    tilesSse: 28,
    tilesCacheMB: 192,
    globeSse: 3,
    maxModels: 6,
    modelDistanceM: 15_000,
    clouds: 0,
    fog: false,
    shadows: false,
    fxaa: false,
    targetFps: 30,
  },
  medium: {
    label: 'Medium',
    resolutionScale: 1,
    maxPixelRatio: 1.75,
    tilesSse: 16,
    tilesCacheMB: 384,
    globeSse: 2,
    maxModels: 16,
    modelDistanceM: 35_000,
    clouds: 60,
    fog: true,
    shadows: false,
    fxaa: true,
    targetFps: 60,
  },
  high: {
    label: 'High',
    resolutionScale: 1,
    maxPixelRatio: 2.5,
    tilesSse: 8,
    tilesCacheMB: 768,
    globeSse: 1.33,
    maxModels: 40,
    modelDistanceM: 60_000,
    clouds: 160,
    fog: true,
    shadows: true,
    fxaa: true,
    targetFps: 60,
  },
};

/** Pick a sensible default from the device (mid-range Android tablets/phones → medium; weak devices → low). */
export function defaultQuality(nav: { hardwareConcurrency?: number; deviceMemory?: number } = navigator as never): QualityLevel {
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 4;
  if (cores <= 4 || mem <= 3) return 'low';
  return 'medium';
}
