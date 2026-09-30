import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Set `SERPENT_WEB_OUT_DIR` to build into a different folder than the default
 * `dist/web`. The share server serves everything under its static root, so a
 * sibling folder is reachable at `/<folder-name>/` while the default build
 * keeps serving `/` untouched — that is how an uncommitted style experiment is
 * previewed side by side with the current version.
 */
const outDir = process.env.SERPENT_WEB_OUT_DIR
  ? path.resolve(projectRoot, process.env.SERPENT_WEB_OUT_DIR)
  : path.resolve(projectRoot, 'dist/web');

/**
 * Read-only web share client. It is a separate build from the Electron
 * renderer: the desktop app serves `dist/web` over the loopback share server,
 * so the bundle must use relative asset URLs (`base: './'`) and must not import
 * Electron-only renderer modules.
 */
export default defineConfig({
  root: path.resolve(projectRoot, 'src/myqy-web-share/client'),
  base: './',
  plugins: [react()],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.SERPENT_WEB_DEV_PORT || 5199),
    strictPort: true,
  },
});
