import { useEffect, useRef, useState, type ReactNode } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapLibre } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { mapStyle } from './style';
import {
  addAircraftLayers,
  addStationLayers,
  addTrainLayers,
  addTransitLayers,
  AIR_HIT_LAYER,
  AIR_SOURCE,
  dotRadiusAt,
  STATION_SOURCE,
  setFocusedTrain,
  stationsToGeoJson,
  TRAIN_HIT_LAYER,
  TRAIN_SOURCE,
  transitLayers,
  transitSource,
  type AircraftFeatureProps,
  type TrainFeatureProps,
} from './layers';
import { AIR_AREA } from '../data/air';
import { trainStore, useTrainStore } from '../data/trainStore';
import type { Category, NetworkId, TrainKey } from '../data/types';
import { isLate, mapLabel } from '../lib/format';

/** Delays are marked for passenger trains and trams. Freight runs off timetable so
 * often that the rings would drown out the ones people care about, and the metro
 * feed has no delays. */
const isLateForMap = (cat: Category, delay: number | null | undefined) =>
  (cat === 'long-distance' || cat === 'commuter' || cat === 'tram') && isLate(delay);

/** The same outline as the map's aircraft icon (layers.ts), for the selected aircraft. */
const PLANE_PATH =
  'M0 -11 L1.6 -9 L1.6 -3 L10.5 2.5 L10.5 4.5 L1.6 1.5 L1.4 7 L4.5 9.5 L4.5 11 L0 9.8 L-4.5 11 L-4.5 9.5 L-1.4 7 L-1.6 1.5 L-10.5 4.5 L-10.5 2.5 L-1.6 -3 L-1.6 -9 Z';

const NETWORKS: NetworkId[] = ['tram-helsinki', 'tram-tampere', 'metro'];

/** Aircraft are fetched only when the map shows Helsinki-Vantaa's surroundings this closely. */
const AIR_MIN_ZOOM = 7.5;

function airInView(map: MapLibre) {
  if (map.getZoom() < AIR_MIN_ZOOM) return false;
  const b = map.getBounds();
  return b.getWest() < AIR_AREA.east && b.getEast() > AIR_AREA.west && b.getSouth() < AIR_AREA.north && b.getNorth() > AIR_AREA.south;
}

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
          'Junat: <a href="https://www.digitraffic.fi/" target="_blank">Fintraffic / digitraffic.fi</a>, CC BY 4.0 | Metro ja raitiovaunut: <a href="https://www.hsl.fi/avoindata" target="_blank">HSL</a>, <a href="https://data.itsfactory.fi/" target="_blank">Nysse / ITS Factory</a>, CC BY 4.0 | Lentokoneet: <a href="https://avioadsb.org/" target="_blank">AvioADSB</a>, CC BY-NC 4.0',
    });
    map.addControl(attribution, 'bottom-left');
    // Start collapsed behind the (i) button; the credits are long.
    const collapseAttribution = () =>
      map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');

    let userMarker: maplibregl.Marker | null = null;
    let hovered: TrainKey | null = null;
    let hoveredSource = TRAIN_SOURCE;
    const setHover = (key: TrainKey | null, value: boolean) => {
      if (key && map.getSource(hoveredSource)) map.setFeatureState({ source: hoveredSource, id: key }, { hover: value });
    };

    map.on('load', () => {
      collapseAttribution();
      for (const id of NETWORKS) addTransitLayers(map, id);
      addStationLayers(map);
      addTrainLayers(map);
      addAircraftLayers(map);
      setLoaded(true);
      updateAirWanted();
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
    for (const [layer, source] of [
      [TRAIN_HIT_LAYER, TRAIN_SOURCE],
      [AIR_HIT_LAYER, AIR_SOURCE],
    ]) {
      map.on('mousemove', layer, (e) => {
        if (!hoverCapable) return;
        const key = (e.features?.[0]?.properties as { key?: string } | undefined)?.key ?? null;
        map.getCanvas().style.cursor = key ? 'pointer' : '';
        if (key === hovered) return;
        setHover(hovered, false);
        hovered = key;
        hoveredSource = source;
        setHover(key, true);
        latest.current.onHover(key);
      });
      map.on('mouseleave', layer, () => {
        map.getCanvas().style.cursor = '';
        setHover(hovered, false);
        hovered = null;
        latest.current.onHover(null);
      });
    }

    map.on('click', (e) => {
      // Several trains can be under a finger; take the one closest to it.
      const hits = map.queryRenderedFeatures(e.point, { layers: [TRAIN_HIT_LAYER, AIR_HIT_LAYER] });
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

    const updateAirWanted = () => trainStore.setAirWanted(!latest.current.hidden.has('air') && airInView(map));
    map.on('moveend', updateAirWanted);

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
        const aircraft: GeoJSON.Feature<GeoJSON.Point, AircraftFeatureProps>[] = [];
        for (const t of trainStore.visible(now)) {
          const cat = t.meta?.category ?? 'other';
          if (hidden.has(cat) && t.key !== selectedKey) continue;
          if (t.meta?.air) {
            aircraft.push({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: t.position },
              properties: {
                key: t.key,
                label: t.meta.air.callsign,
                track: t.meta.air.track ?? 0,
                ground: t.meta.air.altitude == null,
              },
            });
            continue;
          }
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
        (map.getSource(AIR_SOURCE) as GeoJSONSource).setData({ type: 'FeatureCollection', features: aircraft });
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
          focusEl.dataset.ground = String(meta?.air != null && meta.air.altitude == null);
          focusEl.style.setProperty('--track', `${meta?.air?.track ?? 0}deg`);
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

  // Stations and the metro and tram networks may arrive after the map has loaded.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource(STATION_SOURCE) as GeoJSONSource).setData(stationsToGeoJson(trainStore.stations.values()));
    for (const [id, network] of trainStore.networks) {
      (map.getSource(transitSource(id)) as GeoJSONSource).setData(network.geojson);
    }
  }, [version, loaded]);

  const airHidden = props.hidden.has('air');
  useEffect(() => {
    const map = mapRef.current;
    if (map && loaded) trainStore.setAirWanted(!airHidden && airInView(map));
  }, [airHidden, loaded]);

  // Hiding the metro or trams hides their lines and stops too, not just the vehicles.
  const metroHidden = props.hidden.has('metro');
  const tramsHidden = props.hidden.has('tram');
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    for (const id of NETWORKS) {
      const hidden = id === 'metro' ? metroHidden : tramsHidden;
      for (const layer of transitLayers(id)) map.setLayoutProperty(layer, 'visibility', hidden ? 'none' : 'visible');
    }
  }, [metroHidden, tramsHidden, loaded]);

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
        <svg className="focus-plane" viewBox="-13 -13 26 26">
          <path d={PLANE_PATH} />
        </svg>
        <span className="focus-label" />
      </div>
      <div className="card-anchor" ref={anchor} hidden>
        {props.card}
      </div>
    </div>
  );
}
