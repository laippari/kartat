import { describe, expect, it } from 'vitest';
import { TrackIndex } from './track';

// An L-shaped line: east along 60°N, then north.
const index = new TrackIndex([
  [
    [24.9, 60],
    [24.92, 60],
    [24.92, 60.02],
  ],
]);

describe('TrackIndex', () => {
  it('moves a point sideways onto the line', () => {
    const [lng, lat] = index.snap([24.91, 60.0002], 50);
    expect(lng).toBeCloseTo(24.91, 6);
    expect(lat).toBeCloseTo(60, 6);
  });

  it('keeps the point where it is when no line is close enough', () => {
    expect(index.snap([24.91, 60.003], 50)).toEqual([24.91, 60.003]);
  });

  it('pulls a point that cut the corner back onto the bend', () => {
    const [lng, lat] = index.snap([24.9198, 60.0002], 50);
    expect(Math.abs(lng - 24.92) < 1e-6 || Math.abs(lat - 60) < 1e-6).toBe(true);
  });

  it('finds lines that cross a cell without a point in it', () => {
    // The north leg spans several grid cells with no vertex in between.
    const [lng, lat] = index.snap([24.9201, 60.0101], 50);
    expect(lng).toBeCloseTo(24.92, 6);
    expect(lat).toBeCloseTo(60.0101, 6);
  });
});
