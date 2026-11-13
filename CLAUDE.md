# CLAUDE.md

smaltty is smalt's own implementation of TypeScript, a top-level smalt product (the owner's decision, 2026-11-12), with
no outside code: a parser, a type stripper, scope analysis and a type checker for TypeScript written against smaltdf
and smaltts (smaltts's TypeScript tooling is smaltty: owner's decision,
2026-11-10). It replaces sucrase in smaltui and the TypeScript compiler in smaltnb. smaltkit
wraps it for the apps. Read [docs/DESIGN.md](docs/DESIGN.md) first: it holds the owner's decisions and their order.
Milestones 1–9 are done (through the checker, checking in the apps, and TypeScript 7 as the checker's reference;
9's release is 0.10.0); milestones 9–15 were decided at gate D (2026-11-12) in
docs/adr/0029-after-the-checker-trial.md, with how they reach consumers in
docs/adr/0030-changing-smaltty-without-breaking-its-consumers.md; milestone 10 is next. See docs/MILESTONES.md.
Several Claude Code sessions work on the smalt repos in parallel and cannot see each other: this file is the shared
starting point, and its working rules match smaltdb's `CLAUDE.md`.

## Commands

```bash
npm install            # prepare builds dist/ (tsc -p tsconfig.build.json)
npm run typecheck      # TypeScript 7's tsc (--noEmit, strict, erasableSyntaxOnly) over src/, test/ and bench/;
                       # plain `tsc` is typescript 6.0.3's, which builds dist/
npm test               # build, then node --test test/*.test.ts (the corpus checks among them)
npm run test:self      # the same tests, with .ts files stripped by smaltty instead of Node (test/register.mjs)
npm run bench          # the benchmark tables in docs/BENCHMARKS.md; --quick checks the harness only
npm run bench:page     # the checkers in a page (Chromium; Playwright through NODE_PATH): smaltty and tsrs's WASM build
npm run docs:dev       # the docs site (docs/, VitePress); docs:build fails on dead links (CI runs it)
NODE_PATH=$(npm root -g) node scripts/downstream.mjs   # the downstream check: the consumers' tests on this smaltty
```

## Repo map

- `src/`: `scanner.ts` (tokens on demand), `parser.ts` (TypeScript's grammar, TypeScript's tree shapes), `tree.ts` (the
  flat tree), `strip.ts` (types to spaces), `binder.ts` (which declaration each name means), `checker.ts` (types
  of calls into the libraries a file imports, and tsc's errors on them), `kinds.ts` and `tokens.ts`
  (codes). The entry points (milestone 10): `index.ts` (`smaltty`, everything), `entry-strip.ts` (`smaltty/strip`:
  scanner, parser, stripper), `entry-bind.ts` (`smaltty/bind`) and `entry-check.ts` (`smaltty/check`: binder and
  checker); `test/entries.test.ts` holds each to the modules it loads. `dist/*.js` is built without comments, its
  `.d.ts` with them. `test/` imports the package by name, so
  it tests the built output.
- `test/compare.ts` flattens both trees for comparison; `node test/sweep.ts <paths>` compares the parser with TypeScript
  on any code (run it on the smalt repositories after a parser change). `node test/strip-sweep.ts <paths>` does the same
  for the stripper, against TypeScript's own transpile, and `node test/binding.ts <paths>` for the binder, against
  TypeScript's checker (all three on `typescript` 6.0.3's API). `node test/checking.ts <project>
  [--package=name=path]` compares the checker with TypeScript 7's `tsc` (the reference since milestone 9) on a
  project's files. `node test/tsrs.ts` adds tsrs (a Rust port of TypeScript 7.1 beta's checker) and TypeScript 6.0 to
  that comparison, on the checker tests' mutants; `--misses` counts what smaltty misses, by code.
- `scripts/downstream.mjs` (run daily by `.github/workflows/downstream.yml`): smaltkit's, smaltts's, smaltui's and
  smaltnb's own tests, the apps' e2e in Chromium, against this smaltty. A release is tagged only with it green.
