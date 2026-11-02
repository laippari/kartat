import type { LngLat } from './motion';
import type { Aircraft, TrainLocation, TrainMeta } from './types';

// Aircraft around Helsinki-Vantaa from community ADS-B networks. The networks
// with the best coverage in Finland (adsb.fi, adsb.lol, OpenSky) refuse calls
// from web pages on other sites, so only sources that allow them are used:
//
// - FlyItalyADSB, when the build has a key (VITE_FLYITALY_KEY): a free key by
//   email, 30 requests a minute and 300,000 a month, shared by everyone using
//   the app, since a key in a web page is public. Data CC BY-SA 4.0.
// - AvioADSB otherwise: no key, one request per ten seconds and 100 a day per
//   viewer's network, but few receivers in Finland so far. Data CC BY-NC 4.0.
//
// Both answer in the readsb / adsb.lol format. The map asks only while
// aircraft are shown near the airport and the page is visible.

export const HELSINKI_VANTAA: LngLat = [24.9633, 60.3172];
/** Nautical miles: approach and departure paths, out past Nummela and Porvoo. */
const RADIUS_NM = 40;

export interface AirProvider {
  name: string;
  home: string;
  licence: string;
  url: string;
  headers: Record<string, string>;
  pollMs: number;
  /** Over what period the remaining-requests count runs. */
  quotaPeriod: 'tänään' | 'tässä kuussa';
}

const flyItalyKey: string | undefined = import.meta.env.VITE_FLYITALY_KEY;

export const AIR_PROVIDER: AirProvider = flyItalyKey
  ? {
      name: 'FlyItalyADSB',
      home: 'https://flyitalyadsb.com/',
      licence: 'CC BY-SA 4.0',
      url: `https://api.flyitalyadsb.com/v2/lat/${HELSINKI_VANTAA[1]}/lon/${HELSINKI_VANTAA[0]}/dist/${Math.round(RADIUS_NM * 1.852)}`,
      headers: { 'X-Api-Key': flyItalyKey },
      // 30 a minute is the key's limit across all viewers; leave room for a few at once.
      pollMs: 10_000,
      quotaPeriod: 'tässä kuussa',
    }
  : {
      name: 'AvioADSB',
      home: 'https://avioadsb.org/',
      licence: 'CC BY-NC 4.0',
      url: `https://avioadsb.org/v1/point/${HELSINKI_VANTAA[1]}/${HELSINKI_VANTAA[0]}/${RADIUS_NM}`,
      headers: {},
      // One request per ten seconds is allowed; leave a margin.
      pollMs: 15_000,
      quotaPeriod: 'tänään',
    };

/** The box around the circle the source is asked about, in degrees. */
const radiusLat = (RADIUS_NM * 1.852) / 111.32;
const radiusLng = radiusLat / Math.cos((HELSINKI_VANTAA[1] * Math.PI) / 180);
export const AIR_AREA = {
  west: HELSINKI_VANTAA[0] - radiusLng,
  east: HELSINKI_VANTAA[0] + radiusLng,
  south: HELSINKI_VANTAA[1] - radiusLat,
  north: HELSINKI_VANTAA[1] + radiusLat,
};
export const AIR_POLL_MS = AIR_PROVIDER.pollMs;

const FEET = 0.3048;
const KNOTS = 1.852;

/** One aircraft in a readsb / adsb.lol style response. */
export interface RawAircraft {
  hex: string;
  flight?: string;
  r?: string;
  t?: string;
  desc?: string;
  ownOp?: string;
  lat?: number;
  lon?: number;
  /** Feet, or "ground". */
  alt_baro?: number | 'ground';
  /** Knots. */
  gs?: number;
  track?: number;
  /** Feet per minute. */
  baro_rate?: number;
  geom_rate?: number;
  squawk?: string;
  /** Seconds since the position was received. */
  seen_pos?: number;
}

