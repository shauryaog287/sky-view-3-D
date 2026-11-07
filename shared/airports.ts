import { angleDiff, bearingDeg, haversineM, norm360, trackOffsets, FT_TO_M } from './geo';

/** One end of a runway (the threshold an aircraft lands on when flying the runway heading `hdg`). */
export interface RunwayEnd {
  ident: string; // "28", "09L"
  lat: number;
  lon: number;
  elevFt: number;
  /** True heading when landing on / departing from this end. */
  hdg: number;
  displacedFt: number;
}

export interface Runway {
  le: RunwayEnd;
  he: RunwayEnd;
  lengthFt: number;
  widthFt: number;
  surface: string;
}

export interface Airport {
  ident: string; // ICAO / GPS code e.g. VIDP
  iata?: string; // DEL
  name: string;
  city?: string;
  country: string; // ISO 3166-1 alpha-2
  lat: number;
  lon: number;
  elevFt: number;
  kind: 'L' | 'M' | 'S';
  runways: Runway[];
}

/** Compact on-disk format (arrays instead of objects) to keep the dataset small. */
export type CompactRunway = [
  string, number, number, number, number, number, // le: ident, lat, lon, elev, hdg, displaced
  string, number, number, number, number, number, // he: ident, lat, lon, elev, hdg, displaced
  number, number, string, // lengthFt, widthFt, surface
];
export type CompactAirport = [string, string, string, string, string, number, number, number, string, CompactRunway[]];
export interface CompactAirportFile {
  v: 1;
  generated: string;
  source: string;
  licence: string;
  airports: CompactAirport[];
}

export function encodeAirport(a: Airport): CompactAirport {
  const r5 = (x: number) => Math.round(x * 1e5) / 1e5;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return [
    a.ident,
    a.iata ?? '',
    a.name,
    a.city ?? '',
    a.country,
    r5(a.lat),
    r5(a.lon),
    Math.round(a.elevFt),
    a.kind,
    a.runways.map((r) => [
      r.le.ident, r5(r.le.lat), r5(r.le.lon), Math.round(r.le.elevFt), r1(r.le.hdg), Math.round(r.le.displacedFt),
      r.he.ident, r5(r.he.lat), r5(r.he.lon), Math.round(r.he.elevFt), r1(r.he.hdg), Math.round(r.he.displacedFt),
      Math.round(r.lengthFt), Math.round(r.widthFt), r.surface,
    ]),
  ];
}

export function decodeAirport(c: CompactAirport): Airport {
  const [ident, iata, name, city, country, lat, lon, elevFt, kind, rws] = c;
  return {
    ident,
    iata: iata || undefined,
    name,
    city: city || undefined,
    country,
    lat,
    lon,
    elevFt,
    kind: kind as Airport['kind'],
    runways: rws.map((r) => ({
      le: { ident: r[0], lat: r[1], lon: r[2], elevFt: r[3], hdg: r[4], displacedFt: r[5] },
      he: { ident: r[6], lat: r[7], lon: r[8], elevFt: r[9], hdg: r[10], displacedFt: r[11] },
      lengthFt: r[12],
      widthFt: r[13],
      surface: r[14],
    })),
  };
}

export interface RunwayMatch {
  airport: Airport;
  runway: Runway;
  /** The end whose heading matches the aircraft track (landing threshold or departure end). */
  end: RunwayEnd;
  /** The opposite end. */
  far: RunwayEnd;
  /** Distance from the aircraft to `end` threshold, metres. */
  distToEndM: number;
  /** Signed distance along the runway direction from `end` (negative = before threshold, i.e. on approach). */
  alongM: number;
  /** Lateral offset from the extended centreline, metres (positive = right). */
  crossM: number;
  /** |track − runway heading|, degrees. */
  headingDiff: number;
  /** True if the aircraft is laterally within the paved runway (plus margin) and between the ends. */
  onRunway: boolean;
}

/** Spatial index over airports (1° grid) with runway-alignment queries used by phase detection and cameras. */
export class AirportIndex {
  private readonly grid = new Map<string, Airport[]>();
  private readonly byIcao = new Map<string, Airport>();
  private readonly byIataCode = new Map<string, Airport>();

  constructor(readonly airports: Airport[]) {
    for (const a of airports) {
      const k = AirportIndex.key(a.lat, a.lon);
      let cell = this.grid.get(k);
      if (!cell) this.grid.set(k, (cell = []));
      cell.push(a);
      this.byIcao.set(a.ident.toUpperCase(), a);
      if (a.iata) this.byIataCode.set(a.iata.toUpperCase(), a);
    }
  }

