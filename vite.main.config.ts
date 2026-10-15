import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/main/index.ts',
      formats: ['cjs'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      // `sharp` must stay external. Its platform package loads a native `.node`
      // (for example `@img/sharp-win32-x64`). Rolldown reads that file as source
      // and fails the main build with UNLOADABLE_DEPENDENCY / invalid UTF-8,
      // so Electron never starts. The library worker already loads sharp from
      // node_modules; packaged apps unpack `@img/**` out of app.asar.
      external: ['better-sqlite3', 'koffi', 'libarchive-wasm', 'sharp'],
    },
  },
});
