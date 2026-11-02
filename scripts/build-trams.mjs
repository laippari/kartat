// Builds the tram networks the app draws and follows trams along:
//   public/data/tram-helsinki.geojson  from HSL's GTFS
//   public/data/tram-tampere.geojson   from Nysse's GTFS (ITS Factory)
// Each tram route and direction becomes a line with its stops in running
// order, taken from one of its trips; stops become points.
//
// Run: node scripts/build-trams.mjs [hsl.zip] [tampere.zip]
// Without paths, downloads the feeds (~75 MB and ~18 MB). Needs `unzip`.
// Data: Helsinki Region Transport (HSL), CC BY 4.0; Tampereen joukkoliikenne Nysse, CC BY 4.0.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const FEEDS = [
  { name: 'helsinki', url: 'https://infopalvelut.storage.hsldev.com/gtfs/hsl.zip', path: process.argv[2] },
  { name: 'tampere', url: 'https://data.itsfactory.fi/journeys/files/gtfs/latest/gtfs_tampere.zip', path: process.argv[3] },
];
/** A shape used by fewer trips than this share of its route's busiest one is a depot run or a detour. */
const MIN_SHARE = 0.05;

// GTFS CSV: quoted fields may contain commas, never newlines.
const splitCsv = (line) =>
  [...line.matchAll(/("([^"]*(?:""[^"]*)*)"|[^,]*)(,|$)/g)].slice(0, -1).map((m) => (m[2] ?? m[1]).trim());

function parseCsv(text) {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const keys = splitCsv(header);
  return lines.map((line) => Object.fromEntries(splitCsv(line).map((v, i) => [keys[i], v])));
}

async function build({ name, url, path }) {
  let zip = path;
  if (!zip) {
    zip = join(await mkdtemp(join(tmpdir(), `${name}-`)), 'gtfs.zip');
    console.log(`Downloading ${url}…`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    await writeFile(zip, new Uint8Array(await res.arrayBuffer()));
  }
  const read = (file) => parseCsv(execFileSync('unzip', ['-p', zip, file], { maxBuffer: 1 << 30 }).toString('utf8'));

  // Basic GTFS calls trams 0; the extended types put them in 900–906 (Raide-Jokeri is 900).
  const routes = new Map(read('routes.txt').filter((r) => /^(0|90\d)$/.test(r.route_type)).map((r) => [r.route_id, r]));
  const trips = read('trips.txt').filter((t) => routes.has(t.route_id));

  // Each route and direction: the shapes its trips run, busiest first.
  const variants = new Map();
  for (const t of trips) {
    const key = `${t.route_id}\t${t.direction_id}\t${t.shape_id}`;
    const v = variants.get(key) ?? { route: t.route_id, direction: t.direction_id, shape: t.shape_id, headsign: t.trip_headsign, trip: t.trip_id, count: 0 };
    v.count++;
    variants.set(key, v);
  }
  const busiest = new Map();
  for (const v of variants.values()) {
    const key = `${v.route}\t${v.direction}`;
    busiest.set(key, Math.max(busiest.get(key) ?? 0, v.count));
  }
  // Busiest first, so the first match for a route and direction is its usual run.
  const kept = [...variants.values()]
    .filter((v) => v.count >= busiest.get(`${v.route}\t${v.direction}`) * MIN_SHARE)
    .sort((a, b) => b.count - a.count);

  const shapes = new Map(kept.map((v) => [v.shape, []]));
  for (const row of read('shapes.txt')) {
    shapes.get(row.shape_id)?.push([Number(row.shape_pt_sequence), Number(row.shape_pt_lon), Number(row.shape_pt_lat)]);
  }

  // Stops of one trip per variant, streamed: stop_times.txt can be a gigabyte.
  const wanted = new Map(kept.map((v) => [v.trip, []]));
  const unzip = spawn('unzip', ['-p', zip, 'stop_times.txt']);
  let keys;
  for await (const line of createInterface({ input: unzip.stdout })) {
    if (!keys) {
      keys = splitCsv(line);
      continue;
    }
    // Parsing every row is slow; trip_id usually comes first, so check it before parsing.
    if (keys[0] === 'trip_id' && !wanted.has(line.slice(0, line.indexOf(',')).replaceAll('"', ''))) continue;
    const row = Object.fromEntries(splitCsv(line).map((v, i) => [keys[i], v]));
    wanted.get(row.trip_id)?.push([Number(row.stop_sequence), row.stop_id]);
  }

  const stops = new Map(read('stops.txt').map((s) => [s.stop_id, s]));
  const used = new Set();
  const round = ([lng, lat]) => [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
  const features = kept.map((v) => {
    const ids = wanted.get(v.trip).sort((a, b) => a[0] - b[0]).map(([, id]) => id);
    ids.forEach((id) => used.add(id));
    const coordinates = shapes.get(v.shape).sort((a, b) => a[0] - b[0]).map(([, lng, lat]) => round([lng, lat]));
    return {
      type: 'Feature',
      properties: {
        kind: 'line',
        id: v.route,
        line: routes.get(v.route).route_short_name,
        // Realtime feeds number directions 1 and 2; GTFS uses 0 and 1.
        direction: Number(v.direction) + 1,
        headsign: v.headsign,
        stations: ids,
      },
      geometry: { type: 'LineString', coordinates },
    };
  });
  for (const id of used) {
    const s = stops.get(id);
    features.push({
      type: 'Feature',
      // Tampere names each platform: "Sorin aukio A", "Sorin aukio B". Passengers know the stop.
      properties: { kind: 'station', id, name: s.stop_name.replace(/ [A-D]$/, ''), code: s.stop_code },
      geometry: { type: 'Point', coordinates: round([Number(s.stop_lon), Number(s.stop_lat)]) },
    });
  }

  const json = JSON.stringify({ type: 'FeatureCollection', features });
  await writeFile(new URL(`../public/data/tram-${name}.geojson`, import.meta.url), json);
  console.log(`${name}: ${kept.length} line variants, ${used.size} stops, ${(json.length / 1024).toFixed(0)} KB`);
}

for (const feed of FEEDS) await build(feed);
