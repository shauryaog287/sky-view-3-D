/** Types shared by the browser and the Worker. Keep this file free of runtime dependencies. */

export type ProviderId = 'adsblol' | 'airplaneslive' | 'opensky' | 'commercial' | 'fixture';

/** One aircraft's latest known state, normalised from any provider. Units are aviation-native. */
export interface AircraftState {
  /** ICAO 24-bit address, lowercase hex. Non-ICAO (TIS-B/anonymous) addresses keep a leading "~". */
  hex: string;
  callsign?: string;
  /** Registration (tail number), e.g. VT-NHC. */
  reg?: string;
  /** ICAO type designator, e.g. A20N, B738. */
  type?: string;
  /** ADS-B emitter category, e.g. A3 (large), A7 (rotorcraft). */
  category?: string;
  lat: number;
  lon: number;
  /** Barometric (pressure) altitude, feet. */
  altBaro?: number;
  /** Geometric altitude, feet above the WGS-84 ellipsoid. */
  altGeom?: number;
  onGround: boolean;
  /** Ground speed, knots. */
  gs?: number;
  /** True track over ground, degrees. */
  track?: number;
  /** Rate of change of track, degrees/second (positive = turning right). */
  trackRate?: number;
  /** Roll angle, degrees (positive = right wing down). */
  roll?: number;
  /** Vertical rate, feet/minute. */
  vrate?: number;
  squawk?: string;
  emergency?: string;
  /** Epoch ms of the position fix. */
  posTs: number;
  /** Epoch ms of the last message of any kind. */
  seenTs: number;
  source: ProviderId;
  mlat?: boolean;
}

export interface ProviderStatus {
  id: ProviderId;
  enabled: boolean;
  ok: boolean;
  /** Epoch ms until which the provider is backed off (429 / errors). */
  blockedUntil?: number;
  lastError?: string;
  lastSuccess?: number;
}

export type RegionNotice = 'zoom_in' | 'providers_down' | 'partial';

export interface RegionBucketInfo {
  id: string;
  ageMs: number;
  count: number;
}

export interface RegionResponse {
  now: number;
  aircraft: AircraftState[];
  buckets: RegionBucketInfo[];
  /** True when the view was larger than we poll; only the area nearest the view centre is included. */
  truncated: boolean;
  /** True when at least one bucket could not be refreshed and older data is served. */
  stale: boolean;
  providers: ProviderStatus[];
  notice?: RegionNotice;
}

export interface SearchResult {
  query: string;
  /** Callsigns we tried (e.g. 6E2134 → IGO2134). */
  candidates: string[];
  aircraft: AircraftState[];
}

export interface TrackPoint {
  hex: string;
  /** Epoch ms. */
  ts: number;
  lat: number;
  lon: number;
  /** Altitude, feet (baro, or geometric when baro is missing). Null on ground. */
  alt: number | null;
  gs: number | null;
  track: number | null;
  vrate: number | null;
}

export interface AirportRef {
  icao?: string;
  iata?: string;
  name?: string;
  city?: string;
  country?: string;
  lat?: number;
  lon?: number;
}

/** Enrichment (route + airframe) from adsbdb or a commercial source. */
export interface FlightInfo {
  hex: string;
  callsign?: string;
  airline?: { name?: string; icao?: string; iata?: string };
  origin?: AirportRef;
  destination?: AirportRef;
  aircraft?: {
    type?: string;
    icaoType?: string;
    manufacturer?: string;
    reg?: string;
    owner?: string;
  };
  /** Attribution string to show next to the data. */
  source?: string;
}

export interface WeatherCloudLayer {
  /** METAR cover code: FEW SCT BKN OVC (or CLR/NSC/SKC). */
  cover: string;
  /** Cloud base, feet AGL. */
  baseFt: number;
}

export interface WeatherInfo {
  lat: number;
  lon: number;
  fetchedAt: number;
  /** Total cloud cover 0..100 %. */
  cloudCover?: number;
  cloudLow?: number;
  cloudMid?: number;
  cloudHigh?: number;
  /** Horizontal visibility, metres. */
  visibilityM?: number;
  weatherCode?: number;
  windDir?: number;
  windKt?: number;
  tempC?: number;
  isDay?: boolean;
  metar?: {
    station: string;
    raw: string;
    obsTime: number;
    visibilityM?: number;
    clouds: WeatherCloudLayer[];
    flightCategory?: string;
    altimeterHpa?: number;
    wx?: string;
  };
  sources: string[];
}

export type FlightPhase = 'ground' | 'takeoff_roll' | 'climb' | 'cruise' | 'descent' | 'approach' | 'landing' | 'unknown';
