import { build } from 'esbuild';
import { mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
const root = process.cwd();
const out = resolve('.test-output');
await rm(join(out, 'extension-result.json'), { force: true });
await mkdir(join(out, 'workspace'), { recursive: true });
await mkdir(join(out, 'vscode-user/User'), { recursive: true });
await writeFile(
  join(out, 'workspace/sample.py'),
  '# ding-code: atomic cleanup\ntry:\n    download()\nfinally:\n    cleanup()\n',
);
await writeFile(
  join(out, 'vscode-user/User/settings.json'),
  JSON.stringify({
    'ding-code.databasePath': join(out, `integration-${Date.now()}.db`),
    'ding-code.ai.enabled': false,
    'workbench.startupEditor': 'none',
    'security.workspace.trust.enabled': false,
    'extensions.autoUpdate': false,
    'update.mode': 'none',
  }),
);
await build({
  entryPoints: ['tests/extension-runner.ts'],
  outfile: join(out, 'extension-runner.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
});
const executable =
  process.env.VSCODE_EXECUTABLE ??
  (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA, 'Programs/Microsoft VS Code/Code.exe')
    : 'code');
await access(executable);
const child = spawn(
  executable,
  [
    `--user-data-dir=${join(out, 'vscode-user')}`,
    `--extensions-dir=${join(out, 'extensions')}`,
    `--extensionDevelopmentPath=${resolve('packages/extension')}`,
    `--extensionTestsPath=${join(out, 'extension-runner.cjs')}`,
    '--disable-extensions',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-updates',
    join(out, 'workspace'),
  ],
  { env: { ...process.env, DING_TEST_ROOT: root }, windowsHide: true, stdio: 'ignore' },
);
const exit = new Promise((resolve) => child.on('exit', resolve));
const resultPath = join(out, 'extension-result.json');
let result;
for (let i = 0; i < 90; i++) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    result = JSON.parse(await readFile(resultPath, 'utf8'));
    break;
  } catch {
    /* The extension host has not written its result yet. */
  }
}
if (!result) {
  child.kill();
  throw new Error('Extension integration test timed out. Inspect .test-output/vscode-user/logs.');
}
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
await Promise.race([exit, new Promise((resolve) => setTimeout(resolve, 5000))]);
