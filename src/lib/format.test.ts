import { describe, expect, it } from 'vitest';
import { delayShort, delayText, formatTime, trainTitle } from './format';

describe('format', () => {
  it('shows times in Finnish time', () => {
    expect(formatTime('2026-10-25T18:05:00.000Z')).toBe('20.05');
    expect(formatTime('2026-07-01T18:05:00.000Z')).toBe('21.05');
  });

  it('names commuter trains by line', () => {
    expect(trainTitle({ type: 'HL', trainNumber: 9673, commuterLine: 'R' })).toBe('R-juna');
    expect(trainTitle({ type: 'IC', trainNumber: 27, commuterLine: null })).toBe('IC 27');
  });

  it('names metros and trams by line', () => {
    const run = { city: 'helsinki', route: '1007', direction: 1, start: '13:45' } as const;
    const base = { type: '', trainNumber: 0, commuterLine: null };
    expect(trainTitle({ ...base, transit: { ...run, mode: 'metro', line: 'M1' } })).toBe('M1');
    expect(trainTitle({ ...base, transit: { ...run, mode: 'tram', line: '7' } })).toBe('Ratikka 7');
  });

  it('describes delays', () => {
    expect(delayText(0)).toBe('Aikataulussa');
    expect(delayText(4)).toBe('4 min myöhässä');
    expect(delayText(-2)).toBe('2 min etuajassa');
    expect(delayShort(4)).toBe('+4 min');
    expect(delayShort(null)).toBeNull();
  });
});
