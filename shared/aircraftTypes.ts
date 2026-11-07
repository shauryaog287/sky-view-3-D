/**
 * ICAO aircraft type designator → 3D model class.
 * Covers the common types seen over India and at major hubs; anything unknown falls back to the ADS-B emitter
 * category, then to "generic".
 */
export type ModelClass = 'narrowbody' | 'widebody' | 'regional' | 'turboprop' | 'bizjet' | 'helicopter' | 'light' | 'generic';

const LIST: Record<Exclude<ModelClass, 'generic'>, string[]> = {
  narrowbody: [
    'A318', 'A319', 'A320', 'A321', 'A19N', 'A20N', 'A21N', 'BCS1', 'BCS3', 'A221', 'A223',
    'B712', 'B731', 'B732', 'B733', 'B734', 'B735', 'B736', 'B737', 'B738', 'B739', 'B37M', 'B38M', 'B39M', 'B3XM',
    'B752', 'B753', 'MD80', 'MD81', 'MD82', 'MD83', 'MD87', 'MD88', 'MD90', 'C919', 'MC23', 'T204', 'SU95',
  ],
  widebody: [
    'A306', 'A30B', 'A310', 'A332', 'A333', 'A337', 'A338', 'A339', 'A342', 'A343', 'A345', 'A346', 'A359', 'A35K', 'A388',
    'B741', 'B742', 'B743', 'B744', 'B748', 'B74S', 'B762', 'B763', 'B764', 'B772', 'B773', 'B77L', 'B77W', 'B778', 'B779',
    'B788', 'B789', 'B78X', 'MD11', 'DC10', 'IL96', 'IL76', 'A400', 'C17', 'A3ST', 'BLCF', 'B37F', 'AN12', 'AN24',
  ],
  regional: ['CRJ1', 'CRJ2', 'CRJ7', 'CRJ9', 'CRJX', 'E135', 'E145', 'E170', 'E175', 'E190', 'E195', 'E290', 'E295', 'E75L', 'E75S', 'RJ85', 'RJ1H', 'B461', 'B462', 'B463', 'F70', 'F100', 'SU95', 'AJ27', 'ARJ21'],
  turboprop: [
    'AT43', 'AT45', 'AT46', 'AT72', 'AT73', 'AT75', 'AT76', 'DH8A', 'DH8B', 'DH8C', 'DH8D', 'Q400', 'SF34', 'SB20', 'JS31', 'JS32', 'JS41',
    'D228', 'D328', 'B190', 'BE20', 'BE30', 'BE35', 'BE9L', 'PC12', 'PC24', 'C208', 'C212', 'CN35', 'C295', 'C130', 'C30J', 'L410', 'F27', 'F50', 'Y12', 'DHC6', 'MA60', 'SW4', 'P180', 'TBM7', 'TBM8', 'TBM9', 'KODI',
  ],
  bizjet: [
    'C25A', 'C25B', 'C25C', 'C25M', 'C510', 'C525', 'C550', 'C560', 'C56X', 'C650', 'C680', 'C68A', 'C700', 'C750',
    'CL30', 'CL35', 'CL60', 'GL5T', 'GL7T', 'GLEX', 'GLF4', 'GLF5', 'GLF6', 'G150', 'G200', 'G280', 'GA5C', 'GA6C', 'GA7C', 'GA8C',
    'LJ35', 'LJ40', 'LJ45', 'LJ55', 'LJ60', 'LJ75', 'FA10', 'FA20', 'FA50', 'FA7X', 'FA8X', 'F2TH', 'F900', 'FA6X', 'E50P', 'E55P', 'E545', 'E550', 'H25B', 'H25C', 'HDJT', 'PRM1', 'BE40', 'SF50', 'EA50',
  ],
  helicopter: [
    'A109', 'A119', 'A139', 'A169', 'A189', 'AS32', 'AS35', 'AS50', 'AS55', 'AS65', 'B06', 'B06T', 'B105', 'B212', 'B407', 'B412', 'B429', 'B505',
    'EC20', 'EC25', 'EC30', 'EC35', 'EC45', 'EC55', 'EC75', 'H125', 'H130', 'H135', 'H145', 'H155', 'H160', 'H175', 'H215', 'H225',
    'R22', 'R44', 'R66', 'S61', 'S76', 'S92', 'MI8', 'MI17', 'MI26', 'ALH', 'DHRUV', 'UH1', 'H60', 'CH47', 'NH90', 'AW09', 'K226',
  ],
  light: ['C150', 'C152', 'C162', 'C172', 'C177', 'C182', 'C206', 'C210', 'P28A', 'P28B', 'P28R', 'PA31', 'PA34', 'PA44', 'PA46', 'SR20', 'SR22', 'DA40', 'DA42', 'DA62', 'TB20', 'M20P', 'BE36', 'BE58', 'G115', 'PIVI', 'CRUZ'],
};

const MAP = new Map<string, ModelClass>();
for (const [cls, types] of Object.entries(LIST) as [ModelClass, string[]][]) for (const t of types) if (!MAP.has(t)) MAP.set(t, cls);

/** ADS-B emitter category fallback (DO-260B). */
function fromCategory(cat?: string): ModelClass | undefined {
  switch (cat) {
    case 'A1':
      return 'light';
    case 'A2':
      return 'bizjet';
    case 'A3':
      return 'narrowbody';
    case 'A4':
      return 'narrowbody'; // B757-class high-vortex large
    case 'A5':
      return 'widebody';
    case 'A6':
      return 'bizjet';
    case 'A7':
      return 'helicopter';
    default:
      return undefined;
  }
}

export function modelClassFor(type?: string, category?: string): ModelClass {
  if (type) {
    const t = type.toUpperCase();
    const hit = MAP.get(t);
    if (hit) return hit;
    // Family heuristics for designators not in the table.
    if (/^A3[3-5]|^A38|^B7[4-8]/.test(t)) return 'widebody';
    if (/^A3[12]|^B73|^B3/.test(t)) return 'narrowbody';
    if (/^E1[79]|^CRJ|^E2/.test(t)) return 'regional';
    if (/^AT[4-7]|^DH8/.test(t)) return 'turboprop';
  }
  return fromCategory(category) ?? 'generic';
}

/** Approximate physical sizes (metres) used to scale cameras and the chase distance. */
export const CLASS_SIZE: Record<ModelClass, { length: number; span: number }> = {
  narrowbody: { length: 38, span: 35 },
  widebody: { length: 64, span: 62 },
  regional: { length: 33, span: 28 },
  turboprop: { length: 27, span: 27 },
  bizjet: { length: 20, span: 19 },
  helicopter: { length: 13, span: 11 },
  light: { length: 8.5, span: 11 },
  generic: { length: 36, span: 34 },
};
