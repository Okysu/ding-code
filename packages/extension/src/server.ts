import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { KnowledgeDAO } from './db';
import { AIService, parseCandidates } from './ai/service';
import { systemPrompt } from './ai/prompts';
import {
  normalizeLocale,
  type AIConfig,
  type AppState,
  type Candidate,
  type Capture,
  type ChangeEvent,
} from '../../../shared/types';

export interface Host {
  state(): Promise<AppState>;
  open(id: string): Promise<void>;
  settings(config: AIConfig & { databasePath?: string; apiKey?: string }): Promise<void>;
  activeSource(): Promise<{ text: string; capture(start: number, end: number): Capture }>;
}
const settingsSchema = z
  .object({
    enabled: z.boolean(),
    baseUrl: z.string().max(2000),
    model: z.string().max(200),
    protocol: z.enum(['responses', 'chat-completions', 'anthropic']),
    databasePath: z.string().min(1).max(4000).optional(),
    apiKey: z.string().max(10000).optional(),
  })
  .strict();
const patchSchema = z
  .object({
    user_note: z.string().max(1_000_000).optional(),
    ai_article: z.string().max(1_000_000).nullable().optional(),
    tags: z.array(z.string().min(1).max(80)).max(50).optional(),
    expectedUpdatedAt: z.string().optional(),
  })
  .strict();
