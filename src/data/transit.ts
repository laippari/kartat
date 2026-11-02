import mqtt from 'mqtt';
import type { LngLat } from './motion';
import type { NetworkId, TrainLocation, TrainMeta, Transit } from './types';

// City rail: the Helsinki metro and trams, and the Tampere tram.
// Live positions: HSL's high-frequency positioning feed (MQTT, about once a
// second, no key) and the Tampere journeys API (polled). Lines and stops:
// public/data/*.geojson, built from GTFS by scripts/build-metro.mjs and
// scripts/build-trams.mjs.
// Data: Helsinki Region Transport (HSL) and Tampereen joukkoliikenne Nysse, CC BY 4.0.
const HSL_MQTT = 'wss://mqtt.hsl.fi:443/';
const HSL_TOPICS = ['/hfp/v2/journey/ongoing/vp/metro/#', '/hfp/v2/journey/ongoing/vp/tram/#'];
const TAMPERE_API =
  'https://data.itsfactory.fi/journeys/api/1/vehicle-activity?lineRef=1,3&exclude-fields=monitoredVehicleJourney.onwardCalls';
const TAMPERE_POLL_MS = 3000;

export const NETWORK_FILES: Record<NetworkId, string> = {
  metro: 'data/metro.geojson',
  'tram-helsinki': 'data/tram-helsinki.geojson',
  'tram-tampere': 'data/tram-tampere.geojson',
};

export const networkOf = (t: Transit): NetworkId => (t.mode === 'metro' ? 'metro' : `tram-${t.city}`);

export interface TransitStation {
  id: string;
  name: string;
  lng: number;
  lat: number;
}

export interface TransitLine {
  /** GTFS route id; trams are matched to their line by it. */
  id: string;
  /** What passengers call it: "M1", "7". */
  line: string;
  /** 1 or 2, as in the realtime feeds. */
  direction: number;
  headsign: string;
  /** Station or stop ids in running order. */
  stations: string[];
  coordinates: LngLat[];
  /** Distance along the line in metres, for each of `stations`. */
  stationDistances: number[];
}

