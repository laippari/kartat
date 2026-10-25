// Turns the artifact build (dist-artifact/) into what the Artifact tool
// publishes: a page body without its own <html>/<head> (the viewer adds the
// skeleton) and a list of the supporting files beside it.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const dir = new URL('../dist-artifact/', import.meta.url).pathname;

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map((e) => (e.isDirectory() ? walk(join(path, e.name)) : [join(path, e.name)])))).flat();
}
const html = await readFile(join(dir, 'index.html'), 'utf8');
const pick = (re) => html.match(re)?.[1] ?? '';

const page = `<title>Junat kartalla</title>
<meta name="description" content="Suomen junat kartalla.">
<link rel="stylesheet" href="${pick(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"/)}">
<div id="root"></div>
<script type="module" src="${pick(/<script type="module"[^>]*src="\.\/([^"]+)"/)}"></script>
`;
await writeFile(join(dir, 'artifact.html'), page);

// Artifacts don't serve .pbf, so the label fonts travel base64-encoded in one
// JSON file that src/artifact/style.ts hands to MapLibre.
const glyphDir = join(dir, 'data/glyphs');
const glyphs = {};
for (const file of await walk(glyphDir)) glyphs[relative(glyphDir, file).replace(/\.pbf$/, '')] = (await readFile(file)).toString('base64');
await writeFile(join(dir, 'data/glyphs.json'), JSON.stringify(glyphs));

const TYPES = { '.geojson': 'application/json' };
const files = {};
for (const file of await walk(dir)) {
  const published = relative(dir, file);
  if (['index.html', 'artifact.html', 'files.json'].includes(published) || published.endsWith('.pbf')) continue;
  const type = Object.entries(TYPES).find(([ext]) => file.endsWith(ext))?.[1];
  files[published] = type ? { from: file, contentType: type } : file;
}
await writeFile(join(dir, 'files.json'), JSON.stringify(files, null, 2));
console.log(`artifact.html + ${Object.keys(files).length} files`);
