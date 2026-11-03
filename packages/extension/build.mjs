import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, sep } from 'node:path';
const extensionRoot = fileURLToPath(new URL('.', import.meta.url));
const webOutput = fileURLToPath(new URL('./dist/web', import.meta.url));
if (!webOutput.startsWith(join(extensionRoot, 'dist') + sep))
  throw new Error('Invalid web output path');
await rm(webOutput, { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await mkdir('../../artifacts', { recursive: true });
for (const file of [
  'README.md',
  'README.zh-CN.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'CHANGELOG.md',
])
  await cp(`../../${file}`, file);
await build({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['vscode'],
  sourcemap: true,
});
await cp('../web/dist', 'dist/web', { recursive: true });