export function parseAircraft(a: RawAircraft, now: number): { location: TrainLocation; meta: TrainMeta } | null {
  if (a.lat == null || a.lon == null) return null;
  const key = `air/${a.hex}`;
  const callsign = a.flight?.trim() || a.r || a.hex.toUpperCase();
  const onGround = a.alt_baro === 'ground';
  const rate = a.baro_rate ?? a.geom_rate;
  const air: Aircraft = {
    callsign,
    registration: a.r ?? null,
    type: a.t ?? null,
    model: a.desc ?? null,
    operator: a.ownOp ?? null,
    altitude: onGround || typeof a.alt_baro !== 'number' ? null : Math.round(a.alt_baro * FEET),
    climb: rate == null ? null : Math.round(((rate * FEET) / 60) * 10) / 10,
    track: a.track ?? null,
    squawk: a.squawk ?? null,
  };
  return {
    location: {
      key,
      trainNumber: 0,
      departureDate: '',
      lng: a.lon,
      lat: a.lat,
      speed: Math.round((a.gs ?? 0) * KNOTS),
      timestamp: now - (a.seen_pos ?? 0) * 1000,
    },
    meta: {
      key,
      trainNumber: 0,
      departureDate: '',
      type: a.t ?? '',
      category: 'air',
      commuterLine: null,
      operator: a.ownOp ?? '',
      origin: null,
      destination: null,
      delay: null,
      air,
    },
  };
}

const metresBetween = ([lng1, lat1]: LngLat, [lng2, lat2]: LngLat) => {
  const cos = Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.hypot((lng2 - lng1) * 111_320 * cos, (lat2 - lat1) * 111_320);
};

export const kmFromAirport = (p: LngLat) => metresBetween(p, HELSINKI_VANTAA) / 1000;

export type FlightPhase = 'ground' | 'landing' | 'departing' | 'passing';

/**
 * What the aircraft is doing as seen from Helsinki-Vantaa. ADS-B carries no
 * route, so this reads it from height, climb and distance: low and descending
 * near the airport is landing there, low and climbing has just left.
 */
export function flightPhase(air: Aircraft, position: LngLat, speedKmh: number): FlightPhase {
  if (air.altitude == null || (air.altitude < 150 && speedKmh < 100)) return 'ground';
  const near = kmFromAirport(position) < 60 && air.altitude < 4000;
  if (near && (air.climb ?? 0) < -2) return 'landing';
  if (near && (air.climb ?? 0) > 2) return 'departing';
  return 'passing';
}

export interface AirQuota {
  /** Requests left in the source's period, as it last said. */
  remaining: number | null;
  /** When the count starts over, ms since epoch. */
  resetsAt: number | null;
}

export interface AirSnapshot {
  aircraft: { location: TrainLocation; meta: TrainMeta }[];
  quota: AirQuota;
}

export class AirLimitError extends Error {
  constructor(
    readonly retryAfterMs: number,
    readonly quota: AirQuota,
  ) {
    super('rate limited');
  }
}

function quotaOf(res: Response): AirQuota {
  const remaining = res.headers.get('X-RateLimit-Remaining');
  const reset = res.headers.get('X-RateLimit-Reset');
  return {
    remaining: remaining == null ? null : Number(remaining),
    resetsAt: reset == null ? null : Date.now() + Number(reset) * 1000,
  };
}

export async function fetchAircraft(source = AIR_PROVIDER): Promise<AirSnapshot> {
  const res = await fetch(source.url, { headers: source.headers });
  const quota = quotaOf(res);
  if (res.status === 429) {
    const retry = Number(res.headers.get('Retry-After') ?? 10);
    throw new AirLimitError(retry * 1000, quota);
  }
  if (!res.ok) throw new Error(`aircraft ${res.status}`);
  const body: { ac?: RawAircraft[]; now?: number } = await res.json();
  // Some sources give seconds, some milliseconds.
  const now = body.now == null ? Date.now() : body.now < 1e12 ? body.now * 1000 : body.now;
  return {
    aircraft: (body.ac ?? []).flatMap((a) => parseAircraft(a, now) ?? []),
    quota,
  };
}
