export type TrainCategory = 'long-distance' | 'commuter' | 'cargo' | 'other';
export type TransitMode = 'metro' | 'tram';
export type Category = TrainCategory | TransitMode;

export const TRAIN_CATEGORIES: TrainCategory[] = ['long-distance', 'commuter', 'cargo', 'other'];
export const CATEGORIES: Category[] = [...TRAIN_CATEGORIES, 'metro', 'tram'];

/** The city rail networks, each drawn from its own file and followed on its own tracks. */
export type NetworkId = 'metro' | 'tram-helsinki' | 'tram-tampere';

/**
 * Identifies one run: the same train number repeats every day. Metro and tram
 * runs start with "metro/" or "tram/".
 */
export type TrainKey = string;

export const trainKey = (departureDate: string, trainNumber: number): TrainKey =>
  `${departureDate}/${trainNumber}`;

export const isTransitKey = (key: TrainKey) => key.startsWith('metro/') || key.startsWith('tram/');

/** A metro or tram run. */
export interface Transit {
  mode: TransitMode;
  city: 'helsinki' | 'tampere';
  /** What passengers call it: "M1", "7". */
  line: string;
  /** GTFS route id, e.g. "1007"; Tampere's realtime feed only gives the line. */
  route: string;
  /** 1 or 2. */
  direction: number;
  /** Departure from the first stop, "13:45". */
  start: string;
  /** Last stop's code, where the feed says it (Tampere). */
  destination?: string;
}

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
  /** Metro and tram runs only. */
  transit?: Transit;
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
