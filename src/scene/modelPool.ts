import type { FrameAircraft } from './aircraftLayer';

/** Placeholder until glTF models land (M3): no aircraft are modelled, everything is a billboard. */
export class ModelPool {
  update(_list: FrameAircraft[], _selected: string | null, _followed: string | null): Set<string> {
    return new Set();
  }
  release(_hex: string) {}
  destroy() {}
}
