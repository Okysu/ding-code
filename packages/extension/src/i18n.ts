import { normalizeLocale, type Locale } from '../../../shared/types';
export { normalizeLocale };
const en = {
  saved: 'Snippet saved.',
  note: 'Your insight (Markdown, optional)',
  tags: 'Tags, separated by commas (optional)',
  selectCode: 'Select some code in a saved file first.',
  openWeb: 'Open Ding Code Workbench',
  indexed: 'Ding-Code Indexed | View Note',
  apiKey: 'API Key (leave empty to clear; stored in VS Code SecretStorage)',
  keySaved: 'AI credential updated.',
  aiUnavailable: 'Configure an optional BYOK model in Settings to enable this enhancement.',
  error: 'Ding Code: {0}',
  notFound: 'The snippet or source file was not found.',
  noFile: 'Open a local source file first.',
  scanning: 'Scanning industrial patterns',
  noPatterns: 'No strong patterns found.',
  choosePatterns: 'Select patterns to collect',
  reload:
    'Database path changed. Reload the window to use it. Existing data stays in its original location.',
  reloadAction: 'Reload Window',
  databaseVersion: 'The database was created by a newer version of Ding Code.',
  failure: 'The operation failed. Check the Ding Code output channel for details.',
  changedSource: 'The file changed after scanning. Scan it again.',
  backup: 'Save SQLite backup',
  backupSaved: 'Database backup saved.',
};
const zh: Record<keyof typeof en, string> = {
  saved: '代码范式已收录。',
  note: '个人感悟（Markdown，可选）',
  tags: '标签，以逗号分隔（可选）',
  selectCode: '请先在已保存的文件中选择代码。',
  openWeb: '打开 Ding Code 知识库工作台',
  indexed: 'Ding-Code 已收录 | 查看笔记',
  apiKey: 'API Key（留空清除，保存在 VS Code SecretStorage 中）',
  keySaved: 'AI 凭据已更新。',
  aiUnavailable: '在设置中配置可选的 BYOK 模型后，可使用此增强功能。',
  error: 'Ding Code：{0}',
  notFound: '未找到代码片段或源文件。',
  noFile: '请先打开本地源文件。',
  scanning: '正在扫描工业级写法',
  noPatterns: '未发现足够突出的代码范式。',
  choosePatterns: '选择要收录的代码范式',
  reload: '数据库路径已更改。重新加载窗口后生效，原有数据保留在原位置。',
  reloadAction: '重新加载窗口',
  databaseVersion: '此数据库由更高版本的 Ding Code 创建。',
  failure: '操作失败，详情请查看 Ding Code 输出面板。',
  changedSource: '扫描后文件已改变，请重新扫描。',
  backup: '保存 SQLite 备份',
  backupSaved: '数据库备份已保存。',
};
export function translator(language: string) {
  const locale: Locale = normalizeLocale(language);
  return (key: keyof typeof en, ...args: string[]) =>
    (locale === 'zh-CN' ? zh[key] : en[key]).replace(/\{(\d+)\}/g, (_, n) => args[Number(n)] ?? '');
}
