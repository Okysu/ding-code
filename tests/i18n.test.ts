import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import en from '../packages/web/src/i18n/en-US';
import zh from '../packages/web/src/i18n/zh-CN';
test('all web and manifest translation keys have Chinese and English coverage', () => {
  const keys = (object: Record<string, unknown>, prefix = ''): string[] =>
    Object.entries(object)
      .flatMap(([key, value]) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? keys(value as Record<string, unknown>, prefix + key + '.')
          : [prefix + key],
      )
      .sort();
  assert.deepEqual(keys(en), keys(zh));
  assert.deepEqual(
    Object.keys(JSON.parse(readFileSync('packages/extension/package.nls.json', 'utf8'))).sort(),
    Object.keys(
      JSON.parse(readFileSync('packages/extension/package.nls.zh-cn.json', 'utf8')),
    ).sort(),
  );
});
test('project-owned UI, prompts and manifests contain no pictographic emoji', () => {
  function visit(path: string) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (['node_modules', 'dist'].includes(entry.name)) continue;
      const file = join(path, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(ts|vue|json|svg|css)$/.test(file))
        assert.equal(/\p{Extended_Pictographic}/u.test(readFileSync(file, 'utf8')), false, file);
    }
  }
  visit('packages');
});
