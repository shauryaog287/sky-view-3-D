/** Recorded real ADS-B snapshots (adsb.lol, ODbL-1.0). Imported lazily by mock mode and the FixtureProvider. */
import type { ReadsbResponse } from './readsb';
import BLR from '../fixtures/adsb-v2/BLR.json';
import BOM from '../fixtures/adsb-v2/BOM.json';
import CCU from '../fixtures/adsb-v2/CCU.json';
import DEL from '../fixtures/adsb-v2/DEL.json';
import DXB from '../fixtures/adsb-v2/DXB.json';
import FRA from '../fixtures/adsb-v2/FRA.json';
import HYD from '../fixtures/adsb-v2/HYD.json';
import JFK from '../fixtures/adsb-v2/JFK.json';
import LHR from '../fixtures/adsb-v2/LHR.json';
import MAA from '../fixtures/adsb-v2/MAA.json';
import RPR from '../fixtures/adsb-v2/RPR.json';
import SIN from '../fixtures/adsb-v2/SIN.json';

export const FIXTURE_SNAPSHOTS = [DEL, BOM, BLR, MAA, CCU, HYD, RPR, DXB, LHR, SIN, JFK, FRA] as unknown as ReadsbResponse[];
