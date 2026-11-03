# Ding Code

简体中文 · [English](./README.md)

一个本地优先的 VS Code 代码范式知识库。随手收录值得学习的工程细节，撰写 Markdown 笔记，再通过独立工作台整理、检索和深入理解。

**核心功能不需要账号、云端数据库或 AI Key。** 可选的 BYOK AI 能解释代码、生成由浅入深的技术微文章，并围绕所选片段进行问答。

## 功能

- 选中代码后按 **Ctrl / Cmd + Shift + D**，或通过右键菜单收录。
- 保存文件时识别 `ding-code` 注释，显示 CodeLens 与行号旁标记。
- VS Code 侧边栏与浏览器实时看板跟随当前活动文件。
- SQLite FTS5 检索源码、笔记、文章和标签，支持项目、语言、标签筛选。
- 手工编辑 Markdown 笔记与微文章，管理标签，导出独立 `.md` 文件。
- 下载一致的 SQLite 备份，或将知识库与对话导出为 JSON。
- 简体中文 / 英文实时切换，支持浅色与深色主题。
- 可选接入 OpenAI Responses、OpenAI Chat Completions、Anthropic Messages 兼容服务。

Web 界面使用 shadcn-vue 组件、Reka UI 原语和 Lucide 图标，插件使用 Codicons 与单色 SVG。界面标签和默认生成提示词不使用 Emoji。

## 安装

需要桌面版 **VS Code 1.100 或更新版本**。SQLite 使用 VS Code 内置 Node.js 运行时提供的实现，无需编译原生扩展。

Marketplace 版本发布前，可以从源码构建 VSIX：

```sh
git clone https://github.com/Okysu/ding-code.git
cd ding-code
corepack pnpm install --frozen-lockfile
corepack pnpm package
code --install-extension artifacts/ding-code-0.1.0.vsix
```

开发环境需要 **Node.js 22.13+** 和 **pnpm 10.28.2**。如果 Node.js 发行版未附带 Corepack，请先安装或启用它。

## 收录第一个代码范式

在已保存的本地文件中选择代码，执行 **Ding Code: 收录此代码范式**，输入可选的个人感悟和逗号分隔的标签。快捷键占用了 VS Code 默认调试入口的 Ctrl / Cmd + Shift + D；如需保留原快捷键，可在键盘快捷方式中重新绑定。

也可以直接在源码中添加标记：

```python
# ding-code: 声明式环境变量前缀与配置隔离
class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="APP_", env_file=".env", extra="ignore"
    )
```

对于结构复杂或边界不明确的代码，使用显式区间：

```python
# ding-code-start: 异常转换时保留根因
try:
    payload = response.json()
except ValueError as exc:
    raise InvalidResponse("Invalid JSON response") from exc
# ding-code-end
```

支持 `#`、`//`、`/* */`、`<!-- -->`、`--` 等注释形式，具体按编辑器语言标识识别，也支持 `@ding-code`。普通字符串中的伪标记不会被采集；未闭合的显式区间会被忽略。

点击 CodeLens 可打开笔记并定位源码。通过 **Ding Code: 打开知识库工作台** 或状态栏的地球图标打开浏览器工作台。使用浏览器期间需保持 VS Code 运行。

## 可选 AI

在 **设置与数据** 中启用 AI，填写服务商基础地址、协议、模型名称与 API Key。也可通过 **Ding Code: 设置或清除 AI API Key** 输入密钥。密钥仅保存在 VS Code `SecretStorage`，不写入 SQLite、导出备份或工作区设置。

| 协议                    | 追加到基础地址的端点   |
| ----------------------- | ---------------------- |
| OpenAI Responses        | `/v1/responses`        |
| OpenAI Chat Completions | `/v1/chat/completions` |
| Anthropic Messages      | `/v1/messages`         |

基础地址可以包含 `/v1`。远程服务要求 HTTPS，本机服务允许 HTTP。当前实现对本机兼容服务也要求填写非空 API Key。

只有主动操作才会调用 AI：生成文章发送所选代码、前后各五行上下文和笔记；对话还会发送近期聊天记录；全文件扫描发送当前文件，并在你选择采纳后入库。服务商可能收取费用，请在调用前检查代码内容与目标服务。

