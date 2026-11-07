import type { AircraftState } from '../../../shared/types';
import { FlightSimulator, defaultScriptedFlights, nearPoint } from '../../../shared/simulator';
import { FIXTURE_SNAPSHOTS } from '../../../shared/fixtures';
import { airportIndex } from '../../../shared/airportData';
import { inBBox } from '../../../shared/geo';
import type { ProviderAdapter, ProviderQuery } from './types';

/**
 * Serves recorded real ADS-B fixtures, animated by the shared simulator, plus scripted takeoffs/landings.
 * Used when PROVIDERS=fixture (local dev without network, demos, tests).
 */
export class FixtureProvider implements ProviderAdapter {
  readonly id = 'fixture' as const;
  readonly label = 'Recorded sample data';
  readonly limits = { capacity: 100, refillPerSec: 100 };
  readonly commercialUseAllowed = false;
  readonly attribution = 'Sample data recorded from adsb.lol (ODbL 1.0)';
  private sim?: FlightSimulator;

  constructor(private readonly now: () => number = Date.now) {}

  private simulator(): FlightSimulator {
    if (!this.sim) this.sim = new FlightSimulator(FIXTURE_SNAPSHOTS, defaultScriptedFlights(airportIndex()), { noiseM: 8 });
    return this.sim;
  }

  supports(): boolean {
    return true;
  }

  cost(): number {
    return 1;
  }

  async fetch(q: ProviderQuery): Promise<AircraftState[]> {
    const all = this.simulator().snapshot(this.now());
    switch (q.kind) {
      case 'point':
        return nearPoint(all, q.lat, q.lon, q.radiusNm);
      case 'bbox':
        return all.filter((a) => inBBox(q.bbox, a.lat, a.lon));
      case 'callsign':
        return all.filter((a) => a.callsign?.toUpperCase() === q.callsign.toUpperCase());
      case 'hex':
        return all.filter((a) => a.hex === q.hex.toLowerCase());
      case 'reg':
        return all.filter((a) => a.reg?.toUpperCase().replace('-', '') === q.reg.toUpperCase().replace('-', ''));
    }
  }
}
