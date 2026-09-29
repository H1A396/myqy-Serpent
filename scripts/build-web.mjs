import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(rootDir, 'dist', 'web');

async function assertFile(relativePath) {
  const absolutePath = path.join(outDir, relativePath);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile() || fileStat.size === 0) {
    throw new Error(`Web share build output is missing or empty: ${relativePath}`);
  }
}

async function buildWeb() {
  await build({
    configFile: path.join(rootDir, 'vite.web.config.ts'),
    logLevel: 'warn',
  });

  await assertFile('index.html');
  const html = await readFile(path.join(outDir, 'index.html'), 'utf8');
  if (!/src="\.\/assets\//u.test(html)) {
    throw new Error('Web share index.html must reference assets with a relative path.');
  }
  if (!html.includes('name="robots"')) {
    throw new Error('Web share index.html must opt out of indexing (robots meta).');
  }

  process.stdout.write(`Verified read-only web share client at ${outDir}\n`);
}

await buildWeb();