- `corpus/` the input for tests and benchmarks ([corpus/README.md](corpus/README.md)). `bench/` the harness.
- `docs/` is the docs site (VitePress, deployed to stenhoor.github.io/smaltty/ from `main` by `.github/workflows/docs.yml`):
  `guide/`, `adr/` (decision records, numbered with all smalt ADRs), and [DESIGN.md](docs/DESIGN.md),
  [MILESTONES.md](docs/MILESTONES.md), [BENCHMARKS.md](docs/BENCHMARKS.md).
  `docs/.vitepress/theme/` (except `index.ts`) and `docs/public/` are copied from smalt-brand unchanged.

## Rules for code here

- TypeScript only: no Rust, no WASM. Output is plain ES2022 modules that load in a page without a bundler.
- No run-time dependencies. sucrase, typescript, tsrs and @tsrs/wasm (the owner's yes, 2026-11-11) may be dev dependencies for
  differential tests and benchmarks only; from milestone 9, `typescript` 6.0.3 for its API and TypeScript 7 under an
  npm alias, run by its own name, while `tsc` stays 6.0.3's (the owner's yes, 2026-11-12, ADR 0029).
- Releases: a tag per milestone with `CHANGELOG.md`, and only with the downstream check green (ADR 0030). Versions
  follow the smalt family's (the owner's decision, 2026-11-12): 0.9.0 shipped in smaltworks 0.9.0, milestone 9 is
  0.10.0. New behaviour comes as an option, off by default; a default changes only in a release that says so.
- Speed comes first. Every change to the scanner, parser, stripper or binder is benchmarked against the tool it
  replaces, on the same work, and a slowdown is a regression.
- Follow TypeScript, not sucrase: where they differ, TypeScript's behaviour is right (the owner's rule).
- The parser's tree must match TypeScript's node for node. A difference the tests or a sweep find is a bug in smaltty,
  unless TypeScript reports a syntax error there too. The one exception is the checker's tolerant parse (milestone
  13, the owner's yes, 2026-11-12), off by default and never used for stripping.
- The binder must name the declaration TypeScript's checker names, for every name it binds.
- Erasable syntax only: `enum`, `namespace` with values and constructor parameter properties are reported, not
  transformed.
- A checker error that tsc doesn't report is a bug. Anything the checker doesn't model is unknown and quiet.
- Checking schemas (table and column names) is out of scope: that is the future smaltsc project.

## Working rules for sessions

- One task per branch and PR. Do not add unrelated work to an open PR: it holds up everything else in it.
- Mark unfinished work clearly, and open a PR only when CI passes.
- Read review comments on your PR and answer them with commits that say what they address.
- When a PR depends on another repo's PR, add a line such as `Depends on: stenhoor/smaltkit#3`.
- **Ask before adding outside code.** Ask the owner, and wait for a yes, before adding a package (a dependency of any
  kind, or a pin in `packed.json`), copying or bundling in someone else's code, or loading code from another site at run
  time (a CDN such as jsDelivr). Say what it is, its licence and size, what it's for, and why our own code can't do it.

## Brand

smaltty is a top-level smalt product, not a kit: smalt's own implementation of TypeScript. The owner made it one on
2026-11-12, once it had grown into a significant part of a TypeScript compiler (smalt-brand's
[DECISIONS.md](https://github.com/stenhoor/smalt-brand/blob/main/DECISIONS.md), "smaltty: a product"):

- **Words:** the tagline "Small. Alternative. Code.", the line "TypeScript for the smalt apps.", and the role "smalt's
  TypeScript implementation" ("smaltty · TypeScript implementation" in menus).
- **Mark and colour:** the Grain, turned (smaltdb's Grain rotated half a turn, the chip at the bottom left), in kiln,
  the family's colour: TypeScript is the language of everything smalt. The hero suffix is `suffix family`.
- **Place:** at the base of the family, under smaltdb's plugins.

The logo files in `docs/public/` come from smalt-brand's `logos/smaltty/`, unchanged. The docs site and README follow
smalt-brand's [BRAND.md](https://github.com/stenhoor/smalt-brand/blob/main/BRAND.md) "Sites and READMEs", like every
product's.

## Cross-repo impact

- smaltkit wraps smaltty; smaltui and smaltnb use it through smaltkit.
- smaltnb's API loses its `ts` option when it moves over: a breaking change there.
- smaltdb-sucrase is retired once smaltui has moved.
