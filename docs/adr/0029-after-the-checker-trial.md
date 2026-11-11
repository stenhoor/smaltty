# ADR 0029: after the checker trial: speed in the page, TypeScript 7 as the reference

- **Status:** proposed (2026-11-11; the owner's decisions are open, below)
- **Date:** 2026-11-11
- **Builds on:** [DESIGN.md](../DESIGN.md) (the test every piece of work passes: does it remove outside code from the
  apps, or make them faster?), [MILESTONES.md](../MILESTONES.md) milestones 1–8 and gate C,
  [BENCHMARKS.md](../BENCHMARKS.md) ("Checking", "Checking in a page", "What adding tsrs says"); smaltts
  [ADR 0023](https://github.com/stenhoor/smaltts/blob/main/docs/adr/0023-the-smaltts-language.md) (smaltts's
  TypeScript tooling is smaltty).
- **Details:** the milestones this adds are 9–15 in [MILESTONES.md](../MILESTONES.md).

## Context

Milestones 1–8 are done. smaltty parses, strips, binds and checks in smaltui and smaltnb with no outside code at run
time, and it is ahead of the tools it replaces on almost every measure:

| | smaltty | tsc 5.9 | tsrs (TypeScript 7.1 beta's checker, in Rust) |
| --- | --- | --- | --- |
| Download for a page | 58 KB gzipped | 1.6 MB | 2.9 MB (WebAssembly) |
| Load in Chromium | 27 ms | about 260 ms (Node) | 62 ms |
| Cold check of app code in a page | 7.7–10 ms | — | 36–80 ms |
| Re-check after an edit, app code | 0.4–0.8 ms | 2–21 ms (program reused) | the same as its first check |
| First check in a new page or process | 76–157 ms (Node); 91 ms in a page | 150 ms and more | 80 ms and more |
| 40 KB script, re-check after an edit | 18–27 ms | 71 ms | 25 ms (its own time) |
| tsc's errors caught, of the codes checked | 71%: smaltts 78%, smaltdf 88%, tabs 97% | the reference | 100% |
| Errors tsc doesn't report | none | — | none |

What the review of 2026-11-11 found, beyond that table:

- **The first check costs ten times a warm one.** A page's first check parses the declarations it checks against
  (smaltdf's in smaltui, written to `vendor/smaltdf/types.json`; smaltnb's and smaltdf's in smaltnb, its `types.json`)
  and the built-in types while the JIT warms up. That is what a user sees when a tab or notebook opens.
- **A re-check is a check of the whole file.** On app code this doesn't matter; on a 40 KB generated script it is the
  one place tsrs's own time is better than smaltty's.
- **The parser stops at the first syntax error.** smaltnb works around it (`parseTolerant` in its `format.ts` blanks
  each cell that doesn't parse); smaltui doesn't, so a half-typed line leaves the whole tab unchecked.
- **Coverage is calls into libraries.** Narrowing, locals' types, return types and assignments are not modelled; 8 of
  tsc's 203 errors of code 2322 are caught, most of the rest being outside call arguments. The built-in types stop at
  `Array`, `String`, `Number`, `Boolean`, `Map`, `Set`, `Promise`, `Math` and `JSON`.
- **One entry point.** `smaltty` exports the checker with the stripper, so a page that only strips loads 60 KB
  gzipped (the stripping modules alone are about 32 KB) against the 48 KB target of phase 0.
- **Messages.** 250 errors both report have a message other than tsc's: smaltty writes a shorter name where tsc keeps
  an alias or a mapped type's name.
- **Milestone 6 is done in practice.** smaltnb's `format.ts` walks smaltty's tree and nothing in smaltnb imports
  `typescript`; smaltty's milestones and status page didn't record it.

### TypeScript 7

TypeScript 7.0.2 (the Go compiler) has been `latest` on npm since 2026-07-08; 7.1 is in beta and 6.0.3 is the last
JavaScript release. The review checked every public smalt repository against what 7.0 removes or changes:

- **The builds are ready.** None uses an option 7.0 removes (`baseUrl`, `outFile`, `target: es5`, `node`/`classic`
  resolution, AMD/UMD/SystemJS, `downlevelIteration`, import `assert`, `module Foo {}`). All set `strict`, `module`,
  `target` and `types`, and those that emit declarations set `rootDir`, so the changed defaults don't apply. Side-effect
  imports, now checked by default, resolve where tsc checks them (smaltbi's `import './cartesian.js'`); the docs
  themes' `import './smaltdb.css'` is built by VitePress, not tsc. Every repository runs `tsc` only from npm scripts,
  which 7.0's package still provides.
- **smaltty's tests are not.** 7.0's package exports no compiler API: only a version and `unstable/*` modules that
  talk to the Go binary. smaltty's tests and benchmarks are built on `ts.createSourceFile`, `ts.createProgram`,
  `ts.forEachChild` and `ts.transpileModule` (10 files: the tree comparison, the strip, binding and check sweeps, the
  built-in types' test and `bench/run.ts`). A stable API is expected in 7.1 at the earliest.
- **Errors are the same; messages are not.** tsrs reports exactly tsc 5.9's errors on all 1,752 mutants, at the same
  places; the first line of 57 of them differs, because TypeScript 7 orders a union's members one fixed way (which
  can't be turned off) and cuts long types elsewhere.

## Decision

### 1. TypeScript 7 is the reference

From milestone 9, "what TypeScript does" (the owner's rule, 2026-11-08) means TypeScript 7: which errors are
reported, where, and their messages. tsc 7's command line and tsrs are both run in the comparisons. `typescript`
6.0.3 stays as a dev dependency for its JavaScript API only (the parser's, stripper's and binder's comparisons), until
TypeScript 7 has a stable API; then those move over too. The other smalt repositories can move their builds to 7.0
now: a version bump and one run of each `typecheck` and `build`.

### 2. Speed first: the page's first check, then re-checks

- **Prepared declarations.** The declarations a page checks against, whichever library they come from, are prepared
  when the app is built: their trees (already flat typed arrays) and names, written as one buffer, in place of `.d.ts`
  text. Loading them parses nothing. The built-in types are prepared when smaltty is built. The checker's worker is
  started and warmed with a check of nothing while the page is idle. Target: a page's first check under 20 ms.
- **Incremental re-checks** (DESIGN.md's model, ty's "incremental queries"): results kept per top-level statement and
  per notebook cell, keyed by its text and the declarations it uses; an edit re-checks what it touches. Target: a
  re-check of the 40 KB script under 3 ms, and app code unchanged or faster.

### 3. A smaller page for stripping

`smaltty/strip` (scanner, parser, stripper) and `smaltty/check` (binder, checker, built-in types) as their own entry
points, so the checker is loaded only in its worker; `dist/` minified if the measurements say it pays. Target: the
stripping path under 30 KB gzipped.

### 4. Checking through syntax errors

A tolerant parse for checking only: a syntax error is kept to its top-level statement, which is reported, and the
rest of the file is checked. The strict parser stays for stripping and is still compared with TypeScript node for
node; the tolerant tree is not. That needs the owner's yes (below), as an exception to the node-for-node rule.

### 5. Then coverage, by what is missed most

`test/tsrs.ts` counts the errors smaltty misses by code, and the largest counts go first: narrowing (`typeof`, `===`,
`in`, optional chaining), locals' and return types, assignments (2322 outside call arguments), unknown names (2304,
2552) once the globals a page has are fully declared, a missing `await`, and the built-in types modern browsers ship
(`Date`, `RegExp`, `Object`, `Error`, iterator helpers, `Array.fromAsync`, ES2025's `Set` methods, `structuredClone`,
`console`), each held to TypeScript's lib by `test/builtins.test.ts`. No false errors, as always. Targets: smaltts
above 90%, smaltdf above 95%.

### 6. Messages as TypeScript 7 writes them

Alias and mapped-type names kept when a type is printed, and unions in TypeScript 7's order, so the 250 differences go
towards none.

## The owner's decisions

Open. Nothing in milestones 9–15 starts until these are answered.

1. **TypeScript 7 as the reference (decision 1).** It changes dev dependencies: `typescript` 5.9.3 to 6.0.3 for its
   API, and `typescript` 7 beside it as the `tsc` command (an npm alias such as `typescript7`), or tsrs alone for
   TypeScript 7's errors. CLAUDE.md asks for the owner's yes on any package change. Both are Apache-2.0; neither
   reaches `dist/`.
2. **The tolerant parse (decision 4)** as an exception to "the parser's tree must match TypeScript's node for node",
   for checking only.
3. **The order** of milestones 9–15, which puts speed (first check, re-checks, size) before coverage.
4. **Unchanged, unless the owner says otherwise:** errors stay warnings and code still runs; completions, hover and
   go-to-definition stay out (they remove no outside code and make nothing faster, so they fail DESIGN.md's test).

## Alternatives

- **tsrs's WebAssembly build in the apps.** It reports all of tsc's errors, but it is 2.9 MB gzipped, it re-checks
  as slowly as it checks first, and it is outside code in WebAssembly: against DESIGN.md's decisions on both counts.
- **Coverage before speed.** More errors caught sooner, but the first check stays at about 90 ms in a page, and the
  measurements a coverage change is held to (no slower) would be taken against a baseline about to change.
- **Staying on tsc 5.9.** No dependency change, but the reference falls behind what the community runs, and smaltty's
  messages would be aimed at a printer TypeScript no longer uses.
- **Waiting for TypeScript 7's API to move every test at once.** Simpler, but the checker's errors and messages,
  which users see, would follow 5.9 for months longer.

## Consequences

- smaltty's checker results and messages are compared with TypeScript 7; the parser's, stripper's and binder's still
  with 6.0's JavaScript API until 7 has a stable one. BENCHMARKS.md gains TypeScript 7 columns.
- smaltkit's wrapper changes: prepared declarations to load, a warmed worker, and the two entry points. smaltui and
  smaltnb change their build steps that write `types.json`. Each is a PR linked with `Depends on:`.
- smaltnb's `parseTolerant` can go once the checker parses tolerantly; its run path keeps blanking cells that don't
  parse.
- Every milestone is measured against the same tables as now (smaltty, tsc, tsrs, in Node and in Chromium); a
  slowdown is a regression.