文章采用四步结构：痛点与直觉写法、核心机制拆解、底层原理与设计哲学、可复用范式与检查清单。输出语言跟随当前界面。流式响应中断或不完整时，不会覆盖已有文章。

## 数据与隐私

- 默认数据库为 `~/.ding-code/knowledge.db`，可通过 `ding-code.databasePath` 修改。
- HTTP 与 WebSocket 服务仅监听 `127.0.0.1`，使用随机端口和每次进程启动生成的鉴权令牌。
- SQLite 启用 WAL、外键、事务与乐观版本检查。同一服务下的视图实时接收通知，跨窗口数据库变化通过 SQLite 数据版本轮询发现。
- SHA-256 防重以绝对文件路径为范围；重新索引不会覆盖用户编辑的笔记、标签和文章。
- 无遥测，不自动调用模型。前端不依赖 CDN 或远程字体。
- Markdown 禁用原始 HTML，并清理渲染结果；禁用内嵌图片，避免远程追踪请求。

恢复 SQLite 备份时，请关闭使用该数据库的所有 VS Code 窗口，再将备份复制到配置路径。修改路径不会自动迁移旧数据。JSON 导出用于数据携带，目前没有 JSON 导入界面。

## 开发

```sh
corepack pnpm format          # 格式化源码与文档
corepack pnpm lint            # TypeScript / Vue ESLint，零警告
corepack pnpm typecheck       # TypeScript + vue-tsc
corepack pnpm test            # 数据库、扫描器、API、i18n、协议测试
corepack pnpm build           # 构建 Web 资源与插件
corepack pnpm test:extension  # 可选：真实 VS Code 扩展宿主冒烟测试
corepack pnpm package         # 构建并生成 artifacts/*.vsix
corepack pnpm dev             # 使用隔离演示数据启动本地预览
```

`dev` 托管已经构建的前端，修改后需重新构建并刷新。演示数据位于被 Git 忽略的 `.dev-data/`；预览环境不会在 VS Code 中定位源码，也不保存真实服务商密钥，它不是独立生产服务。扩展宿主测试使用隔离配置和数据库；非标准安装路径可通过 `VSCODE_EXECUTABLE` 指定 VS Code 可执行文件。

```text
packages/
  extension/             VS Code 集成与内嵌本地服务
    src/ai/              多协议适配与中英文 System Prompt
    src/db.ts            SQLite 迁移、FTS5、CRUD、备份、对话历史
    src/scanner.ts       注释词法分析与代码块捕获
    src/server.ts        鉴权 HTTP/WS API 与流式调度
    src/extension.ts     命令、CodeLens、装饰与侧边栏生命周期
    package.nls*.json    插件贡献点翻译
  web/                   浏览器与侧边栏复用的 Vue 应用
    src/components/ui/   官方 shadcn-vue 源码与业务组合
    src/i18n/            中英文词典
shared/                  前后端类型契约
tests/                   聚焦测试与扩展宿主运行器
scripts/                 预览、打包与集成验证脚本
.github/workflows/       CI、VSIX 产物与可选市场发布
```

## 当前边界

扫描器采用保守的词法、缩进和括号启发式规则，并非所有语言的完整 AST 解析器。复杂宏、语言特有结构和混合语言文件建议使用显式区间。已收录内容是学习快照；文件移动和未标记代码的修改不会自动改写或删除历史收藏。中文子串查询通过转义后的 `LIKE` 补充 FTS5，因此大型知识库下的性能特征不同。语法高亮内置常用语言集合，其他语言以纯文本显示。

首版面向本机桌面工作区，不支持浏览器版 VS Code、虚拟文件系统和远程主机路径映射。兼容服务的实际 AI 行为取决于服务商与模型；自动测试使用本地协议夹具，不调用付费接口。

## 参与贡献

欢迎提交 Issue 和 Pull Request。请保持无 AI 工作流完整可用，为新界面文字同时提供中英文翻译，复用 shadcn-vue 组件，并遵守零 Emoji 约束。提交前运行 lint、类型检查与聚焦测试，不要提交收藏数据、数据库、凭据或预览配置。

## 许可证

[MIT](./LICENSE)。引用的 shadcn-vue 组件保留上游 MIT 许可，详见 [第三方声明](./THIRD_PARTY_NOTICES.md)。
