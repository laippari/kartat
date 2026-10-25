import { useEffect, useRef, type ReactNode } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapLibre } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { mapStyle } from './style';
import {
  addStationLayers,
  addTrainLayers,
  STATION_SOURCE,
  stationsToGeoJson,
  TRAIN_HIT_LAYER,
  TRAIN_SOURCE,
  type TrainFeatureProps,
} from './layers';
import { trainStore, useTrainStore } from '../data/trainStore';
import type { Category, TrainKey } from '../data/types';
import { isLate, mapLabel } from '../lib/format';

// The rail network, Hanko to Kolari, rather than all of Finland: the far north has no lines.
const RAIL_NETWORK: [[number, number], [number, number]] = [
  [21.0, 59.8],
  [30.6, 67.5],
];

/** Redraw at most this often; GPS fixes arrive every few seconds anyway. */
const FRAME_MS = 1000 / 30;

export interface MapPadding {
  right: number;
  bottom: number;
}

export interface MapApi {
  zoomIn(): void;
  zoomOut(): void;
  flyTo(lngLat: [number, number], zoom?: number): void;
  showTrain(key: TrainKey): void;
  showUser(lngLat: [number, number]): void;
}

interface Props {
  selectedKey: TrainKey | null;
  /** The train the floating card belongs to; the card follows it on screen. */
  cardKey: TrainKey | null;
  card: ReactNode;
  hidden: ReadonlySet<Category>;
  following: boolean;
  padding: MapPadding;
  onHover(key: TrainKey | null): void;
  onSelect(key: TrainKey | null): void;
  onUserMove(): void;
  onReady(api: MapApi): void;
}

