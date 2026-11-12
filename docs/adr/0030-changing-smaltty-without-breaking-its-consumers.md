# ADR 0030: changing smaltty without breaking its consumers

- **Status:** proposed (2026-11-12; the owner's decisions are open, below)
- **Date:** 2026-11-12
- **Builds on:** [ADR 0029](0029-after-the-checker-trial.md) (milestones 9–15: speed in the page, TypeScript 7 as
  the reference), [DESIGN.md](../DESIGN.md) ("Type errors on Run": warn and run), CLAUDE.md ("Cross-repo impact").
- **Details:** how this changes milestones 9–15 is in [MILESTONES.md](../MILESTONES.md).

## Context

smaltty has four consumers, and each pins it to an exact commit:

| Consumer | How it takes smaltty | What it relies on |
| --- | --- | --- |
| smaltkit | `github:stenhoor/smaltty#679e889`; `scripts/copy-smaltty.mjs` copies `dist/` and rewrites `from 'smaltty'` | the `.` export resolving to `dist/index.js`; `strip`, `ParseError` and the `Transpiler` default (`typescript.ts`); `check` and `checkCache` with `.d.ts` text (`typecheck.ts`, `TypeCheckSetup.files`) |
| smaltui | smaltkit's pin (`c7d9c5c`); `scripts/vendor-smaltdb.mjs` writes `vendor/smaltdf/types.json` as `.d.ts` text | its e2e test: the demos show no warnings, and a misspelt method has tsc's exact message |
| smaltnb | smaltkit; its build writes `types.json` as `.d.ts` text; `format.ts` parses with smaltty and blanks cells that don't parse (`parseTolerant`) | its e2e test: no warnings on the examples, and tsc's exact message on a misspelt method |
| smaltts | `github:stenhoor/smaltty#78eb49e`, for its tests | `checker.test.ts`: its tests and reference examples have no errors; every `@ts-expect-error` is found; every file strips |

The pins are why nothing breaks today: a change reaches a consumer only when its pin moves. But a change is found to
break a consumer only when that consumer bumps its pin, in the consumer's repository, by a session that didn't make
the change. Milestones 9–15 (ADR 0029) would break a bump in five places unless they are planned for:

1. **Milestone 9:** keeping `typescript` 6.0.3 for its API and adding TypeScript 7 under an npm alias gives two
   packages with a `tsc` command. smaltty's `prepare` builds `dist/` with `tsc` when a consumer installs it from
   GitHub, so which compiler builds `dist/` would change without anyone choosing it.
2. **Milestone 11:** prepared declarations in place of `.d.ts` text would break `TypeCheckSetup` and both apps'
   `types.json`; and a prepared buffer kept in the browser from an earlier deploy could be read by a later smaltty.
3. **Milestone 13:** syntax errors reported by `check()` by default would appear twice in both apps, which report them
   already; and smaltkit catches `ParseError` from the strict parse.
4. **Milestone 14:** each of tsc's errors newly caught fails a test that requires none: smaltts's, and the apps' "no
   warnings on the demos". The errors are real (tsc 5.9 reports three in two smaltts examples as smaltty's corpus holds
   them), but the bump still fails.
5. **Milestone 15:** messages are asserted word for word in both apps' e2e tests. Those messages name simple types
   (`'Frame'`), which milestone 15 doesn't change, but each message change is a possible break.

Being forward leaning is the other half: TypeScript 7 is the current release, every smalt repository's build is
already compatible with it (ADR 0029), and the apps target modern browsers. The aim is to move as fast as smaltty can,
with users and the other repositories changing only by a step they choose.

## Decision

### 1. Releases, not commits

- smaltty is versioned and tagged (0.1.0, 0.2.0, …) when a milestone is done, with a changelog (`CHANGELOG.md`) that
  marks each change of behaviour a consumer can see: an API, a default, a new error code, a message.
- Consumers pin tags. smaltkit is the only way smaltty reaches the apps: smaltui and smaltnb change when smaltkit's pin
  moves, and not otherwise.
- Before 1.0, a minor version may change behaviour, and the changelog says how; a patch version doesn't.

### 2. A downstream check in smaltty's CI

A workflow checks out smaltkit, smaltts, smaltui and smaltnb at their default branches, points each at the smaltty
being tested, and runs their tests (smaltui's and smaltnb's e2e included, in Chromium). It runs on a schedule against
`main` and is required before a release is tagged. A failure is smaltty's to fix, or to plan a consumer change for,
before the release. This is part of milestone 9 and comes before any other milestone changes behaviour.

### 3. Add first, change defaults later, remove last

