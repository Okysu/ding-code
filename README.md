# Ding Code

[简体中文](./README.zh-CN.md) · English

A local-first code pattern library for VS Code. Collect the engineering details worth remembering, annotate them in Markdown, and revisit them in a dedicated knowledge workbench.

**No account, cloud database, or AI key is required.** Optional BYOK AI can explain a pattern, draft a progressive technical article, or discuss the selected code.

## What you can do

- Collect selected code with **Ctrl / Cmd + Shift + D** or the editor context menu.
- Index `ding-code` comment directives on save, with CodeLens and gutter indicators.
- Follow the active file in a compact VS Code sidebar or a separate browser window.
- Search code, notes, articles, and tags with SQLite FTS5; filter by project, language, or tag.
- Write Markdown notes and articles, manage tags, and export articles as `.md` files.
- Back up the SQLite database or export your library and conversations as JSON.
- Switch between English and Simplified Chinese, and between light and dark themes.
- Optionally connect OpenAI Responses, OpenAI Chat Completions, or Anthropic Messages compatible providers.

The interface uses shadcn-vue components, Reka UI primitives, and Lucide icons. Extension surfaces use Codicons and monochrome SVGs. UI labels and generated default prompts contain no emoji.

## Install

Requires desktop **VS Code 1.100 or newer**. The extension uses the SQLite implementation bundled with VS Code's Node.js runtime; there is no native addon to compile.

Until a Marketplace version is published, build the VSIX locally:

```sh
git clone https://github.com/Okysu/ding-code.git
cd ding-code
corepack pnpm install --frozen-lockfile
corepack pnpm package
code --install-extension artifacts/ding-code-0.1.0.vsix
```

Development requires **Node.js 22.13+** and **pnpm 10.28.2**. Install or enable Corepack if it is not available in your Node.js distribution.

## Collect your first pattern

Select code in a saved local file, use **Ding Code: Save Snippet**, and enter an optional note and comma-separated tags. The shortcut intentionally uses Ctrl / Cmd + Shift + D; reassign it in Keyboard Shortcuts if you prefer to keep VS Code's default debugging shortcut.

You can also annotate source code:

```python
# ding-code: Keep configuration isolated from unrelated environment variables
class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="APP_", env_file=".env", extra="ignore"
    )
```

Use explicit ranges when a language's block structure is ambiguous:

```python
# ding-code-start: Preserve the original exception chain
try:
    payload = response.json()
except ValueError as exc:
    raise InvalidResponse("Invalid JSON response") from exc
# ding-code-end
```

Supported comment forms include `#`, `//`, `/* */`, `<!-- -->`, and `--`, selected by the editor's language identifier. `@ding-code` is also supported. Directive-like text inside ordinary quoted strings is ignored. An unclosed explicit range is ignored.

Click an indexed CodeLens to open the note and reveal its source. Use **Ding Code: Open Knowledge Workbench** or the globe status item to open the full workbench. Keep VS Code running while using the browser view.

## Optional AI

In **Settings & data**, enable AI and enter your provider's base URL, protocol, model name, and API key. You can also set the key through **Ding Code: Set or Clear AI API Key**. The key is stored in VS Code `SecretStorage`, never in SQLite, exported backups, or workspace settings.

| Protocol                | Endpoint appended to the base URL |
| ----------------------- | --------------------------------- |
| OpenAI Responses        | `/v1/responses`                   |
| OpenAI Chat Completions | `/v1/chat/completions`            |
| Anthropic Messages      | `/v1/messages`                    |

A base URL may already end in `/v1`. HTTPS is required for remote providers; local HTTP endpoints are supported. A nonempty API key is currently required even for a local compatible provider.

AI is invoked only by an explicit action. Article generation sends selected code, five lines of surrounding context, and notes. Chat also sends the recent conversation. Full-file scanning sends the active file and requires you to select suggestions before collecting them. These operations can incur provider charges. Check the code and provider before invoking them.

