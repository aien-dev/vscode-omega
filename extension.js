'use strict';
// Omega for VS Code: optional omc diagnostics on save and `om2 fmt` formatting. Both do nothing until
// an omc is found (setting omega.omcPath, else `omc` on PATH). omc is a static AArch64 Linux program.
const vscode = require('vscode');
const omcLib = require('./omc');

function settings() {
  const c = vscode.workspace.getConfiguration('omega');
  return {
    omcPath: c.get('omcPath') || '',
    onSave: c.get('diagnostics.onSave', true),
    timeoutMs: c.get('omcTimeoutMs', 10000),
  };
}

function toDiagnostic(doc, d) {
  const lineNo = Math.min(Math.max(d.line - 1, 0), Math.max(doc.lineCount - 1, 0));
  const line = doc.lineAt(lineNo);
  let range = line.range;
  if (d.col !== undefined && d.span) {
    const start = Math.min(Math.max(d.col - 1, 0), line.text.length);
    const end = Math.min(start + Math.max(d.span[1] - d.span[0], 1), line.text.length);
    range = new vscode.Range(lineNo, start, lineNo, Math.max(end, start));
  }
  const extra = d.sev ? ` (${d.sev}${d.detail ? ', ' + d.detail : ''})` : '';
  const diag = new vscode.Diagnostic(range, `omc error ${d.code}${extra}`, vscode.DiagnosticSeverity.Error);
  diag.source = 'omc';
  diag.code = d.code;
  return diag;
}

function activate(context) {
  const collection = vscode.languages.createDiagnosticCollection('omc');
  const log = vscode.window.createOutputChannel('Omega');
  context.subscriptions.push(collection, log);
  let warned = false;

  const omc = () => {
    const s = settings();
    const found = omcLib.findOmc(s.omcPath);
    if (!found && !warned) {
      warned = true;
      log.appendLine(
        s.omcPath
          ? `omega.omcPath "${s.omcPath}" is not an executable file; diagnostics and formatting are off.`
          : 'No omc on PATH; diagnostics and formatting are off. omc runs on AArch64 Linux; build it with ' +
              '`sh seed/omega-from-seed.sh` in aien-dev/omega-mv and set omega.omcPath to seed/out/omc.',
      );
    }
    return { path: found, ...s };
  };

  const check = async (doc) => {
    if (doc.languageId !== 'omega') return;
    const o = omc();
    if (!o.path) return;
    try {
      const r = await omcLib.check(o.path, doc.getText(), o.timeoutMs);
      if (r.killed) {
        log.appendLine(`omc was stopped after ${o.timeoutMs} ms (${r.killed}) on ${doc.uri.fsPath}`);
        return;
      }
      collection.set(doc.uri, r.diagnostics.map((d) => toDiagnostic(doc, d)));
    } catch (e) {
      log.appendLine(`could not run ${o.path}: ${e.message}`);
    }
  };

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (settings().onSave) check(doc);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)),
    vscode.commands.registerCommand('omega.check', () => {
      const ed = vscode.window.activeTextEditor;
      if (ed) check(ed.document);
    }),
    vscode.languages.registerDocumentFormattingEditProvider('omega', {
      async provideDocumentFormattingEdits(doc) {
        const o = omc();
        if (!o.path) return [];
        try {
          const r = await omcLib.format(o.path, doc.getText(), o.timeoutMs);
          if (!r.ok) {
            collection.set(doc.uri, r.diagnostics.map((d) => toDiagnostic(doc, d)));
            return [];
          }
          const all = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
          return [vscode.TextEdit.replace(all, r.text)];
        } catch (e) {
          log.appendLine(`could not run ${o.path}: ${e.message}`);
          return [];
        }
      },
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
