'use strict';
// Tests for omc.js and the snippets. The omc tests need a real omc in $OMC (CI births it from the
// 408-byte seed of aien-dev/omega-mv at omega.ref); with OMEGA_REQUIRE_OMC=1 a missing $OMC fails.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const omc = require('../omc');

const OMC = process.env.OMC || '';
const haveOmc = OMC !== '' && omc.findOmc(OMC) !== null;
if (!haveOmc && process.env.OMEGA_REQUIRE_OMC === '1') {
  throw new Error(`OMEGA_REQUIRE_OMC=1 but $OMC (${JSON.stringify(OMC)}) is not an executable file`);
}
const needOmc = haveOmc ? {} : { skip: 'set $OMC to an omc binary' };

test('parseDiagnostics: human line only', () => {
  assert.deepEqual(omc.parseDiagnostics('omc: line 3: error 16\n'), [{ line: 3, code: 16 }]);
});

test('parseDiagnostics: om2 diag record replaces its human line', () => {
  const err =
    'omc: line 3: error 4\n' +
    'omc-diag 1 code=4 sev=incomplete line=3 col=14 span=37-37 expect=value found=- obligation=- profile=OM-2\n';
  assert.deepEqual(omc.parseDiagnostics(err), [
    {
      line: 3,
      code: 4,
      sev: 'incomplete',
      col: 14,
      span: [37, 37],
      detail: 'expect=value found=- obligation=- profile=OM-2',
    },
  ]);
});

test('parseDiagnostics: unrelated stderr gives nothing', () => {
  assert.deepEqual(omc.parseDiagnostics('Segmentation fault\nomc: line x: error 4\n'), []);
});

test('findOmc: explicit path that is not executable gives null', () => {
  assert.equal(omc.findOmc(path.join(__dirname, 'no-such-omc')), null);
  assert.equal(omc.findOmc('', ''), null);
});

test('check: an accepted unit has no diagnostics', needOmc, async () => {
  const r = await omc.check(OMC, 'fn main to int\nret 0\nend\n');
  assert.equal(r.ok, true);
  assert.equal(r.exit, 0);
  assert.deepEqual(r.diagnostics, []);
});

test('check: unclosed paren (omega-mv seed/omc/tests/paren/neg_unclosed.om) is error 16 at line 3', needOmc, async () => {
  const r = await omc.check(OMC, 'fn main to int\nret (5\nend\n');
  assert.equal(r.ok, false);
  assert.equal(r.exit, 16);
  assert.deepEqual(r.diagnostics, [{ line: 3, code: 16 }]);
});

test('check: om2 diag unit cut at end of input (seed/omc/om2/s1/diag-eof.om) gives a column', needOmc, async () => {
  const r = await omc.check(OMC, 'om2 diag\nfn main to int\nret add int 1');
  assert.equal(r.exit, 4);
  assert.equal(r.diagnostics.length, 1);
  assert.deepEqual([r.diagnostics[0].line, r.diagnostics[0].col, r.diagnostics[0].sev], [3, 14, 'incomplete']);
});

test('format: blanks between words become one space, notes and indentation kept', needOmc, async () => {
  const r = await omc.format(OMC, 'note hi  there\nfn   main  to int\n    ret 0\nend\n');
  assert.equal(r.ok, true);
  assert.equal(r.text, 'note hi  there\nfn main to int\n    ret 0\nend\n');
  const again = await omc.format(OMC, r.text);
  assert.equal(again.text, r.text, 'fmt is idempotent');
});

test('format: a refused unit is not rewritten and its line is the buffer line', needOmc, async () => {
  const r = await omc.format(OMC, 'fn main to int\nret (5\nend\n');
  assert.equal(r.ok, false);
  assert.equal(r.exit, 16);
  assert.deepEqual(r.diagnostics, [{ line: 3, code: 16 }]);
  assert.equal(r.text, undefined);
});

// ---- snippets: expand every placeholder to its default and compile the result ----
const snippets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'snippets', 'omega.json'), 'utf8'));

function expand(name, fill = '') {
  let s = snippets[name].body.join('\n');
  s = s.replace(/\$0|\$\{0\}/g, '\u0000');
  for (let prev = ''; prev !== s; ) {
    prev = s;
    s = s.replace(/\$\{\d+:([^${}]*)\}/g, '$1').replace(/\$\{\d+\|([^,|]*)[^|]*\|\}/g, '$1');
  }
  s = s.replace(/\$\d+/g, '');
  return s.replace('\u0000', fill);
}

test('snippets: every snippet has a prefix, body and description', () => {
  for (const [k, v] of Object.entries(snippets)) {
    assert.ok(v.prefix && Array.isArray(v.body) && v.description, k);
  }
});

test('snippets: OM-1 snippets expand to a unit omc accepts', needOmc, async () => {
  const body = [
    'a = int 1',
    'b = int 0',
    expand('if', 'a = 2'),
    expand('if else', 'a = 3'),
    expand('while bound', 'b = 0'),
    expand('for', 'a = 4'),
    expand('note', 'inside main'),
  ].join('\n');
  const unit = [
    expand('struct'),
    expand('text'),
    expand('function', 'ret x'),
    expand('main', body),
    '',
  ].join('\n');
  const r = await omc.check(OMC, unit);
  assert.deepEqual([r.ok, r.diagnostics], [true, []], unit);
});

test('snippets: OM-2 snippets expand to a unit omc accepts', needOmc, async () => {
  const unit = [
    expand('om2 profile'),
    expand('layout'),
    'fn f s edit uint 8 fresh to uint',
    expand('for unroll', 'put s i add i 1'),
    'ret get s 7',
    'end',
    expand('main'),
    '',
  ].join('\n');
  const r = await omc.check(OMC, unit);
  assert.deepEqual([r.ok, r.diagnostics], [true, []], unit);
});
