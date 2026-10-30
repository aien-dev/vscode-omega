# Omega for VS Code

Syntax highlighting, snippets, and optional `omc` diagnostics and formatting for Omega (`.om`), the
language of [aien-dev/omega-mv](https://github.com/aien-dev/omega-mv).

[![extension](https://github.com/aien-dev/vscode-omega/actions/workflows/ci.yml/badge.svg)](https://github.com/aien-dev/vscode-omega/actions/workflows/ci.yml)

**Connected repos:** [aien-dev/omega-mv](https://github.com/aien-dev/omega-mv) (the language and
`omc`, pinned in [`omega.ref`](omega.ref)) ·
[aien-dev/tree-sitter-omega](https://github.com/aien-dev/tree-sitter-omega) (the tree-sitter grammar my
TextMate grammar is checked against, pinned in [`tree-sitter-omega.ref`](tree-sitter-omega.ref)).

## Install

I publish each version as a GitHub Release with its sha256. Download `omega-<version>.vsix` and
`omega-<version>.vsix.sha256` from the [Releases page](https://github.com/aien-dev/vscode-omega/releases), then:

```sh
sha256sum -c omega-0.1.0.vsix.sha256
code --install-extension omega-0.1.0.vsix
```

Or build it yourself:

```sh
git clone https://github.com/aien-dev/vscode-omega && cd vscode-omega
npm ci
npx --no-install vsce package --no-dependencies -o omega-0.1.0.vsix
```

The extension is not on the Visual Studio Marketplace or Open VSX yet.

## What it does

- **Highlighting** for `.om` files: keywords, the OM-2 profile line, operator, type, contract and host
  words, numbers (decimal, `0x` hex, floats), text with escapes, and `note` comments. Function and
  declaration names keep their colour even when an OM-1 unit uses an OM-2 word such as `rotr` as a name.
- **Snippets**: `fn`, `main`, `if`, `ife`, `while` (with its `bound`), `for`, `foru`, `struct`, `layout`,
  `text`, `om2`, `note`. CI expands every snippet with its default values and compiles the result with `omc`.
- **Comment toggling** (`note`), bracket matching and auto-closing for `(` `)` and `"`.
- **Diagnostics from `omc`** on save (and the command *Omega: Check this file with omc*): the error
  number and line `omc` reports, with the exact column for `om2 diag` units.
- **Format Document** through `omc`'s own `om2 fmt` mode: blanks between words become one space, notes,
  text and indentation stay as written; a unit `omc` refuses is left unchanged and gets its diagnostic.

Diagnostics and formatting run only when the extension finds an `omc`: the `omega.omcPath` setting,
else the first `omc` on `PATH`. Without one, the extension highlights and stays quiet.

## Getting `omc`

`omc` is a static AArch64 Linux program. On an AArch64 Linux machine:

```sh
git clone https://github.com/aien-dev/omega-mv && cd omega-mv
sh seed/omega-from-seed.sh      # writes seed/out/omc
```

then set `omega.omcPath` to the full path of `seed/out/omc`. The script births `omc` from a 408-byte
seed. Its limits, in full: the 408 bytes are a binary written as 7,903 bytes of commented hex text
and turned into bytes by a 1,048-byte POSIX shell script (load0.sh); the shell's printf is the one
outside tool, and the chain runs only on AArch64 Linux. Matching the published `omc` hash is a
fixed-output reproducibility match along one build path from a pinned commit (369dbc96); it is not
diverse double compilation, does not prove omc correct, and off AArch64 Linux it reports NOT_RUN.

On x86_64 Linux, macOS or Windows there is no native `omc`. On x86_64 Linux you can point
`omega.omcPath` at a small wrapper script that runs `qemu-aarch64 /path/to/omc`; I have not tested
that path.

## Settings

| setting | default | meaning |
|---|---|---|
| `omega.omcPath` | empty | path to `omc`; empty means the first `omc` on `PATH` |
| `omega.diagnostics.onSave` | `true` | compile the file with `omc` on save and show its error |
| `omega.omcTimeoutMs` | `10000` | stop `omc` after this many milliseconds |

## How I test it

All of this runs in CI on GitHub's `ubuntu-24.04-arm` runner, with `omc` born from the seed at
`omega.ref`:

- `npm test` (`test/omc.test.js`): the diagnostic parser, `omc` on accepted and refused units,
  `om2 fmt` round trips, and every snippet compiled by `omc`.
- `npm run test:vscode`: VS Code 1.90.0 (the oldest version the extension supports), under xvfb, with
  this extension loaded. It checks that `.om` opens as Omega, that a refused unit gets the diagnostic
  `omc error 16` on line 3 and an accepted one gets none, and that Format Document returns `om2 fmt`'s text.
- `test/agree.js`: the TextMate grammar against
  [tree-sitter-omega](https://github.com/aien-dev/tree-sitter-omega)'s highlight query, token by token,
  over every `*.om` file in omega-mv and over [`test/fixtures/`](test/fixtures) (edge cases `omc`
  accepts: names that start with `note`, `note(...)`, `note` inside text, a function named `field`
  next to a `layout`). On the files `omc` accepts the two must agree on every token; CI fails otherwise.
- Negative controls that must fail: the unit tests with a fake `omc` that accepts everything, the
  VS Code test with that fake `omc`, the agreement check with the type words removed from the
  TextMate grammar, and a package built without `.vscodeignore`, which must fail `test/check-vsix.sh`.

MEASURED at omega-mv `e5b32567` with the TextMate grammar of this commit and the tree-sitter-omega
commit in `tree-sitter-omega.ref` (local run on a DGX Spark, 2026-10-28; CI has not run on these
commits yet):

| files | tokens compared | TextMate and tree-sitter agree |
|---|---:|---:|
| 393 omega-mv files `omc` accepts | 118,468 | 118,468 (100%) |
| all 811 omega-mv `*.om` files | 211,404 | 211,358 (99.978%) |
| 3 files in `test/fixtures/` | 108 | 108 (100%) |

The 46 disagreements are all in files `omc` refuses: malformed hex numbers, which the two grammars split
differently, and deliberately malformed test fixtures.

The same check over every public aien-dev repository with Omega in it (948 files `omc` accepts, in 17
of the 26 repositories measured, omega-rosetta at its `corpus/200` commit `a5b7330a`; list and
commits in tree-sitter-omega's README): 423,864 of 423,864 tokens agree. Over all 357 omega-rosetta
files, exercise stubs and `test.om` files included, 100,651 of 100,651 agree. With the previous
grammars (TextMate here at `885db1b`, tree-sitter-omega `9b63612`) it was 423,733 of 423,797 on the
accepted files: a function named `field` outside a layout (aienos.com `om/hive-render/render.om`) and a
`note` inside text (babel `build/babel.om`). With the previous grammars `test/fixtures/` agreed on 108
of 117 tokens.
`test/agree.js` now converts tree-sitter's byte columns to the editor's UTF-16 columns, so a line with
a non-ASCII character no longer compares the wrong tokens.

Not tested: the extension on Windows or macOS, the `qemu-aarch64` wrapper path, and VS Code versions
other than 1.90.0.

## Foreign dependencies

These are editor and packaging glue, not part of Omega:

| dependency | version | what it does here |
|---|---|---|
| VS Code extension API | engine `^1.90.0` | hosts the extension; `extension.js` and `omc.js` are plain JavaScript run by VS Code |
| TextMate grammar format | n/a | `syntaxes/omega.tmLanguage.json`, read by VS Code's tokenizer |
| @vscode/vsce | 4.0.0 | packages the `.vsix` (dev only) |
| @vscode/test-electron | 3.1.0 | downloads VS Code 1.90.0 and runs the in-editor test (dev only) |
| vscode-textmate, vscode-oniguruma | 9.3.2, 2.0.1 | run the TextMate grammar outside VS Code for `test/agree.js` (dev only) |
| Node.js | 24 | runs the tests and vsce |
| tree-sitter-cli | 0.27.1, via tree-sitter-omega | the other side of the agreement check (CI only) |

An Omega-native editor protocol (a language server written in `.om`) would be the first-party
replacement for `extension.js`; it does not exist yet.

## Licence

Apache-2.0 WITH LLVM-exception. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Human-Directed Agentic Engineering

Development follows Human-Directed Agentic Engineering (HDAE): humans define goals,
architecture, constraints, acceptance criteria, and stopping points; agents implement,
execute checks, diagnose failures, and revise within those boundaries. Human review
retains responsibility for claims, acceptance, and release decisions. This describes
the development method, not a change to runtime autonomy or historical evidence.

For the documented method and a systems-software case study, see Gregory M. Kurtzer
(2026), *Ginux: Building an Independent Kernel That Runs Linux Userspace through
Human-Directed Agentic Engineering*, technical report, v1, Zenodo,
<https://doi.org/10.5281/zenodo.23682548>.
