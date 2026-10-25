import { trainKey, type Category, type Station, type TrainLocation, type TrainMeta } from './types';

// Maps raw Digitraffic responses to the app's own types. Shared by the live
// client and the artifact's recorded replay, which stores the raw shapes.

export function toCategory(name: string | undefined): Category {
  switch (name) {
    case 'Long-distance':
      return 'long-distance';
    case 'Commuter':
      return 'commuter';
    case 'Cargo':
      return 'cargo';
    default:
      return 'other';
  }
}

export interface RawLocation {
  trainNumber: number;
  departureDate: string;
  timestamp: string;
  speed: number;
  location: { coordinates: [number, number] };
}

export function parseLocation(raw: RawLocation): TrainLocation {
  const [lng, lat] = raw.location.coordinates;
  return {
    key: trainKey(raw.departureDate, raw.trainNumber),
    trainNumber: raw.trainNumber,
    departureDate: raw.departureDate,
    lng,
    lat,
    speed: raw.speed,
    timestamp: Date.parse(raw.timestamp),
  };
}

export const RUNNING_TRAINS_QUERY = `{
  currentlyRunningTrains {
    trainNumber
    departureDate
    commuterLineid
    operator { shortCode }
    trainType { name trainCategory { name } }
    first: timeTableRows(take: 1) { station { shortCode } scheduledTime }
    last: timeTableRows(orderBy: { scheduledTime: DESCENDING }, take: 1) { station { shortCode } scheduledTime }
    latest: timeTableRows(where: { actualTime: { unequals: null } }, orderBy: { actualTime: DESCENDING }, take: 1) { differenceInMinutes }
  }
}`;

export interface RawRunningTrain {
  trainNumber: number;
  departureDate: string;
  commuterLineid: string | null;
  operator: { shortCode: string };
  trainType: { name: string; trainCategory: { name: string } };
  first: { station: { shortCode: string }; scheduledTime: string }[];
  last: { station: { shortCode: string }; scheduledTime: string }[];
  latest: { differenceInMinutes: number | null }[];
}

export function parseRunningTrain(t: RawRunningTrain): TrainMeta {
  const first = t.first[0];
  const last = t.last[0];
  return {
    key: trainKey(t.departureDate, t.trainNumber),
    trainNumber: t.trainNumber,
    departureDate: t.departureDate,
    type: t.trainType.name,
    category: toCategory(t.trainType.trainCategory.name),
    commuterLine: t.commuterLineid || null,
    operator: t.operator.shortCode,
    origin: first ? { code: first.station.shortCode, time: first.scheduledTime } : null,
    destination: last ? { code: last.station.shortCode, time: last.scheduledTime } : null,
    delay: t.latest[0]?.differenceInMinutes ?? null,
  };
}

export interface RawStation {
  stationShortCode: string;
  stationName: string;
  passengerTraffic: boolean;
  countryCode: string;
  longitude: number;
  latitude: number;
}

/** Digitraffic names read "Helsinki asema"; the suffix adds nothing on a map. */
export const cleanStationName = (name: string) => name.replace(/ asema$/, '');

export const parseStations = (raw: RawStation[]): Station[] =>
  raw
    .filter((s) => s.countryCode === 'FI')
    .map((s) => ({
      code: s.stationShortCode,
      name: cleanStationName(s.stationName),
      passenger: s.passengerTraffic,
      lng: s.longitude,
      lat: s.latitude,
    }));
