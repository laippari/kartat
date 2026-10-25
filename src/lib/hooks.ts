import { useEffect, useState, useSyncExternalStore } from 'react';
import { now as clockNow } from '../data/clock';

/** Re-renders every `intervalMs`, for "x s ago" style labels. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(clockNow);
  useEffect(() => {
    const id = window.setInterval(() => setNow(clockNow()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}
