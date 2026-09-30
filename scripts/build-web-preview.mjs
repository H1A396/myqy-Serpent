import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

/**
 * Preview build of the read-only web share client.
 *
 * It builds into `dist/web-preview/` instead of `dist/web/`, so the share
 * server serves the experiment at `/web-preview/` while `/` keeps serving the
 * last committed build. Use it to compare an uncommitted style change against
 * the current version before deciding whether to keep it.
 *
 * The preview folder is never what gets shipped: `npm run package` and
 * `npm run web:build` both (re)build `dist/web`, and `dist/` is gitignored.
 */
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(rootDir, 'dist', 'web-preview');

async function buildPreview() {
  // vite.web.config.ts resolves its outDir from this variable; set it here so
  // the script works from npm without the caller remembering the prefix.
  process.env.SERPENT_WEB_OUT_DIR = path.join('dist', 'web-preview');

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
