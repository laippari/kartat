import type { FlightPhase } from '../data/air';
import type { Aircraft, Category, TrainMeta, Transit } from '../data/types';

const timeFormat = new Intl.DateTimeFormat('fi-FI', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Helsinki',
});

/** "14.05" in Finnish time, whatever the viewer's own time zone. */
export const formatTime = (iso: string) => timeFormat.format(new Date(iso));

const TYPE_NAMES: Record<string, string> = {
  S: 'Pendolino',
  IC: 'InterCity',
  IC2: 'InterCity',
  P: 'Pikajuna',
  PYO: 'Yöjuna',
  AE: 'Allegro',
  H: 'Taajamajuna',
  HDM: 'Taajamajuna',
  HSM: 'Taajamajuna',
  HV: 'Taajamajuna',
  HL: 'Lähijuna',
  HLV: 'Lähijuna',
  HV2: 'Lähijuna',
  T: 'Tavarajuna',
  MUS: 'Museojuna',
  MV: 'Kalustonsiirto',
  VET: 'Veturi',
  VEV: 'Veturi',
  VLI: 'Veturi',
  PAI: 'Vaihtotyö',
  SAA: 'Vaihtotyö',
  TYO: 'Työjuna',
  LIV: 'Työjuna',
};

export const typeName = (type: string) => TYPE_NAMES[type] ?? type;

export const CATEGORY_LABELS: Record<Category, string> = {
  'long-distance': 'Kaukojunat',
  commuter: 'Lähijunat',
  cargo: 'Tavarajunat',
  other: 'Muut',
  metro: 'Metro',
  tram: 'Raitiovaunut',
  air: 'Lentokoneet',
};

/** How passengers would name it: "R-juna", "IC 27", "T 3642", "M1", "Ratikka 7". */
export function trainTitle(meta: Pick<TrainMeta, 'type' | 'trainNumber' | 'commuterLine' | 'transit' | 'air'>) {
  if (meta.air) return meta.air.callsign;
  if (meta.transit) return meta.transit.mode === 'tram' ? `Ratikka ${meta.transit.line}` : meta.transit.line;
  if (meta.commuterLine) return `${meta.commuterLine}-juna`;
  return `${meta.type} ${meta.trainNumber}`;
}

/** Short label drawn next to the dot on the map. */
export function mapLabel(meta: TrainMeta | undefined, trainNumber: number) {
  if (!meta) return String(trainNumber);
  if (meta.air) return meta.air.callsign;
  if (meta.transit) return meta.transit.line;
  return meta.commuterLine ?? `${meta.type} ${meta.trainNumber}`;
}

/** "13:59" from the realtime feeds as "13.59". */
export const clockTime = (start: string) => start.replace(':', '.');

const CITY_OPERATORS = { helsinki: 'HSL', tampere: 'Nysse' };

/** "Metro · HSL", "Raitiovaunu · Nysse". */
export const transitKind = (t: Transit) =>
  `${t.mode === 'metro' ? 'Metro' : 'Raitiovaunu'} · ${CITY_OPERATORS[t.city]}`;

export function delayText(minutes: number | null | undefined) {
  if (minutes == null) return null;
  if (minutes >= 1) return `${minutes} min myöhässä`;
  if (minutes <= -1) return `${-minutes} min etuajassa`;
  return 'Aikataulussa';
}

/** Compact form for tight spaces: "+4 min", "−2 min", "Ajallaan". */
export function delayShort(minutes: number | null | undefined) {
  if (minutes == null) return null;
  if (minutes >= 1) return `+${minutes} min`;
  if (minutes <= -1) return `−${-minutes} min`;
  return 'Ajallaan';
}

export const isLate = (minutes: number | null | undefined) => minutes != null && minutes >= 5;

export function ago(timestamp: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds} s sitten`;
  return `${Math.round(seconds / 60)} min sitten`;
}

const OPERATORS: Record<string, string> = { vr: 'VR', fenniarail: 'Fenniarail', 'vr-track': 'VR FleetCare' };

export const operatorName = (code: string) => OPERATORS[code] ?? code;

const thousands = new Intl.NumberFormat('fi-FI');

/** "1 250 m", "Maassa". */
export const altitudeText = (metres: number | null) =>
  metres == null ? 'Maassa' : `${thousands.format(Math.round(metres / 10) * 10)} m`;

/** "+12 m/s", "−4 m/s", "Vaakalento". */
export function climbText(metresPerSecond: number | null) {
  if (metresPerSecond == null) return '–';
  const rounded = Math.round(metresPerSecond);
  if (rounded === 0) return 'Vaakalento';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)} m/s`;
}

export const PHASE_TEXT: Record<FlightPhase, string> = {
  ground: 'Maassa Helsinki-Vantaalla',
  landing: 'Laskeutumassa Helsinki-Vantaalle',
  departing: 'Lähtenyt Helsinki-Vantaalta',
  passing: 'Ylilento',
};

/** "Airbus A321 · Finnair"; the model name from the register, tidied. */
export function aircraftKind(air: Aircraft) {
  const model = air.model ? titleCase(air.model) : air.type;
  return [model, air.operator && titleCase(air.operator)].filter(Boolean).join(' · ');
}

/** Registers shout: "AIRBUS A-321" → "Airbus A-321". Codes with digits stay as they are. */
const titleCase = (text: string) =>
  text
    .split(' ')
    .map((w) => (/\d/.test(w) || w.length <= 2 ? w : w[0] + w.slice(1).toLowerCase()))
    .join(' ');
