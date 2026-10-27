'use strict';
// Inside VS Code: the .om association, omc diagnostics through the omega.check command, and Format
// Document through om2 fmt. With a fake omc (negative control) the diagnostic check must fail.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function open(dir, name, text) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(doc);
  return doc;
}

exports.run = async function run() {
  const ext = vscode.extensions.getExtension('aien-dev.omega');
  assert.ok(ext, 'extension aien-dev.omega is loaded');
  await vscode.workspace.getConfiguration('omega').update('omcPath', process.env.OMC, vscode.ConfigurationTarget.Global);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-vscode-'));

  const bad = await open(dir, 'bad.om', 'fn main to int\nret (5\nend\n');
  assert.strictEqual(bad.languageId, 'omega', '.om opens as omega');
  await ext.activate();
  await vscode.commands.executeCommand('omega.check');
  const diags = await waitFor(() => {
    const d = vscode.languages.getDiagnostics(bad.uri);
    return d.length ? d : null;
  });
  assert.ok(diags && diags.length === 1, `one diagnostic for bad.om, got ${JSON.stringify(diags)}`);
  assert.strictEqual(diags[0].range.start.line, 2, 'omc reports line 3 (0-based 2)');
  assert.strictEqual(diags[0].message, 'omc error 16');
  assert.strictEqual(diags[0].source, 'omc');
  console.log('PASS diagnostic', diags[0].range.start.line + 1, diags[0].message);

  const good = await open(dir, 'good.om', 'fn main to int\nret 0\nend\n');
  await vscode.commands.executeCommand('omega.check');
  await new Promise((r) => setTimeout(r, 1500));
  assert.deepStrictEqual(vscode.languages.getDiagnostics(good.uri), [], 'no diagnostic for an accepted unit');
  console.log('PASS accepted unit has no diagnostic');

  const messy = await open(dir, 'messy.om', 'note keep  this\nfn   main  to int\n    ret 0\nend\n');
  const edits = await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', messy.uri, {
    tabSize: 4,
    insertSpaces: true,
  });
  // VS Code may shrink the provider's whole-document edit into smaller ones, so apply them and compare.
  assert.ok(edits && edits.length > 0, `formatting edits, got ${JSON.stringify(edits)}`);
  const we = new vscode.WorkspaceEdit();
  we.set(messy.uri, edits);
  assert.ok(await vscode.workspace.applyEdit(we), 'formatting edits apply');
  assert.strictEqual(messy.getText(), 'note keep  this\nfn main to int\n    ret 0\nend\n');
  console.log('PASS format', edits.length, 'edit(s)');
};
