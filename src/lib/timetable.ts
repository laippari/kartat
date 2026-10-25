import type { TimetableRow, TrainDetails } from '../data/types';

export interface Stop {
  code: string;
  arrival?: TimetableRow;
  departure?: TimetableRow;
  /** The train stops here; otherwise it only passes through. */
  stopping: boolean;
  /** Passengers can board or alight here. */
  commercial: boolean;
  track?: string;
  cancelled: boolean;
  passed: boolean;
}

/**
 * Digitraffic lists one row per arrival and per departure. Pairs them up into
 * one entry per station, in running order.
 */
export function toStops(rows: TimetableRow[]): Stop[] {
  const stops: Stop[] = [];
  for (const row of rows) {
    let stop = stops[stops.length - 1];
    // A station repeats when the train turns back through it, so only merge
    // an arrival with the departure that directly follows it.
    if (!stop || stop.code !== row.stationShortCode || row.type === 'ARRIVAL' || stop.departure) {
      stop = {
        code: row.stationShortCode,
        stopping: false,
        commercial: false,
        cancelled: false,
        passed: false,
      };
      stops.push(stop);
    }
    if (row.type === 'ARRIVAL') stop.arrival = row;
    else stop.departure = row;
    stop.stopping ||= row.trainStopping;
    stop.commercial ||= row.trainStopping && row.commercialStop === true;
    stop.track ??= row.commercialTrack || undefined;
    stop.cancelled ||= row.cancelled;
  }
  // A stop is behind the train once it has left, or reached the end of the line.
  // Points the train passes without stopping do not always get an actual time,
  // so anything before the latest recorded stop counts as passed too.
  let latest = -1;
  stops.forEach((stop, i) => {
    if (mainRow(stop).actualTime) latest = i;
  });
  stops.forEach((stop, i) => (stop.passed = i <= latest));
  return stops;
}

/** The row whose time best describes the stop: departure, or arrival at the end. */
export const mainRow = (stop: Stop) => (stop.departure ?? stop.arrival)!;

/** The best known time: actual if it has happened, otherwise the live estimate. */
export const effectiveTime = (row: TimetableRow) =>
  row.actualTime ?? row.liveEstimateTime ?? row.scheduledTime;

export function visibleStops(train: TrainDetails, stops: Stop[], showAll: boolean) {
  if (showAll) return stops;
  const passenger = train.trainCategory === 'Long-distance' || train.trainCategory === 'Commuter';
  return stops.filter(
    (s, i) => i === 0 || i === stops.length - 1 || (passenger ? s.commercial : s.stopping),
  );
}

/** The next stop the train has not yet reached, undefined once it has arrived. */
export const nextStop = (stops: Stop[]) => stops.find((s) => !s.passed);

/** Delay at the most recent station with an actual time. */
export function currentDelay(rows: TimetableRow[]) {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].actualTime) return rows[i].differenceInMinutes ?? 0;
  }
  return null;
}
