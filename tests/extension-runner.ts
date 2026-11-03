import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import manifest from '../packages/extension/package.json';
export async function run() {
  const root = process.env.DING_TEST_ROOT!;
  const results: string[] = [];
  try {
    const extension = vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`);
    assert.ok(extension);
    const api = await extension.activate();
    assert.ok(api?.dao);
    results.push('Extension activated with node:sqlite in the real VS Code host');
    const uri = vscode.Uri.file(resolve(root, '.test-output/workspace/sample.py'));
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    api.scan(document);
    const rows = api.dao.list({ file: uri.fsPath });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_note, 'atomic cleanup');
    results.push('Comment capture and SQLite persistence');
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      uri,
    );
    assert.ok(lenses?.some((l) => l.command?.command === 'ding-code.viewNote'));
    results.push('CodeLens registration and indexed command');
    await vscode.commands.executeCommand('ding-code.viewNote', rows[0].id);
    results.push('Sidebar Webview resolution and source reveal');
    for (let i = 0; i < 100 && !api.sidebar.ready; i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      api.sidebar.ready,
      true,
      'Sidebar must load the Vue bundle and successfully fetch authenticated state',
    );
    results.push('Sidebar Vue runtime, CSP, origin handshake, and authenticated API request');
    const response = await fetch(`${api.server.url}/api/state`, {
      headers: { Authorization: `Bearer ${api.server.token}` },
    });
    const state = (await response.json()) as { ai: { available: boolean } };
    assert.equal(state.ai.available, false);
    results.push('Local server and graceful no-key state');
    writeFileSync(
      resolve(root, '.test-output/extension-result.json'),
      JSON.stringify({ ok: true, node: process.version, results }, null, 2),
    );
  } catch (error) {
    mkdirSync(resolve(root, '.test-output'), { recursive: true });
    writeFileSync(
      resolve(root, '.test-output/extension-result.json'),
      JSON.stringify(
        { ok: false, results, error: String(error), stack: (error as Error).stack },
        null,
        2,
      ),
    );
    throw error;
  }
}