- New behaviour comes in as an option, off by default: prepared declarations, syntax errors from the tolerant parse,
  each new group of error codes.
- APIs grow; they don't change shape. `check()` takes prepared declarations beside text, smaltkit's
  `TypeCheckSetup` takes either, `smaltty` keeps exporting everything, and the strict parse keeps throwing
  `ParseError`.
- A default changes only in a release whose changelog says so. An old form is removed one minor release after the new
  one is the default, never in the same release.
- Anything persisted outside smaltty's process (prepared declarations, and anything kept in Cache Storage) carries a
  format version. A version smaltty doesn't know is ignored and rebuilt from the text, never read.

### 4. Three waves, by what users notice

| Wave | Milestones | Users see | Done before the next wave |
| --- | --- | --- | --- |
| 1. Tooling | 9 and the downstream check; TypeScript 7 for `typecheck` in every smalt repository | nothing | the downstream check green on `main` |
| 2. Speed | 10, 11, 12 | faster first checks and re-checks; the same warnings | the apps on the new release, measured |
| 3. Visible | 13, 14, 15 | new warnings and changed messages | below |

Wave 3 ships in this order:

- **Our own code first.** The errors wider coverage finds in smaltts's tests and examples and in the apps' demos are
  fixed in those repositories before the release that reports them.
- **One app, then the other.** smaltui's tabs (short, smaltdf only) turn the new checks on first, then smaltnb.
- **Warn and run, still** (DESIGN.md). Blocking a run on errors is a separate decision.

### 5. TypeScript: current, in two steps, by a stated rule

- **Checking moves to TypeScript 7 now,** in every smalt repository: the `typecheck` scripts. It is faster, and the
  builds are compatible.
- **Emitting stays on 6.0.3 for one release.** `dist/` and `.d.ts` are built with 6.0.3 while 7's output is compared
  with it; then the build moves too. Until it does, `tsc` in smaltty is 6.0.3's, and TypeScript 7 is run by its own
  name (the alias's binary, or tsrs).
- **smaltty drops 6.0.3** when TypeScript 7 has a stable JavaScript API (expected in 7.1 at the earliest); the
  parser's, stripper's and binder's comparisons move to it then.
- **The rule:** the smalt repositories are on the latest stable TypeScript within one minor release of it. tsrs, which
  follows TypeScript's next version (7.1 beta now), is the early warning of what it changes, in `test/tsrs.ts`.

### 6. Browsers: a stated baseline

- smaltty's output stays plain ES2022 modules, which every current browser loads without a bundler.
- smaltty's built-in types follow web features Baseline "widely available": what users can call in the browsers the
  apps support. The next step is Baseline 2024 (`Array.fromAsync`, ES2025's `Set` methods), with milestone 14.
- The output target and the baseline are reviewed once a year, in a record like this one.

## The owner's decisions

Open. They are part of gate D (MILESTONES.md), with ADR 0029's.

1. **Releases and tags** (decision 1), and `CHANGELOG.md`.
2. **The downstream check** (decision 2): it needs read access to the four consumers in CI, and Chromium for the e2e
   tests (as `bench:page` uses now).
3. **TypeScript 7 for `typecheck` in every smalt repository** (decision 5). It is a change of dev dependency in each,
   so each needs the owner's yes under its CLAUDE.md; the work there is each repository's own.
4. **Sections 5 and 6 as rules for the whole family.** Recorded here for smaltty; whether they are smalt-wide (and
   recorded with smalt-brand's other cross-family decisions as well) is the owner's call.

## Alternatives

- **Commit pins and fixes after the bump** (as now). No process to add, but every break is found by the consumer's
  session, in another repository, after the change is merged.
- **One consumer test suite inside smaltty** in place of running the consumers' own tests. Faster, but a copy of their
  expectations falls behind them.
- **Moving everything to TypeScript 7 at once** (checking and emitting). One step instead of two, but emitted `.d.ts`
  is what other repositories read, and it changes without having been compared.
- **Staying on 5.9 until TypeScript 7's API is stable.** Nothing to manage, but the family runs a TypeScript that is
  no longer current, and smaltty's messages follow its printer.

## Consequences

- Milestone 9 grows: the downstream check, the first tag and the changelog. Each later milestone ends in a release.
- Milestones 11, 13 and 14 say what they add as options and when a default changes (MILESTONES.md).
- smaltkit's `copy-smaltty.mjs` keeps working as long as the `.` export is `dist/index.js`; a smaltkit change to use
  `smaltty/strip` (milestone 10) rewrites that import too.
- Users see changes only in wave 3, one app at a time, after our own code is clean.
