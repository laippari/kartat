import { useSyncExternalStore } from 'react';
import {
  fetchLatestLocations,
  fetchRunningTrains,
  fetchStations,
  subscribeLocations,
} from './digitraffic';
import { CATEGORIES, type Category, type Station, type TrainKey, type TrainLocation, type TrainMeta } from './types';

/** A train that has not reported its position for this long is no longer shown. */
const STALE_MS = 10 * 60_000;
const META_REFRESH_MS = 60_000;
/** A position this recent from a train we do not know yet means it just set off. */
const NEW_TRAIN_MS = 30_000;

const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Tracked {
  location: TrainLocation;
  from: [number, number];
  to: [number, number];
  start: number;
  duration: number;
  receivedAt: number;
}

export interface Snapshot {
  ready: boolean;
  connected: boolean;
  counts: Record<Category, number>;
  /** Bumps whenever train metadata or stations change. */
  version: number;
}

const emptyCounts = (): Record<Category, number> =>
  Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;

class TrainStore {
  private tracked = new Map<TrainKey, Tracked>();
  private meta = new Map<TrainKey, TrainMeta>();
  /**
   * Trains keep reporting a position for a while after reaching the end of the
   * line, so only those Digitraffic lists as running are shown...
   */
  private running = new Set<TrainKey>();
  /** ...plus trains that just appeared, until a metadata refresh confirms them. */
  private pending = new Map<TrainKey, number>();
  private metaLoaded = false;
  stations = new Map<string, Station>();

  private snapshot: Snapshot = { ready: false, connected: false, counts: emptyCounts(), version: 0 };
  private listeners = new Set<() => void>();
  private started = false;
  private metaRefreshPending = false;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private publish(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }

  start() {
    if (this.started) return;
    this.started = true;

    fetchStations()
      .then((stations) => {
        stations.forEach((s) => this.stations.set(s.code, s));
        this.publish({ version: this.snapshot.version + 1 });
      })
      .catch(console.error);

    Promise.allSettled([this.refreshMeta(), fetchLatestLocations()]).then(([, locations]) => {
      if (locations.status === 'fulfilled') locations.value.forEach((l) => this.upsert(l, true));
      this.publish({ ready: true });
    });

    subscribeLocations(
      (l) => this.upsert(l),
      (connected) => this.publish({ connected }),
    );

    window.setInterval(() => this.refreshMeta(), META_REFRESH_MS);
    window.setInterval(() => this.publishCounts(), 2000);
  }

  private async refreshMeta() {
    const startedAt = Date.now();
    try {
      const trains = await fetchRunningTrains();
      trains.forEach((t) => this.meta.set(t.key, t));
      this.running = new Set(trains.map((t) => t.key));
      this.metaLoaded = true;
      for (const [key, seenAt] of this.pending) {
        if (this.running.has(key) || seenAt < startedAt) this.pending.delete(key);
      }
      this.publish({ version: this.snapshot.version + 1 });
      this.publishCounts();
    } catch (err) {
      console.error(err);
    }
  }

  private upsert(location: TrainLocation, initial = false) {
    const now = performance.now();
    const existing = this.tracked.get(location.key);
    if (existing && location.timestamp <= existing.location.timestamp) return;

    const target: [number, number] = [location.lng, location.lat];
    if (!existing) {
      this.tracked.set(location.key, {
        location,
        from: target,
        to: target,
        start: now,
        duration: 0,
        receivedAt: now,
      });
      const fresh = Date.now() - location.timestamp < NEW_TRAIN_MS;
      if (!initial && fresh && !this.running.has(location.key)) {
        this.pending.set(location.key, Date.now());
        this.scheduleMetaRefresh();
      }
      return;
    }

    // Glide from wherever the dot is drawn now to the new fix, over roughly the
    // interval between fixes, so movement looks continuous rather than jumpy.
    const interval = now - existing.receivedAt;
    this.tracked.set(location.key, {
      location,
      from: this.positionOf(existing, now),
      to: target,
      start: now,
      duration: reducedMotion ? 0 : Math.min(Math.max(interval, 600), 5000),
      receivedAt: now,
    });
  }

  private scheduleMetaRefresh() {
    if (this.metaRefreshPending) return;
    this.metaRefreshPending = true;
    window.setTimeout(() => {
      this.metaRefreshPending = false;
      this.refreshMeta();
    }, 5000);
  }

  private positionOf(t: Tracked, now: number): [number, number] {
    if (t.duration === 0) return t.to;
    const p = Math.min((now - t.start) / t.duration, 1);
    return [t.from[0] + (t.to[0] - t.from[0]) * p, t.from[1] + (t.to[1] - t.from[1]) * p];
  }

  private isFresh(t: Tracked) {
    if (Date.now() - t.location.timestamp > STALE_MS) return false;
    // Without metadata there is nothing to filter by; better to show every train.
    if (!this.metaLoaded) return true;
    return this.running.has(t.location.key) || this.pending.has(t.location.key);
  }

  getMeta(key: TrainKey) {
    return this.meta.get(key);
  }

  getLocation(key: TrainKey) {
    const t = this.tracked.get(key);
    return t && this.isFresh(t) ? t.location : undefined;
  }

  /** Where the train is drawn at this instant, including the glide. */
  getDrawnPosition(key: TrainKey, now = performance.now()) {
    const t = this.tracked.get(key);
    return t && this.isFresh(t) ? this.positionOf(t, now) : undefined;
  }

  /** Every train currently on the map, with its drawn position. */
  *visible(now = performance.now()) {
    for (const [key, t] of this.tracked) {
      if (!this.isFresh(t)) continue;
      yield { key, position: this.positionOf(t, now), location: t.location, meta: this.meta.get(key) };
    }
  }

  categoryOf(key: TrainKey): Category {
    return this.meta.get(key)?.category ?? 'other';
  }

  private publishCounts() {
    const counts = emptyCounts();
    for (const { key } of this.visible()) counts[this.categoryOf(key)]++;
    const changed = CATEGORIES.some((c) => counts[c] !== this.snapshot.counts[c]);
    if (changed) this.publish({ counts });
  }
}

export const trainStore = new TrainStore();

export function useTrainStore() {
  return useSyncExternalStore(trainStore.subscribe, trainStore.getSnapshot);
}

export const stationName = (code: string) => trainStore.stations.get(code)?.name ?? code;
