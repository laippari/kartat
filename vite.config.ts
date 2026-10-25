import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

/**
 * `vite build --mode artifact` makes the self-contained version published as a
 * claude.ai artifact: live data and map tiles are swapped for a recording
 * packed with the page (see scripts/build-artifact-data.mjs).
 */
function artifactModules(): Plugin {
  const swaps = new Map([
    [src('data/digitraffic.ts'), src('artifact/digitraffic.ts')],
    [src('map/style.ts'), src('artifact/style.ts')],
  ]);
  return {
    name: 'artifact-modules',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return (resolved && swaps.get(resolved.id)) ?? null;
    },
  };
}

export default defineConfig(({ mode }) =>
  mode === 'artifact'
    ? {
        plugins: [react(), artifactModules()],
        base: './',
        publicDir: 'artifact/public',
        build: { outDir: 'dist-artifact', emptyOutDir: true },
      }
    : { plugins: [react()] },
);
