import { useSyncExternalStore } from 'react';
import { now as clockNow } from './clock';
import {
  fetchLatestLocations,
  fetchRunningTrains,
  fetchStations,
  recording,
  subscribeLocations,
} from './digitraffic';
import { loadMetroNetwork, subscribeMetro, terminiOf, type MetroNetwork } from './metro';
import { nextMotion, offsetMetres, positionAt, type LngLat, type Motion } from './motion';
import { linesOf, TrackIndex } from './track';
import {
  CATEGORIES,
  isMetroKey,
  type Category,
  type Station,
  type TrainKey,
  type TrainLocation,
  type TrainMeta,
} from './types';

/** A train that has not reported its position for this long is no longer shown. */
const STALE_MS = 10 * 60_000;
/** Metro trains report every second while running, so silence means the run has ended. */
const METRO_STALE_MS = 60_000;
/** Drawn trains stick to a track this close; farther off they are somewhere the network does not cover. */
const SNAP_METRES = 60;
const META_REFRESH_MS = 60_000;
/** A position this recent from a train we do not know yet means it just set off. */
const NEW_TRAIN_MS = 30_000;
/** Farther than this between two fixes is a jump (bad GPS, replay restart): move there at once. */
const JUMP_METRES = 2000;

const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Tracked {
  location: TrainLocation;
  motion: Motion;
}

export interface Snapshot {
  ready: boolean;
  connected: boolean;
  counts: Record<Category, number>;
  /** Bumps whenever train metadata or stations change. */
  version: number;
  /** Set when the trains are a recording being replayed instead of live data. */
  recording: { start: number; end: number } | null;
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
  metro: MetroNetwork | null = null;
  private railTracks: TrackIndex | null = null;
  private metroTracks: TrackIndex | null = null;

  private snapshot: Snapshot = { ready: false, connected: false, counts: emptyCounts(), version: 0, recording: null };
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
      this.publish({ ready: true, recording: recording() });
    });

    subscribeLocations(
      (l) => this.upsert(l),
      (connected) => this.publish({ connected }),
    );

    fetch(new URL('data/rail-network.geojson', document.baseURI))
      .then((res) => res.json())
      .then((network: GeoJSON.FeatureCollection) => (this.railTracks = new TrackIndex(linesOf(network))))
      .catch(console.error);

    loadMetroNetwork()
      .then((network) => {
        this.metro = network;
        this.metroTracks = new TrackIndex(network.lines.map((l) => l.coordinates));
        this.publish({ version: this.snapshot.version + 1 });
      })
      .catch(console.error);
    subscribeMetro((location, meta) => {
      if (!this.meta.has(meta.key)) this.meta.set(meta.key, meta);
      this.upsert(location);
    });

    window.setInterval(() => this.refreshMeta(), META_REFRESH_MS);
    window.setInterval(() => this.publishCounts(), 2000);
  }

  private async refreshMeta() {
    const startedAt = clockNow();
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

    // Reduced motion: dots jump from fix to fix instead of gliding.
    const fix = { lng: location.lng, lat: location.lat, speed: reducedMotion ? 0 : location.speed };
    const age = clockNow() - location.timestamp;
    const jump = existing && Math.hypot(...offsetMetres(existing.location, fix)) > JUMP_METRES;
    this.tracked.set(location.key, {
      location,
      motion: nextMotion(existing?.motion, fix, now, age, reducedMotion || jump),
    });

    if (!existing) {
      const fresh = clockNow() - location.timestamp < NEW_TRAIN_MS;
      if (!initial && fresh && !isMetroKey(location.key) && !this.running.has(location.key)) {
        this.pending.set(location.key, clockNow());
        this.scheduleMetaRefresh();
      }
    }
  }

  private scheduleMetaRefresh() {
    if (this.metaRefreshPending) return;
    this.metaRefreshPending = true;
    window.setTimeout(() => {
      this.metaRefreshPending = false;
      this.refreshMeta();
    }, 5000);
  }

  /** Where to draw the train: its dead-reckoned position, kept on the track. */
  private positionOf(t: Tracked, now: number): LngLat {
    const raw = positionAt(t.motion, now);
    const tracks = isMetroKey(t.location.key) ? this.metroTracks : this.railTracks;
    return tracks ? tracks.snap(raw, SNAP_METRES) : raw;
  }

  private isFresh(t: Tracked) {
    if (isMetroKey(t.location.key)) return clockNow() - t.location.timestamp < METRO_STALE_MS;
    if (clockNow() - t.location.timestamp > STALE_MS) return false;
    // Without metadata there is nothing to filter by; better to show every train.
    if (!this.metaLoaded) return true;
    return this.running.has(t.location.key) || this.pending.has(t.location.key);
  }

  getMeta(key: TrainKey) {
    const meta = this.meta.get(key);
    // Metro runs learn their end stations once the network has loaded.
    if (meta?.metro && !meta.origin && this.metro) {
      const termini = terminiOf(this.metro, meta.metro.line, meta.metro.direction);
      if (termini) {
        meta.origin = { code: termini.first, time: '' };
        meta.destination = { code: termini.last, time: '' };
      }
    }
    return meta;
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

export const stationName = (code: string) =>
  trainStore.stations.get(code)?.name ?? trainStore.metro?.stations.get(code)?.name ?? code;
