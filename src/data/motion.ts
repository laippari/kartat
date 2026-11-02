// Dead reckoning for train dots. GPS fixes arrive every few seconds, already a
// little old, and their timestamps jitter by about a second. Between fixes the
// dot keeps moving at the reported speed in the direction of travel. When a fix
// lands, the gap between where the dot is drawn and where the train should be
// is closed gently over a few seconds, so the dot only speeds up or slows down
// a little instead of jumping or darting.

export type LngLat = [number, number];

export interface Fix {
  lng: number;
  lat: number;
  /** km/h, as reported. */
  speed: number;
}

export interface Motion {
  fix: Fix;
  /** performance.now() at which the train was at the fix. */
  fixTime: number;
  /** Degrees per ms, east and north. */
  velocity: LngLat;
  /** Unit vector of travel in metres east and north; kept while the train stands still. */
  heading: LngLat | null;
  /** Drawn minus true position when the fix arrived; fades to nothing. */
  correction: LngLat;
  /** Drawn minus true velocity then, so the dot carries on at the pace it had. */
  correctionVelocity: LngLat;
  correctionStart: number;
}

/** About one interval between fixes: each correction is spread over the wait for the next. */
export const CORRECTION_MS = 3000;
/** Stop extrapolating if no fix arrives for this long; the train may have stopped. */
export const MAX_EXTRAPOLATION_MS = 15_000;
/** Fix timestamps older than this are not caught up on, in case a clock is off. */
export const MAX_FIX_AGE_MS = 10_000;
/** Below this the train counts as standing; GPS jitters even when it is not moving. */
const MIN_SPEED_KMH = 3;
/** Shorter moves are noise, not a direction of travel. */
const MIN_HEADING_METRES = 15;
/** A moving train reporting the same spot again has resent its last fix. */
const SAME_SPOT_METRES = 2;

const METRES_PER_DEGREE = 111_320;

/** Metres east and north from a to b. */
export function offsetMetres(a: Fix | LngLat, b: Fix | LngLat): LngLat {
  const [lng1, lat1] = Array.isArray(a) ? a : [a.lng, a.lat];
  const [lng2, lat2] = Array.isArray(b) ? b : [b.lng, b.lat];
  const cos = Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return [(lng2 - lng1) * METRES_PER_DEGREE * cos, (lat2 - lat1) * METRES_PER_DEGREE];
}

/** Where to draw the train at `now`. */
export function positionAt(m: Motion, now: number): LngLat {
  const elapsed = Math.min(Math.max(now - m.fixTime, 0), MAX_EXTRAPOLATION_MS);
  // Cubic Hermite fade: starts from the drawn position and pace, ends on the
  // true track with no leftover drift, and never changes speed abruptly.
  const s = Math.min((now - m.correctionStart) / CORRECTION_MS, 1);
  const fromPosition = 2 * s ** 3 - 3 * s ** 2 + 1;
  const fromVelocity = (s ** 3 - 2 * s ** 2 + s) * CORRECTION_MS;
  return [
    m.fix.lng + m.velocity[0] * elapsed + m.correction[0] * fromPosition + m.correctionVelocity[0] * fromVelocity,
    m.fix.lat + m.velocity[1] * elapsed + m.correction[1] * fromPosition + m.correctionVelocity[1] * fromVelocity,
  ];
}

function velocityAt(m: Motion, now: number): LngLat {
  const a = positionAt(m, now - 1);
  const b = positionAt(m, now);
  return [b[0] - a[0], b[1] - a[1]];
}

/**
 * Motion after a new fix. `age` is how old the fix already is, so the train is
 * carried forward to where it should be now. Without `previous`, or with
 * `snap`, the dot starts exactly on the fix.
 */
export function nextMotion(previous: Motion | undefined, fix: Fix, now: number, age: number, snap = false): Motion {
  let heading = previous?.heading ?? null;
  let firstHeading = false;
  if (previous) {
    const [east, north] = offsetMetres(previous.fix, fix);
    const distance = Math.hypot(east, north);
    // Nothing new to steer by; acting on it would pull the dot back.
    if (distance < SAME_SPOT_METRES && fix.speed >= MIN_SPEED_KMH && !snap) return previous;
    if (distance >= MIN_HEADING_METRES) {
      firstHeading = !heading;
      heading = [east / distance, north / distance];
    }
  }

  const metresPerMs = fix.speed >= MIN_SPEED_KMH ? fix.speed / 3.6 / 1000 : 0;
  const cos = Math.cos((fix.lat * Math.PI) / 180);
  const velocity: LngLat = heading
    ? [(heading[0] * metresPerMs) / (METRES_PER_DEGREE * cos), (heading[1] * metresPerMs) / METRES_PER_DEGREE]
    : [0, 0];

  const motion: Motion = {
    fix,
    fixTime: now - Math.min(Math.max(age, 0), MAX_FIX_AGE_MS),
    velocity,
    heading,
    correction: [0, 0],
    correctionVelocity: [0, 0],
    correctionStart: now,
  };
  // Until a train's direction is known its dot cannot move with it; once known,
  // move it straight there rather than racing to catch up.
  if (previous && !snap && !firstHeading) {
    const drawn = positionAt(previous, now);
    const target = positionAt(motion, now);
    const drawnVelocity = velocityAt(previous, now);
    motion.correction = [drawn[0] - target[0], drawn[1] - target[1]];
    motion.correctionVelocity = [drawnVelocity[0] - velocity[0], drawnVelocity[1] - velocity[1]];
  }
  return motion;
}
