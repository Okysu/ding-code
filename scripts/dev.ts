import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { KnowledgeDAO } from '../packages/extension/src/db';
import { AIService } from '../packages/extension/src/ai/service';
import { LocalServer, type Host } from '../packages/extension/src/server';
import type { AIConfig, Capture } from '../shared/types';
const dir = resolve('.dev-data');
mkdirSync(dir, { recursive: true });
const dao = new KnowledgeDAO(resolve(dir, 'knowledge.db'));
const examples = [
  {
    file: 'atomic_download.py',
    project: 'http-toolkit',
    language: 'python',
    note: '原子文件下载与兜底清理\n先写入同目录临时文件，再原子替换目标路径，避免中断下载污染现有文件。',
    tags: ['atomic-io', 'resource-safety'],
    code: 'tmp_path = None\ntry:\n    with tempfile.NamedTemporaryFile(\n        dir=target.parent, delete=False\n    ) as tmp:\n        tmp_path = Path(tmp.name)\n        for chunk in response.iter_bytes():\n            tmp.write(chunk)\n    tmp_path.replace(target)\nfinally:\n    if tmp_path is not None:\n        tmp_path.unlink(missing_ok=True)',
  },
  {
    file: 'settings.py',
    project: 'service-core',
    language: 'python',
    note: '声明式环境变量与配置隔离\n让配置边界显式化：前缀过滤、类型校验与未知变量容错。',
    tags: ['pydantic', 'configuration'],
    code: 'class Settings(BaseSettings):\n    model_config = SettingsConfigDict(\n        env_prefix="APP_",\n        env_file=".env",\n        extra="ignore",\n    )\n    request_timeout: float = 10.0',
  },
  {
    file: 'retry.ts',
    project: 'service-core',
    language: 'typescript',
    note: '可取消的请求生命周期\n将外部取消信号与超时信号组合，确保离开页面后请求及时结束。',
    tags: ['cancellation', 'fetch'],
    code: 'const signal = AbortSignal.any([\n  controller.signal,\n  AbortSignal.timeout(10_000),\n]);\nconst response = await fetch(url, { signal });\nif (!response.ok) {\n  throw new Error(`HTTP ${response.status}`);\n}',
  },
  {
    file: 'transaction.sql',
    project: 'knowledge-base',
    language: 'sql',
    note: '事务内维护数据一致性\n明确写入边界，在多个窗口访问同一个数据库时保持完整提交。',
    tags: ['sqlite', 'transactions'],
    code: 'PRAGMA journal_mode = WAL;\nPRAGMA foreign_keys = ON;\nPRAGMA busy_timeout = 5000;\n\nBEGIN IMMEDIATE;\nUPDATE snippets\nSET user_note = ?, updated_at = ?\nWHERE id = ?;\nCOMMIT;',
  },
  {
    file: 'errors.py',
    project: 'http-toolkit',
    language: 'python',
    note: '保留根因的异常转换\n对外提供领域语义，对内保留原始异常链，便于定位故障。',
    tags: ['exception-handling'],
    code: 'try:\n    payload = response.json()\nexcept ValueError as exc:\n    raise InvalidResponse(\n        "Provider returned invalid JSON"\n    ) from exc',
  },
  {
    file: 'cleanup.ts',
    project: 'service-core',
    language: 'typescript',
    note: '订阅生命周期与确定性清理\n在组件卸载时关闭连接，避免重复监听和后台资源泄漏。',
    tags: ['lifecycle', 'vue'],
    code: 'const unsubscribe = subscribe(onChange);\nconst controller = new AbortController();\n\nonBeforeUnmount(() => {\n  unsubscribe();\n  controller.abort();\n  clearTimeout(reconnectTimer);\n});',
  },
];
for (const ex of examples)
  dao.capture({
    file_path: resolve(dir, ex.file),
    relative_path: ex.file,
    project_name: ex.project,
    language: ex.language,
    code_content: ex.code,
    context_before: '',
    context_after: '',
    start_line: 1,
    end_line: ex.code.split('\n').length,
    source_type: 'manual_selection',
    user_note: ex.note,
    tags: ex.tags,
  });
const config: AIConfig = {
  enabled: false,
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  protocol: 'responses',
};
const host: Host = {
  state: async () => ({
    locale: 'zh-CN',
    activeFile: dao.list()[0]?.file_path ?? null,
    databasePath: dao.path,
    ai: { ...config, available: false, hasKey: false },
    version: '0.1.0-preview',
  }),
  open: async () => {},
  settings: async (value) => {
    Object.assign(config, value);
  },
  activeSource: async () => {
    const row = dao.list()[0];
    return { text: row.code_content, capture: () => row as Capture };
  },
};
async function main() {
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
  const url = server.browserUrl('zh-CN');
  writeFileSync(
    resolve(dir, 'preview.json'),
    JSON.stringify({ url, api: server.url, token: server.token }),
  );
  console.log(`Ding Code local preview: ${url}`);
  const close = async () => {
    await server.close();
    dao.close();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
void main();
