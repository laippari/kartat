import { describe, expect, it } from 'vitest';
import { distanceAlong, nextStationIndex, terminiOf, type MetroLine, type MetroNetwork } from './metro';

// A straight east-west line along 60°N with stations every 0.01° (about 557 m).
const coordinates: [number, number][] = [
  [24.9, 60],
  [24.95, 60],
];
const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
const line: MetroLine = {
  line: 'M1',
  direction: 1,
  headsign: 'F',
  stations: ids,
  coordinates,
  stationDistances: ids.map((_, i) => distanceAlong(coordinates, [24.9 + i * 0.01, 60])),
};

describe('metro', () => {
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
    const network: MetroNetwork = {
      lines: [line, { ...line, direction: 2, stations: [...ids].reverse() }],
      stations: new Map(ids.map((id) => [id, { id, name: id === 'd' ? 'Itäkeskus' : id, lng: 0, lat: 0 }])),
      geojson: { type: 'FeatureCollection', features: [] },
    };
    expect(terminiOf(network, 'M1', 1)).toEqual({ first: 'a', last: 'f' });
    expect(terminiOf(network, 'M1B', 1)).toEqual({ first: 'd', last: 'f' });
    expect(terminiOf(network, 'M1B', 2)).toEqual({ first: 'f', last: 'd' });
  });
});
