export type TrainCategory = 'long-distance' | 'commuter' | 'cargo' | 'other';
export type Category = TrainCategory | 'metro';

export const TRAIN_CATEGORIES: TrainCategory[] = ['long-distance', 'commuter', 'cargo', 'other'];
export const CATEGORIES: Category[] = [...TRAIN_CATEGORIES, 'metro'];

/** Identifies one run: the same train number repeats every day. Metro runs start with "metro/". */
export type TrainKey = string;

export const trainKey = (departureDate: string, trainNumber: number): TrainKey =>
  `${departureDate}/${trainNumber}`;

export const isMetroKey = (key: TrainKey) => key.startsWith('metro/');

export interface StopRef {
  code: string;
  time: string;
}

/** Summary of a running train, enough for the map and the hover card. */
export interface TrainMeta {
  key: TrainKey;
  trainNumber: number;
  departureDate: string;
  type: string;
  category: Category;
  commuterLine: string | null;
  operator: string;
  origin: StopRef | null;
  destination: StopRef | null;
  /** Minutes behind schedule at the latest recorded station, null if unknown. */
  delay: number | null;
  /** Metro runs only. */
  metro?: { line: string; direction: number; start: string };
}

export interface TrainLocation {
  key: TrainKey;
  trainNumber: number;
  departureDate: string;
  lng: number;
  lat: number;
  speed: number;
  timestamp: number;
}

export interface Station {
  code: string;
  name: string;
  passenger: boolean;
  lng: number;
  lat: number;
}

export interface TimetableRow {
  stationShortCode: string;
  type: 'ARRIVAL' | 'DEPARTURE';
  trainStopping: boolean;
  commercialStop?: boolean;
  commercialTrack?: string;
  cancelled: boolean;
  scheduledTime: string;
  liveEstimateTime?: string;
  actualTime?: string;
  differenceInMinutes?: number;
  unknownDelay?: boolean;
}

export interface TrainDetails {
  trainNumber: number;
  departureDate: string;
  operatorShortCode: string;
  trainType: string;
  trainCategory: string;
  commuterLineID?: string;
  runningCurrently: boolean;
  cancelled: boolean;
  timeTableRows: TimetableRow[];
}
