/**
 * IATA → ICAO airline designators for converting user-typed flight numbers (6E 2134) into ADS-B callsigns (IGO2134).
 * Hand-maintained list of the airlines most relevant to India plus major international carriers.
 * Optional `color` is a livery tint used for the 3D models (approximate brand colour, not a logo).
 */
export interface AirlineCode {
  iata: string;
  icao: string;
  name: string;
  color?: string;
}

export const AIRLINES: AirlineCode[] = [
  // India
  { iata: '6E', icao: 'IGO', name: 'IndiGo', color: '#1d3b8f' },
  { iata: 'AI', icao: 'AIC', name: 'Air India', color: '#c8102e' },
  { iata: 'IX', icao: 'AXB', name: 'Air India Express', color: '#e4572e' },
  { iata: 'UK', icao: 'VTI', name: 'Vistara', color: '#5f2167' },
  { iata: 'SG', icao: 'SEJ', name: 'SpiceJet', color: '#d52b1e' },
  { iata: 'QP', icao: 'AKJ', name: 'Akasa Air', color: '#f15a22' },
  { iata: 'I5', icao: 'IAD', name: 'AIX Connect', color: '#e4572e' },
  { iata: '9I', icao: 'LLR', name: 'Alliance Air', color: '#c8102e' },
  { iata: 'S5', icao: 'SDG', name: 'Star Air', color: '#1b365d' },
  { iata: 'G8', icao: 'GOW', name: 'Go First', color: '#0a5aa8' },
  { iata: '2T', icao: 'TRJ', name: 'TruJet' },
  { iata: 'OG', icao: 'FBL', name: 'Fly91' },
  { iata: 'S9', icao: 'FLB', name: 'flybig' },
  // Gulf & Middle East
  { iata: 'EK', icao: 'UAE', name: 'Emirates', color: '#d71921' },
  { iata: 'QR', icao: 'QTR', name: 'Qatar Airways', color: '#5c0632' },
  { iata: 'EY', icao: 'ETD', name: 'Etihad Airways', color: '#bd8b13' },
  { iata: 'FZ', icao: 'FDB', name: 'flydubai', color: '#0d3c79' },
  { iata: 'G9', icao: 'ABY', name: 'Air Arabia', color: '#d6001c' },
  { iata: 'WY', icao: 'OMA', name: 'Oman Air', color: '#8a6d3b' },
  { iata: 'GF', icao: 'GFA', name: 'Gulf Air', color: '#a6894b' },
  { iata: 'SV', icao: 'SVA', name: 'Saudia', color: '#006c35' },
  { iata: 'KU', icao: 'KAC', name: 'Kuwait Airways', color: '#0057a8' },
  { iata: 'XY', icao: 'KNE', name: 'flynas' },
  { iata: 'J9', icao: 'JZR', name: 'Jazeera Airways' },
  { iata: 'MS', icao: 'MSR', name: 'EgyptAir' },
  { iata: 'TK', icao: 'THY', name: 'Turkish Airlines', color: '#c8102e' },
  { iata: 'PC', icao: 'PGT', name: 'Pegasus' },
  // Asia-Pacific
  { iata: 'SQ', icao: 'SIA', name: 'Singapore Airlines', color: '#1b365d' },
  { iata: 'TR', icao: 'TGW', name: 'Scoot', color: '#ffd200' },
  { iata: 'MH', icao: 'MAS', name: 'Malaysia Airlines', color: '#003a70' },
  { iata: 'AK', icao: 'AXM', name: 'AirAsia', color: '#e31837' },
  { iata: 'D7', icao: 'XAX', name: 'AirAsia X', color: '#e31837' },
  { iata: 'TG', icao: 'THA', name: 'Thai Airways', color: '#5f259f' },
  { iata: 'FD', icao: 'AIQ', name: 'Thai AirAsia', color: '#e31837' },
  { iata: 'CX', icao: 'CPA', name: 'Cathay Pacific', color: '#006564' },
  { iata: 'UL', icao: 'ALK', name: 'SriLankan Airlines', color: '#1c3f94' },
  { iata: 'BG', icao: 'BBC', name: 'Biman Bangladesh', color: '#006a4e' },
  { iata: 'BS', icao: 'UBG', name: 'US-Bangla Airlines' },
  { iata: 'RA', icao: 'RNA', name: 'Nepal Airlines' },
  { iata: 'KB', icao: 'DRK', name: 'Drukair' },
  { iata: 'PK', icao: 'PIA', name: 'Pakistan International', color: '#006c35' },
  { iata: '8M', icao: 'MMA', name: 'Myanmar Airways International' },
  { iata: 'NH', icao: 'ANA', name: 'All Nippon Airways', color: '#13448f' },
  { iata: 'JL', icao: 'JAL', name: 'Japan Airlines', color: '#cc0000' },
  { iata: 'KE', icao: 'KAL', name: 'Korean Air', color: '#00a4e4' },
  { iata: 'OZ', icao: 'AAR', name: 'Asiana Airlines' },
  { iata: 'CA', icao: 'CCA', name: 'Air China', color: '#c8102e' },
  { iata: 'MU', icao: 'CES', name: 'China Eastern', color: '#002d72' },
  { iata: 'CZ', icao: 'CSN', name: 'China Southern', color: '#00539f' },
  { iata: 'VN', icao: 'HVN', name: 'Vietnam Airlines' },
  { iata: 'VJ', icao: 'VJC', name: 'VietJet Air' },
  { iata: 'PR', icao: 'PAL', name: 'Philippine Airlines' },
  { iata: 'GA', icao: 'GIA', name: 'Garuda Indonesia' },
  { iata: 'QF', icao: 'QFA', name: 'Qantas', color: '#e0001b' },
  { iata: 'VA', icao: 'VOZ', name: 'Virgin Australia' },
  { iata: 'NZ', icao: 'ANZ', name: 'Air New Zealand', color: '#111111' },
  // Europe
  { iata: 'BA', icao: 'BAW', name: 'British Airways', color: '#2a5caa' },
  { iata: 'VS', icao: 'VIR', name: 'Virgin Atlantic', color: '#c8102e' },
  { iata: 'LH', icao: 'DLH', name: 'Lufthansa', color: '#05164d' },
  { iata: 'LX', icao: 'SWR', name: 'Swiss', color: '#d52b1e' },
  { iata: 'OS', icao: 'AUA', name: 'Austrian Airlines' },
  { iata: 'AF', icao: 'AFR', name: 'Air France', color: '#002157' },
  { iata: 'KL', icao: 'KLM', name: 'KLM', color: '#00a1de' },
  { iata: 'IB', icao: 'IBE', name: 'Iberia' },
  { iata: 'AY', icao: 'FIN', name: 'Finnair' },
  { iata: 'SK', icao: 'SAS', name: 'SAS' },
  { iata: 'LO', icao: 'LOT', name: 'LOT Polish Airlines' },
  { iata: 'AZ', icao: 'ITY', name: 'ITA Airways' },
  { iata: 'U2', icao: 'EZY', name: 'easyJet', color: '#ff6600' },
  { iata: 'FR', icao: 'RYR', name: 'Ryanair', color: '#073590' },
  { iata: 'W6', icao: 'WZZ', name: 'Wizz Air', color: '#c6007e' },
  { iata: 'EI', icao: 'EIN', name: 'Aer Lingus' },
  { iata: 'TP', icao: 'TAP', name: 'TAP Air Portugal' },
  { iata: 'SU', icao: 'AFL', name: 'Aeroflot' },
  // Americas
  { iata: 'AA', icao: 'AAL', name: 'American Airlines', color: '#0078d2' },
  { iata: 'DL', icao: 'DAL', name: 'Delta Air Lines', color: '#003366' },
  { iata: 'UA', icao: 'UAL', name: 'United Airlines', color: '#005daa' },
  { iata: 'WN', icao: 'SWA', name: 'Southwest Airlines', color: '#304cb2' },
  { iata: 'B6', icao: 'JBU', name: 'JetBlue', color: '#003876' },
  { iata: 'AS', icao: 'ASA', name: 'Alaska Airlines' },
  { iata: 'NK', icao: 'NKS', name: 'Spirit Airlines' },
  { iata: 'F9', icao: 'FFT', name: 'Frontier Airlines' },
  { iata: 'AC', icao: 'ACA', name: 'Air Canada', color: '#d22630' },
  { iata: 'WS', icao: 'WJA', name: 'WestJet' },
  { iata: 'AM', icao: 'AMX', name: 'Aeroméxico' },
  { iata: 'LA', icao: 'LAN', name: 'LATAM' },
  { iata: 'AV', icao: 'AVA', name: 'Avianca' },
  { iata: 'CM', icao: 'CMP', name: 'Copa Airlines' },
  // Africa
  { iata: 'ET', icao: 'ETH', name: 'Ethiopian Airlines', color: '#078930' },
  { iata: 'KQ', icao: 'KQA', name: 'Kenya Airways' },
  { iata: 'SA', icao: 'SAA', name: 'South African Airways' },
  { iata: 'AT', icao: 'RAM', name: 'Royal Air Maroc' },
  // Cargo
  { iata: 'FX', icao: 'FDX', name: 'FedEx', color: '#4d148c' },
  { iata: '5X', icao: 'UPS', name: 'UPS', color: '#351c15' },
  { iata: 'QY', icao: 'BCS', name: 'DHL (EAT Leipzig)', color: '#ffcc00' },
  { iata: 'CV', icao: 'CLX', name: 'Cargolux' },
  { iata: 'BZ', icao: 'BDA', name: 'Blue Dart Aviation' },
];

const BY_IATA = new Map(AIRLINES.map((a) => [a.iata, a]));
const BY_ICAO = new Map(AIRLINES.map((a) => [a.icao, a]));

export function airlineByIata(code: string): AirlineCode | undefined {
  return BY_IATA.get(code.toUpperCase());
}

export function airlineByIcao(code: string): AirlineCode | undefined {
  return BY_ICAO.get(code.toUpperCase());
}

/** Airline from an ADS-B callsign like "IGO2134" (3-letter ICAO prefix followed by a digit). */
export function airlineFromCallsign(callsign: string | undefined): AirlineCode | undefined {
  if (!callsign) return undefined;
  const m = /^([A-Z]{3})\d/.exec(callsign.toUpperCase());
  return m ? BY_ICAO.get(m[1]) : undefined;
}

/** "IGO2134" → "6E 2134" when the airline is known. */
export function flightNumberFromCallsign(callsign: string | undefined): string | undefined {
  if (!callsign) return undefined;
  const m = /^([A-Z]{3})(\d+[A-Z]?)$/.exec(callsign.toUpperCase());
  if (!m) return undefined;
  const al = BY_ICAO.get(m[1]);
  return al ? `${al.iata} ${m[2]}` : undefined;
}
