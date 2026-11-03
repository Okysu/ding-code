import { z } from 'zod';
import type { AIConfig, Candidate } from '../../../../shared/types';

export class AIUnavailable extends Error {
  constructor() {
    super('aiUnavailable');
  }
}
export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}
export function endpoint(config: AIConfig) {
  const url = new URL(config.baseUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new Error('invalidEndpoint');
  let base = url.href.replace(/\/+$/, '');
  if (!/\/v\d+$/.test(base)) base += '/v1';
  return `${base}/${config.protocol === 'anthropic' ? 'messages' : config.protocol === 'responses' ? 'responses' : 'chat/completions'}`;
}
const streamEventSchema = z
  .object({
    type: z.string().optional(),
    error: z.unknown().optional(),
    delta: z
      .union([
        z.string(),
        z.object({
          type: z.string().optional(),
          text: z.string().optional(),
          stop_reason: z.string().nullable().optional(),
        }),
      ])
      .optional(),
    choices: z
      .array(
        z.object({
          finish_reason: z.string().nullable().optional(),
          delta: z.object({ content: z.string().nullable().optional() }).optional(),
        }),
      )
      .optional(),
  })
  .passthrough();
type StreamEvent = z.infer<typeof streamEventSchema>;
export async function* sse(response: Response): AsyncGenerator<StreamEvent> {
  if (!response.body) throw new Error('emptyResponse');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > 2_000_000) throw new Error('responseTooLarge');
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = frame
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        if (!data) continue;
        if (data === '[DONE]') {
          yield { type: 'done' };
          continue;
        }
        yield streamEventSchema.parse(JSON.parse(data));
      }
      if (done) break;
    }
    // SSE requires a terminating blank line. Never silently commit an incomplete stream.
    if (buffer.trim()) throw new Error('incompleteStream');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export class AIService {
  constructor(
    private config: () => AIConfig,
    private key: () => Promise<string | undefined>,
  ) {}
  async available() {
    const c = this.config();
    return Boolean(c.enabled && c.model.trim() && c.baseUrl.trim() && (await this.key()));
  }
  async *stream(system: string, turns: Turn[], signal?: AbortSignal): AsyncGenerator<string> {
    const c = this.config();
    const key = await this.key();
    if (!c.enabled || !c.model.trim() || !key) throw new AIUnavailable();
    const url = endpoint(c);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    let body: object;
    if (c.protocol === 'anthropic') {
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
      body = { model: c.model, max_tokens: 8192, stream: true, system, messages: turns };
    } else {
      headers.Authorization = `Bearer ${key}`;
      body =
        c.protocol === 'responses'
          ? { model: c.model, stream: true, store: false, instructions: system, input: turns }
          : {
              model: c.model,
              stream: true,
              messages: [{ role: 'system', content: system }, ...turns],
            };
    }
    const timeout = AbortSignal.timeout(180_000);
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`providerHttp:${response.status}`);
    }
    let completed = false;
    let length = 0;
    for await (const event of sse(response)) {
      if (
        event.type === 'error' ||
        event.error ||
        ['response.failed', 'response.incomplete'].includes(event.type ?? '')
      )
        throw new Error('providerError');
      const messageDelta = typeof event.delta === 'object' ? event.delta : undefined;
      if (
        event.type === 'message_delta' &&
        ['max_tokens', 'refusal'].includes(messageDelta?.stop_reason ?? '')
      )
        throw new Error('incompleteStream');
      if (event.choices?.some((v) => ['length', 'content_filter'].includes(v.finish_reason ?? '')))
        throw new Error('incompleteStream');
      if (['response.completed', 'message_stop', 'done'].includes(event.type ?? ''))
        completed = true;
      const delta =
        c.protocol === 'responses'
          ? event.type === 'response.output_text.delta'
            ? event.delta
            : ''
          : c.protocol === 'anthropic'
            ? event.type === 'content_block_delta' && messageDelta?.type === 'text_delta'
              ? messageDelta.text
              : ''
            : event.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) {
        length += delta.length;
        if (length > 1_000_000) throw new Error('responseTooLarge');
        yield delta;
      }
    }
    if (!completed || !length) throw new Error('incompleteStream');
  }
}
const candidateSchema = z
  .array(
    z
      .object({
        start_line: z.number().int().positive(),
        end_line: z.number().int().positive(),
        title: z.string().min(1).max(200),
        reason: z.string().max(10000),
        tags: z.array(z.string().max(80)).max(20),
      })
      .strict(),
  )
  .max(12);
export function parseCandidates(text: string, lineCount: number): Candidate[] {
  const list = candidateSchema.parse(
    JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/, '')
        .replace(/\s*```$/, ''),
    ),
  );
  if (list.some((c) => c.end_line < c.start_line || c.end_line > lineCount))
    throw new Error('invalidCandidates');
  return list;
}
