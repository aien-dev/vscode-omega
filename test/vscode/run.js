'use strict';
// Runs test/vscode/suite.js inside a real VS Code (the minimum supported version, 1.90.0) with this
// extension loaded from the working tree. Needs $OMC and a display (CI: xvfb-run).
const path = require('path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  if (!process.env.OMC) throw new Error('set $OMC to an omc binary');
  const root = path.resolve(__dirname, '..', '..');
  await runTests({
    version: '1.90.0',
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, 'suite.js'),
    extensionTestsEnv: { OMC: process.env.OMC },
    launchArgs: ['--disable-extensions', '--disable-gpu', '--no-sandbox'],
  });
}

main().catch((e) => {
  process.stderr.write(`vscode test failed: ${e && e.message ? e.message : e}\n`);
  process.exit(1);
});
