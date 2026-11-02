import { describe, expect, it } from 'vitest';
import { CORRECTION_MS, MAX_EXTRAPOLATION_MS, nextMotion, offsetMetres, positionAt } from './motion';

const at = (lng: number, lat: number, speed = 0) => ({ lng, lat, speed });
const metresBetween = (a: [number, number], b: [number, number]) => Math.hypot(...offsetMetres(a, b));

describe('motion', () => {
  // Heading north at 72 km/h = 20 m/s.
  const first = nextMotion(undefined, at(25, 60, 72), 0, 0);
  const second = nextMotion(first, at(25, 60.001, 72), 5000, 0);

  it('starts on the first fix and stands still without a direction', () => {
    expect(positionAt(first, 0)).toEqual([25, 60]);
    expect(positionAt(first, 4000)).toEqual([25, 60]);
  });

  it('keeps moving at the reported speed between fixes', () => {
    const later = positionAt(second, 5000 + CORRECTION_MS + 1000);
    const expected = (CORRECTION_MS + 1000) / 1000 * 20;
    expect(metresBetween([25, 60.001], later)).toBeCloseTo(expected, 0);
  });

  it('moves straight to the train once its direction is first known', () => {
    expect(positionAt(second, 5000)).toEqual([25, 60.001]);
  });

  it('does not jump or change pace when a fix arrives', () => {
    const third = nextMotion(second, at(25, 60.0015, 90), 7000, 0);
    const before = [positionAt(second, 6990), positionAt(second, 7000)] as const;
    const after = [positionAt(third, 7000), positionAt(third, 7010)] as const;
    expect(metresBetween(before[1], after[0])).toBeLessThan(0.01);
    const paceBefore = metresBetween(...before) / 0.01;
    const paceAfter = metresBetween(...after) / 0.01;
    expect(Math.abs(paceAfter - paceBefore)).toBeLessThan(1);
  });

  it('catches up on an old fix', () => {
    const late = nextMotion(second, at(25, 60.002, 72), 10_000, 2000, true);
    expect(metresBetween([25, 60.002], positionAt(late, 10_000))).toBeCloseTo(40, 0);
  });

  it('stops extrapolating when fixes stop coming', () => {
    const far = positionAt(second, 5000 + MAX_EXTRAPOLATION_MS);
    expect(positionAt(second, 5000 + MAX_EXTRAPOLATION_MS * 3)).toEqual(far);
  });

  it('ignores a moving train resending its last position', () => {
    const resent = nextMotion(second, at(25, 60.001, 72), 7000, 0);
    expect(resent).toBe(second);
  });

  it('closes a gap gradually, never faster than the gap over half the window', () => {
    // Once the previous correction has settled, a fix puts the train 30 m
    // further along than drawn (20 m/s for CORRECTION_MS, plus 30 m).
    const settled = 5000 + CORRECTION_MS;
    const lat = 60.001 + (20 * (CORRECTION_MS / 1000) + 30) / 111_320;
    const ahead = nextMotion(second, at(25, lat, 72), settled, 0);
    let fastest = 0;
    for (let t = settled; t < settled + CORRECTION_MS; t += 50) {
      const step = metresBetween(positionAt(ahead, t), positionAt(ahead, t + 50)) / 0.05;
      fastest = Math.max(fastest, step);
    }
    expect(fastest).toBeLessThan(20 + (30 / (CORRECTION_MS / 1000)) * 1.6);
  });

  it('treats a crawl as standing', () => {
    const slow = nextMotion(second, at(25, 60.0011, 2), 6000, 0, true);
    expect(positionAt(slow, 20_000)).toEqual([25, 60.0011]);
  });
});
