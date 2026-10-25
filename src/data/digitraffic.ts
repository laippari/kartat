import mqtt from 'mqtt';
import {
  parseLocation,
  parseRunningTrain,
  parseStations,
  RUNNING_TRAINS_QUERY,
  type RawLocation,
  type RawRunningTrain,
  type RawStation,
} from './parse';
import type { Station, TrainDetails, TrainLocation, TrainMeta } from './types';

// Rail data from Fintraffic Digitraffic, licensed CC BY 4.0.
// https://www.digitraffic.fi/rautatieliikenne/
// The artifact build replaces this module with src/artifact/digitraffic.ts,
// which exports the same functions over a recorded replay.
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

/** When the data is a recording rather than live, the span it covers. */
export const recording = (): { start: number; end: number } | null => null;

export async function fetchLatestLocations(): Promise<TrainLocation[]> {
  const raw = await getJson<RawLocation[]>('/v1/train-locations/latest/');
  return raw.map(parseLocation);
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
  return (body.data?.currentlyRunningTrains ?? []).map(parseRunningTrain);
}

export async function fetchStations(): Promise<Station[]> {
  return parseStations(await getJson<RawStation[]>('/v1/metadata/stations'));
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