export interface TransitNetwork {
  lines: TransitLine[];
  stations: Map<string, TransitStation>;
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

export async function loadNetwork(file: string): Promise<TransitNetwork> {
  const res = await fetch(new URL(file, document.baseURI));
  if (!res.ok) throw new Error(`${file} ${res.status}`);
  const geojson = (await res.json()) as GeoJSON.FeatureCollection;
  const stations = new Map<string, TransitStation>();
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
        id: f.properties!.id ?? f.properties!.line,
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

/** The line a run follows. Lines are listed busiest variant first. */
export function lineOf(network: TransitNetwork, t: Transit): TransitLine | undefined {
  const { lines } = network;
  if (t.mode === 'metro') {
    // Short turns (M1B, M2B) follow part of the full line.
    return lines.find((l) => l.line === t.line.replace(/B$/, '') && l.direction === t.direction);
  }
  if (t.destination) {
    // Tampere reports where the run ends rather than a route variant.
    const ending = lines.find((l) => l.line === t.line && l.stations[l.stations.length - 1] === t.destination);
    if (ending) return ending;
  }
  return (
    lines.find((l) => l.id === t.route && l.direction === t.direction) ??
    lines.find((l) => l.line === t.line && l.direction === t.direction)
  );
}

/** First and last stop of a run. Metro short turns (M1B, M2B) start or end at Itäkeskus. */
export function terminiOf(network: TransitNetwork, t: Transit) {
  const line = lineOf(network, t);
  if (!line) return null;
  let first = line.stations[0];
  let last = line.stations[line.stations.length - 1];
  if (t.mode === 'metro' && t.line.endsWith('B')) {
    const itakeskus = line.stations.find((id) => network.stations.get(id)?.name === 'Itäkeskus');
    if (itakeskus && t.direction === 1) first = itakeskus;
    if (itakeskus && t.direction === 2) last = itakeskus;
  }
  return { first, last };
}

/** A train this close to a station is at it. */
const AT_STATION_METRES = 80;

/** Index of the station the train is at or heading for; stations.length once at the end. */
export function nextStationIndex(line: TransitLine, position: LngLat): number {
  const along = distanceAlong(line.coordinates, position);
  const i = line.stationDistances.findIndex((d) => d > along - AT_STATION_METRES);
  return i === -1 ? line.stations.length : i;
}

type OnPosition = (location: TrainLocation, meta: TrainMeta) => void;

function position(key: string, day: string, lng: number, lat: number, kmh: number, time: string): TrainLocation {
  return { key, trainNumber: 0, departureDate: day, lng, lat, speed: Math.round(kmh), timestamp: Date.parse(time) };
}

function meta(key: string, day: string, transit: Transit, operator: string, delay: number | null): TrainMeta {
  return {
    key,
    trainNumber: 0,
    departureDate: day,
    type: transit.line,
    category: transit.mode,
    commuterLine: null,
    operator,
    origin: null,
    destination: null,
    delay,
    transit,
  };
}

interface HfpPosition {
  desi: string;
  dir: string;
  oday: string;
  start: string;
  route: string;
  tst: string;
  spd: number | null;
  /** Seconds ahead of schedule; negative when late. */
  dl: number | null;
  lat: number | null;
  long: number | null;
}

/**
 * Streams HSL metro and tram positions. Coupled units report the same run
 * separately, so positions are keyed by run (line, direction, day and
 * departure time) and the duplicates fall away.
 */
export function subscribeHsl(onPosition: OnPosition): () => void {
  const client = mqtt.connect(HSL_MQTT, {
    clientId: `kartat-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 5000,
  });
  client.on('connect', () => client.subscribe(HSL_TOPICS));
  client.on('message', (topic, payload) => {
    try {
      const mode = topic.split('/')[6];
      const vp: HfpPosition | undefined = JSON.parse(new TextDecoder().decode(payload)).VP;
      // Runs without a line ("000") are depot moves.
      if (!vp || vp.lat == null || vp.long == null || !vp.desi || vp.desi === '000') return;
      if (mode !== 'metro' && mode !== 'tram') return;
      const direction = Number(vp.dir);
      const key = `${mode}/helsinki/${vp.oday}/${vp.route}/${direction}/${vp.start}`;
      const transit: Transit = { mode, city: 'helsinki', line: vp.desi, route: vp.route, direction, start: vp.start };
      // The metro feed's delay field is always empty.
      const delay = mode === 'tram' && vp.dl != null ? Math.round(-vp.dl / 60) : null;
      onPosition(
        position(key, vp.oday, vp.long, vp.lat, (vp.spd ?? 0) * 3.6, vp.tst),
        meta(key, vp.oday, transit, 'HSL', delay),
      );
    } catch {
      // A malformed message is not worth breaking the stream for.
    }
  });
  return () => {
    client.end(true);
  };
}

/** "P0Y0M0DT0H2M5.000S", or with a leading minus when early, in whole minutes. */
export function isoMinutes(duration: string | undefined): number | null {
  const m = duration?.match(/^(-?)P.*?T(\d+)H(\d+)M([\d.]+)S$/);
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 60;
  return Math.round(m[1] ? -minutes : minutes);
}

interface SiriActivity {
  recordedAtTime: string;
  monitoredVehicleJourney: {
    lineRef: string;
    directionRef: string;
    framedVehicleJourneyRef: { dateFrameRef: string; datedVehicleJourneyRef: string };
    vehicleLocation: { longitude: string; latitude: string };
    destinationShortName: string;
    originAimedDepartureTime: string;
    speed: string;
    delay?: string;
  };
}

/** Polls the Tampere tram positions. */
export function subscribeTampere(onPosition: OnPosition): () => void {
  let stopped = false;
  let timer = 0;
  const poll = async () => {
    try {
      const res = await fetch(TAMPERE_API);
      const body: { body?: SiriActivity[] } = await res.json();
      for (const a of body.body ?? []) {
        const j = a.monitoredVehicleJourney;
        const day = j.framedVehicleJourneyRef.dateFrameRef;
        const journey = j.framedVehicleJourneyRef.datedVehicleJourneyRef.split('/').pop();
        const key = `tram/tampere/${day}/${journey}`;
        // "1321" → "13:21"
        const start = j.originAimedDepartureTime.replace(/^(\d\d)(\d\d)$/, '$1:$2');
        const transit: Transit = {
          mode: 'tram',
          city: 'tampere',
          line: j.lineRef,
          route: j.lineRef,
          direction: Number(j.directionRef),
          start,
          destination: j.destinationShortName,
        };
        onPosition(
          position(key, day, Number(j.vehicleLocation.longitude), Number(j.vehicleLocation.latitude), Number(j.speed), a.recordedAtTime),
          meta(key, day, transit, 'Nysse', isoMinutes(j.delay)),
        );
      }
    } catch {
      // Try again on the next round.
    }
    if (!stopped) timer = window.setTimeout(poll, TAMPERE_POLL_MS);
  };
  poll();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}