Articles follow four stages: the naive approach and pitfalls, core mechanisms, underlying principles, and a reusable pattern with a review checklist. Output follows the active interface language. Interrupted or incomplete generations do not replace existing articles.

## Data and privacy

- Default database: `~/.ding-code/knowledge.db`, configurable with `ding-code.databasePath`.
- Local HTTP and WebSocket services listen on `127.0.0.1` using a random port and per-process authentication token.
- SQLite WAL, foreign keys, transactions, and optimistic version checks protect local writes. Other views receive change notifications; cross-window database changes are detected by polling SQLite's data version.
- SHA-256 deduplication is scoped to the absolute source path. Re-indexing preserves edited notes, tags, and articles.
- There is no telemetry or automatic external model call. The browser bundle has no CDN or remote font dependency.
- Markdown HTML is disabled and rendered output is sanitized. Embedded Markdown images are disabled to avoid remote tracking requests.

To restore a database backup, close every VS Code window using it and place the downloaded database at the configured path. Changing the path does not migrate data automatically. JSON export is portable data export; a JSON import UI is not implemented.

## Development

```sh
corepack pnpm format       # Format source and documentation
corepack pnpm lint         # ESLint: TypeScript and Vue, zero warnings
corepack pnpm typecheck    # TypeScript + vue-tsc
corepack pnpm test         # Focused database, scanner, API, i18n, protocol tests
corepack pnpm build        # Web assets and bundled extension
corepack pnpm test:extension # Optional real VS Code host smoke test
corepack pnpm package      # Build and produce artifacts/*.vsix
corepack pnpm dev          # Local preview with isolated demonstration data
```

`dev` serves the already-built web bundle. Rebuild and reload after UI changes. Preview data lives in ignored `.dev-data/`; the preview does not open source files in VS Code or store real provider secrets. It is a development harness, not a separate production service. The extension host smoke test uses an isolated profile and database. On nonstandard installations, set `VSCODE_EXECUTABLE` to the VS Code executable.

```text
packages/
  extension/             VS Code integration and bundled local service
    src/ai/              Provider adapters and bilingual system prompts
    src/db.ts            SQLite migration, FTS5, CRUD, backup, chat history
    src/scanner.ts       Comment lexer and block capture heuristics
    src/server.ts        Authenticated HTTP/WS API and streaming orchestration
    src/extension.ts     Commands, CodeLens, decorations, sidebar lifecycle
    package.nls*.json    VS Code contribution translations
  web/                   Shared browser and sidebar Vue application
    src/components/ui/   Vendored shadcn-vue components and compositions
    src/i18n/            English and Simplified Chinese dictionaries
shared/                  Typed API contracts
tests/                   Focused tests and extension-host runner
scripts/                 Preview, packaging, and integration-test helpers
.github/workflows/       CI, VSIX artifacts, and optional Marketplace publishing
```

## Current boundaries

The scanner uses conservative lexical and indentation/bracket heuristics, not a full AST parser for every language. Prefer explicit ranges for complex macros, language-specific constructs, and ambiguous mixed-language files. Collected snippets are learning snapshots: file moves and unmarked edits do not automatically rewrite or remove them. Chinese substring searches use an escaped `LIKE` fallback alongside FTS5, so they have different performance characteristics on large libraries. Syntax highlighting includes a curated language set; other languages remain readable as plain text.

The initial target is a local desktop workspace. Browser-only VS Code, virtual filesystems, and remote-host path mapping are not supported. Live provider interoperability depends on the selected service and model; automated tests use local protocol fixtures, not paid API calls.

## Contributing

Issues and pull requests are welcome. Keep the manual workflow fully usable without AI, add both language strings for new UI text, use the shared shadcn-vue components, and preserve the zero-emoji policy. Run lint, type checking, and the focused tests before submitting a change. Do not commit collected code, databases, credentials, or preview profiles.

## License

[MIT](./LICENSE). Vendored shadcn-vue code retains its upstream license in [third-party notices](./THIRD_PARTY_NOTICES.md).
