import { useEffect, useRef, useState, type ReactNode } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapLibre } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { mapStyle } from './style';
import {
  addMetroLayers,
  addStationLayers,
  addTrainLayers,
  dotRadiusAt,
  METRO_LAYERS,
  METRO_SOURCE,
  STATION_SOURCE,
  setFocusedTrain,
  stationsToGeoJson,
  TRAIN_HIT_LAYER,
  TRAIN_SOURCE,
  type TrainFeatureProps,
} from './layers';
import { trainStore, useTrainStore } from '../data/trainStore';
import type { Category, TrainKey } from '../data/types';
import { isLate, mapLabel } from '../lib/format';

/** Delays are marked for passenger trains only: freight runs off timetable so often
 * that the rings would drown out the ones people care about. */
const isLateForMap = (cat: Category, delay: number | null | undefined) =>
  (cat === 'long-distance' || cat === 'commuter') && isLate(delay);

// The rail network, Hanko to Kolari, rather than all of Finland: the far north has no lines.
const RAIL_NETWORK: [[number, number], [number, number]] = [
  [21.0, 59.8],
  [30.6, 67.5],
];

/** Update the map's train layer at most this often; the selected train and camera move every frame. */
const FRAME_MS = 1000 / 30;
/** How quickly a followed train's camera catches up: time constant of an exponential glide. */
const FOLLOW_MS = 250;

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
  const focus = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [loaded, setLoaded] = useState(false);
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
    if (import.meta.env.DEV || import.meta.env.MODE === 'artifact') Object.assign(window, { __map: map, __trains: trainStore });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    const attribution = new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          'Junat: <a href="https://www.digitraffic.fi/" target="_blank">Fintraffic / digitraffic.fi</a>, CC BY 4.0 | Metro: <a href="https://www.hsl.fi/avoindata" target="_blank">HSL</a>, CC BY 4.0',
    });
    map.addControl(attribution, 'bottom-left');
    // Start collapsed behind the (i) button; the credits are long.
    const collapseAttribution = () =>
      map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');

    let userMarker: maplibregl.Marker | null = null;
    let hovered: TrainKey | null = null;
    const setHover = (key: TrainKey | null, value: boolean) => {
      if (key && map.getSource(TRAIN_SOURCE)) map.setFeatureState({ source: TRAIN_SOURCE, id: key }, { hover: value });
    };

    map.on('load', () => {
      collapseAttribution();
      addMetroLayers(map);
      addStationLayers(map);
      addTrainLayers(map);
      (map.getSource(STATION_SOURCE) as GeoJSONSource).setData(stationsToGeoJson(trainStore.stations.values()));
      if (trainStore.metro) (map.getSource(METRO_SOURCE) as GeoJSONSource).setData(trainStore.metro.geojson);
      setLoaded(true);
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
      setHover(hovered, false);
      setHover(key, true);
      hovered = key;
      latest.current.onHover(key);
    });
    map.on('mouseleave', TRAIN_HIT_LAYER, () => {
      map.getCanvas().style.cursor = '';
      setHover(hovered, false);
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

    // Animation loop. The map's train layer is rebuilt at 30 fps; its data goes
    // through a worker and shows up a frame or two later. The camera, the
    // selected train and its card are moved every frame, all in this one
    // callback, so a followed train sits still on screen while the map moves.
    let frame = 0;
    let lastFrame = performance.now();
    let lastData = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(now - lastFrame, 100);
      lastFrame = now;
      const source = map.getSource(TRAIN_SOURCE) as GeoJSONSource | undefined;
      if (!source) return;
      const { hidden, following, selectedKey, cardKey, padding } = latest.current;

      if (now - lastData >= FRAME_MS) {
        lastData = now;
        const features: GeoJSON.Feature<GeoJSON.Point, TrainFeatureProps>[] = [];
        for (const t of trainStore.visible(now)) {
          const cat = t.meta?.category ?? 'other';
          if (hidden.has(cat) && t.key !== selectedKey) continue;
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: t.position },
            properties: {
              key: t.key,
              cat,
              label: mapLabel(t.meta, t.location.trainNumber),
              late: isLateForMap(cat, t.meta?.delay),
            },
          });
        }
        source.setData({ type: 'FeatureCollection', features });
      }

      const selected = selectedKey ? trainStore.getDrawnPosition(selectedKey, now) : undefined;

      // Glide the camera toward the train rather than pinning it: the glide is
      // smooth whatever the frame rate, and eases in when following starts or
      // the sheet changes the padding. Paused while the user pinches or zooms.
      if (following && selected && !map.isMoving()) {
        const k = 1 - Math.exp(-dt / FOLLOW_MS);
        const center = map.getCenter();
        const { right = 0, bottom = 0 } = map.getPadding();
        map.jumpTo({
          center: [center.lng + (selected[0] - center.lng) * k, center.lat + (selected[1] - center.lat) * k],
          padding: {
            top: 0,
            left: 0,
            right: right + (padding.right - right) * k,
            bottom: bottom + (padding.bottom - bottom) * k,
          },
        });
      }

      const focusEl = focus.current;
      if (focusEl) {
        const meta = selectedKey ? trainStore.getMeta(selectedKey) : undefined;
        if (selected && selectedKey) {
          const p = map.project(selected);
          const cat = meta?.category ?? 'other';
          focusEl.style.transform = `translate(${p.x}px, ${p.y}px)`;
          focusEl.style.setProperty('--r', `${dotRadiusAt(map.getZoom())}px`);
          focusEl.dataset.cat = cat;
          focusEl.dataset.late = String(isLateForMap(cat, meta?.delay));
          const label = map.getZoom() >= 9 ? mapLabel(meta, Number(selectedKey.split('/')[1])) : '';
          if (focusEl.lastElementChild!.textContent !== label) focusEl.lastElementChild!.textContent = label;
          focusEl.hidden = false;
        } else {
          focusEl.hidden = true;
        }
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

  // Stations and the metro network may arrive after the map has loaded.
  useEffect(() => {
    const map = mapRef.current;
    (map?.getSource(STATION_SOURCE) as GeoJSONSource | undefined)?.setData(
      stationsToGeoJson(trainStore.stations.values()),
    );
    if (trainStore.metro) (map?.getSource(METRO_SOURCE) as GeoJSONSource | undefined)?.setData(trainStore.metro.geojson);
  }, [version, loaded]);

  // Hiding the metro hides its lines and stations too, not just the trains.
  const metroHidden = props.hidden.has('metro');
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    for (const id of METRO_LAYERS) map.setLayoutProperty(id, 'visibility', metroHidden ? 'none' : 'visible');
  }, [metroHidden, loaded]);

  const { selectedKey, padding, following } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (map && loaded) setFocusedTrain(map, selectedKey);
  }, [selectedKey, loaded]);

  // While following, the animation loop eases the padding along with the camera.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || following) return;
    map.easeTo({ padding: { top: 0, left: 0, right: padding.right, bottom: padding.bottom }, duration: 300 });
  }, [padding.right, padding.bottom, following]);

  return (
    <div className="map-wrap">
      <div className="map" ref={container} />
      <div className="focus-train" ref={focus} hidden aria-hidden>
        <span className="focus-dot" />
        <span className="focus-label" />
      </div>
      <div className="card-anchor" ref={anchor} hidden>
        {props.card}
      </div>
    </div>
  );
}
