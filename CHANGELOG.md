# Changelog

smaltty's releases follow the smalt family's version (the owner's decision, 2026-11-12): smaltty 0.9.0 shipped in
smaltworks 0.9.0. Each milestone from 9 on ends in a release, tagged only with the downstream check green
([ADR 0030](docs/adr/0030-changing-smaltty-without-breaking-its-consumers.md)), by the Release workflow
(`.github/workflows/release.yml`) from 0.11.0 on. Before 1.0 a minor release may change
behaviour, and says how here; a patch release doesn't. Each entry marks what a consumer can see: an API, a default, an
error code, a message.

## 0.14.0 (2026-11-13)

Milestone 13: checking through syntax errors ([ADR 0029](docs/adr/0029-after-the-checker-trial.md), decision 4). An
option, off by default ([ADR 0030](docs/adr/0030-changing-smaltty-without-breaking-its-consumers.md), decision 3): with
it off, the errors, their order, the defaults and the messages are 0.13.0's.

### Behaviour a consumer can see

- `check()`'s `syntax: 'tolerant'` (new option; `CheckOptions.syntax`, `'strict' | 'tolerant'`, default `'strict'`):
  the top-level statement a syntax error is in is set aside (blanked, keeping its line breaks), the error is reported,
  and the file's other statements are checked as usual; what the statement declared is unknown, so nothing that uses
  it is an error. Each statement set aside is one diagnostic, before the root's other errors, with the parser's message
  and TypeScript's code for the same error where it has one (1005, 1109, 1110, 1003, 1128, 1002, 1160, 1161, 1010,
  1127, 1351), else 1000 (a code TypeScript doesn't use); `@ts-expect-error`, `@ts-ignore` and `@ts-nocheck` don't
  silence them. A library file with a syntax error declares what its other statements do. See the guide's
  [Syntax errors](docs/guide/syntax-errors.md).
- Unchanged: `parse()`, `strip()` and `transpile()` still throw `ParseError` at the first error, with the same trees;
  with `syntax` left out, a root with a syntax error reports nothing and a file with one declares nothing, as before.
- `CheckCache.files` entries may carry `syntax` (the errors of a file the tolerant parse read); a strict check with the
  same cache reads such a file as one that doesn't parse. A root's per-statement results depend on the option.
- `smaltty/check` loads one module more, `tolerant.js`.

### Tooling

- `test/tolerant.test.ts`: every checker mutant with a syntax error added to one statement, eight kinds, held to a
  check of the file without the statement and to TypeScript 7's errors there.
- `npm run bench`: a "Checking through a syntax error" table (`breakInside` in `bench/corpus.ts`).

## 0.13.0 (2026-11-13)

Milestone 12: incremental re-checks ([ADR 0029](docs/adr/0029-after-the-checker-trial.md), decision 2). The errors,
their order, the defaults and the messages are 0.12.0's: a check with a cache finds exactly what a check without one
finds.

### Behaviour a consumer can see

- `checkCache()` keeps each root's results statement by statement (`CheckCache.statements`, a new optional field): a
  check after an edit parses the root again and checks only the top-level statements whose text, or the declarations
  they use, changed; the others keep their errors, moved where text before them moved. A notebook's cells are top-level
  statements, so an edit checks its cell and the cells that read what it declares. What a statement depends on, and
  where everything is checked again, is in the guide's [Re-checks](docs/guide/rechecks.md). A re-check of the 40 KB
  generated script after a one-line edit takes 2.52 ms (from 22.02 ms checked whole); app code 0.04–0.19 ms (from 0.14–0.36 ms).
- `checkCache({ statements: false })`, and a `CheckCache` made by hand without `statements` (as before 0.13.0), keep
  only the parsed files: each root is checked whole, as in 0.12.0.
- `StatementResults` (exported type): what `cache.statements.get(root)` says of the last check, `reused` statements and
  `checked` statements.
- `Bindings.top` (set by `bind()`, undefined for prepared declarations): the file's top-level names, the scopes a
  statement's names resolve in, with whether the file is a module and strict.

### Tooling

- `test/incremental.test.ts`: a check with a cache against one without, after every kind of edit, on every checker
  workload and every mutant.
- `npm run bench`'s and `bench/page.ts`'s "after an edit" is now a one-line edit inside the root's middle statement
  (`editInside` in `bench/corpus.ts`), not a comment appended, with a "whole file" column for a cache that keeps the
  parsed files only.

## 0.12.0 (2026-11-13)

Milestone 11: prepared declarations, the first check ([ADR 0029](docs/adr/0029-after-the-checker-trial.md), decision
2). Additive only ([ADR 0030](docs/adr/0030-changing-smaltty-without-breaking-its-consumers.md), decision 3): `check()`
takes text as before, with the same results, and the defaults, errors and messages are 0.11.0's.

### Behaviour a consumer can see

- `prepare(files)` (from `smaltty/check` and `smaltty`, not `smaltty/strip`): files parsed and bound once, written as
  one buffer (a `Uint8Array`) with their text, for an app's build to write beside the `.d.ts` text it ships.
- `check()`'s new option `prepared`: the buffer (an `ArrayBuffer` or a view of one), or the `PreparedFiles`
  `readPrepared()` gives for it, read in place of parsing those files' text. Its files are files of the check, as
  `files` are; a path also in `files` with other text is read from the text. A prepared check finds exactly the errors
  a check of the text finds.
- `readPrepared(buffer)` gives the `PreparedFiles` (`version`, `paths`, `text(path)`, `readAll()`), or `undefined` for
  a buffer this smaltty can't read: another format (`PREPARED_FORMAT`), another smaltty version or node kinds, or a
  length or checksum that doesn't match. `check()` ignores such a buffer and reads only `files`: a stale buffer is never
  read, so pass the text too where one can arrive (a browser keeps files from an earlier deploy), or fetch it when
  `readPrepared()` gives `undefined`.
- The built-in types are prepared when smaltty is built and read once per process, so a first check doesn't parse
  them, and a check without a cache no longer parses them each time. `smaltty/check` loads three more modules
  (`prepared.js`, `builtins-prepared.js`, `version.js`), and is 10.5 KB more gzipped (45.4 KB to 55.9 KB), most of it
  the built-in types' buffer.
- `Tree`'s and `Bindings`' constructors take an optional last argument: columns and bindings already made (how a
  prepared file is read back). Called as before, they are unchanged.

### Tooling

- `VERSION` is written in `src/version.ts` (re-exported by `smaltty/strip` and `smaltty` as before); the Release
  workflow reads it there.
- `npm run build` ends with `scripts/prepare-builtins.mjs`, which writes the built-in types' buffer into
  `dist/builtins-prepared.js`.
- `node bench/page.ts --first` measures a page's first check from the checker worker's start, with the libraries as
  text and prepared (`--app=<label>=<types.json>=<code>` adds an app's own); `npm run bench`'s checking table has a
  prepared first-check column.

## 0.11.0 (2026-11-13)

Milestone 10: entry points and size ([ADR 0029](docs/adr/0029-after-the-checker-trial.md), decision 3). Additive
only: `smaltty` exports everything it did, with the same values, and the defaults, errors and messages are 0.10.0's.

### Behaviour a consumer can see

- New entry points, each loading only its own modules: `smaltty/strip` (the scanner, parser and stripper: `strip`,
  `transpile`, `parse`, `Tree`, `K`, `F`, `KIND_NAMES`, `isTypeNode`, `ParseError`, `VERSION` and the default
  Transpiler), `smaltty/bind` (the binder: `bind`, `Bindings`, `Meaning`), and `smaltty/check` (the checker:
  `check`, `checkCache`, `expectations`, and the binder). A page that strips loads none of the binder's or the
  checker's code. `smaltty` (`dist/index.js`) still exports everything; a value is the same object whichever entry
  point it comes from.
- `dist/*.js` is built without comments (the `.d.ts` files keep theirs, and the source maps point at `src/`, which the
  package ships): the stripping path is 24.5 KB gzipped, from 31.1 KB with comments (all of `smaltty` 44.3 KB, from 58.2 KB).

### Tooling

- `npm run bench` measures loading and size per entry point; `npm run bench:page` loads each in a fresh page of
  Chromium, and `node bench/page.ts --entries --dist=<dir>` compares another build of `dist/` (a minified one).
- `test/entries.test.ts` holds each entry point to the modules it loads, recorded in a fresh process.

## 0.10.0 (2026-11-13)

Milestone 9: TypeScript 7 as the reference ([ADR 0029](docs/adr/0029-after-the-checker-trial.md)). Tooling only: the
API, the defaults, the errors reported and their messages are those of 0.9.0, with one exception below.

### Behaviour a consumer can see

- The built-in types' `Map` has `getOrInsert` and `getOrInsertComputed`, as TypeScript 6.0's latest lib does
  (`esnext.collection`): calls to them are no longer reported as unknown properties (2339), and their arguments are
  checked.

### Tooling

- The checker's reference is TypeScript 7: `test/checking.ts` and `test/tsrs.ts` compare smaltty's errors with
  TypeScript 7.0's `tsc` (its command line, `--pretty false`) and with tsrs (TypeScript 7.1 beta's checker), and no
  longer with TypeScript 5.9's API. On TypeScript 7's errors, as on 5.9's: no false errors, and smaltts's mutants
  662 of 847 caught (78%), smaltdf's 325 of 370 (88%), smaltui's tabs 37 of 38 (97%); 250 messages differ from
  TypeScript 7's on errors both report. The coverage floors in `test/checker.test.ts` are re-taken on these, and the
  messages that differ are held to that count (milestone 15 brings it down).
- `node test/tsrs.ts --misses` counts the errors smaltty misses, by code, for milestone 14.
- Dev dependencies: `typescript` 5.9.3 becomes 6.0.3, kept for its JavaScript API (the parser's, stripper's and
  binder's comparisons) and for `tsc`, which still builds `dist/`, also in `prepare` when a consumer installs smaltty
  from GitHub. TypeScript 7.0 is added under the npm alias `typescript7` and run by its own name;
  `npm run typecheck` runs on it.
- The downstream check: `.github/workflows/downstream.yml` runs `scripts/downstream.mjs` daily and by hand; it runs
  smaltkit's, smaltts's, smaltui's and smaltnb's own tests (the apps' end-to-end tests in Chromium) against this
  smaltty.
- `docs/BENCHMARKS.md` has TypeScript 7's columns.

## 0.9.0 (smaltworks 0.9.0)

smaltty's first release, in the family release smaltworks 0.9.0
([release notes](https://github.com/stenhoor/smalt-brand/blob/main/releases/0.9.0/release-notes.md)): milestones 1–8.
The package version in `package.json` and `VERSION` was 0.0.0 until 0.10.0's work set it to 0.9.0.

- The scanner and parser: TypeScript's syntax tree, node for node, stored flat; the stripper: types to spaces, every
  line and column kept, and `enum`, `namespace` with values and parameter properties refused with where
  (milestones 1–3) ([#1](https://github.com/stenhoor/smaltty/pull/1)).
- The binder: which declaration each name means, as TypeScript's checker says (milestone 5)
  ([#2](https://github.com/stenhoor/smaltty/pull/2)).
- The checker: errors on calls into the libraries a file imports (2339, 2551, 2554, 2555, 2353, 2561, 2345, 2322), with
  no error tsc doesn't report; generic types, so smaltts's row callbacks are checked; smaltdf's `this`, private names,
  parameter properties and module augmentations; the built-in types in smaltty's own words; `checkCache()` for
  re-checks (milestone 7) ([#4](https://github.com/stenhoor/smaltty/pull/4)–[#12](https://github.com/stenhoor/smaltty/pull/12)).
- `globals`, and messages that name types as tsc does; smaltui and smaltnb mark the checker's errors as warnings through
  smaltkit (milestone 8) ([#13](https://github.com/stenhoor/smaltty/pull/13), [#14](https://github.com/stenhoor/smaltty/pull/14),
  [#16](https://github.com/stenhoor/smaltty/pull/16)).
- tsrs as a comparison point, natively and in a page ([#15](https://github.com/stenhoor/smaltty/pull/15),
  [#17](https://github.com/stenhoor/smaltty/pull/17)).
- The docs site ([#3](https://github.com/stenhoor/smaltty/pull/3)); ADRs 0029 and 0030 and gate D
  ([#18](https://github.com/stenhoor/smaltty/pull/18)–[#20](https://github.com/stenhoor/smaltty/pull/20)).
