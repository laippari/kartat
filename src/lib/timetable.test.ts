import { describe, expect, it } from 'vitest';
import type { TimetableRow, TrainDetails } from '../data/types';
import { currentDelay, nextStop, toStops, visibleStops } from './timetable';

const row = (
  stationShortCode: string,
  type: TimetableRow['type'],
  extra: Partial<TimetableRow> = {},
): TimetableRow => ({
  stationShortCode,
  type,
  trainStopping: true,
  commercialStop: true,
  cancelled: false,
  scheduledTime: '2026-10-25T10:00:00.000Z',
  ...extra,
});

const train = (rows: TimetableRow[], trainCategory = 'Long-distance'): TrainDetails => ({
  trainNumber: 1,
  departureDate: '2026-10-25',
  operatorShortCode: 'vr',
  trainType: 'IC',
  trainCategory,
  runningCurrently: true,
  cancelled: false,
  timeTableRows: rows,
});

describe('toStops', () => {
  it('pairs arrival and departure rows per station', () => {
    const stops = toStops([
      row('HKI', 'DEPARTURE'),
      row('PSL', 'ARRIVAL'),
      row('PSL', 'DEPARTURE', { commercialTrack: '5' }),
      row('TPE', 'ARRIVAL'),
    ]);
    expect(stops.map((s) => s.code)).toEqual(['HKI', 'PSL', 'TPE']);
    expect(stops[1].arrival?.type).toBe('ARRIVAL');
    expect(stops[1].departure?.type).toBe('DEPARTURE');
    expect(stops[1].track).toBe('5');
  });

  it('keeps a station the train returns to as a separate stop', () => {
    const stops = toStops([
      row('A', 'DEPARTURE'),
      row('B', 'ARRIVAL'),
      row('B', 'DEPARTURE'),
      row('A', 'ARRIVAL'),
    ]);
    expect(stops.map((s) => s.code)).toEqual(['A', 'B', 'A']);
  });

  it('treats points without an actual time before the latest recorded one as passed', () => {
    const stops = toStops([
      row('A', 'DEPARTURE', { actualTime: 't' }),
      row('X', 'ARRIVAL', { trainStopping: false }),
      row('X', 'DEPARTURE', { trainStopping: false }),
      row('B', 'ARRIVAL', { actualTime: 't' }),
      row('B', 'DEPARTURE', { actualTime: 't' }),
      row('C', 'ARRIVAL'),
    ]);
    expect(stops.map((s) => s.passed)).toEqual([true, true, true, false]);
    expect(nextStop(stops)?.code).toBe('C');
  });

  it('counts a stop the train is standing at as not yet passed', () => {
    const stops = toStops([
      row('A', 'DEPARTURE', { actualTime: 't' }),
      row('B', 'ARRIVAL', { actualTime: 't' }),
      row('B', 'DEPARTURE'),
      row('C', 'ARRIVAL'),
    ]);
    expect(nextStop(stops)?.code).toBe('B');
  });
});

describe('visibleStops', () => {
  const rows = [
    row('A', 'DEPARTURE'),
    row('X', 'ARRIVAL', { trainStopping: false, commercialStop: undefined }),
    row('X', 'DEPARTURE', { trainStopping: false, commercialStop: undefined }),
    row('Y', 'ARRIVAL', { commercialStop: false }),
    row('Y', 'DEPARTURE', { commercialStop: false }),
    row('B', 'ARRIVAL'),
  ];

  it('shows passenger trains only where passengers can board', () => {
    const t = train(rows);
    expect(visibleStops(t, toStops(rows), false).map((s) => s.code)).toEqual(['A', 'B']);
  });

  it('shows freight trains wherever they stop', () => {
    const t = train(rows, 'Cargo');
    expect(visibleStops(t, toStops(rows), false).map((s) => s.code)).toEqual(['A', 'Y', 'B']);
  });

  it('shows everything on request', () => {
    expect(visibleStops(train(rows), toStops(rows), true)).toHaveLength(4);
  });
});

describe('currentDelay', () => {
  it('uses the most recent row with an actual time', () => {
    expect(
      currentDelay([
        row('A', 'DEPARTURE', { actualTime: 't', differenceInMinutes: 1 }),
        row('B', 'ARRIVAL', { actualTime: 't', differenceInMinutes: 4 }),
        row('C', 'ARRIVAL', { differenceInMinutes: 6 }),
      ]),
    ).toBe(4);
  });

  it('is unknown before departure', () => {
    expect(currentDelay([row('A', 'DEPARTURE')])).toBeNull();
  });
});
