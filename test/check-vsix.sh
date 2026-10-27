#!/bin/sh
# Usage: test/check-vsix.sh <file.vsix>. Exit 0 when the package holds everything the extension needs
# and none of the tests, CI files or node_modules; 1 otherwise.
set -eu
v=${1:?usage: check-vsix.sh <file.vsix>}
list=$(unzip -Z1 "$v")
rc=0
for f in extension/package.json extension/extension.js extension/omc.js extension/syntaxes/omega.tmLanguage.json \
         extension/language-configuration.json extension/snippets/omega.json extension/LICENSE.txt extension/NOTICE; do
  printf '%s\n' "$list" | grep -qx "$f" || { echo "check-vsix: missing $f"; rc=1; }
done
bad=$(printf '%s\n' "$list" | grep -E '^extension/(test/|node_modules/|\.github/|\.crumb$|\.goals\.json$)' || true)
[ -z "$bad" ] || { echo "check-vsix: shipped files that belong to the repo only:"; printf '%s\n' "$bad"; rc=1; }
[ "$rc" = 0 ] && echo "check-vsix: ok $v"
exit "$rc"
