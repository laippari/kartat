import type { Category, TrainMeta } from '../data/types';

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
};

/** How passengers would name the train: "R-juna", "IC 27", "T 3642". */
export function trainTitle(meta: Pick<TrainMeta, 'type' | 'trainNumber' | 'commuterLine'>) {
  if (meta.commuterLine) return `${meta.commuterLine}-juna`;
  return `${meta.type} ${meta.trainNumber}`;
}

/** Short label drawn next to the dot on the map. */
export function mapLabel(meta: TrainMeta | undefined, trainNumber: number) {
  if (!meta) return String(trainNumber);
  return meta.commuterLine ?? `${meta.type} ${meta.trainNumber}`;
}

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
