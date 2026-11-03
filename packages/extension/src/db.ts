import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Capture, ChatMessage, Filters, Snippet } from '../../../shared/types';

export const schema = `
CREATE TABLE IF NOT EXISTS snippets (
 id TEXT PRIMARY KEY, file_path TEXT NOT NULL, relative_path TEXT NOT NULL,
 project_name TEXT NOT NULL, language TEXT NOT NULL, code_content TEXT NOT NULL,
 context_before TEXT NOT NULL DEFAULT '', context_after TEXT NOT NULL DEFAULT '',
 start_line INTEGER NOT NULL CHECK(start_line > 0), end_line INTEGER NOT NULL CHECK(end_line >= start_line),
 source_type TEXT NOT NULL CHECK(source_type IN ('comment_tag','manual_selection','ai_discovered')),
 source_key TEXT, user_note TEXT NOT NULL DEFAULT '', ai_analysis TEXT, ai_article TEXT,
 tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags)), content_hash TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(file_path,content_hash), UNIQUE(file_path,source_key)
);
CREATE INDEX IF NOT EXISTS snippets_file ON snippets(file_path);
CREATE INDEX IF NOT EXISTS snippets_project_language ON snippets(project_name,language);
CREATE TABLE IF NOT EXISTS chat_sessions (
 id TEXT PRIMARY KEY, snippet_id TEXT REFERENCES snippets(id) ON DELETE CASCADE,
 file_path TEXT, created_at TEXT NOT NULL, CHECK(snippet_id IS NOT NULL OR file_path IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_snippet ON chat_sessions(snippet_id) WHERE snippet_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS chat_messages (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_message_session ON chat_messages(session_id);
CREATE VIRTUAL TABLE IF NOT EXISTS snippets_fts USING fts5(
 code_content,user_note,ai_article,tags,content='snippets',content_rowid='rowid',tokenize='unicode61'
);
CREATE TRIGGER IF NOT EXISTS snippets_ai AFTER INSERT ON snippets BEGIN
 INSERT INTO snippets_fts(rowid,code_content,user_note,ai_article,tags) VALUES(new.rowid,new.code_content,new.user_note,new.ai_article,new.tags);
END;
CREATE TRIGGER IF NOT EXISTS snippets_ad AFTER DELETE ON snippets BEGIN
 INSERT INTO snippets_fts(snippets_fts,rowid,code_content,user_note,ai_article,tags) VALUES('delete',old.rowid,old.code_content,old.user_note,old.ai_article,old.tags);
END;
CREATE TRIGGER IF NOT EXISTS snippets_au AFTER UPDATE ON snippets BEGIN
 INSERT INTO snippets_fts(snippets_fts,rowid,code_content,user_note,ai_article,tags) VALUES('delete',old.rowid,old.code_content,old.user_note,old.ai_article,old.tags);
 INSERT INTO snippets_fts(rowid,code_content,user_note,ai_article,tags) VALUES(new.rowid,new.code_content,new.user_note,new.ai_article,new.tags);
END;`;

export const hashCode = (code: string) =>
  createHash('sha256').update(code.replace(/\r\n/g, '\n').trim()).digest('hex');
const decode = (row: unknown): Snippet => {
  const value = row as Snippet & { tags: string };
  return { ...value, tags: JSON.parse(value.tags) };
};

