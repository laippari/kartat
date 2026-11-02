import mqtt from 'mqtt';
import type { LngLat } from './motion';
import type { TrainLocation, TrainMeta } from './types';

// Helsinki metro from HSL: live positions from the high-frequency positioning
// feed (MQTT, about once a second, no key needed), and the lines and stations
// from public/data/metro.geojson (scripts/build-metro.mjs, from HSL's GTFS).
// Data: Helsinki Region Transport (HSL), CC BY 4.0.
const MQTT_URL = 'wss://mqtt.hsl.fi:443/';
const TOPIC = '/hfp/v2/journey/ongoing/vp/metro/#';

export interface MetroStation {
  id: string;
  name: string;
  lng: number;
  lat: number;
}

export interface MetroLine {
  /** "M1" or "M2". */
  line: string;
  /** 1 or 2, as in the realtime feed. */
  direction: number;
  headsign: string;
  /** Station ids in running order. */
  stations: string[];
  coordinates: LngLat[];
  /** Distance along the line in metres, for each of `stations`. */
  stationDistances: number[];
}

export interface MetroNetwork {
  lines: MetroLine[];
  stations: Map<string, MetroStation>;
  geojson: GeoJSON.FeatureCollection;
}

const metres = ([lng1, lat1]: LngLat, [lng2, lat2]: LngLat) => {
  const cos = Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.hypot((lng2 - lng1) * 111_320 * cos, (lat2 - lat1) * 111_320);
};

/** How far along the line, in metres, the point on it closest to `p` is. */
export function distanceAlong(line: LngLat[], p: LngLat): number {
  let best = 0;
  let bestOff = Infinity;
  let travelled = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const length = metres(a, b);
    const cos = Math.cos((a[1] * Math.PI) / 180);
    const bx = (b[0] - a[0]) * cos;
    const by = b[1] - a[1];
    const t = Math.max(0, Math.min(1, (((p[0] - a[0]) * cos) * bx + (p[1] - a[1]) * by) / (bx * bx + by * by || 1)));
    const off = metres(p, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    if (off < bestOff) {
      bestOff = off;
      best = travelled + length * t;
    }
    travelled += length;
  }
  return best;
}

export async function loadMetroNetwork(): Promise<MetroNetwork> {
  const res = await fetch(new URL('data/metro.geojson', document.baseURI));
  if (!res.ok) throw new Error(`metro.geojson ${res.status}`);
  const geojson = (await res.json()) as GeoJSON.FeatureCollection;
  const stations = new Map<string, MetroStation>();
  for (const f of geojson.features) {
    if (f.properties?.kind !== 'station') continue;
    const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
    stations.set(f.properties.id, { id: f.properties.id, name: f.properties.name, lng, lat });
  }
  const lines = geojson.features
    .filter((f) => f.properties?.kind === 'line')
    .map((f) => {
      const coordinates = (f.geometry as GeoJSON.LineString).coordinates as LngLat[];
      const ids: string[] = f.properties!.stations;
      return {
        line: f.properties!.line,
        direction: f.properties!.direction,
        headsign: f.properties!.headsign,
        stations: ids,
        coordinates,
        stationDistances: ids.map((id) => {
          const s = stations.get(id)!;
          return distanceAlong(coordinates, [s.lng, s.lat]);
        }),
      };
    });
  return { lines, stations, geojson };
}

/** The line a run follows. Short turns (M1B, M2B) follow part of the full line. */
export const lineOf = (network: MetroNetwork, line: string, direction: number) =>
  network.lines.find((l) => l.line === line.replace(/B$/, '') && l.direction === direction);

/** A train this close to a station is at it. */
const AT_STATION_METRES = 80;

/** Index of the station the train is at or heading for; stations.length once at the end. */
export function nextStationIndex(line: MetroLine, position: LngLat): number {
  const along = distanceAlong(line.coordinates, position);
  const i = line.stationDistances.findIndex((d) => d > along - AT_STATION_METRES);
  return i === -1 ? line.stations.length : i;
}

interface VehiclePosition {
  desi: string;
  dir: string;
  oday: string;
  start: string;
  tst: string;
  spd: number | null;
  lat: number | null;
  long: number | null;
}

/**
 * Streams metro positions. Coupled units report the same run separately, so
 * positions are keyed by run (line, direction, day and departure time).
 */
export function subscribeMetro(onPosition: (location: TrainLocation, meta: TrainMeta) => void): () => void {
  const client = mqtt.connect(MQTT_URL, {
    clientId: `kartat-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 5000,
  });
  client.on('connect', () => client.subscribe(TOPIC));
  client.on('message', (_topic, payload) => {
    try {
      const vp: VehiclePosition | undefined = JSON.parse(new TextDecoder().decode(payload)).VP;
      if (!vp || vp.lat == null || vp.long == null) return;
      const direction = Number(vp.dir);
      const key = `metro/${vp.oday}/${vp.desi}/${direction}/${vp.start}`;
      onPosition(
        {
          key,
          trainNumber: 0,
          departureDate: vp.oday,
          lng: vp.long,
          lat: vp.lat,
          speed: Math.round((vp.spd ?? 0) * 3.6),
          timestamp: Date.parse(vp.tst),
        },
        {
          key,
          trainNumber: 0,
          departureDate: vp.oday,
          type: vp.desi,
          category: 'metro',
          commuterLine: null,
          operator: 'HSL',
          origin: null,
          destination: null,
          delay: null,
          metro: { line: vp.desi, direction, start: vp.start },
        },
      );
    } catch {
      // A malformed message is not worth breaking the stream for.
    }
  });
  return () => {
    client.end(true);
  };
}

/** First and last station of a run. Short turns (M1B, M2B) start or end at Itäkeskus. */
export function terminiOf(network: MetroNetwork, line: string, direction: number) {
  const full = lineOf(network, line, direction);
  if (!full) return null;
  let first = full.stations[0];
  let last = full.stations[full.stations.length - 1];
  if (line.endsWith('B')) {
    const itakeskus = full.stations.find((id) => network.stations.get(id)?.name === 'Itäkeskus');
    if (itakeskus && direction === 1) first = itakeskus;
    if (itakeskus && direction === 2) last = itakeskus;
  }
  return { first, last };
}
