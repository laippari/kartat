// Fetches Finland's railway lines from the Digitraffic infra API and writes a
// simplified copy for the low-zoom map. The source is ~10 MB and its API is
// often busy, so the app ships this file rather than fetching it live.
// Run: node scripts/build-rail-network.mjs
// Data: Fintraffic / Väylävirasto, digitraffic.fi, CC BY 4.0.
import { writeFile } from 'node:fs/promises';

const URL_ = 'https://rata.digitraffic.fi/infra-api/0.8/radat.geojson?srsName=crs:84';
const OUT = new URL('../public/data/rail-network.geojson', import.meta.url);
/** Degrees; about 20 m, invisible at the zoom levels this file is drawn at. */
const TOLERANCE = 0.0002;

async function fetchWithRetry(url, attempts = 5) {
  for (let i = 1; ; i++) {
    const res = await fetch(url, { headers: { 'Digitraffic-User': 'kartat/0.1', 'Accept-Encoding': 'gzip' } });
    if (res.ok) return res.json();
    if (i >= attempts || res.status !== 503) throw new Error(`${res.status} ${await res.text()}`);
    console.log(`Busy (${res.status}), retrying in ${i * 5} s…`);
    await new Promise((r) => setTimeout(r, i * 5000));
  }
}

function perpendicularDistance([x, y], [x1, y1], [x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(x - x1, y - y1);
  return Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / length;
}

// Douglas–Peucker, iterative so long lines don't overflow the stack.
function simplify(points) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let max = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistance(points[i], points[first], points[last]);
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (max > TOLERANCE) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round = ([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5];

const source = await fetchWithRetry(URL_);
const features = [];
for (const f of source.features) {
  const geometry = f.geometry ?? (f.properties.geometria && { type: 'MultiLineString', coordinates: f.properties.geometria });
  if (!geometry) continue;
  const lines = geometry.type === 'MultiLineString' ? geometry.coordinates : [geometry.coordinates];
  const coordinates = lines.map((l) => simplify(l).map(round)).filter((l) => l.length > 1);
  if (!coordinates.length) continue;
  features.push({
    type: 'Feature',
    properties: { line: f.properties.ratanumero },
    geometry: { type: 'MultiLineString', coordinates },
  });
}

const json = JSON.stringify({ type: 'FeatureCollection', features });
await writeFile(OUT, json);
console.log(`${features.length} lines, ${(json.length / 1024).toFixed(0)} KB → ${OUT.pathname}`);
