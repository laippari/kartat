import type { ExpressionSpecification, Map as MapLibre } from 'maplibre-gl';
import { palette as c } from '../styles/palette';
import { fonts } from './style';
import type { Category, Station } from '../data/types';

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

const dotRadius = zoomed([
  [4, 2.2],
  [6, 3],
  [8, 4],
  [11, 6],
  [14, 8],
]);

const isFilled: ExpressionSpecification = ['match', ['get', 'cat'], ['long-distance', 'commuter'], true, false];

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
    const icon = stationIcon(8, passenger ? c.inkSoft : c.rail);
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
          [8, 0.7],
          [12, 1],
          [16, 1.3],
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

  // Soft disc behind the hovered or selected train.
  map.addLayer({
    id: 'trains-halo',
    type: 'circle',
    source: TRAIN_SOURCE,
    paint: {
      'circle-radius': zoomed([
        [4, 9],
        [8, 12],
        [14, 18],
      ]),
      'circle-color': c.ink,
      'circle-opacity': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        0.16,
        ['boolean', ['feature-state', 'hover'], false],
        0.09,
        0,
      ],
      'circle-opacity-transition': { duration: 150 },
    },
  });

  map.addLayer({
    id: 'trains-dot',
    type: 'circle',
    source: TRAIN_SOURCE,
    paint: {
      'circle-radius': dotRadius,
      'circle-color': ['match', ['get', 'cat'], 'long-distance', c.ink, 'commuter', c.commuter, c.paper],
      'circle-stroke-color': [
        'case',
        ['get', 'late'],
        c.signal,
        isFilled,
        c.paper,
        ['==', ['get', 'cat'], 'cargo'],
        c.ink,
        c.muted,
      ],
      'circle-stroke-width': ['case', ['get', 'late'], 2, isFilled, 1, 1.4],
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
      'text-offset': [0.9, 0],
      'text-optional': true,
    },
    paint: { 'text-color': c.ink, 'text-halo-color': c.paper, 'text-halo-width': 1.6 },
  });

  map.addLayer({
    id: TRAIN_HIT_LAYER,
    type: 'circle',
    source: TRAIN_SOURCE,
    paint: { 'circle-radius': 16, 'circle-opacity': 0 },
  });
}

export interface TrainFeatureProps {
  key: string;
  cat: Category;
  label: string;
  late: boolean;
}
