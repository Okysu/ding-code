import * as vscode from 'vscode';
import { homedir } from 'node:os';
import { join, resolve, relative, basename } from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { KnowledgeDAO } from './db';
import { AIService, endpoint, parseCandidates } from './ai/service';
import { systemPrompt } from './ai/prompts';
import { LocalServer, type Host } from './server';
import { scanDirectives } from './scanner';
import { translator, normalizeLocale } from './i18n';
import type { AIConfig, Capture } from '../../../shared/types';

let shutdown: (() => Promise<void>) | undefined;
export async function activate(context: vscode.ExtensionContext) {
  const t = translator(vscode.env.language);
  const locale = normalizeLocale(vscode.env.language);
  const output = vscode.window.createOutputChannel('Ding Code');
  context.subscriptions.push(output);
  const config = () => vscode.workspace.getConfiguration('ding-code');
  const aiConfig = (): AIConfig => ({
    enabled: config().get('ai.enabled', false),
    baseUrl: config().get('ai.baseUrl', 'https://api.openai.com/v1'),
    model: config().get('ai.model', ''),
    protocol: config().get('ai.protocol', 'responses'),
  });
  const configuredPath = config().get('databasePath', '~/.ding-code/knowledge.db');
  const databasePath = resolve(configuredPath.replace(/^~(?=[/\\]|$)/, homedir()));
  let dao: KnowledgeDAO;
  try {
    dao = new KnowledgeDAO(databasePath);
  } catch (error) {
    output.appendLine(String(error));
    void vscode.window.showErrorMessage(t('failure'));
    return;
  }
  const ai = new AIService(aiConfig, async () => context.secrets.get('ding-code.apiKey'));
  const lenses = new vscode.EventEmitter<void>();
  const decoration = vscode.window.createTextEditorDecorationType({
    gutterIconPath: vscode.Uri.joinPath(context.extensionUri, 'media/gutter.svg'),
    gutterIconSize: 'contain',
  });
  const highlight = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
  });
  const timers = new Set<ReturnType<typeof setTimeout>>();
  function capture(document: vscode.TextDocument, start: number, end: number): Capture {
    const lines = document.getText().split(/\r?\n/);
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    return {
      file_path: document.uri.fsPath,
      relative_path: folder
        ? relative(folder.uri.fsPath, document.uri.fsPath)
        : basename(document.uri.fsPath),
      project_name: folder?.name ?? '',
      language: document.languageId,
      code_content: lines.slice(start - 1, end).join('\n'),
      context_before: lines.slice(Math.max(0, start - 6), start - 1).join('\n'),
      context_after: lines.slice(end, end + 5).join('\n'),
      start_line: start,
      end_line: end,
      source_type: 'manual_selection',
    };
  }
  async function open(id: string) {
    const snippet = dao.get(id);
    if (!snippet) throw new Error('notFound');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(snippet.file_path));
    const editor = await vscode.window.showTextDocument(doc, {
      preview: false,
      preserveFocus: true,
    });
    const start = Math.min(snippet.start_line - 1, doc.lineCount - 1);
    const end = Math.min(snippet.end_line - 1, doc.lineCount - 1);
    const range = new vscode.Range(start, 0, end, doc.lineAt(end).text.length);
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    editor.setDecorations(highlight, [range]);
    const timer = setTimeout(() => {
      editor.setDecorations(highlight, []);
      timers.delete(timer);
    }, 1800);
    timers.add(timer);
  }
  const host: Host = {
    state: async () => ({
      locale,
      activeFile:
        vscode.window.activeTextEditor?.document.uri.scheme === 'file'
          ? vscode.window.activeTextEditor.document.uri.fsPath
          : null,
      databasePath,
      ai: {
        ...aiConfig(),
        hasKey: Boolean(await context.secrets.get('ding-code.apiKey')),
        available: await ai.available(),
      },
      version: context.extension.packageJSON.version,
    }),
    open,
    settings: async (value) => {
      if (value.baseUrl) endpoint(value);
      for (const key of ['enabled', 'baseUrl', 'model', 'protocol'] as const)
        await config().update(`ai.${key}`, value[key], vscode.ConfigurationTarget.Global);
      if (value.apiKey !== undefined) {
        if (value.apiKey) await context.secrets.store('ding-code.apiKey', value.apiKey);
        else await context.secrets.delete('ding-code.apiKey');
      }
      if (value.databasePath && value.databasePath !== config().get('databasePath'))
        await config().update(
          'databasePath',
          value.databasePath,
          vscode.ConfigurationTarget.Global,
        );
    },
    activeSource: async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc || doc.uri.scheme !== 'file' || doc.isUntitled) throw new Error('noFile');
      // Snapshot text and metadata together; adoption rechecks against the active document.
      const text = doc.getText();
      return { text, capture: (start, end) => capture(doc, start, end) };
    },
  };
  const server = new LocalServer(dao, ai, host, join(context.extensionPath, 'dist/web'));
  try {
    await server.start();
  } catch (error) {
    dao.close();
    output.appendLine(String(error));
    void vscode.window.showErrorMessage(t('failure'));
    return;
  }
  shutdown = async () => {
    for (const timer of timers) clearTimeout(timer);
    await server.close();
    dao.close();
  };
  const guard =
    <T extends unknown[]>(fn: (...args: T) => unknown) =>
    async (...args: T) => {
      try {
        return await fn(...args);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'failure';
        output.appendLine(`[${new Date().toISOString()}] ${message}`);
        void vscode.window.showErrorMessage(
          t(
            message === 'notFound' || message === 'noFile' || message === 'changedSource'
              ? message
              : 'failure',
          ),
        );
      }
    };
  function refresh() {
    lenses.fire();
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.scheme !== 'file') continue;
      editor.setDecorations(
        decoration,
        dao
          .list({ file: editor.document.uri.fsPath })
          .map(
            (s) =>
              new vscode.Range(
                Math.min(s.start_line - 1, editor.document.lineCount - 1),
                0,
                Math.min(s.start_line - 1, editor.document.lineCount - 1),
                0,
              ),
          ),
      );
    }
  }
  server.onChange = refresh;
  function scan(document: vscode.TextDocument) {
    if (
      document.uri.scheme !== 'file' ||
      document.isUntitled ||
      document.getText().length > 2_000_000
    )
      return;
    const blocks = scanDirectives(document.getText(), document.languageId);
    for (const block of blocks)
      dao.capture({
        ...capture(document, block.start_line, block.end_line),
        source_type: 'comment_tag',
        source_key: block.key,
        user_note: block.note,
      });
    if (blocks.length) server.broadcast({ type: 'changed' });
    refresh();
  }
  let pendingFocus: string | undefined;
  class Sidebar implements vscode.WebviewViewProvider {
    view?: vscode.WebviewView;
    ready = false;
    async resolveWebviewView(view: vscode.WebviewView) {
      this.view = view;
      const web = view.webview;
      const root = vscode.Uri.joinPath(context.extensionUri, 'dist/web');
      web.options = { enableScripts: true, localResourceRoots: [root] };
      const nonce = randomBytes(18).toString('hex');
      const origin = web.cspSource;
      let documentOrigin: string | undefined;
      let html = await readFile(join(root.fsPath, 'index.html'), 'utf8');
      html = html.replace(
        /(src|href)="\.\/([^"]+)"/g,
        (_, attr, path) => `${attr}="${web.asWebviewUri(vscode.Uri.joinPath(root, path))}"`,
      );
      html = html.replace(/<script /g, `<script nonce="${nonce}" `);
      const boot = JSON.stringify({
        api: server.url,
        token: server.token,
        locale,
        compact: true,
      }).replace(/</g, '\\u003c');
      const csp = `default-src 'none'; script-src 'nonce-${nonce}' ${origin}; style-src ${origin} 'unsafe-inline'; font-src ${origin}; img-src ${origin} data:; connect-src ${server.url} ${server.url.replace('http:', 'ws:')}; base-uri 'none';`;
      web.html = html.replace(
        '<head>',
        `<head><meta http-equiv="Content-Security-Policy" content="${csp}"><script nonce="${nonce}">window.__DING_BOOT__=${boot};window.__VSCODE__=acquireVsCodeApi();</script>`,
      );
      web.onDidReceiveMessage(
        guard(async (message) => {
          if (message?.type === 'connect' && typeof message.origin === 'string') {
            const candidate = new URL(message.origin);
            if (
              candidate.hostname &&
              (candidate.protocol === 'vscode-webview:' || candidate.protocol === 'https:')
            ) {
              if (documentOrigin) server.origins.delete(documentOrigin);
              documentOrigin = message.origin;
              server.origins.add(documentOrigin!);
              await web.postMessage({ type: 'connected' });
            }
          }
          if (message?.type === 'ready') {
            this.ready = true;
            if (pendingFocus) server.broadcast({ type: 'focus', id: pendingFocus });
          }
          if (message?.type === 'openWeb')
            await vscode.env.openExternal(vscode.Uri.parse(server.browserUrl(locale)));
        }),
        undefined,
        context.subscriptions,
      );
      view.onDidDispose(
        () => {
          this.view = undefined;
          this.ready = false;
          if (documentOrigin) server.origins.delete(documentOrigin);
        },
        undefined,
        context.subscriptions,
      );
    }
  }
  const sidebar = new Sidebar();
  context.subscriptions.push(
    lenses,
    decoration,
    highlight,
    vscode.window.registerWebviewViewProvider('ding-code.sidebar', sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file' },
      {
        onDidChangeCodeLenses: lenses.event,
        provideCodeLenses: (doc) =>
          dao
            .list({ file: doc.uri.fsPath })
            .filter((s) => s.start_line <= doc.lineCount)
            .map(
              (s) =>
                new vscode.CodeLens(new vscode.Range(s.start_line - 1, 0, s.start_line - 1, 0), {
                  title: `$(bookmark) ${t('indexed')}`,
                  command: 'ding-code.viewNote',
                  arguments: [s.id],
                }),
            ),
      },
    ),
    vscode.workspace.onDidSaveTextDocument(guard(scan)),
    vscode.window.onDidChangeActiveTextEditor(
      guard((editor) => {
        if (editor) scan(editor.document);
        server.broadcast({ type: 'state' });
      }),
    ),
    vscode.commands.registerCommand(
      'ding-code.openWeb',
      guard(() => vscode.env.openExternal(vscode.Uri.parse(server.browserUrl(locale)))),
    ),
    vscode.commands.registerCommand(
      'ding-code.viewNote',
      guard(async (id: string) => {
        pendingFocus = id;
        await vscode.commands.executeCommand('ding-code.sidebar.focus');
        await open(id);
        server.broadcast({ type: 'focus', id });
      }),
    ),
    vscode.commands.registerCommand(
      'ding-code.saveSnippet',
      guard(async () => {
        const editor = vscode.window.activeTextEditor;
        if (
          !editor ||
          editor.selection.isEmpty ||
          editor.document.isUntitled ||
          editor.document.uri.scheme !== 'file'
        ) {
          void vscode.window.showInformationMessage(t('selectCode'));
          return;
        }
        const selection = editor.selection;
        const doc = editor.document;
        const end =
          selection.end.character === 0 && selection.end.line > selection.start.line
            ? selection.end.line
            : selection.end.line + 1;
        const input = {
          ...capture(doc, selection.start.line + 1, end),
          code_content: doc.getText(selection),
        };
        const note = await vscode.window.showInputBox({ prompt: t('note'), ignoreFocusOut: true });
        if (note === undefined) return;
        const tags = await vscode.window.showInputBox({ prompt: t('tags'), ignoreFocusOut: true });
        if (tags === undefined) return;
        const snippet = dao.capture({
          ...input,
          user_note: note,
          tags: [
            ...new Set(
              tags
                .split(/[,，]/)
                .map((t) => t.trim())
                .filter(Boolean),
            ),
          ],
        });
        pendingFocus = snippet.id;
        server.broadcast({ type: 'changed' });
        await vscode.commands.executeCommand('ding-code.sidebar.focus');
        server.broadcast({ type: 'focus', id: snippet.id });
        void vscode.window.setStatusBarMessage(t('saved'), 3000);
      }),
    ),
    vscode.commands.registerCommand(
      'ding-code.setApiKey',
      guard(async () => {
        const key = await vscode.window.showInputBox({
          prompt: t('apiKey'),
          password: true,
          ignoreFocusOut: true,
        });
        if (key === undefined) return;
        if (key.trim()) await context.secrets.store('ding-code.apiKey', key.trim());
        else await context.secrets.delete('ding-code.apiKey');
        server.broadcast({ type: 'state' });
        void vscode.window.setStatusBarMessage(t('keySaved'), 3000);
      }),
    ),
    vscode.commands.registerCommand(
      'ding-code.scanFile',
      guard(async () => {
        if (!(await ai.available())) {
          void vscode.window.setStatusBarMessage(t('aiUnavailable'), 5000);
          return;
        }
        const source = await host.activeSource();
        if (source.text.length > 300_000) throw new Error('contextTooLarge');
        const text = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: t('scanning'),
            cancellable: true,
          },
          async (_, token) => {
            const controller = new AbortController();
            const disposable = token.onCancellationRequested(() => controller.abort());
            let result = '';
            try {
              for await (const delta of ai.stream(
                systemPrompt('scan', locale),
                [
                  {
                    role: 'user',
                    content: source.text
                      .split(/\r?\n/)
                      .map((s, i) => `${i + 1}: ${s}`)
                      .join('\n'),
                  },
                ],
                controller.signal,
              ))
                result += delta;
              return result;
            } catch (error) {
              if (controller.signal.aborted) return '';
              throw error;
            } finally {
              disposable.dispose();
            }
          },
        );
        if (!text) return;
        const candidates = parseCandidates(text, source.text.split(/\r?\n/).length);
        if (!candidates.length) {
          void vscode.window.showInformationMessage(t('noPatterns'));
          return;
        }
        const choices = await vscode.window.showQuickPick(
          candidates.map((c) => ({
            label: c.title,
            description: `L${c.start_line}–${c.end_line}`,
            detail: c.reason,
            candidate: c,
          })),
          { canPickMany: true, placeHolder: t('choosePatterns') },
        );
        if (!choices?.length) return;
        const current = await host.activeSource();
        if (
          current.text !== source.text ||
          current.capture(1, 1).file_path !== source.capture(1, 1).file_path
        )
          throw new Error('changedSource');
        for (const { candidate: c } of choices)
          dao.capture({
            ...source.capture(c.start_line, c.end_line),
            source_type: 'ai_discovered',
            user_note: c.title,
            ai_analysis: c.reason,
            tags: c.tags,
          });
        server.broadcast({ type: 'changed' });
      }),
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('ding-code')) server.broadcast({ type: 'state' });
      if (event.affectsConfiguration('ding-code.databasePath'))
        void vscode.window.showInformationMessage(t('reload'), t('reloadAction')).then((action) => {
          if (action) void vscode.commands.executeCommand('workbench.action.reloadWindow');
        });
    }),
    context.secrets.onDidChange((event) => {
      if (event.key === 'ding-code.apiKey') server.broadcast({ type: 'state' });
    }),
  );
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = '$(globe) Ding Code';
  status.tooltip = t('openWeb');
  status.command = 'ding-code.openWeb';
  status.show();
  context.subscriptions.push(status);
  for (const doc of vscode.workspace.textDocuments) await guard(scan)(doc);
  return { dao, server, scan, capture, sidebar };
}
export async function deactivate() {
  const close = shutdown;
  shutdown = undefined;
  await close?.();
}