  static fromCompact(file: CompactAirportFile): AirportIndex {
    return new AirportIndex(file.airports.map(decodeAirport));
  }

  private static key(lat: number, lon: number) {
    return `${Math.floor(lat)}:${Math.floor(lon)}`;
  }

  get(code: string | undefined): Airport | undefined {
    if (!code) return undefined;
    const c = code.trim().toUpperCase();
    return c.length === 3 ? this.byIataCode.get(c) ?? this.byIcao.get(c) : this.byIcao.get(c) ?? this.byIataCode.get(c);
  }

  /** Airports within `radiusM` of a point, nearest first. */
  within(lat: number, lon: number, radiusM: number): { airport: Airport; distM: number }[] {
    const degLat = radiusM / 111_000;
    const degLon = radiusM / (111_000 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
    const out: { airport: Airport; distM: number }[] = [];
    for (let la = Math.floor(lat - degLat); la <= Math.floor(lat + degLat); la++) {
      for (let lo = Math.floor(lon - degLon); lo <= Math.floor(lon + degLon); lo++) {
        const wrapped = ((((lo + 180) % 360) + 360) % 360) - 180;
        const cell = this.grid.get(`${la}:${wrapped}`);
        if (!cell) continue;
        for (const a of cell) {
          const d = haversineM(lat, lon, a.lat, a.lon);
          if (d <= radiusM) out.push({ airport: a, distM: d });
        }
      }
    }
    return out.sort((a, b) => a.distM - b.distM);
  }

  nearest(lat: number, lon: number, maxM = 300_000, filter?: (a: Airport) => boolean): { airport: Airport; distM: number } | undefined {
    for (const r of [25_000, 80_000, maxM]) {
      const hit = this.within(lat, lon, Math.min(r, maxM)).find((x) => !filter || filter(x.airport));
      if (hit) return hit;
      if (r >= maxM) break;
    }
    return undefined;
  }

  /**
   * Best runway alignment for an aircraft at (lat, lon) moving on `trackDeg`.
   * Considers airports within `searchM`. Lower score = better (distance + lateral offset + heading penalty).
   */
  bestRunway(lat: number, lon: number, trackDeg: number | undefined, searchM = 30_000): RunwayMatch | undefined {
    let best: RunwayMatch | undefined;
    let bestScore = Infinity;
    for (const { airport } of this.within(lat, lon, searchM)) {
      for (const runway of airport.runways) {
        for (const [end, far] of [
          [runway.le, runway.he],
          [runway.he, runway.le],
        ] as const) {
          const m = runwayMatch(airport, runway, end, far, lat, lon, trackDeg);
          const headingPenalty = trackDeg === undefined ? 0 : m.headingDiff * 120;
          const score = Math.abs(m.crossM) * 3 + Math.abs(Math.min(0, m.alongM)) * 0.2 + headingPenalty;
          if (score < bestScore) {
            bestScore = score;
            best = m;
          }
        }
      }
    }
    return best;
  }
}

export function runwayMatch(
  airport: Airport,
  runway: Runway,
  end: RunwayEnd,
  far: RunwayEnd,
  lat: number,
  lon: number,
  trackDeg: number | undefined,
): RunwayMatch {
  const rwyBrg = bearingDeg(end.lat, end.lon, far.lat, far.lon);
  const { along, cross } = trackOffsets(end.lat, end.lon, rwyBrg, lat, lon);
  const lengthM = runway.lengthFt * FT_TO_M || haversineM(end.lat, end.lon, far.lat, far.lon);
  const halfWidth = Math.max(30, (runway.widthFt * FT_TO_M) / 2 + 25);
  return {
    airport,
    runway,
    end,
    far,
    distToEndM: haversineM(lat, lon, end.lat, end.lon),
    alongM: along,
    crossM: cross,
    headingDiff: trackDeg === undefined ? 0 : Math.abs(angleDiff(trackDeg, rwyBrg)),
    onRunway: Math.abs(cross) <= halfWidth && along >= -60 && along <= lengthM + 60,
  };
}

/** Runway centre point and true bearing from `end` to `far`. */
export function runwayGeometry(end: RunwayEnd, far: RunwayEnd) {
  return {
    midLat: (end.lat + far.lat) / 2,
    midLon: (end.lon + far.lon) / 2,
    bearing: norm360(bearingDeg(end.lat, end.lon, far.lat, far.lon)),
    lengthM: haversineM(end.lat, end.lon, far.lat, far.lon),
  };
}
