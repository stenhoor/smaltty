# CLAUDE.md

smaltty is a TypeScript kit with no outside code: a parser, a type stripper, scope analysis and, later, a type checker
for TypeScript written against smaltdf and smaltts (smaltts's TypeScript tooling is smaltty: owner's decision,
2026-11-10). It replaces sucrase in smaltui and the TypeScript compiler in smaltnb. smaltkit
wraps it for the apps. Read [docs/DESIGN.md](docs/DESIGN.md) first: it holds the owner's decisions and their order.
Milestones 1–5 are done (scaffold and baseline, parser, stripper, smaltui moved over, binder); see docs/MILESTONES.md for what's next. Several Claude Code sessions work on the smalt repos in parallel and cannot see each other: this
file is the shared starting point, and its working rules match smaltdb's `CLAUDE.md`.

## Commands

```bash
npm install            # prepare builds dist/ (tsc -p tsconfig.build.json)
npm run typecheck      # tsc --noEmit, strict and erasableSyntaxOnly, over src/, test/ and bench/
npm test               # build, then node --test test/*.test.ts (the corpus checks among them)
npm run test:self      # the same tests, with .ts files stripped by smaltty instead of Node (test/register.mjs)
npm run bench          # the benchmark tables in docs/BENCHMARKS.md; --quick checks the harness only
npm run docs:dev       # the docs site (docs/, VitePress); docs:build fails on dead links (CI runs it)
```

## Repo map

- `src/`: `scanner.ts` (tokens on demand), `parser.ts` (TypeScript's grammar, TypeScript's tree shapes), `tree.ts` (the
  flat tree), `strip.ts` (types to spaces), `binder.ts` (which declaration each name means), `checker.ts` (types
  of calls into the libraries a file imports, and tsc's errors on them), `kinds.ts` and `tokens.ts`
  (codes). `test/` imports the package by name, so
  it tests the built output.
- `test/compare.ts` flattens both trees for comparison; `node test/sweep.ts <paths>` compares the parser with TypeScript
  on any code (run it on the smalt repositories after a parser change). `node test/strip-sweep.ts <paths>` does the same
  for the stripper, against TypeScript's own transpile, and `node test/binding.ts <paths>` for the binder, against
  TypeScript's checker. `node test/checking.ts <project> [--package=name=path]` compares the checker with tsc on a
  project's files. `node test/tsrs.ts` adds tsrs, a Rust port of TypeScript 7's
  checker, to that comparison, on the checker tests' mutants.
- `corpus/` the input for tests and benchmarks ([corpus/README.md](corpus/README.md)). `bench/` the harness.
- `docs/` is the docs site (VitePress, deployed to stenhoor.github.io/smaltty/ from `main` by `.github/workflows/docs.yml`):
  `guide/`, and [DESIGN.md](docs/DESIGN.md), [MILESTONES.md](docs/MILESTONES.md), [BENCHMARKS.md](docs/BENCHMARKS.md).
  `docs/.vitepress/theme/` (except `index.ts`) and `docs/public/` are copied from smalt-brand unchanged.

## Rules for code here

- TypeScript only: no Rust, no WASM. Output is plain ES2022 modules that load in a page without a bundler.
- No run-time dependencies. sucrase, typescript and tsrs (the owner's yes, 2026-11-11) may be dev dependencies for differential tests and
  benchmarks only.
- Speed comes first. Every change to the scanner, parser, stripper or binder is benchmarked against the tool it
  replaces, on the same work, and a slowdown is a regression.
- Follow TypeScript, not sucrase: where they differ, TypeScript's behaviour is right (the owner's rule).
- The parser's tree must match TypeScript's node for node. A difference the tests or a sweep find is a bug in smaltty,
  unless TypeScript reports a syntax error there too.
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

smaltty is one of the kits, not a top-level product: it has no brand entry or mark of its own. Don't propose one. It
becomes a top-level product only if it grows into our own TypeScript compiler or a significant part of one, and that
is the owner's call. Its docs site and README follow smalt-brand's
[BRAND.md](https://github.com/stenhoor/smalt-brand/blob/main/BRAND.md) "Sites and READMEs", like the other docs sites
(the owner's choice, 2026-11-08), with two differences while it has no brand entry: the name is text where they show a
lockup, and the hero has a plain description instead of a family tagline.

## Cross-repo impact

- smaltkit wraps smaltty; smaltui and smaltnb use it through smaltkit.
- smaltnb's API loses its `ts` option when it moves over: a breaking change there.
- smaltdb-sucrase is retired once smaltui has moved.
