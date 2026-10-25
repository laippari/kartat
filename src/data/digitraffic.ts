import mqtt from 'mqtt';
import {
  trainKey,
  type Category,
  type Station,
  type TrainDetails,
  type TrainLocation,
  type TrainMeta,
} from './types';

// Rail data from Fintraffic Digitraffic, licensed CC BY 4.0.
// https://www.digitraffic.fi/rautatieliikenne/
const API = 'https://rata.digitraffic.fi/api';
const MQTT_URL = 'wss://rata.digitraffic.fi:443/mqtt';

// Digitraffic asks every client to identify itself.
const HEADERS = { 'Digitraffic-User': 'kartat/0.1' };

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...HEADERS, ...init?.headers },
  });
  if (!res.ok) throw new Error(`Digitraffic ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

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

interface RawLocation {
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

export async function fetchLatestLocations(): Promise<TrainLocation[]> {
  const raw = await getJson<RawLocation[]>('/v1/train-locations/latest/');
  return raw.map(parseLocation);
}

const RUNNING_TRAINS_QUERY = `{
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

interface RawRunningTrain {
  trainNumber: number;
  departureDate: string;
  commuterLineid: string | null;
  operator: { shortCode: string };
  trainType: { name: string; trainCategory: { name: string } };
  first: { station: { shortCode: string }; scheduledTime: string }[];
  last: { station: { shortCode: string }; scheduledTime: string }[];
  latest: { differenceInMinutes: number | null }[];
}

export async function fetchRunningTrains(): Promise<TrainMeta[]> {
  const body = await getJson<{ data?: { currentlyRunningTrains: RawRunningTrain[] } }>(
    '/v2/graphql/graphql',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: RUNNING_TRAINS_QUERY }),
    },
  );
  return (body.data?.currentlyRunningTrains ?? []).map((t) => {
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
  });
}

interface RawStation {
  stationShortCode: string;
  stationName: string;
  passengerTraffic: boolean;
  countryCode: string;
  longitude: number;
  latitude: number;
}

/** Digitraffic names read "Helsinki asema"; the suffix adds nothing on a map. */
export const cleanStationName = (name: string) => name.replace(/ asema$/, '');

export async function fetchStations(): Promise<Station[]> {
  const raw = await getJson<RawStation[]>('/v1/metadata/stations');
  return raw
    .filter((s) => s.countryCode === 'FI')
    .map((s) => ({
      code: s.stationShortCode,
      name: cleanStationName(s.stationName),
      passenger: s.passengerTraffic,
      lng: s.longitude,
      lat: s.latitude,
    }));
}

export async function fetchTrain(departureDate: string, trainNumber: number) {
  const trains = await getJson<TrainDetails[]>(`/v1/trains/${departureDate}/${trainNumber}`);
  return trains[0] ?? null;
}

/** Streams GPS positions of every train. Returns a function that closes the stream. */
export function subscribeLocations(
  onLocation: (location: TrainLocation) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  const client = mqtt.connect(MQTT_URL, {
    clientId: `kartat-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 5000,
  });
  client.on('connect', () => {
    onStatus(true);
    client.subscribe('train-locations/#');
  });
  client.on('close', () => onStatus(false));
  client.on('message', (_topic, payload) => {
    try {
      onLocation(parseLocation(JSON.parse(new TextDecoder().decode(payload))));
    } catch {
      // A malformed message is not worth breaking the stream for.
    }
  });
  return () => {
    client.end(true);
  };
}
