// Records a stretch of live rail traffic and packs everything the artifact
// build needs to run without network access: the artifact sandbox blocks
// requests to Digitraffic and to the tile server, so it replays this instead.
//
// Run: node scripts/build-artifact-data.mjs [--seconds 480] [--skip-map | --map-only]
// Behind a proxy on Node 22, prefix with NODE_USE_ENV_PROXY=1.
// Data: Fintraffic / digitraffic.fi (CC BY 4.0), OpenFreeMap / OpenMapTiles / OpenStreetMap.
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import mqtt from 'mqtt';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const OUT = new URL('../artifact/public/data/', import.meta.url);
const API = 'https://rata.digitraffic.fi/api';
const HEADERS = { 'Digitraffic-User': 'kartat/0.1' };

const args = process.argv.slice(2);
const seconds = Number(args[args.indexOf('--seconds') + 1]) || 480;
const skipMap = args.includes('--skip-map');
const mapOnly = args.includes('--map-only');

const write = (name, data) => writeFile(new URL(name, OUT), typeof data === 'string' ? data : JSON.stringify(data));

async function getJson(path, init) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}${path}`, { ...init, headers: { ...HEADERS, ...init?.headers } });
    if (res.ok) return res.json();
    if (attempt >= 4) throw new Error(`${res.status} ${path}`);
    await new Promise((r) => setTimeout(r, attempt * 3000));
  }
}

// Same fields as src/data/digitraffic.ts asks for, so the replay parses identically.
const RUNNING_TRAINS_QUERY = `{
  currentlyRunningTrains {
    trainNumber
    departureDate
    commuterLineid
    operator { shortCode }
    trainType { name trainCategory { name } }
    first: timeTableRows(take: 1) { station { shortCode } scheduledTime }
    last: timeTableRows(orderBy: { scheduledTime: DESCENDING }, take: 1) { station { shortCode } scheduledTime }
    latest: timeTableRows(where: { actualTime: { unequals: null } }, orderBy: { actualTime: DESCENDING }, take: 1) { differenceInMinutes }
  }
}`;

const runningTrains = async () =>
  (
    await getJson('/v2/graphql/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: RUNNING_TRAINS_QUERY }),
    })
  ).data.currentlyRunningTrains;

const keyOf = (t) => `${t.departureDate}/${t.trainNumber}`;

async function recordReplay() {
  const trainsAtStart = await runningTrains();
  const start = Date.now();
  const latest = await getJson('/v1/train-locations/latest/');
  console.log(`Recording ${seconds} s of train positions…`);

  const messages = [...latest];
  await new Promise((resolve, reject) => {
    const client = mqtt.connect('wss://rata.digitraffic.fi:443/mqtt', {
      clientId: `kartat-rec-${Math.random().toString(16).slice(2, 10)}`,
    });
    client.on('connect', () => client.subscribe('train-locations/#'));
    client.on('message', (_t, payload) => messages.push(JSON.parse(payload.toString())));
    client.on('error', reject);
    setTimeout(() => {
      client.end(true);
      resolve();
    }, seconds * 1000);
  });
  const end = Date.now();

  const trainsAtEnd = await runningTrains();
  const trains = new Map([...trainsAtStart, ...trainsAtEnd].map((t) => [keyOf(t), t]));
  await write('trains.json', [...trains.values()]);

  // Compact rows: [train index, ms from start, lng × 1e5, lat × 1e5, speed].
  const keys = [];
  const index = new Map();
  const row = (m) => {
    const key = keyOf(m);
    if (!index.has(key)) index.set(key, keys.push(key) - 1);
    const [lng, lat] = m.location.coordinates;
    return [index.get(key), Date.parse(m.timestamp) - start, Math.round(lng * 1e5), Math.round(lat * 1e5), m.speed];
  };
  const rows = messages.map(row).sort((a, b) => a[1] - b[1]);
  const initial = new Map();
  for (const r of rows) if (r[1] <= 0) initial.set(r[0], r);
  const seen = new Set();
  const updates = rows.filter((r) => {
    if (r[1] <= 0 || r[1] > end - start) return false;
    const id = `${r[0]}:${r[1]}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  await write('replay.json', { start, end, keys, initial: [...initial.values()], updates });
  console.log(`${keys.length} trains, ${updates.length} position updates`);

  console.log('Fetching timetables…');
  const timetables = {};
  const queue = [...trains.values()];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        const [train] = await getJson(`/v1/trains/${t.departureDate}/${t.trainNumber}`);
        if (!train) continue;
        timetables[keyOf(t)] = {
          trainNumber: train.trainNumber,
          departureDate: train.departureDate,
          operatorShortCode: train.operatorShortCode,
          trainType: train.trainType,
          trainCategory: train.trainCategory,
          commuterLineID: train.commuterLineID,
          runningCurrently: train.runningCurrently,
          cancelled: train.cancelled,
          timeTableRows: train.timeTableRows.map((r) => ({
            stationShortCode: r.stationShortCode,
            type: r.type,
            trainStopping: r.trainStopping,
            commercialStop: r.commercialStop,
            commercialTrack: r.commercialTrack,
            cancelled: r.cancelled,
            scheduledTime: r.scheduledTime,
            liveEstimateTime: r.liveEstimateTime,
            actualTime: r.actualTime,
            differenceInMinutes: r.differenceInMinutes,
            unknownDelay: r.unknownDelay,
          })),
        };
      }
    }),
  );
  await write('timetables.json', timetables);

  const stations = (await getJson('/v1/metadata/stations'))
    .filter((s) => s.countryCode === 'FI')
    .map(({ stationShortCode, stationName, passengerTraffic, countryCode, longitude, latitude }) => ({
      stationShortCode,
      stationName,
      passengerTraffic,
      countryCode,
      longitude,
      latitude,
    }));
  await write('stations.json', stations);
}

