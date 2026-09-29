import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Read-only web share client. It is a separate build from the Electron
 * renderer: the desktop app serves `dist/web` over the loopback share server,
 * so the bundle must use relative asset URLs (`base: './'`) and must not import
 * Electron-only renderer modules.
 */
export default defineConfig({
  root: path.resolve(projectRoot, 'src/web'),
  base: './',
  plugins: [react()],
  build: {
    outDir: path.resolve(projectRoot, 'dist/web'),
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.SERPENT_WEB_DEV_PORT || 5199),
    strictPort: true,
  },
});
