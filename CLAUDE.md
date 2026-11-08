# CLAUDE.md

smaltty is a TypeScript kit with no outside code: a parser, a type stripper, scope analysis and, later, a type checker
for TypeScript written against smaltdf. It replaces sucrase in smaltui and the TypeScript compiler in smaltnb. smaltkit
wraps it for the apps. Read [docs/DESIGN.md](docs/DESIGN.md) first: it holds the owner's decisions and their order.
There is no code yet. Several Claude Code sessions work on the smalt repos in parallel and cannot see each other: this
file is the shared starting point, and its working rules match smaltdb's `CLAUDE.md`.

## Rules for code here

- TypeScript only: no Rust, no WASM. Output is plain ES2022 modules that load in a page without a bundler.
- No run-time dependencies. sucrase and typescript may be dev dependencies for differential tests and benchmarks only.
- Speed comes first. Every change to the scanner, parser, stripper or binder is benchmarked against the tool it
  replaces, on the same work, and a slowdown is a regression.
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

Before writing the README or a site, read smalt-brand's
[BRAND.md](https://github.com/stenhoor/smalt-brand/blob/main/BRAND.md) and
[DECISIONS.md](https://github.com/stenhoor/smalt-brand/blob/main/DECISIONS.md).

## Cross-repo impact

- smaltkit wraps smaltty; smaltui and smaltnb use it through smaltkit.
- smaltnb's API loses its `ts` option when it moves over: a breaking change there.
- smaltdb-sucrase is retired once smaltui has moved.