// ---------- Base map: vector tiles decoded into one small GeoJSON ----------

// z7 keeps the file small enough for a phone; lakes smaller than MIN_AREA are dropped.
const TILE_ZOOM = 7;
/** Square degrees, roughly 1 km² at these latitudes. */
const MIN_AREA = 0.0002;
/** Degrees; about 150–250 m, enough for an overview. */
const TOLERANCE = 0.0025;
const BOUNDS = { west: 16.5, south: 58.6, east: 33.5, north: 70.6 };
const tileX = (lng) => Math.floor(((lng + 180) / 360) * 2 ** TILE_ZOOM);
const tileY = (lat) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** TILE_ZOOM);
};
const round = (c) => (typeof c[0] === 'number' ? [Math.round(c[0] * 1e4) / 1e4, Math.round(c[1] * 1e4) / 1e4] : c.map(round));

function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return Math.abs(sum / 2);
}

// Douglas–Peucker on one ring or line, iterative so long lines don't overflow the stack.
function simplifyLine(points) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [x1, y1] = points[a];
    const [x2, y2] = points[b];
    const len = Math.hypot(x2 - x1, y2 - y1);
    let max = 0;
    let index = -1;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = points[i];
      const d = len === 0 ? Math.hypot(x - x1, y - y1) : Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / len;
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (max > TOLERANCE) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Simplified polygons, without the ones too small to see. */
function simplifyPolygons(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const kept = polygons
    .filter((rings) => ringArea(rings[0]) >= MIN_AREA)
    .map((rings) => rings.filter((r) => ringArea(r) >= MIN_AREA).map((r) => round(simplifyLine(r))));
  return kept.length ? { type: 'MultiPolygon', coordinates: kept } : null;
}

async function buildBaseMap() {
  const tilejson = await (await fetch('https://tiles.openfreemap.org/planet')).json();
  const template = tilejson.tiles[0];
  const features = [];
  const places = new Map();
  const jobs = [];
  for (let x = tileX(BOUNDS.west); x <= tileX(BOUNDS.east); x++) {
    for (let y = tileY(BOUNDS.north); y <= tileY(BOUNDS.south); y++) jobs.push([x, y]);
  }
  console.log(`Decoding ${jobs.length} map tiles…`);
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let job = jobs.shift(); job; job = jobs.shift()) {
        const [x, y] = job;
        const res = await fetch(template.replace('{z}', TILE_ZOOM).replace('{x}', x).replace('{y}', y));
        if (!res.ok) continue;
        const tile = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer())));
        const each = (layer, fn) => {
          const l = tile.layers[layer];
          for (let i = 0; l && i < l.length; i++) fn(l.feature(i).toGeoJSON(x, y, TILE_ZOOM));
        };
        each('water', (f) => {
          if (f.properties.brunnel === 'tunnel' || !f.geometry.type.endsWith('Polygon')) return;
          const geometry = simplifyPolygons(f.geometry);
          if (geometry) features.push({ type: 'Feature', properties: { layer: 'water' }, geometry });
        });
        each('boundary', (f) => {
          if (f.properties.admin_level !== 2 || f.properties.maritime === 1) return;
          const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
          features.push({
            type: 'Feature',
            properties: { layer: 'boundary' },
            geometry: { type: 'MultiLineString', coordinates: lines.map((l) => round(simplifyLine(l))) },
          });
        });
        each('place', (f) => {
          const { class: kind, rank, capital } = f.properties;
          if (!['country', 'city', 'town', 'village'].includes(kind)) return;
          const name = f.properties['name:fi'] || f.properties['name:latin'] || f.properties.name;
          const id = `${kind}:${name}`;
          if (places.has(id)) return;
          places.set(id, { type: 'Feature', properties: { layer: 'place', class: kind, rank, capital, name }, geometry: { type: 'Point', coordinates: round(f.geometry.coordinates) } });
        });
      }
    }),
  );
  const json = JSON.stringify({ type: 'FeatureCollection', features: [...features, ...places.values()] });
  await write('basemap.geojson', json);
  console.log(`Base map ${(json.length / 1024 / 1024).toFixed(1)} MB`);

  // Label fonts, served from the artifact under names without spaces.
  for (const [font, dir] of [
    ['Noto Sans Regular', 'NotoRegular'],
    ['Noto Sans Bold', 'NotoBold'],
  ]) {
    await mkdir(new URL(`glyphs/${dir}/`, OUT), { recursive: true });
    for (const range of ['0-255', '256-511', '8192-8447']) {
      const res = await fetch(`https://tiles.openfreemap.org/fonts/${encodeURIComponent(font)}/${range}.pbf`);
      await writeFile(new URL(`glyphs/${dir}/${range}.pbf`, OUT), new Uint8Array(await res.arrayBuffer()));
    }
  }
}

await mkdir(OUT, { recursive: true });
await copyFile(new URL('../public/data/rail-network.geojson', import.meta.url), new URL('rail-network.geojson', OUT));
if (!skipMap) await buildBaseMap();
if (!mapOnly) await recordReplay();
console.log('Done.');
