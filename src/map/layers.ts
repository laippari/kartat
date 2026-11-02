import type { ExpressionSpecification, Map as MapLibre } from 'maplibre-gl';
import { palette as c } from '../styles/palette';
import { fonts } from './style';
import type { Category, Station } from '../data/types';

export const TRAIN_SOURCE = 'trains';
export const STATION_SOURCE = 'stations';
export const METRO_SOURCE = 'metro';
export const METRO_LAYERS = ['metro-line', 'metro-stations'];
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
const DOT_RADIUS: [number, number][] = [
  [4, 3.3],
  [6, 4],
  [8, 4.8],
  [10, 6],
  [12, 7.5],
  [14, 9.5],
  [16, 11],
];
const dotRadius = zoomed(DOT_RADIUS);
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
  text ? c.spruceText : c.spruce,
  'metro',
  text ? c.ruskaText : c.ruska,
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

/** The metro lines and stations, drawn under everything that moves. */
export function addMetroLayers(map: MapLibre) {
  map.addSource(METRO_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'metro-line',
    type: 'line',
    source: METRO_SOURCE,
    minzoom: 8,
    // Each line is stored once per direction; one is enough to draw.
    filter: ['all', ['==', ['get', 'kind'], 'line'], ['==', ['get', 'direction'], 1]],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': c.ruska,
      'line-width': zoomed([
        [8, 1],
        [11, 2.2],
        [14, 3.5],
        [17, 5],
      ]),
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.4, 10, 0.75],
    },
  });
  const icon = stationIcon(7, c.ruska);
  map.addImage('station-metro', icon.image, icon.options);
  map.addLayer({
    id: 'metro-stations',
    type: 'symbol',
    source: METRO_SOURCE,
    minzoom: 10,
    filter: ['==', ['get', 'kind'], 'station'],
    layout: {
      'icon-image': 'station-metro',
      'icon-size': zoomed([
        [10, 0.75],
        [13, 1],
        [16, 1.2],
      ]),
      'icon-allow-overlap': true,
      'text-field': ['step', ['zoom'], '', 12, ['get', 'name']],
      'text-font': fonts.regular,
      'text-size': zoomed([
        [12, 11],
        [15, 13],
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

  const selected: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];
  const hovered: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false];

  // Heather disc and ring around the selected train; a faint grey one on hover.
  map.addLayer({
    id: 'trains-halo',
    type: 'circle',
    source: TRAIN_SOURCE,
    paint: {
      'circle-radius': ringRadius(7),
      'circle-color': ['case', selected, c.heather, c.ink],
      'circle-opacity': ['case', selected, 0.16, hovered, 0.08, 0],
      'circle-stroke-color': c.heather,
      'circle-stroke-width': 1.5,
      'circle-stroke-opacity': ['case', selected, 0.9, 0],
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

export interface TrainFeatureProps {
  key: string;
  cat: Category;
  label: string;
  late: boolean;
}