export function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const { version } = useTrainStore();

  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: mapStyle,
      bounds: RAIL_NETWORK,
      fitBoundsOptions: { padding: 24 },
      minZoom: 3.5,
      maxZoom: 17,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
    });
    mapRef.current = map;
    // Handle for poking at the map from the console while developing and testing.
    if (import.meta.env.DEV || import.meta.env.MODE === 'artifact') Object.assign(window, { __map: map });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    const attribution = new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          'Junat: <a href="https://www.digitraffic.fi/" target="_blank">Fintraffic / digitraffic.fi</a>, CC BY 4.0',
    });
    map.addControl(attribution, 'bottom-left');
    // Start collapsed behind the (i) button; the credits are long.
    const collapseAttribution = () =>
      map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');

    let userMarker: maplibregl.Marker | null = null;
    let hovered: TrainKey | null = null;
    const setState = (key: TrainKey | null, state: 'hover' | 'selected', value: boolean) => {
      if (key && map.getSource(TRAIN_SOURCE)) map.setFeatureState({ source: TRAIN_SOURCE, id: key }, { [state]: value });
    };

    map.on('load', () => {
      collapseAttribution();
      addStationLayers(map);
      addTrainLayers(map);
      (map.getSource(STATION_SOURCE) as GeoJSONSource).setData(stationsToGeoJson(trainStore.stations.values()));
      latest.current.onReady({
        zoomIn: () => map.zoomIn(),
        zoomOut: () => map.zoomOut(),
        flyTo: (center, zoom) => map.flyTo({ center, zoom: zoom ?? Math.max(map.getZoom(), 11) }),
        showTrain: (key) => {
          const position = trainStore.getDrawnPosition(key);
          if (position) map.easeTo({ center: position, zoom: Math.max(map.getZoom(), 9), duration: 700 });
        },
        showUser: (lngLat) => {
          if (!userMarker) {
            const el = document.createElement('div');
            el.className = 'user-marker';
            userMarker = new maplibregl.Marker({ element: el });
          }
          userMarker.setLngLat(lngLat).addTo(map);
          map.flyTo({ center: lngLat, zoom: Math.max(map.getZoom(), 10.5) });
        },
      });
    });

    const hoverCapable = window.matchMedia('(hover: hover)').matches;
    map.on('mousemove', TRAIN_HIT_LAYER, (e) => {
      if (!hoverCapable) return;
      const key = (e.features?.[0]?.properties as TrainFeatureProps | undefined)?.key ?? null;
      map.getCanvas().style.cursor = key ? 'pointer' : '';
      if (key === hovered) return;
      setState(hovered, 'hover', false);
      setState(key, 'hover', true);
      hovered = key;
      latest.current.onHover(key);
    });
    map.on('mouseleave', TRAIN_HIT_LAYER, () => {
      map.getCanvas().style.cursor = '';
      setState(hovered, 'hover', false);
      hovered = null;
      latest.current.onHover(null);
    });

    map.on('click', (e) => {
      // Several trains can be under a finger; take the one closest to it.
      const hits = map.queryRenderedFeatures(e.point, { layers: [TRAIN_HIT_LAYER] });
      let best: TrainKey | null = null;
      let bestDistance = Infinity;
      for (const f of hits) {
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        const p = map.project([lng, lat]);
        const d = Math.hypot(p.x - e.point.x, p.y - e.point.y);
        if (d < bestDistance) {
          bestDistance = d;
          best = (f.properties as TrainFeatureProps).key;
        }
      }
      latest.current.onSelect(best);
    });

    map.on('dragstart', () => latest.current.onUserMove());

    // Animation loop: move the dots, keep the camera on a followed train and
    // keep the floating card pinned above its train.
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < FRAME_MS) return;
      last = now;
      const source = map.getSource(TRAIN_SOURCE) as GeoJSONSource | undefined;
      if (!source) return;
      const { hidden, following, selectedKey, cardKey } = latest.current;

      const features: GeoJSON.Feature<GeoJSON.Point, TrainFeatureProps>[] = [];
      for (const t of trainStore.visible(now)) {
        const cat = t.meta?.category ?? 'other';
        if (hidden.has(cat) && t.key !== selectedKey) continue;
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: t.position },
          properties: { key: t.key, cat, label: mapLabel(t.meta, t.location.trainNumber), late: isLate(t.meta?.delay) },
        });
      }
      source.setData({ type: 'FeatureCollection', features });

      if (following && selectedKey) {
        const position = trainStore.getDrawnPosition(selectedKey, now);
        if (position && !map.isMoving()) map.jumpTo({ center: position });
      }

      const el = anchor.current;
      const position = cardKey ? trainStore.getDrawnPosition(cardKey, now) : undefined;
      if (el) {
        if (position) {
          const p = map.project(position);
          // Slide the card sideways rather than let it run off the screen edge.
          const cardWidth = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0;
          const width = map.getContainer().clientWidth;
          const shift = Math.min(Math.max(p.x, cardWidth / 2 + 8), width - cardWidth / 2 - 8) - p.x;
          el.style.transform = `translate(${p.x}px, ${p.y}px)`;
          el.style.setProperty('--shift', `${shift}px`);
          el.dataset.placement = p.y < 180 ? 'below' : 'above';
          el.hidden = false;
        } else {
          el.hidden = true;
        }
      }
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Stations arrive after the map has loaded on a slow connection.
  useEffect(() => {
    const source = mapRef.current?.getSource(STATION_SOURCE) as GeoJSONSource | undefined;
    source?.setData(stationsToGeoJson(trainStore.stations.values()));
  }, [version]);

  const { selectedKey, padding, following } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedKey) return;
    const set = (value: boolean) => {
      if (map.getSource(TRAIN_SOURCE)) map.setFeatureState({ source: TRAIN_SOURCE, id: selectedKey }, { selected: value });
    };
    set(true);
    return () => set(false);
  }, [selectedKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const next = { top: 0, left: 0, right: padding.right, bottom: padding.bottom };
    if (following) map.easeTo({ padding: next, duration: 400 });
    else map.setPadding(next);
  }, [padding.right, padding.bottom, following]);

  return (
    <div className="map-wrap">
      <div className="map" ref={container} />
      <div className="card-anchor" ref={anchor} hidden>
        {props.card}
      </div>
    </div>
  );
}