async function body(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error('payloadTooLarge');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
}
function errorCode(error: unknown) {
  return error instanceof z.ZodError || error instanceof SyntaxError
    ? 'invalidRequest'
    : error instanceof Error
      ? error.message
      : 'operationFailed';
}
export class LocalServer {
  readonly token = randomBytes(32).toString('hex');
  readonly origins = new Set<string>();
  private wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
    handleProtocols: () => 'ding-code',
  });
  private server = createServer((req, res) => {
    void this.handle(req, res);
  });
  private scans = new Map<
    string,
    { text: string; file: string; candidates: Candidate[]; expires: number }
  >();
  private busy = new Set<string>();
  private controllers = new Set<AbortController>();
  private lastDataVersion: number;
  private poll: ReturnType<typeof setInterval>;
  url = '';
  onChange?: () => void;
  constructor(
    readonly dao: KnowledgeDAO,
    readonly ai: AIService,
    private host: Host,
    private webRoot: string,
  ) {
    this.lastDataVersion = this.dataVersion();
    this.poll = setInterval(() => {
      const version = this.dataVersion();
      if (version !== this.lastDataVersion) {
        this.lastDataVersion = version;
        this.broadcast({ type: 'changed' });
      }
    }, 1500);
    this.poll.unref();
    this.server.on('upgrade', (req, socket, head) => {
      const protocols =
        req.headers['sec-websocket-protocol']?.split(',').map((v) => v.trim()) ?? [];
      if (
        req.url !== '/ws' ||
        !this.validHost(req) ||
        !this.validOrigin(req) ||
        !this.authorized(protocols[1])
      ) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on('error', () => {});
        ws.on('message', () => ws.close(1008));
      });
    });
  }
  private dataVersion() {
    return Number(
      (this.dao.db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version,
    );
  }
  private authorized(token?: string) {
    return (
      !!token &&
      token.length === this.token.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(this.token))
    );
  }
  private validHost(req: IncomingMessage) {
    return req.headers.host === new URL(this.url).host;
  }
  private validOrigin(req: IncomingMessage) {
    const origin = req.headers.origin;
    return !origin || origin === this.url || this.origins.has(origin);
  }
  async start() {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('serverStart');
    this.url = `http://127.0.0.1:${address.port}`;
    return this.url;
  }
  browserUrl(locale: string) {
    return `${this.url}/#token=${this.token}&locale=${encodeURIComponent(locale)}`;
  }
  broadcast(event: ChangeEvent) {
    if (event.type === 'changed') this.onChange?.();
    for (const client of this.wss.clients)
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(event));
  }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      if (!this.validHost(req) || !this.validOrigin(req)) {
        json(res, 403, { error: 'forbidden' });
        return;
      }
      if (req.headers.origin) {
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        });
        res.end();
        return;
      }
      const url = new URL(req.url ?? '/', this.url);
      if (!url.pathname.startsWith('/api/')) {
        await this.staticFile(url.pathname, res);
        return;
      }
      if (!this.authorized(req.headers.authorization?.replace(/^Bearer /, ''))) {
        json(res, 401, { error: 'unauthorized' });
        return;
      }
      const path = url.pathname.slice(5);
      const method = req.method;
      if (path === 'state' && method === 'GET') {
        json(res, 200, await this.host.state());
        return;
      }
      if (path === 'snippets' && method === 'GET') {
        json(res, 200, this.dao.list(Object.fromEntries(url.searchParams)));
        return;
      }
      const match = /^snippets\/([\w-]+)$/.exec(path);
      if (match) {
        if (!this.dao.get(match[1])) {
          json(res, 404, { error: 'notFound' });
          return;
        }
        if (method === 'PATCH') {
          const { expectedUpdatedAt, ...patch } = patchSchema.parse(await body(req));
          json(res, 200, this.dao.update(match[1], patch, expectedUpdatedAt));
          this.broadcast({ type: 'changed' });
          return;
        }
        if (method === 'DELETE') {
          if (this.busy.has(match[1])) throw new Error('busy');
          this.dao.delete(match[1]);
          json(res, 200, { ok: true });
          this.broadcast({ type: 'changed' });
          return;
        }
      }
      if (path === 'open' && method === 'POST') {
        const { id } = z.object({ id: z.string().uuid() }).parse(await body(req));
        await this.host.open(id);
        json(res, 200, { ok: true });
        return;
      }
      if (path === 'settings' && method === 'POST') {
        await this.host.settings(settingsSchema.parse(await body(req)));
        json(res, 200, await this.host.state());
        this.broadcast({ type: 'state' });
        return;
      }
      if (path === 'export' && method === 'GET') {
        res.setHeader('Content-Disposition', 'attachment; filename="ding-code-backup.json"');
        json(res, 200, this.dao.exportData());
        return;
      }
      if (path === 'backup' && method === 'GET') {
        const dir = await mkdtemp(join(tmpdir(), 'ding-code-'));
        try {
          const file = join(dir, 'knowledge.db');
          this.dao.backup(file);
          const bytes = await readFile(file);
          res.writeHead(200, {
            'Content-Type': 'application/vnd.sqlite3',
            'Content-Disposition': 'attachment; filename="knowledge.db"',
            'Cache-Control': 'no-store',
          });
          res.end(bytes);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
        return;
      }
      if (path === 'chat' && method === 'GET') {
        json(res, 200, this.dao.messages(url.searchParams.get('id') ?? ''));
        return;
      }
      if (path === 'ai' && method === 'POST') {
        await this.generate(req, res);
        return;
      }
      if (path === 'adopt' && method === 'POST') {
        const { scanId, indices } = z
          .object({
            scanId: z.string().uuid(),
            indices: z.array(z.number().int().min(0)).min(1).max(12),
          })
          .parse(await body(req));
        const scan = this.scans.get(scanId);
        if (!scan || scan.expires < Date.now()) throw new Error('scanExpired');
        const source = await this.host.activeSource();
        if (source.text !== scan.text || source.capture(1, 1).file_path !== scan.file)
          throw new Error('changedSource');
        const selected = [...new Set(indices)].map((index) => scan.candidates[index]);
        if (selected.some((c) => !c)) throw new Error('invalidRequest');
        const rows = selected.map((c) =>
          this.dao.capture({
            ...source.capture(c.start_line, c.end_line),
            source_type: 'ai_discovered',
            user_note: c.title,
            ai_analysis: c.reason,
            tags: c.tags,
          }),
        );
        json(res, 200, rows);
        this.broadcast({ type: 'changed' });
        return;
      }
      json(res, 404, { error: 'notFound' });
    } catch (error) {
      const code = errorCode(error);
      if (res.headersSent) {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ error: code })}\n\n`);
          res.end();
        }
      } else
        json(
          res,
          code === 'aiUnavailable' ? 409 : code === 'conflict' || code === 'busy' ? 409 : 400,
          { error: code },
        );
    }
  }
  private async generate(req: IncomingMessage, res: ServerResponse) {
    const input = z
      .object({
        kind: z.enum(['article', 'chat', 'scan', 'test']),
        ids: z.array(z.string().uuid()).min(1).max(10).optional(),
        question: z.string().min(1).max(20000).optional(),
        locale: z.enum(['en-US', 'zh-CN']).default('en-US'),
      })
      .parse(await body(req));
    if (!(await this.ai.available())) throw new Error('aiUnavailable');
    const snippets = (input.ids ?? []).map((id) => {
      const s = this.dao.get(id);
      if (!s) throw new Error('notFound');
      return s;
    });
    if ((input.kind === 'article' || input.kind === 'chat') && !snippets.length)
      throw new Error('invalidRequest');
    if (input.kind === 'chat' && (!input.question || snippets.length !== 1))
      throw new Error('invalidRequest');
    const locks = input.ids ?? [input.kind];
    if (locks.some((id) => this.busy.has(id))) throw new Error('busy');
    locks.forEach((id) => this.busy.add(id));
    const controller = new AbortController();
    this.controllers.add(controller);
    const close = () => controller.abort();
    res.on('close', close);
    try {
      const source = input.kind === 'scan' ? await this.host.activeSource() : undefined;
      const context = source
        ? source.text
            .split(/\r?\n/)
            .map((s, i) => `${i + 1}: ${s}`)
            .join('\n')
        : JSON.stringify(
            snippets.map((s) => ({
              language: s.language,
              code: s.code_content,
              before: s.context_before,
              after: s.context_after,
              note: s.user_note,
            })),
          );
      if (context.length > 300_000) throw new Error('contextTooLarge');
      const history =
        input.kind === 'chat'
          ? this.dao
              .messages(snippets[0].id)
              .slice(-20)
              .map((m) => ({ role: m.role, content: m.content }))
          : [];
      const turns = [
        { role: 'user' as const, content: `REFERENCE DATA:\n${context}` },
        ...history,
        {
          role: 'user' as const,
          content:
            input.question ??
            (input.kind === 'test'
              ? 'Reply with OK.'
              : 'Proceed with the task using the reference data.'),
        },
      ];
      // Anthropic requires alternating conversational turns; combine adjacent user turns.
      const merged = turns.reduce<typeof turns>((acc, turn) => {
        if (acc.at(-1)?.role === turn.role)
          acc[acc.length - 1] = { ...turn, content: `${acc.at(-1)!.content}\n\n${turn.content}` };
        else acc.push(turn);
        return acc;
      }, []);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.flushHeaders();
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
      let text = '';
      try {
        for await (const delta of this.ai.stream(
          systemPrompt(input.kind === 'test' ? 'chat' : input.kind, normalizeLocale(input.locale)),
          merged,
          controller.signal,
        )) {
          text += delta;
          res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        }
      } finally {
        clearInterval(heartbeat);
      }
      if (controller.signal.aborted) return;
      let result: unknown;
      if (input.kind === 'article') {
        // Check all versions before writing any article so concurrent manual edits win.
        this.dao.transaction(() => {
          for (const s of snippets)
            if (this.dao.get(s.id)?.updated_at !== s.updated_at) throw new Error('conflict');
          const now = new Date().toISOString();
          for (const s of snippets)
            this.dao.db
              .prepare('UPDATE snippets SET ai_article=?,updated_at=? WHERE id=?')
              .run(text, now, s.id);
        });
      } else if (input.kind === 'chat')
        this.dao.appendExchange(snippets[0].id, input.question!, text);
      else if (source) {
        const candidates = parseCandidates(text, source.text.split(/\r?\n/).length);
        const scanId = randomUUID();
        for (const [id, old] of this.scans) if (old.expires < Date.now()) this.scans.delete(id);
        if (this.scans.size >= 20) this.scans.delete(this.scans.keys().next().value!);
        this.scans.set(scanId, {
          text: source.text,
          file: source.capture(1, 1).file_path,
          candidates,
          expires: Date.now() + 600_000,
        });
        result = { scanId, candidates };
      }
      res.write(`data: ${JSON.stringify({ done: true, result })}\n\n`);
      res.end();
      this.broadcast({ type: 'changed' });
    } finally {
      res.off('close', close);
      this.controllers.delete(controller);
      locks.forEach((id) => this.busy.delete(id));
    }
  }
  private async staticFile(path: string, res: ServerResponse) {
    const root = resolve(this.webRoot);
    const file = resolve(root, '.' + decodeURIComponent(path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + sep)) {
      json(res, 403, { error: 'forbidden' });
      return;
    }
    try {
      if (!(await stat(file)).isFile()) throw new Error('notFound');
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.wasm': 'application/wasm',
      };
      res.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'Content-Security-Policy':
          "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      });
      res.end(await readFile(file));
    } catch {
      json(res, 404, { error: 'notFound' });
    }
  }
  async close() {
    clearInterval(this.poll);
    for (const controller of this.controllers) controller.abort();
    for (const client of this.wss.clients) client.terminate();
    this.wss.close();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
