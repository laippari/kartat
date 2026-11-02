// Builds public/data/metro.geojson from HSL's open GTFS: the M1 and M2 lines as
// they run in each direction, and the metro stations in running order. The
// app uses it to draw the metro and to tell where along its line a train is.
//
// Run: node scripts/build-metro.mjs [path/to/hsl.zip]
// Without a path, downloads the feed (~75 MB). Needs `unzip`.
// Data: Helsinki Region Transport (HSL), CC BY 4.0.
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FEED = 'https://infopalvelut.storage.hsldev.com/gtfs/hsl.zip';
const OUT = new URL('../public/data/metro.geojson', import.meta.url);
const ROUTES = ['31M1', '31M2'];
/** A station farther than this from a line is not on it. */
const ON_LINE_METRES = 150;

let zip = process.argv[2];
if (!zip) {
  zip = join(await mkdtemp(join(tmpdir(), 'hsl-')), 'hsl.zip');
  console.log('Downloading HSL GTFS…');
  const res = await fetch(FEED);
  if (!res.ok) throw new Error(`${res.status} ${FEED}`);
  await writeFile(zip, new Uint8Array(await res.arrayBuffer()));
}

const read = (file) => execFileSync('unzip', ['-p', zip, file], { maxBuffer: 1 << 30 }).toString('utf8');

// GTFS CSV: quoted fields may contain commas, never newlines.
function parseCsv(text) {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const split = (line) => [...line.matchAll(/("([^"]*(?:""[^"]*)*)"|[^,]*)(,|$)/g)].slice(0, -1).map((m) => (m[2] ?? m[1]).trim());
  const keys = split(header);
  return lines.map((line) => Object.fromEntries(split(line).map((v, i) => [keys[i], v])));
}

const metres = ([lng1, lat1], [lng2, lat2]) => {
  const cos = Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.hypot((lng2 - lng1) * 111_320 * cos, (lat2 - lat1) * 111_320);
};

/** Distance along the line to the point on it closest to p, and how far off the line p is. */
function project(line, p) {
  let best = { along: 0, off: Infinity };
  let travelled = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const length = metres(a, b);
    const cos = Math.cos((a[1] * Math.PI) / 180);
    const ax = (p[0] - a[0]) * cos;
    const ay = p[1] - a[1];
    const bx = (b[0] - a[0]) * cos;
    const by = b[1] - a[1];
    const t = Math.max(0, Math.min(1, (ax * bx + ay * by) / (bx * bx + by * by || 1)));
    const closest = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const off = metres(p, closest);
    if (off < best.off) best = { along: travelled + length * t, off };
    travelled += length;
  }
  return best;
}

const trips = parseCsv(read('trips.txt')).filter((t) => ROUTES.includes(t.route_id));
const variants = [];
for (const route of ROUTES) {
  for (const direction of ['0', '1']) {
    // The most common shape is the full line; the rest are depot runs and short turns.
    const counts = new Map();
    for (const t of trips.filter((t) => t.route_id === route && t.direction_id === direction)) {
      const key = `${t.shape_id}\t${t.trip_headsign}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const [shape, headsign] = [...counts].sort((a, b) => b[1] - a[1])[0][0].split('\t');
    variants.push({ route, direction, shape, headsign });
  }
}

const wanted = new Set(variants.map((v) => v.shape));
const points = new Map();
for (const row of parseCsv(read('shapes.txt'))) {
  if (!wanted.has(row.shape_id)) continue;
  if (!points.has(row.shape_id)) points.set(row.shape_id, []);
  points.get(row.shape_id).push([Number(row.shape_pt_sequence), Number(row.shape_pt_lon), Number(row.shape_pt_lat)]);
}

const stops = parseCsv(read('stops.txt'));
const parents = new Map(stops.filter((s) => s.location_type === '1').map((s) => [s.stop_id, s]));
const stations = new Map();
for (const s of stops) {
  if (s.vehicle_type !== '1' || s.location_type !== '0' || !parents.has(s.parent_station)) continue;
  const parent = parents.get(s.parent_station);
  stations.set(parent.stop_id, { id: parent.stop_id, name: s.stop_name, at: [Number(parent.stop_lon), Number(parent.stop_lat)] });
}

const round = ([lng, lat]) => [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
const features = variants.map((v) => {
  const line = points.get(v.shape).sort((a, b) => a[0] - b[0]).map(([, lng, lat]) => [lng, lat]);
  const onLine = [...stations.values()]
    .map((s) => ({ id: s.id, ...project(line, s.at) }))
    .filter((s) => s.off < ON_LINE_METRES)
    .sort((a, b) => a.along - b.along);
  return {
    type: 'Feature',
    properties: {
      kind: 'line',
      line: v.route.replace(/^31/, ''),
      // Realtime feeds number directions 1 and 2; GTFS uses 0 and 1.
      direction: Number(v.direction) + 1,
      headsign: v.headsign,
      stations: onLine.map((s) => s.id),
    },
    geometry: { type: 'LineString', coordinates: line.map(round) },
  };
});
for (const s of stations.values()) {
  features.push({
    type: 'Feature',
    properties: { kind: 'station', id: s.id, name: s.name },
    geometry: { type: 'Point', coordinates: round(s.at) },
  });
}

const json = JSON.stringify({ type: 'FeatureCollection', features });
await writeFile(OUT, json);
for (const f of features.filter((f) => f.properties.kind === 'line')) {
  const p = f.properties;
  console.log(`${p.line} → ${p.headsign}: ${p.stations.length} stations, ${f.geometry.coordinates.length} points`);
}
console.log(`${stations.size} stations, ${(json.length / 1024).toFixed(0)} KB`);
