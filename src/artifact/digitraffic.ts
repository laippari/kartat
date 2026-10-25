import { setClock } from '../data/clock';
import { parseRunningTrain, parseStations, type RawRunningTrain, type RawStation } from '../data/parse';
import { trainKey, type Station, type TrainDetails, type TrainLocation, type TrainMeta } from '../data/types';

// Stands in for src/data/digitraffic.ts in the artifact build (see vite.config.ts).
// The artifact sandbox blocks requests to Digitraffic, so this replays a
// recording made by scripts/build-artifact-data.mjs, on a loop, through the
// same functions the live client exports.

/** [train index, ms from start, lng × 1e5, lat × 1e5, speed] */
type Row = [number, number, number, number, number];

interface Replay {
  start: number;
  end: number;
  keys: string[];
  initial: Row[];
  updates: Row[];
}

// Absolute, because MapLibre resolves URLs inside a worker with no page base.
export const dataUrl = (name: string) => new URL(`data/${name}`, document.baseURI).href;

const getData = async <T>(name: string): Promise<T> => {
  const res = await fetch(dataUrl(name));
  if (!res.ok) throw new Error(`${res.status}: ${name}`);
  return res.json() as Promise<T>;
};

let span: { start: number; end: number } | null = null;
let startedAt = 0;
let replay: Promise<Replay> | undefined;

function loadReplay() {
  replay ??= getData<Replay>('replay.json').then((r) => {
    startedAt = Date.now();
    span = { start: r.start, end: r.end };
    // Time runs on from the start of the recording, so "x s ago" stays right.
    setClock(() => r.start + (Date.now() - startedAt));
    return r;
  });
  return replay;
}

export const recording = () => span;

function toLocation(r: Replay, row: Row, timestamp: number): TrainLocation {
  const key = r.keys[row[0]];
  const [departureDate, number] = key.split('/');
  return {
    key,
    trainNumber: Number(number),
    departureDate,
    lng: row[2] / 1e5,
    lat: row[3] / 1e5,
    speed: row[4],
    timestamp,
  };
}

export async function fetchLatestLocations(): Promise<TrainLocation[]> {
  const r = await loadReplay();
  return r.initial.map((row) => toLocation(r, row, r.start + row[1]));
}

export async function fetchRunningTrains(): Promise<TrainMeta[]> {
  return (await getData<RawRunningTrain[]>('trains.json')).map(parseRunningTrain);
}

export async function fetchStations(): Promise<Station[]> {
  return parseStations(await getData<RawStation[]>('stations.json'));
}

let timetables: Promise<Record<string, TrainDetails>> | undefined;

export async function fetchTrain(departureDate: string, trainNumber: number) {
  timetables ??= getData('timetables.json');
  return (await timetables)[trainKey(departureDate, trainNumber)] ?? null;
}

export function subscribeLocations(
  onLocation: (location: TrainLocation) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  let timer = 0;
  let stopped = false;
  loadReplay().then((r) => {
    if (stopped) return;
    onStatus(true);
    const duration = r.end - r.start;
    let loop = 0;
    let next = 0;
    const emit = (row: Row) => onLocation(toLocation(r, row, r.start + loop * duration + row[1]));
    timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      // At the end of the recording, start over: every train back to where it began.
      while (Math.floor(elapsed / duration) > loop) {
        for (; next < r.updates.length; next++) emit(r.updates[next]);
        loop++;
        next = 0;
        for (const row of r.initial) onLocation(toLocation(r, row, r.start + loop * duration));
      }
      const local = elapsed - loop * duration;
      for (; next < r.updates.length && r.updates[next][1] <= local; next++) emit(r.updates[next]);
    }, 250);
  });
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}
