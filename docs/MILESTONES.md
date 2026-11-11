# Milestones

The plan in [DESIGN.md](DESIGN.md), as milestones. Each one ends with something measurable. The gates are owner
decisions taken on the data the milestones before them produce: nothing after a gate starts until the owner says so.

Goal 1 (remove the outside code) is milestones 1–6. Goal 2 (measure) runs through all of them. Goal 3 (checking) starts
only after gate B.

## 1. Scaffold and baseline

Status: done, 2026-11-08 ([BENCHMARKS.md](BENCHMARKS.md)).

- Package, strict `tsconfig`, CI (typecheck and tests), the benchmark harness. sucrase and typescript as dev dependencies,
  for tests and benchmarks only.
- A corpus: smaltnb's example notebooks, smaltui's demo tabs, a large generated script, and syntax edge cases.
- **Done when:** CI passes and `docs/BENCHMARKS.md` records the baselines (sucrase and `transpileModule` stripping, the
  compiler's parse and name analysis, sizes) on the corpus.

## 2. Scanner and parser (the trial)

Status: done, 2026-11-08. Waiting on gate A ([BENCHMARKS.md](BENCHMARKS.md), "What milestone 2 says").

- A scanner and a parser for the erasable TypeScript users write, building a flat-array syntax tree.
- **Done when:** the whole corpus parses, the tree's node kinds and positions match `ts.createSourceFile`'s, and parse time
  is measured against sucrase and the compiler.

**Gate A (owner):** can stripping from a full tree get to sucrase's speed?

- Yes: go on as designed, one tree for everything.
- No: smaltui gets a stripper that skips types without building a tree (as sucrase does), and the binder in milestone 5
  keeps its own tree. The plan stays the same; the parts change.

## 3. Stripper

Status: done, 2026-11-08 ([BENCHMARKS.md](BENCHMARKS.md), "What milestone 3 says"). Gate A was passed on 2026-11-08: one
tree, as designed.

- Types removed, line and column positions kept. `enum`, `namespace` with values and constructor parameter properties are
  errors. Syntax errors say where (file, line, column), in the shape of the current `Transpiler` interface.
- **Done when:** on the corpus, smaltty's output runs the same as sucrase's; it's no slower than sucrase; and it's under
  48 KB gzipped.

## 4. smaltui moves over

Status: done, 2026-11-08: stenhoor/smaltkit#12 (`smaltkit/typescript`) and stenhoor/smaltui#33. The sucrase plugin is
retired (stenhoor/smaltdb-sucrase#2).

- A thin smaltty wrapper module in smaltkit. smaltui uses it instead of `vendor/smaltdb-sucrase/`.
- **Done when:** smaltui's tests and e2e pass, and the `@smaltworks/smaltdb-sucrase` pin is removed.
- PRs in smaltkit and smaltui, linked with `Depends on:`.

## 5. Binder

Status: done, 2026-11-08 ([BENCHMARKS.md](BENCHMARKS.md), "What milestone 5 says").

- Scope analysis: module, function, block, class, catch and loop scopes; hoisting; value and type names; destructuring;
  shorthand properties; `typeof` in types.
- **Done when:** on the corpus, every identifier resolves to the same declaration as the compiler's
  `getSymbolAtLocation`, and parse plus bind time is measured against the compiler.

## 6. smaltnb moves over

- `parseNotebook`, `compileCell`, `compileSetup` and `compileGuard` use smaltty. The `ts` option, `loadTypeScript` and
  `TYPESCRIPT_URL` go: a breaking change to smaltnb's API. Notebooks with `enum` or `namespace` now get an error.
- **Done when:** smaltnb's tests and e2e pass with no TypeScript compiler at run time, and smaltdb-sucrase is retired.
- PRs in smaltkit (if the wrapper changes) and smaltnb.

**Goal 1 is met here.**

**Gate B (owner):** with milestones 1–6 measured, start type checking or stop at the minimal kit.

Decided early, on 2026-11-10: **start type checking now**, with smaltts in scope beside smaltdf (DESIGN.md, "smaltts").
Milestone 7 starts before milestone 6; milestone 6 goes on independently.

## 7. Checker trial

Status: in progress. Done so far (`src/checker.ts`, `test/checker.test.ts`):

- Declarations read from the libraries a file imports (relative paths, and bare specifiers through `packages`):
  classes, interfaces (merged), type literals, functions (overloads), arrow functions, re-exports and `export *`.
- Checks on calls into them: unknown properties (tsc's 2339, and 2551 with tsc's own spelling suggestion), argument
  counts (2554, 2555) where there is one signature and no spread, and option keys: an object literal's property that
  the parameter's type doesn't have (2353, and 2561 with a suggestion), nested literals too, one per call as tsc does.
- Generic types, so row callbacks are checked: type arguments carried by classes, interfaces and aliases; inference
  from arguments (object literals, then arrow functions' return types) with defaults; arrow functions' parameters typed
  from where they are passed; mapped types over known keys (with `as` and template literals), `keyof`, intersections,
  string literal unions, and `Omit`, `Pick`, `Readonly`, `Partial`, `Required` and `Record`; overloads chosen when only
  one fits. `scan(orders).filter((o) => o.totl…)`, a join's prefixed columns, `extend` and `select` are all checked.
- Argument types (2345): each argument against its parameter, in order, the first that certainly can't be assigned.
  Types now include primitives by kind, boolean literals, unions, arrays, indexed access, conditional types (with
  `infer`, distributed over unions) and template literals over unions, so a column's value type (`RowOf`'s
  conditional `ValueOf`) and `sort`'s keys are known. A union-typed argument may be narrowed where it is read, which
  the checker doesn't follow, so it is reported only when every member fails.
- `// @ts-expect-error` and `// @ts-ignore` silence the line after them, and `@ts-nocheck` a file, as in tsc;
  `expectations()` says which `@ts-expect-error` lines the checker finds an error on. smaltts's compile-time tests:
  all 3 found (a column name, a column compared with a value of another type, a sort key that isn't a column).
- Against tsc on smaltts's reference examples as written (no errors from either), on all of smaltts's own code (no
  false errors), and in 1,026 mutants (a property or an option key misspelt, an argument added, taken away or of
  another type): no false errors, 637 of tsc's 846 errors caught (75%). Most of the 2345 errors it misses compare
  generic classes (`Expr<A>` with `Expr<B>`). A check of one example, smaltts's declarations included, takes 5.9 ms
  (median, warm process; 43 ms the first time).
- Next: generic classes compared structurally; property types (2322); the built-in types; smaltdf; and smaltts's
  `npm run check` running the checker.

- Built-in types prepared when smaltty is built (only what users call). smaltdf's and smaltts's `.d.ts` read in the
  page. Checks on calls into smaltdf and smaltts: unknown methods and properties, argument types and counts, option
  keys, literal values, a missing `await`; for smaltts, also column names and types in row callbacks, which come from
  its mapped, conditional and template-literal types. Anything not modelled is unknown and quiet.
- **Done when:** the checker reports no errors that tsc doesn't (zero false errors) on the corpus and on smaltdf's and
  smaltts's own tests and examples; the share of tsc's errors it does catch is recorded; smaltts's compile-time tests
  (its `@ts-expect-error` lines) are reported; and cold checks and re-checks after an edit are measured against the
  targets (under 10 ms cold, 1–2 ms per edit).
- smaltts then runs the checker in its `npm run check` (smaltts MILESTONES.md, "Alongside").

**Gate C (owner):** targets met → milestone 8. Not met → stop, or fix what the measurements point to.

## 8. Checking in the apps

- smaltkit's wrapper runs the checker in a worker. smaltui and smaltnb show its warnings and still run the code.
- **Done when:** both apps show smaltdf type errors for the corpus's broken cases, and running code is no slower.

## Not scheduled

Anything past checking smaltdf's and smaltts's APIs: other APIs, more of TypeScript, blocking runs on errors, a prepared smaltdf type
table. Each one is weighed against the test in DESIGN.md (does it remove outside code from the apps, or make them
faster?) before it is scheduled.
