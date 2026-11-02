import { describe, expect, it } from 'vitest';
import { flightPhase, HELSINKI_VANTAA, parseAircraft, type RawAircraft } from './air';

const raw: RawAircraft = {
  hex: '461fa9',
  flight: 'FIN7YB  ',
  r: 'OH-LZT',
  t: 'A321',
  desc: 'AIRBUS A-321',
  lat: 60.32,
  lon: 24.14,
  alt_baro: 19475,
  gs: 369.1,
  track: 254.12,
  baro_rate: 2752,
  seen_pos: 0.5,
};

describe('aircraft', () => {
  it('converts to metres, km/h and m/s', () => {
    const parsed = parseAircraft(raw, 10_000)!;
    expect(parsed.location.key).toBe('air/461fa9');
    expect(parsed.location.speed).toBe(684);
    expect(parsed.location.timestamp).toBe(9_500);
    expect(parsed.meta.air).toMatchObject({ callsign: 'FIN7YB', altitude: 5936, climb: 14, track: 254.12 });
  });

  it('falls back to the registration without a flight number', () => {
    expect(parseAircraft({ ...raw, flight: '  ' }, 0)!.meta.air!.callsign).toBe('OH-LZT');
  });

  it('skips aircraft without a position', () => {
    expect(parseAircraft({ hex: 'abc' }, 0)).toBeNull();
  });

  it('reads the phase of flight from height, climb and distance', () => {
    const at = (altitude: number | null, climb: number, km = 10) => {
      const air = { ...parseAircraft(raw, 0)!.meta.air!, altitude, climb };
      const position: [number, number] = [HELSINKI_VANTAA[0], HELSINKI_VANTAA[1] + km / 111.32];
      return flightPhase(air, position, 300);
    };
    expect(at(null, 0)).toBe('ground');
    expect(at(900, -4)).toBe('landing');
    expect(at(1500, 10)).toBe('departing');
    expect(at(11_000, 0)).toBe('passing');
    // Descending far away is not a landing here.
    expect(at(900, -4, 120)).toBe('passing');
  });
});
