import maplibregl, { type ExpressionSpecification, type StyleSpecification } from 'maplibre-gl';
import { palette as c } from '../styles/palette';
import { dataUrl } from './digitraffic';

// Stands in for src/map/style.ts in the artifact build. Same look, but drawn
// from files packed with the artifact (scripts/build-artifact-data.mjs), since
// the sandbox cannot reach the tile server: water, borders and place names
// from a simplified base map, the rail network, and the label fonts.

// Label fonts come base64-encoded in data/glyphs.json (artifacts don't serve .pbf).
let glyphs: Promise<Record<string, string>> | undefined;
maplibregl.addProtocol('glyphs', async ({ url }) => {
  glyphs ??= fetch(dataUrl('glyphs.json')).then((r) => r.json());
  const encoded = (await glyphs)[decodeURIComponent(url.slice('glyphs://'.length))];
  if (!encoded) return { data: new ArrayBuffer(0) };
  return { data: Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0)).buffer };
});

const regular = ['NotoRegular'];
const bold = ['NotoBold'];
const layer = (name: string): ExpressionSpecification => ['==', ['get', 'layer'], name];

export const mapStyle: StyleSpecification = {
  version: 8,
  glyphs: 'glyphs://{fontstack}/{range}',
  sources: {
    base: {
      type: 'geojson',
      data: dataUrl('basemap.geojson'),
      attribution:
        '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
    },
    network: {
      type: 'geojson',
      data: dataUrl('rail-network.geojson'),
      attribution: 'Rataverkko: Väylävirasto / digitraffic.fi, CC BY 4.0',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': c.paper } },
    { id: 'water', type: 'fill', source: 'base', filter: layer('water'), paint: { 'fill-color': c.water } },
    {
      id: 'rail-network',
      type: 'line',
      source: 'network',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': c.rail,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 8, 1.1, 12, 1.8, 16, 2.5],
      },
    },
    {
      id: 'boundary-country',
      type: 'line',
      source: 'base',
      filter: layer('boundary'),
      paint: { 'line-color': c.muted, 'line-width': 0.8, 'line-dasharray': [3, 2], 'line-opacity': 0.6 },
    },
    {
      id: 'place-village',
      type: 'symbol',
      source: 'base',
      minzoom: 10,
      filter: ['all', layer('place'), ['==', ['get', 'class'], 'village']],
      layout: { 'text-field': ['get', 'name'], 'text-font': regular, 'text-size': 11 },
      paint: { 'text-color': c.muted, 'text-halo-color': c.paper, 'text-halo-width': 1.5 },
    },
    {
      id: 'place-town',
      type: 'symbol',
      source: 'base',
      minzoom: 8,
      filter: ['all', layer('place'), ['==', ['get', 'class'], 'town']],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': regular,
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 13, 14],
      },
      paint: { 'text-color': c.muted, 'text-halo-color': c.paper, 'text-halo-width': 1.5 },
    },
    {
      id: 'place-city',
      type: 'symbol',
      source: 'base',
      minzoom: 4,
      filter: ['all', layer('place'), ['==', ['get', 'class'], 'city']],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': regular,
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 10, 15],
        'text-letter-spacing': 0.02,
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: { 'text-color': c.inkSoft, 'text-halo-color': c.paper, 'text-halo-width': 1.5 },
    },
    {
      id: 'place-country',
      type: 'symbol',
      source: 'base',
      maxzoom: 7,
      filter: ['all', layer('place'), ['==', ['get', 'class'], 'country']],
      layout: { 'text-field': ['upcase', ['get', 'name']], 'text-font': bold, 'text-size': 11, 'text-letter-spacing': 0.25 },
      paint: { 'text-color': c.muted, 'text-halo-color': c.paper, 'text-halo-width': 1.5 },
    },
  ],
};

export const fonts = { regular, bold };
