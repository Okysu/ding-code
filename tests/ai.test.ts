import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AIService, endpoint, parseCandidates, sse } from '../packages/extension/src/ai/service';
import { systemPrompt } from '../packages/extension/src/ai/prompts';
import type { AIConfig, Protocol } from '../shared/types';
test('AI without a key is unavailable and never contacts a provider', async () => {
  const service = new AIService(
    () => ({
      enabled: true,
      baseUrl: 'https://invalid.test',
      model: 'test',
      protocol: 'responses',
    }),
    async () => undefined,
  );
  assert.equal(await service.available(), false);
  await assert.rejects(async () => {
    for await (const _ of service.stream('system', [])) {
      /* Exhaust the stream to observe failures. */
    }
  }, /aiUnavailable/);
});
test('SSE decoder handles split multibyte characters and CRLF', async () => {
  const bytes = new TextEncoder().encode('data: {"delta":"中文"}\r\n\r\ndata: [DONE]\n\n');
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    }),
  );
  const result = [];
  for await (const event of sse(response)) result.push(event);
  assert.deepEqual(result, [{ delta: '中文' }, { type: 'done' }]);
});
test('all provider protocols send the correct shape and consume their terminal events', async () => {
  let protocol: Protocol = 'responses';
  let incomplete = false;
  let request: {
    url?: string;
    headers: import('node:http').IncomingHttpHeaders;
    body: { stream: boolean };
  } = { headers: {}, body: { stream: false } };
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    request = { url: req.url, headers: req.headers, body: JSON.parse(raw) };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const events =
      protocol === 'responses'
        ? [{ type: 'response.output_text.delta', delta: 'hello' }, { type: 'response.completed' }]
        : protocol === 'anthropic'
          ? [
              { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } },
              { type: 'message_stop' },
            ]
          : [{ choices: [{ delta: { content: 'hello' } }] }, '[DONE]'];
    for (const event of incomplete ? events.slice(0, 1) : events)
      res.write(`data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    for (const p of ['responses', 'anthropic', 'chat-completions'] as Protocol[]) {
      protocol = p;
      const config: AIConfig = {
        enabled: true,
        baseUrl: `http://127.0.0.1:${port}`,
        model: 'mock',
        protocol,
      };
      const service = new AIService(
        () => config,
        async () => 'mock-key',
      );
      let result = '';
      for await (const delta of service.stream(systemPrompt('article', 'zh-CN'), [
        { role: 'user', content: 'code' },
      ]))
        result += delta;
      assert.equal(result, 'hello');
      assert.equal(request.body.stream, true);
      assert.match(JSON.stringify(request.body), /简体中文/);
      assert.equal(
        request.url,
        protocol === 'responses'
          ? '/v1/responses'
          : protocol === 'anthropic'
            ? '/v1/messages'
            : '/v1/chat/completions',
      );
      if (protocol === 'anthropic') assert.equal(request.headers['x-api-key'], 'mock-key');
      else assert.equal(request.headers.authorization, 'Bearer mock-key');
      incomplete = true;
      await assert.rejects(async () => {
        for await (const _ of service.stream('system', [{ role: 'user', content: 'code' }])) {
          /* Exhaust the truncated stream. */
        }
      }, /incompleteStream/);
      incomplete = false;
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test('validate endpoints, structured ranges and bilingual four-step prompts', () => {
  assert.equal(
    endpoint({
      enabled: true,
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1/',
      model: 'x',
    }),
    'https://api.anthropic.com/v1/messages',
  );
  assert.throws(
    () =>
      endpoint({
        enabled: true,
        protocol: 'responses',
        baseUrl: 'http://external.test',
        model: 'x',
      }),
    /invalidEndpoint/,
  );
  assert.throws(
    () => parseCandidates('[{"start_line":2,"end_line":20,"title":"x","reason":"x","tags":[]}]', 4),
    /invalidCandidates/,
  );
  assert.deepEqual(parseCandidates('```json\n[]\n```', 10), []);
  assert.match(systemPrompt('article', 'en-US'), /Reusable Pattern & Checklist/);
  assert.match(systemPrompt('article', 'zh-CN'), /举一反三与可复用范式/);
});
