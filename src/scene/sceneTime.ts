import { env } from '../config/env';

/**
 * The moment the scene shows (sun position, night lighting). Real time, except in mock mode where
 * `?time=2026-06-21T06:30:00Z` pins the start to that instant — for demos, screenshots and tests of day/night looks.
 */
const override = env.apiMode === 'mock' && typeof location !== 'undefined' ? Date.parse(new URLSearchParams(location.search).get('time') ?? '') : NaN;
export const sceneTimeOffsetMs = Number.isFinite(override) ? override - Date.now() : 0;
export const sceneNowMs = () => Date.now() + sceneTimeOffsetMs;
