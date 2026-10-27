#!/usr/bin/env node
'use strict';
// Token-class agreement between this extension's TextMate grammar and aien-dev/tree-sitter-omega's
// highlight query, over a directory of .om files (CI: every *.om in aien-dev/omega-mv at omega.ref).
//
// Usage: node test/agree.js --ts <tree-sitter-omega dir> --src <dir of .om> [--files <list>]
//                           [--grammar <tmLanguage.json>] [--min <percent>]
// --files: a file of paths relative to --src, one per line; only those files are compared
// (CI passes the files omc accepts). Default: every *.om under --src.
// stdout: one line per disagreeing token  <path>\t<row>:<col>\t<text>\tts=<class>\ttm=<class>
//         then  AGREE <agreeing>/<compared> <percent>%  and  FILES <n>
// Exit: 0 when the percentage is at least --min (default 100), 1 below it, 2 on a usage or tool error.
//
// Every node tree-sitter captures is compared, with tree-sitter's winning capture (the later
// pattern wins) and the TextMate scope at the node's first character both mapped to one class.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}
const tsDir = arg('--ts');
const srcDir = arg('--src');
const filesList = arg('--files');
const grammarPath = arg('--grammar', path.join(__dirname, '..', 'syntaxes', 'omega.tmLanguage.json'));
const min = Number(arg('--min', '100'));
if (!tsDir || !srcDir) {
  process.stderr.write('usage: agree.js --ts <dir> --src <dir> [--files list] [--grammar g.json] [--min pct]\n');
  process.exit(2);
}

const TS_CLASS = {
  comment: 'comment',
  string: 'string',
  'string.escape': 'escape',
  number: 'number',
  'number.float': 'number',
  keyword: 'keyword',
  'keyword.conditional': 'keyword',
  'keyword.repeat': 'keyword',
  'keyword.return': 'keyword',
  'keyword.directive': 'keyword',
  'keyword.modifier': 'modifier',
  'keyword.operator': 'operator-word',
  operator: 'operator',
  'punctuation.bracket': 'punct',
  'type.builtin': 'type',
  boolean: 'constant',
  'variable.builtin': 'variable.builtin',
  'function.builtin': 'builtin',
  function: 'function',
  type: 'name',
  'type.definition': 'name',
  constant: 'name',
  variable: 'name',
  'variable.parameter': 'name',
  'variable.member': 'name',
  'function.call': 'name',
};
// The unsized `*` is @type in tree-sitter and storage.modifier.unsized in TextMate.
function tmClass(scopes) {
  const s = scopes[scopes.length - 1] || '';
  if (s.startsWith('comment.')) return 'comment';
  if (s.startsWith('constant.character.escape')) return 'escape';
  if (s.startsWith('string.')) return 'string';
  if (s.startsWith('constant.numeric')) return 'number';
  if (s.startsWith('storage.modifier.unsized')) return 'name';
  if (s.startsWith('keyword.operator.word')) return 'operator-word';
  if (s.startsWith('keyword.operator.assignment')) return 'operator';
  if (s.startsWith('keyword.')) return 'keyword';
  if (s.startsWith('storage.modifier')) return 'modifier';
  if (s.startsWith('punctuation.')) return 'punct';
  if (s.startsWith('support.type')) return 'type';
  if (s.startsWith('constant.language')) return 'constant';
  if (s.startsWith('variable.language')) return 'variable.builtin';
  if (s.startsWith('support.function')) return 'builtin';
  if (s.startsWith('entity.name.function')) return 'function';
  if (s.startsWith('entity.name') || s.startsWith('variable.other')) return 'name';
  return 'plain';
}

function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.om')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

// tree-sitter query -c prints, per file, `pattern: P, capture: C - NAME, start: (R, C), end: (R, C), text: ...`.
function treeSitterCaptures(files) {
  const list = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'agree-')), 'paths');
  fs.writeFileSync(list, files.join('\n') + '\n');
  const cli = path.join(tsDir, 'node_modules', '.bin', 'tree-sitter');
  const out = execFileSync(
    cli,
    ['query', '-p', tsDir, '-c', path.join(tsDir, 'queries', 'highlights.scm'), '--paths', list],
    { maxBuffer: 1 << 30, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const byFile = new Map();
  let cur = null;
  const re = /^\s+pattern:\s*(\d+), capture: \d+ - ([\w.]+), start: \((\d+), (\d+)\), end: \((\d+), (\d+)\)/;
  for (const line of out.split('\n')) {
    if (!line) continue;
    if (!/^\s/.test(line)) {
      cur = new Map();
      byFile.set(line.trim(), cur);
      continue;
    }
    const m = re.exec(line);
    if (!m || !cur) continue;
    const key = `${m[3]}:${m[4]}:${m[5]}:${m[6]}`;
    const prev = cur.get(key);
    if (!prev || +m[1] >= prev.pattern) cur.set(key, { pattern: +m[1], name: m[2], row: +m[3], col: +m[4] });
  }
  return byFile;
}

async function main() {
  const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')).buffer;
  await oniguruma.loadWASM(wasm);
  const registry = new vsctm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (p) => new oniguruma.OnigScanner(p),
      createOnigString: (s) => new oniguruma.OnigString(s),
    }),
    loadGrammar: async () => vsctm.parseRawGrammar(fs.readFileSync(grammarPath, 'utf8'), grammarPath),
  });
  const grammar = await registry.loadGrammar('source.omega');
  const files = filesList
    ? fs.readFileSync(filesList, 'utf8').split('\n').filter(Boolean).map((p) => path.join(srcDir, p))
    : listFiles(srcDir);
  if (files.length === 0) {
    process.stderr.write(`agree.js: no .om files under ${srcDir}\n`);
    process.exit(2);
  }
  const caps = treeSitterCaptures(files);
  let compared = 0;
  let agree = 0;
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    const tm = [];
    let state = vsctm.INITIAL;
    for (const l of lines) {
      const r = grammar.tokenizeLine(l, state);
      tm.push(r.tokens);
      state = r.ruleStack;
    }
    for (const c of (caps.get(f) || new Map()).values()) {
      const tsc = TS_CLASS[c.name];
      if (!tsc) continue;
      const toks = tm[c.row] || [];
      const t = toks.find((k) => k.startIndex <= c.col && c.col < k.endIndex);
      const tmc = t ? tmClass(t.scopes) : 'plain';
      compared++;
      if (tmc === tsc) agree++;
      else {
        const text = (lines[c.row] || '').slice(c.col).split(/[ \t]/)[0].slice(0, 24);
        process.stdout.write(`${path.relative(srcDir, f)}\t${c.row + 1}:${c.col + 1}\t${text}\tts=${tsc}\ttm=${tmc}\n`);
      }
    }
  }
  const pct = compared ? (100 * agree) / compared : 0;
  process.stdout.write(`AGREE ${agree}/${compared} ${pct.toFixed(3)}%\nFILES ${files.length}\n`);
  process.exit(pct >= min ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`agree.js: ${e.stack || e}\n`);
  process.exit(2);
});
