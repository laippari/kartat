import type { ExpressionSpecification, Map as MapLibre } from 'maplibre-gl';
import { palette as c } from '../styles/palette';
import { fonts } from './style';
import type { Category, NetworkId, Station } from '../data/types';

export const TRAIN_SOURCE = 'trains';
export const STATION_SOURCE = 'stations';
/** Invisible, generously sized circles that make small dots easy to hover and tap. */
export const TRAIN_HIT_LAYER = 'trains-hit';

const zoomed = (stops: [number, number][]): ExpressionSpecification => [
  'interpolate',
  ['linear'],
  ['zoom'],
  ...stops.flat(),
];

// Trains grow faster than stations as you zoom in, so up close they read as
// vehicles and the stations as small markers on the line.
export const DOT_RADIUS: [number, number][] = [
  [4, 3.3],
  [6, 4],
  [8, 4.8],
  [10, 6],
  [12, 7.5],
  [14, 9.5],
  [16, 11],
];
const dotRadius = zoomed(DOT_RADIUS);

/** The same radius as the map draws, for a dot drawn outside the map. */
export function dotRadiusAt(zoom: number) {
  const i = DOT_RADIUS.findIndex(([z]) => z > zoom);
  if (i === 0) return DOT_RADIUS[0][1];
  if (i === -1) return DOT_RADIUS[DOT_RADIUS.length - 1][1];
  const [z1, r1] = DOT_RADIUS[i - 1];
  const [z2, r2] = DOT_RADIUS[i];
  return r1 + ((r2 - r1) * (zoom - z1)) / (z2 - z1);
}
/** A radius a few pixels outside the dot, for rings drawn around it. */
const ringRadius = (extra: number) => zoomed(DOT_RADIUS.map(([z, r]) => [z, r + extra]));

const categoryColor = (other: string, text = false): ExpressionSpecification => [
  'match',
  ['get', 'cat'],
  'long-distance',
  c.ink,
  'commuter',
  text ? c.lakeText : c.lake,
  'cargo',
  c.kaarna,
  'metro',
  text ? c.ruskaText : c.ruska,
  'tram',
  text ? c.spruceText : c.spruce,
  other,
];

/** A small square: stations read as stops on the line, not as trains. */
function stationIcon(size: number, stroke: string) {
  const ratio = 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * ratio;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(ratio, ratio);
  ctx.fillStyle = c.paper;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeRect(0.75, 0.75, size - 1.5, size - 1.5);
  return { image: ctx.getImageData(0, 0, size * ratio, size * ratio), options: { pixelRatio: ratio } };
}

export function addStationLayers(map: MapLibre) {
  map.addSource(STATION_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  // Passenger stations appear first; other operating points (sidings, junctions
  // such as Nummela on the Hanko line) only once zoomed in close.
  for (const passenger of [false, true]) {
    const id = passenger ? 'passenger' : 'other';
    const icon = stationIcon(7, passenger ? c.inkSoft : c.rail);
    map.addImage(`station-${id}`, icon.image, icon.options);
    map.addLayer({
      id: `stations-${id}`,
      type: 'symbol',
      source: STATION_SOURCE,
      minzoom: passenger ? 8 : 11,
      filter: ['==', ['get', 'passenger'], passenger],
      layout: {
        'icon-image': `station-${id}`,
        'icon-size': zoomed([
          [8, 0.75],
          [12, 1],
          [16, 1.2],
        ]),
        'icon-allow-overlap': true,
        'text-field': ['step', ['zoom'], '', passenger ? 9 : 12, ['get', 'name']],
        'text-font': fonts.regular,
        'text-size': zoomed([
          [9, 10.5],
          [14, 13],
        ]),
        'text-anchor': 'top',
        'text-offset': [0, 0.7],
        'text-optional': true,
      },
      paint: {
        'text-color': passenger ? c.inkSoft : c.muted,
        'text-halo-color': c.paper,
        'text-halo-width': 1.5,
      },
    });
  }
}

interface TransitStyle {
  color: string;
  /** Opaque, so overlapping route variants don't darken where they share track. */
  lineColor: string;
  lineWidth: [number, number][];
  lineFrom: number;
  stopsFrom: number;
  namesFrom: number;
  /** Draw one direction only, where both run on the same line. */
  oneDirection: boolean;
}

const METRO_STYLE: TransitStyle = {
  color: c.ruska,
  lineColor: c.ruskaLine,
  lineWidth: [
    [8, 1],
    [11, 2.2],
    [14, 3.5],
    [17, 5],
  ],
  lineFrom: 8,
  stopsFrom: 10,
  namesFrom: 12,
  oneDirection: true,
};

const TRAM_STYLE: TransitStyle = {
  color: c.spruce,
  lineColor: c.spruceLine,
  lineWidth: [
    [10, 0.6],
    [13, 1.6],
    [16, 3],
  ],
  lineFrom: 10,
  stopsFrom: 14,
  namesFrom: 15,
  oneDirection: false,
};

export const transitSource = (id: NetworkId) => `transit-${id}`;
export const transitLayers = (id: NetworkId) => [`${id}-line`, `${id}-stops`];

/** A metro or tram network's lines and stops, drawn under everything that moves. */
export function addTransitLayers(map: MapLibre, id: NetworkId) {
  const style = id === 'metro' ? METRO_STYLE : TRAM_STYLE;
  const source = transitSource(id);
  map.addSource(source, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const isLine: ExpressionSpecification = ['==', ['get', 'kind'], 'line'];
  map.addLayer({
    id: `${id}-line`,
    type: 'line',
    source,
    minzoom: style.lineFrom,
    filter: style.oneDirection ? ['all', isLine, ['==', ['get', 'direction'], 1]] : isLine,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': style.lineColor, 'line-width': zoomed(style.lineWidth) },
  });
  const image = `stop-${id}`;
  if (!map.hasImage(image)) {
    const icon = stationIcon(7, style.color);
    map.addImage(image, icon.image, icon.options);
  }
  map.addLayer({
    id: `${id}-stops`,
    type: 'symbol',
    source,
    minzoom: style.stopsFrom,
    filter: ['==', ['get', 'kind'], 'station'],
    layout: {
      'icon-image': image,
      'icon-size': zoomed([
        [style.stopsFrom, 0.75],
        [style.stopsFrom + 3, 1],
        [style.stopsFrom + 6, 1.2],
      ]),
      'icon-allow-overlap': true,
      'text-field': ['step', ['zoom'], '', style.namesFrom, ['get', 'name']],
      'text-font': fonts.regular,
      'text-size': zoomed([
        [style.namesFrom, 11],
        [style.namesFrom + 3, 13],
      ]),
      'text-anchor': 'top',
      'text-offset': [0, 0.7],
      'text-optional': true,
    },
    paint: { 'text-color': c.inkSoft, 'text-halo-color': c.paper, 'text-halo-width': 1.5 },
  });
}

export function stationsToGeoJson(stations: Iterable<Station>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: Array.from(stations, (s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: { name: s.name, passenger: s.passenger },
    })),
  };
}

