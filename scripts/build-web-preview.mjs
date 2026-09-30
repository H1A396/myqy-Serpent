import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

/**
 * Preview build of the read-only web share client.
 *
 * It builds into `dist/web/web-preview/`, i.e. *inside* the share server's
 * static root, so the experiment is served at `/web-preview/` while `/` keeps
 * serving the committed build at the root. The folder must be a child of the
 * static root — the server resolves every path relative to it and rejects
 * anything outside.
 *
 * The preview is never what gets shipped: `npm run package` and
 * `npm run web:build` only ever produce the root build, and `dist/` is
 * gitignored so neither lands in version control.
 */
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relativeOutDir = path.join('dist', 'web', 'web-preview');
const outDir = path.join(rootDir, relativeOutDir);

async function buildPreview() {
  // vite.web.config.ts resolves its outDir from this variable; set it here so
  // the script works from npm without the caller remembering the prefix.
  process.env.SERPENT_WEB_OUT_DIR = relativeOutDir;

  await build({
    configFile: path.join(rootDir, 'vite.web.config.ts'),
    logLevel: 'warn',
  });

  const indexPath = path.join(outDir, 'index.html');
  const fileStat = await stat(indexPath);
  if (!fileStat.isFile() || fileStat.size === 0) {
    throw new Error(`Web share preview build output is missing or empty: ${indexPath}`);
  }

  const html = await readFile(indexPath, 'utf8');
  if (!/src="\.\/assets\//u.test(html)) {
    throw new Error('Web share preview index.html must reference assets with a relative path.');
  }

  process.stdout.write(
    `Web share preview built at ${outDir}\n` +
      `Preview: <share origin>/web-preview/  ·  current build stays at <share origin>/\n`,
  );
}

await buildPreview();
