import { useEffect, useState } from 'react';
import { fetchTrain } from './digitraffic';
import type { TrainDetails, TrainKey } from './types';

const POLL_MS = 20_000;

/** Full timetable of one train, refreshed while it is on screen. */
export function useTrainDetails(key: TrainKey | null) {
  const [details, setDetails] = useState<{ key: TrainKey; train: TrainDetails | null } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!key) return;
    const [date, number] = key.split('/');
    let cancelled = false;
    const load = () =>
      fetchTrain(date, Number(number))
        .then((train) => {
          if (cancelled) return;
          setDetails({ key, train });
          setError(false);
        })
        .catch(() => !cancelled && setError(true));
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [key]);

  const current = details?.key === key ? details : null;
  return { train: current?.train ?? null, loading: !current && !error, error };
}