export function addTrainLayers(map: MapLibre) {
  map.addSource(TRAIN_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    promoteId: 'key',
  });

  // A faint disc behind the train under the pointer. The selected train is
  // drawn outside the map instead (see MapView), with its heather ring.
  map.addLayer({
    id: 'trains-halo',
    type: 'circle',
    source: TRAIN_SOURCE,
    paint: {
      'circle-radius': ringRadius(7),
      'circle-color': c.ink,
      'circle-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.08, 0],
    },
  });

  // A lingonberry ring, kept apart from the dot by its pale outline, marks a late train.
  map.addLayer({
    id: 'trains-late',
    type: 'circle',
    source: TRAIN_SOURCE,
    filter: ['get', 'late'],
    paint: { 'circle-radius': ringRadius(3), 'circle-color': c.lingon },
  });

  map.addLayer({
    id: 'trains-dot',
    type: 'circle',
    source: TRAIN_SOURCE,
    paint: {
      'circle-radius': dotRadius,
      'circle-color': categoryColor(c.paper),
      // Filled dots get a pale outline to lift them off the rails; the rest are hollow rings.
      'circle-stroke-color': ['match', ['get', 'cat'], 'other', c.muted, c.paper],
      'circle-stroke-width': ['match', ['get', 'cat'], 'other', 1.6, 1.5],
    },
  });

  map.addLayer({
    id: 'trains-label',
    type: 'symbol',
    source: TRAIN_SOURCE,
    minzoom: 9,
    layout: {
      'text-field': ['get', 'label'],
      'text-font': fonts.bold,
      'text-size': zoomed([
        [9, 10.5],
        [14, 12.5],
      ]),
      'text-anchor': 'left',
      'text-offset': [1.1, 0],
      'text-optional': true,
    },
    paint: { 'text-color': categoryColor(c.muted, true), 'text-halo-color': c.paper, 'text-halo-width': 1.6 },
  });

  map.addLayer({
    id: TRAIN_HIT_LAYER,
    type: 'circle',
    source: TRAIN_SOURCE,
    paint: { 'circle-radius': ringRadius(12), 'circle-opacity': 0 },
  });
}

const TRAIN_VISUAL_LAYERS = ['trains-halo', 'trains-late', 'trains-dot', 'trains-label'];

/**
 * Leaves one train out of the map's own drawing, so it can be drawn in step
 * with the camera instead. It stays in the hit layer, so it can still be tapped.
 */
export function setFocusedTrain(map: MapLibre, key: string | null) {
  const others: ExpressionSpecification = ['!=', ['get', 'key'], key ?? ''];
  for (const id of TRAIN_VISUAL_LAYERS) {
    map.setFilter(id, id === 'trains-late' ? ['all', ['get', 'late'], others] : others);
  }
}

export interface TrainFeatureProps {
  key: string;
  cat: Category;
  label: string;
  late: boolean;
}
