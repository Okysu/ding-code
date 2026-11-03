import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { KnowledgeDAO } from '../packages/extension/src/db';
import { AIService } from '../packages/extension/src/ai/service';
import { LocalServer, type Host } from '../packages/extension/src/server';
import type { AIConfig, Capture } from '../shared/types';
const require = createRequire(resolve('packages/extension/package.json'));
const { WebSocket } = require('ws') as typeof import('ws');
const capture: Capture = {
  file_path: '/workspace/test.ts',
  relative_path: 'test.ts',
  project_name: 'test',
  language: 'typescript',
  code_content: 'const answer = 42;',
  context_before: '',
  context_after: '',
  start_line: 1,
  end_line: 1,
  source_type: 'manual_selection',
};
test('offline HTTP/WS workflow, authentication, origin isolation, exports and conflict detection', async () => {
  const dao = new KnowledgeDAO(':memory:');
  const row = dao.capture(capture);
  const config: AIConfig = {
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    protocol: 'responses',
  };
  let opened = '';
  const host: Host = {
    state: async () => ({
      locale: 'zh-CN',
      activeFile: capture.file_path,
      databasePath: ':memory:',
      version: 'test',
      ai: { ...config, hasKey: false, available: false },
    }),
    open: async (id) => {
      opened = id;
    },
    settings: async () => {},
    activeSource: async () => ({ text: capture.code_content, capture: () => capture }),
  };
  const server = new LocalServer(
    dao,
    new AIService(
      () => config,
      async () => undefined,
    ),
    host,
    resolve('packages/web/dist'),
  );
  await server.start();
  const headers = { Authorization: `Bearer ${server.token}`, 'Content-Type': 'application/json' };
  const ws = new WebSocket(`${server.url.replace('http', 'ws')}/ws`, ['ding-code', server.token]);
  try {
    await once(ws, 'open');
    assert.equal((await fetch(`${server.url}/api/state`)).status, 401);
    assert.equal(
      (
        await fetch(`${server.url}/api/state`, {
          headers: { ...headers, Origin: 'https://evil.test' },
        })
      ).status,
      403,
    );
    const state = await (await fetch(`${server.url}/api/state`, { headers })).json();
    assert.equal(state.ai.available, false);
    assert.equal(
      (
        await fetch(`${server.url}/api/ai`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ kind: 'article', ids: [row.id] }),
        })
      ).status,
      409,
    );
    const changed = once(ws, 'message');
    const updated = await (
      await fetch(`${server.url}/api/snippets/${row.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          user_note: '中文 searchable insight',
          tags: ['local'],
          expectedUpdatedAt: row.updated_at,
        }),
      })
    ).json();
    assert.equal(JSON.parse(String((await changed)[0])).type, 'changed');
    assert.equal(updated.user_note, '中文 searchable insight');
    assert.equal(
      (
        await fetch(`${server.url}/api/snippets/${row.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ user_note: 'stale', expectedUpdatedAt: row.updated_at }),
        })
      ).status,
      409,
    );
    assert.equal(
      (await (await fetch(`${server.url}/api/snippets?query=searchable`, { headers })).json())
        .length,
      1,
    );
    await fetch(`${server.url}/api/open`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: row.id }),
    });
    assert.equal(opened, row.id);
    const exported = await (await fetch(`${server.url}/api/export`, { headers })).json();
    assert.equal(exported.snippets.length, 1);
    assert.equal(JSON.stringify(exported).includes(server.token), false);
    const backup = new Uint8Array(
      await (await fetch(`${server.url}/api/backup`, { headers })).arrayBuffer(),
    );
    assert.equal(new TextDecoder().decode(backup.slice(0, 15)), 'SQLite format 3');
    assert.equal(
      (
        await fetch(`${server.url}/api/snippets/${row.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ file_path: '/etc/passwd' }),
        })
      ).status,
      400,
    );
    await fetch(`${server.url}/api/snippets/${row.id}`, { method: 'DELETE', headers });
    assert.equal(dao.list().length, 0);
  } finally {
    ws.terminate();
    await server.close();
    dao.close();
  }
});
