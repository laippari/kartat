import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';
import { palette as c } from '../styles/palette';

// A quiet base map: rails carry the picture, everything else stays in the
// background. Vector tiles from OpenFreeMap (OpenMapTiles schema).

const name: ExpressionSpecification = ['coalesce', ['get', 'name:fi'], ['get', 'name:latin'], ['get', 'name']];
const isLine: ExpressionSpecification = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const isPolygon: ExpressionSpecification = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];

const regular = ['Noto Sans Regular'];
const bold = ['Noto Sans Bold'];

export const mapStyle: StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    base: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
      attribution:
        '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
    },
    // The whole network from the official register, simplified at build time
    // (scripts/build-rail-network.mjs). The base tiles drop branch lines such as
    // Hyvinkää–Hanko until zoomed in close, so this draws the overview instead.
    network: {
      type: 'geojson',
      data: '/data/rail-network.geojson',
      attribution: 'Rataverkko: Väylävirasto / digitraffic.fi, CC BY 4.0',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': c.paper } },
    {
      id: 'residential',
      type: 'fill',
      source: 'base',
      'source-layer': 'landuse',
      minzoom: 8,
      filter: ['all', isPolygon, ['match', ['get', 'class'], ['residential', 'suburb', 'neighbourhood'], true, false]],
      paint: { 'fill-color': c.paperDeep, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 10, 1] },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'base',
      'source-layer': 'water',
      filter: ['all', isPolygon, ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: { 'fill-color': c.water },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'base',
      'source-layer': 'waterway',
      minzoom: 9,
      filter: isLine,
      paint: { 'line-color': c.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 14, 2] },
    },
    {
      id: 'building',
      type: 'fill',
      source: 'base',
      'source-layer': 'building',
      minzoom: 14,
      paint: { 'fill-color': c.paperDeep, 'fill-outline-color': c.hairline },
    },
    {
      id: 'road-minor',
      type: 'line',
      source: 'base',
      'source-layer': 'transportation',
      minzoom: 12,
      filter: ['all', isLine, ['match', ['get', 'class'], ['minor', 'service', 'tertiary'], true, false]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c.road, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, 0.5, 18, 10] },
    },
    {
      id: 'road-major',
      type: 'line',
      source: 'base',
      'source-layer': 'transportation',
      minzoom: 6,
      filter: ['all', isLine, ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary'], true, false]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': c.road,
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 6, 0.4, 10, 1.4, 18, 16],
      },
    },
    {
      id: 'rail-service',
      type: 'line',
      source: 'base',
      'source-layer': 'transportation',
      minzoom: 12,
      filter: ['all', isLine, ['==', ['get', 'class'], 'rail'], ['has', 'service']],
      paint: { 'line-color': c.railMinor, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 1.5] },
    },
    {
      id: 'rail-transit',
      type: 'line',
      source: 'base',
      'source-layer': 'transportation',
      minzoom: 10,
      filter: ['all', isLine, ['==', ['get', 'class'], 'transit'], ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: { 'line-color': c.railMinor, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 16, 1.5] },
    },
    {
      id: 'rail-network',
      type: 'line',
      source: 'network',
      maxzoom: 11,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': c.rail,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 8, 1.1, 11, 1.6],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 1, 11, 0],
      },
    },
    {
      // Close up, the detailed OpenStreetMap tracks match the GPS positions better.
      id: 'rail',
      type: 'line',
      source: 'base',
      'source-layer': 'transportation',
      minzoom: 10,
      filter: ['all', isLine, ['==', ['get', 'class'], 'rail'], ['!', ['has', 'service']]],
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': c.rail,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.4, 12, 1.6, 16, 2.5],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 11, 1],
      },
    },
    {
      id: 'boundary-country',
      type: 'line',
      source: 'base',
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': c.muted, 'line-width': 0.8, 'line-dasharray': [3, 2], 'line-opacity': 0.6 },
    },
    {
      id: 'place-village',
      type: 'symbol',
      source: 'base',
      'source-layer': 'place',
      minzoom: 11,
      filter: ['match', ['get', 'class'], ['village', 'suburb'], true, false],
      layout: { 'text-field': name, 'text-font': regular, 'text-size': 11 },
      paint: { 'text-color': c.muted, 'text-halo-color': c.paper, 'text-halo-width': 1.5 },
    },
    {
      id: 'place-town',
      type: 'symbol',
      source: 'base',
      'source-layer': 'place',
      minzoom: 8,
      filter: ['==', ['get', 'class'], 'town'],
      layout: { 'text-field': name, 'text-font': regular, 'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 13, 14] },
      paint: { 'text-color': c.muted, 'text-halo-color': c.paper, 'text-halo-width': 1.5 },
    },
    {
      id: 'place-city',
      type: 'symbol',
      source: 'base',
      'source-layer': 'place',
      minzoom: 4,
      filter: ['==', ['get', 'class'], 'city'],
      layout: {
        'text-field': name,
        'text-font': regular,
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 10, 15],
        'text-letter-spacing': 0.02,
      },
      paint: { 'text-color': c.inkSoft, 'text-halo-color': c.paper, 'text-halo-width': 1.5 },
    },
    {
      id: 'place-country',
      type: 'symbol',
      source: 'base',
      'source-layer': 'place',
      maxzoom: 7,
      filter: ['==', ['get', 'class'], 'country'],
      layout: {
        'text-field': ['upcase', name],
        'text-font': bold,
        'text-size': 11,
        'text-letter-spacing': 0.25,
      },
      paint: { 'text-color': c.muted, 'text-halo-color': c.paper, 'text-halo-width': 1.5 },
    },
  ],
};

export const fonts = { regular, bold };
