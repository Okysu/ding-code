import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KnowledgeDAO, hashCode } from '../packages/extension/src/db';
import type { Capture } from '../shared/types';
export const sample: Capture = {
  file_path: '/project/io.py',
  relative_path: 'io.py',
  project_name: 'example',
  language: 'python',
  code_content: 'target.replace(destination)',
  context_before: '',
  context_after: '',
  start_line: 5,
  end_line: 5,
  source_type: 'manual_selection',
  user_note: 'atomic replacement 原子替换',
  tags: ['atomic-io'],
};
test('SQLite persists, indexes updates, filters Chinese substrings, and cascades chat deletion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ding-db-'));
  const path = join(dir, 'knowledge.db');
  let db = new KnowledgeDAO(path);
  try {
    const first = db.capture(sample);
    assert.equal(db.capture({ ...sample, user_note: 'do not overwrite' }).id, first.id);
    assert.equal(db.get(first.id)?.user_note, sample.user_note);
    assert.equal(db.list({ query: 'atomic' }).length, 1);
    assert.equal(db.list({ query: '原子' }).length, 1);
    assert.equal(db.list({ tag: 'atomic-io', project: 'example', language: 'python' }).length, 1);
    assert.equal(db.list({ query: '" OR *' }).length, 0);
    const updated = db.update(
      first.id,
      { user_note: 'durability', ai_article: '# Persistence\nfsync details', tags: ['durable'] },
      first.updated_at,
    );
    assert.equal(db.list({ query: 'fsync' }).length, 1);
    assert.equal(db.list({ query: 'atomic-io' }).length, 0);
    assert.throws(() => db.update(first.id, { user_note: 'stale' }, first.updated_at), /conflict/);
    assert.equal(db.get(first.id)?.updated_at, updated.updated_at);
    db.appendExchange(first.id, 'How?', 'Use fsync.');
    assert.equal(db.messages(first.id).length, 2);
    db.backup(join(dir, 'backup.db'));
    const backup = new KnowledgeDAO(join(dir, 'backup.db'));
    assert.equal(backup.list().length, 1);
    backup.close();
    db.close();
    db = new KnowledgeDAO(path);
    assert.equal(db.list().length, 1);
    assert.equal(db.messages(first.id).length, 2);
    db.delete(first.id);
    assert.equal(db.list({ query: 'fsync' }).length, 0);
    assert.equal(db.messages(first.id).length, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('comment re-index preserves manual enrichment and follows stable directive identity', () => {
  const db = new KnowledgeDAO(':memory:');
  try {
    const row = db.capture({ ...sample, source_type: 'comment_tag', source_key: 'anchor' });
    db.update(row.id, {
      user_note: 'my edited note',
      tags: ['personal'],
      ai_article: 'my article',
    });
    const next = db.capture({
      ...sample,
      source_type: 'comment_tag',
      source_key: 'anchor',
      code_content: 'target.replace(new_destination)',
      start_line: 8,
      end_line: 8,
    });
    assert.equal(next.id, row.id);
    assert.equal(next.user_note, 'my edited note');
    assert.equal(next.ai_article, 'my article');
    assert.equal(next.start_line, 8);
    assert.deepEqual(next.tags, ['personal']);
    assert.equal(hashCode('a\r\nb '), hashCode('a\nb'));
  } finally {
    db.close();
  }
});
test('multiple windows share WAL without lost writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ding-wal-'));
  const one = new KnowledgeDAO(join(dir, 'data.db'));
  const two = new KnowledgeDAO(join(dir, 'data.db'));
  try {
    const row = one.capture(sample);
    assert.equal(two.get(row.id)?.user_note, sample.user_note);
    two.update(row.id, { user_note: 'second window' });
    assert.equal(one.get(row.id)?.user_note, 'second window');
  } finally {
    one.close();
    two.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
