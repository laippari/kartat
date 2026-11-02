import { describe, expect, it } from 'vitest';
import {
  distanceAlong,
  isoMinutes,
  lineOf,
  nextStationIndex,
  terminiOf,
  type TransitLine,
  type TransitNetwork,
} from './transit';
import type { Transit } from './types';

// A straight east-west line along 60°N with stations every 0.01° (about 557 m).
const coordinates: [number, number][] = [
  [24.9, 60],
  [24.95, 60],
];
const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
const line: TransitLine = {
  id: '31M1',
  line: 'M1',
  direction: 1,
  headsign: 'F',
  stations: ids,
  coordinates,
  stationDistances: ids.map((_, i) => distanceAlong(coordinates, [24.9 + i * 0.01, 60])),
};

const metro = (line: string, direction: number): Transit => ({
  mode: 'metro',
  city: 'helsinki',
  line,
  route: `31${line}`,
  direction,
  start: '13:45',
});

describe('city rail', () => {
  it('measures distance along the line from the nearest point on it', () => {
    expect(distanceAlong(coordinates, [24.92, 60.0003])).toBeCloseTo(1113, -1);
  });

  it('finds the next station ahead of the train', () => {
    expect(nextStationIndex(line, [24.915, 60])).toBe(2);
  });

  it('counts a train at a platform as being at that station', () => {
    expect(nextStationIndex(line, [24.9201, 60])).toBe(2);
  });

  it('is past the last station at the end of the line', () => {
    expect(nextStationIndex(line, [24.95, 60])).toBe(5);
    expect(nextStationIndex(line, [24.96, 60])).toBe(5);
  });

  it('ends short turns at Itäkeskus', () => {
    const network: TransitNetwork = {
      lines: [line, { ...line, direction: 2, stations: [...ids].reverse() }],
      stations: new Map(ids.map((id) => [id, { id, name: id === 'd' ? 'Itäkeskus' : id, lng: 0, lat: 0 }])),
      geojson: { type: 'FeatureCollection', features: [] },
    };
    expect(terminiOf(network, metro('M1', 1))).toEqual({ first: 'a', last: 'f' });
    expect(terminiOf(network, metro('M1B', 1))).toEqual({ first: 'd', last: 'f' });
    expect(terminiOf(network, metro('M1B', 2))).toEqual({ first: 'f', last: 'd' });
  });

  it('matches a tram to the line variant that ends where the run ends', () => {
    const tram = (stations: string[], id = '3'): TransitLine => ({ ...line, id, line: '3', stations });
    const network: TransitNetwork = {
      lines: [tram(['a', 'b', 'x']), tram(['a', 'b', 'y'])],
      stations: new Map(),
      geojson: { type: 'FeatureCollection', features: [] },
    };
    const run: Transit = { mode: 'tram', city: 'tampere', line: '3', route: '3', direction: 1, start: '13:21' };
    expect(lineOf(network, { ...run, destination: 'y' })?.stations).toEqual(['a', 'b', 'y']);
    // Without a destination, the busiest variant (listed first) is the one.
    expect(lineOf(network, run)?.stations).toEqual(['a', 'b', 'x']);
  });

  it('reads delays given as ISO durations', () => {
    expect(isoMinutes('P0Y0M0DT0H2M5.000S')).toBe(2);
    expect(isoMinutes('-P0Y0M0DT0H0M40.000S')).toBe(-1);
    expect(isoMinutes('P0Y0M0DT1H0M0.000S')).toBe(60);
    expect(isoMinutes(undefined)).toBeNull();
  });
});
