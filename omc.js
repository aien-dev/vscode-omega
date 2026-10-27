'use strict';
// Runs omc (aien-dev/omega-mv) on a buffer: a check for diagnostics, and `om2 fmt` for formatting.
// No VS Code dependency, so test/omc.test.js exercises it with a real omc in CI.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// `omc: line N: error E` is always printed; `om2 diag` units add
// `omc-diag 1 code=E sev=S line=N col=C span=A-B ...` (OMEGESE.md 12, "om2 diag").
const HUMAN = /^omc: line (\d+): error (\d+)\s*$/;
const DIAG = /^omc-diag 1 code=(\d+) sev=(\S+) line=(\d+) col=(\d+) span=(\d+)-(\d+)(.*)$/;

function parseDiagnostics(stderr) {
  const out = [];
  for (const raw of stderr.split('\n')) {
    let m = DIAG.exec(raw);
    if (m) {
      const last = out[out.length - 1];
      const d = { line: +m[3], code: +m[1], sev: m[2], col: +m[4], span: [+m[5], +m[6]], detail: m[7].trim() };
      if (last && last.line === d.line && last.code === d.code && last.col === undefined) out[out.length - 1] = d;
      else out.push(d);
      continue;
    }
    m = HUMAN.exec(raw);
    if (m) out.push({ line: +m[1], code: +m[2] });
  }
  return out;
}

// An explicit path wins; otherwise the first executable `omc` on PATH, or null.
function findOmc(configured, envPath = process.env.PATH || '') {
  const can = (p) => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  if (configured) return can(configured) ? configured : null;
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, 'omc');
    if (can(p)) return p;
  }
  return null;
}

function run(omc, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(omc, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (b) => out.push(b));
    child.stderr.on('data', (b) => err.push(b));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// Compile the text and report what omc says. The binary omc writes is discarded.
async function check(omc, text, timeoutMs = 10000) {
  const r = await run(omc, text, timeoutMs);
  if (r.signal) return { ok: false, killed: r.signal, diagnostics: [] };
  return { ok: r.code === 0, exit: r.code, diagnostics: parseDiagnostics(r.stderr) };
}

// `om2 fmt` on the first line makes omc print the canonical text of the rest, or refuse it; its
// line numbers then count the header line, so they are shifted back by one here.
async function format(omc, text, timeoutMs = 10000) {
  const r = await run(omc, 'om2 fmt\n' + text, timeoutMs);
  if (r.signal) return { ok: false, killed: r.signal, diagnostics: [] };
  const diagnostics = parseDiagnostics(r.stderr).map((d) => ({ ...d, line: Math.max(1, d.line - 1) }));
  if (r.code !== 0) return { ok: false, exit: r.code, diagnostics };
  return { ok: true, text: r.stdout.toString('utf8'), diagnostics };
}

module.exports = { parseDiagnostics, findOmc, check, format };
