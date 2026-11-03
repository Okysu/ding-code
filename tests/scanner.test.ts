import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanDirectives } from '../packages/extension/src/scanner';
test('Python indentation, multiline call and explicit range', () => {
  const source =
    '# ding-code: settings\nsettings = Settings(\n    env_prefix="APP_",\n    extra="ignore"\n)\nother = 1\n# ding-code-start: cleanup\ntry:\n    download()\nfinally:\n    remove()\n# ding-code-end\n';
  const rows = scanDirectives(source, 'python');
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((s) => [s.start_line, s.end_line, s.note]),
    [
      [2, 5, 'settings'],
      [8, 11, 'cleanup'],
    ],
  );
  const indented = scanDirectives(
    '# @ding-code: lifecycle\ndef safe():\n    open_it()\n    close_it()\n\nnext_call()',
    'python',
  );
  assert.equal(indented[0].end_line, 4);
});
test('directives in strings and docstrings do not index code', () => {
  assert.equal(
    scanDirectives(
      's = "# ding-code: fake"\nrun()\n"""\n# ding-code: docstring\n"""\nrun()',
      'python',
    ).length,
    0,
  );
  assert.equal(
    scanDirectives('const s = `\n// ding-code: fake\n`;\nrun()', 'typescript').length,
    0,
  );
  assert.equal(
    scanDirectives('const s = "https://host/# ding-code: fake";\nrun()', 'typescript').length,
    0,
  );
});
test('C-style blocks, HTML comments and SQL line comments', () => {
  assert.deepEqual(
    scanDirectives(
      '/*\n * @ding-code: safety\n */\nfunction safe() {\n  try { run(); }\n  finally { clean(); }\n}\nnext();',
      'typescript',
    ).map((s) => [s.start_line, s.end_line]),
    [[4, 7]],
  );
  assert.equal(
    scanDirectives(
      '<!-- ding-code-start: markup -->\n<section>\n <p>Text</p>\n</section>\n<!-- ding-code-end -->',
      'html',
    )[0].end_line,
    4,
  );
  assert.equal(
    scanDirectives('-- ding-code: index\nCREATE INDEX ix ON table_name(col);', 'sql').length,
    1,
  );
});
test('unclosed explicit markers and prose mentions are ignored', () => {
  assert.equal(scanDirectives('# ding-code-start: unclosed\nfoo()', 'python').length, 0);
  assert.equal(scanDirectives('// docs mention @ding-code here\nfoo();', 'typescript').length, 0);
});
test('same note occurrences get distinct stable source keys', () => {
  const source = '# ding-code: a\nx()\n# ding-code: a\ny()';
  const a = scanDirectives(source, 'python');
  const b = scanDirectives('\n\n' + source, 'python');
  assert.equal(a.length, 2);
  assert.notEqual(a[0].key, a[1].key);
  assert.equal(a[0].key, b[0].key);
});
