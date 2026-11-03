export type Locale = 'en-US' | 'zh-CN';
export type SourceType = 'comment_tag' | 'manual_selection' | 'ai_discovered';
export interface Snippet {
  id: string;
  file_path: string;
  relative_path: string;
  project_name: string;
  language: string;
  code_content: string;
  context_before: string;
  context_after: string;
  start_line: number;
  end_line: number;
  source_type: SourceType;
  source_key: string | null;
  user_note: string;
  ai_analysis: string | null;
  ai_article: string | null;
  tags: string[];
  content_hash: string;
  created_at: string;
  updated_at: string;
}
export type Capture = Pick<
  Snippet,
  | 'file_path'
  | 'relative_path'
  | 'project_name'
  | 'language'
  | 'code_content'
  | 'context_before'
  | 'context_after'
  | 'start_line'
  | 'end_line'
  | 'source_type'
> &
  Partial<Pick<Snippet, 'source_key' | 'user_note' | 'tags' | 'ai_analysis'>>;
export interface Filters {
  query?: string;
  file?: string;
  project?: string;
  language?: string;
  tag?: string;
}
export type Protocol = 'responses' | 'chat-completions' | 'anthropic';
export interface AIConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  protocol: Protocol;
}
export interface AppState {
  locale: Locale;
  activeFile: string | null;
  databasePath: string;
  ai: AIConfig & { available: boolean; hasKey: boolean };
  version: string;
}
export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}
export interface Candidate {
  start_line: number;
  end_line: number;
  title: string;
  reason: string;
  tags: string[];
}
export type ChangeEvent = { type: 'changed' | 'state' } | { type: 'focus'; id: string };
export interface Bootstrap {
  api: string;
  token: string;
  locale: Locale;
  compact: boolean;
}
export function normalizeLocale(value: string): Locale {
  return value.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}