export class KnowledgeDAO {
  readonly db: DatabaseSync;
  constructor(readonly path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = Number(
      (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    );
    if (version > 1) {
      this.db.close();
      throw new Error('databaseVersion');
    }
    if (version < 1)
      this.transaction(() => {
        this.db.exec(schema);
        this.db.exec(
          "INSERT INTO snippets_fts(snippets_fts) VALUES('rebuild'); PRAGMA user_version=1;",
        );
      });
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  get(id: string): Snippet | undefined {
    const row = this.db.prepare('SELECT * FROM snippets WHERE id=?').get(id);
    return row ? decode(row) : undefined;
  }
  list(filters: Filters = {}): Snippet[] {
    const where: string[] = [];
    const params: string[] = [];
    if (filters.query?.trim()) {
      // Literal tokens prevent FTS syntax errors; LIKE provides Chinese substring search.
      const query = filters.query.trim().slice(0, 500);
      const tokens = query
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => `"${t.replace(/"/g, '""')}"*`)
        .join(' AND ');
      where.push(
        `(s.rowid IN (SELECT rowid FROM snippets_fts WHERE snippets_fts MATCH ?) OR (s.code_content||s.user_note||coalesce(s.ai_article,'')||s.tags) LIKE ? ESCAPE '\\')`,
      );
      params.push(tokens, `%${query.replace(/[\\%_]/g, '\\$&')}%`);
    }
    for (const [key, column] of [
      ['file', 'file_path'],
      ['project', 'project_name'],
      ['language', 'language'],
    ] as const) {
      if (filters[key]) {
        where.push(`s.${column}=?`);
        params.push(filters[key]!);
      }
    }
    if (filters.tag) {
      where.push('EXISTS(SELECT 1 FROM json_each(s.tags) WHERE value=?)');
      params.push(filters.tag);
    }
    return this.db
      .prepare(
        `SELECT s.* FROM snippets s ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.updated_at DESC,s.id`,
      )
      .all(...params)
      .map(decode);
  }
  capture(input: Capture): Snippet {
    return this.transaction(() => {
      const hash = hashCode(input.code_content);
      const duplicate = this.db
        .prepare('SELECT * FROM snippets WHERE file_path=? AND content_hash=?')
        .get(input.file_path, hash);
      const anchor = input.source_key
        ? this.db
            .prepare('SELECT * FROM snippets WHERE file_path=? AND source_key=?')
            .get(input.file_path, input.source_key)
        : undefined;
      const existing = duplicate || anchor;
      if (existing) {
        const old = decode(existing);
        // Saving or scanning again must never overwrite a user's notes, tags, or article.
        if (input.source_type === 'comment_tag' && old.source_type === 'comment_tag') {
          this.db
            .prepare(
              `UPDATE snippets SET code_content=?,content_hash=?,start_line=?,end_line=?,context_before=?,context_after=?,relative_path=?,updated_at=? WHERE id=?`,
            )
            .run(
              input.code_content,
              hash,
              input.start_line,
              input.end_line,
              input.context_before,
              input.context_after,
              input.relative_path,
              new Date().toISOString(),
              old.id,
            );
        }
        return this.get(old.id)!;
      }
      const now = new Date().toISOString();
      const row: Snippet = {
        ...input,
        id: randomUUID(),
        source_key: input.source_key ?? null,
        user_note: input.user_note ?? '',
        tags: input.tags ?? [],
        ai_analysis: input.ai_analysis ?? null,
        ai_article: null,
        content_hash: hash,
        created_at: now,
        updated_at: now,
      };
      const keys = Object.keys(row);
      this.db
        .prepare(`INSERT INTO snippets(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`)
        .run(
          ...keys.map((k) =>
            k === 'tags'
              ? JSON.stringify(row.tags)
              : (row[k as keyof Snippet] as string | number | null),
          ),
        );
      return row;
    });
  }
  update(
    id: string,
    patch: Partial<Pick<Snippet, 'user_note' | 'tags' | 'ai_article' | 'ai_analysis'>>,
    expectedUpdatedAt?: string,
  ): Snippet {
    return this.transaction(() => {
      const current = this.get(id);
      if (!current) throw new Error('notFound');
      if (expectedUpdatedAt && expectedUpdatedAt !== current.updated_at)
        throw new Error('conflict');
      const fields = (['user_note', 'tags', 'ai_article', 'ai_analysis'] as const).filter(
        (k) => patch[k] !== undefined,
      );
      if (fields.length) {
        const now = new Date(
          Math.max(Date.now(), Date.parse(current.updated_at) + 1),
        ).toISOString();
        this.db
          .prepare(
            `UPDATE snippets SET ${fields.map((k) => `${k}=?`).join(',')},updated_at=? WHERE id=?`,
          )
          .run(
            ...fields.map((k) =>
              k === 'tags' ? JSON.stringify(patch[k]) : (patch[k] as string | null),
            ),
            now,
            id,
          );
      }
      return this.get(id)!;
    });
  }
  delete(id: string) {
    this.db.prepare('DELETE FROM snippets WHERE id=?').run(id);
  }
  messages(snippetId: string): ChatMessage[] {
    return this.db
      .prepare(
        'SELECT m.* FROM chat_messages m JOIN chat_sessions s ON s.id=m.session_id WHERE s.snippet_id=? ORDER BY m.rowid',
      )
      .all(snippetId) as unknown as ChatMessage[];
  }
  appendExchange(snippetId: string, question: string, answer: string) {
    this.transaction(() => {
      const session = this.db
        .prepare('SELECT id FROM chat_sessions WHERE snippet_id=?')
        .get(snippetId) as { id: string } | undefined;
      const id = session?.id ?? randomUUID();
      const now = new Date().toISOString();
      if (!session)
        this.db
          .prepare('INSERT INTO chat_sessions(id,snippet_id,created_at) VALUES(?,?,?)')
          .run(id, snippetId, now);
      for (const [role, content] of [
        ['user', question],
        ['assistant', answer],
      ])
        this.db
          .prepare('INSERT INTO chat_messages VALUES(?,?,?,?,?)')
          .run(randomUUID(), id, role, content, now);
    });
  }
  exportData() {
    return {
      version: 1,
      exported_at: new Date().toISOString(),
      snippets: this.list(),
      chat_sessions: this.db.prepare('SELECT * FROM chat_sessions').all(),
      chat_messages: this.db.prepare('SELECT * FROM chat_messages ORDER BY rowid').all(),
    };
  }
  backup(destination: string) {
    this.db.prepare('VACUUM INTO ?').run(destination);
  }
  close() {
    this.db.close();
  }
}
