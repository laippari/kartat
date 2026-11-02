import type { LngLat } from './motion';

// Keeps drawn trains on their line. GPS wanders a few metres sideways, and
// between fixes a dot moves in a straight line, cutting curves; snapping the
// drawn position to the nearest track removes both. Segments are bucketed in
// a coarse grid, so a lookup only checks the few segments near the point.

/** About 550 m north–south and 280 m east–west in Finland. */
const CELL = 0.005;
const METRES_PER_DEGREE = 111_320;

type Segment = [LngLat, LngLat];

export class TrackIndex {
  private cells = new Map<string, Segment[]>();

  constructor(lines: Iterable<LngLat[]>) {
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) this.insert([line[i - 1], line[i]]);
    }
  }

  private insert(segment: Segment) {
    const [[x1, y1], [x2, y2]] = segment;
    for (let x = Math.floor(Math.min(x1, x2) / CELL); x <= Math.floor(Math.max(x1, x2) / CELL); x++) {
      for (let y = Math.floor(Math.min(y1, y2) / CELL); y <= Math.floor(Math.max(y1, y2) / CELL); y++) {
        const key = `${x}:${y}`;
        const cell = this.cells.get(key);
        if (cell) cell.push(segment);
        else this.cells.set(key, [segment]);
      }
    }
  }

  /**
   * The nearest point on a track, or the point itself if no track is within
   * `maxMetres` (yards and sidings missing from the network, for instance).
   */
  snap(p: LngLat, maxMetres: number): LngLat {
    const cos = Math.cos((p[1] * Math.PI) / 180);
    const cx = Math.floor(p[0] / CELL);
    const cy = Math.floor(p[1] / CELL);
    let best = p;
    let bestDistance = maxMetres;
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (const [a, b] of this.cells.get(`${x}:${y}`) ?? []) {
          // Project onto the segment in a local metric frame.
          const bx = (b[0] - a[0]) * cos;
          const by = b[1] - a[1];
          const px = (p[0] - a[0]) * cos;
          const py = p[1] - a[1];
          const t = Math.max(0, Math.min(1, (px * bx + py * by) / (bx * bx + by * by || 1)));
          const distance = Math.hypot(px - bx * t, py - by * t) * METRES_PER_DEGREE;
          if (distance < bestDistance) {
            bestDistance = distance;
            best = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          }
        }
      }
    }
    return best;
  }
}

/** All line strings in a GeoJSON collection, MultiLineStrings included. */
export function* linesOf(collection: GeoJSON.FeatureCollection): Iterable<LngLat[]> {
  for (const f of collection.features) {
    if (f.geometry.type === 'LineString') yield f.geometry.coordinates as LngLat[];
    if (f.geometry.type === 'MultiLineString') yield* f.geometry.coordinates as LngLat[][];
  }
}
