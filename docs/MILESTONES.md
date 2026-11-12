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

Status: done in smaltnb's code, to be confirmed against the done-when below (ADR 0029): smaltnb's `format.ts` walks
smaltty's tree, and nothing in smaltnb imports `typescript`.

- `parseNotebook`, `compileCell`, `compileSetup` and `compileGuard` use smaltty. The `ts` option, `loadTypeScript` and
  `TYPESCRIPT_URL` go: a breaking change to smaltnb's API. Notebooks with `enum` or `namespace` now get an error.
- **Done when:** smaltnb's tests and e2e pass with no TypeScript compiler at run time, and smaltdb-sucrase is retired.
- PRs in smaltkit (if the wrapper changes) and smaltnb.

**Goal 1 is met here.**

**Gate B (owner):** with milestones 1–6 measured, start type checking or stop at the minimal kit.

Decided early, on 2026-11-10: **start type checking now**, with smaltts in scope beside smaltdf (DESIGN.md, "smaltts").
Milestone 7 starts before milestone 6; milestone 6 goes on independently.

## 7. Checker trial

Status: done, 2026-11-11 (`src/checker.ts`, `test/checker.test.ts`):

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
  the checker doesn't follow, so it is reported only when every member fails. Two instances of a class are compared
  by a type parameter that is a property's whole type (`Expr`'s `$type`), so at least covariant.
- Option values (2322): an object literal argument's property whose value can't be assigned to the parameter type's,
  in the target's order, after the excess-property check, as tsc. Where the parameter's type comes from the
  signature's own type parameters (`{ position?: Pos }`), only the keys are checked.
- `// @ts-expect-error` and `// @ts-ignore` silence the line after them, and `@ts-nocheck` a file, as in tsc;
  `expectations()` says which `@ts-expect-error` lines the checker finds an error on. smaltts's compile-time tests:
  all 3 found (a column name, a column compared with a value of another type, a sort key that isn't a column).
- Against tsc on smaltts's reference examples as written (no errors from either), on all of smaltts's own code (no
  false errors; 6 of tsc's errors found), and in 1,076 mutants (a property or an option key misspelt, an argument
  added, taken away or of another type, an option's value of another type): no false errors, 637 of tsc's 847 errors
  of the codes before 2322 caught (75%); of 2322, most of tsc's are knock-on errors outside call arguments (8 of 203).
  A check of one example, smaltts's declarations included, takes 5.5 ms (median, warm process).
- smaltdf: `this` in class members, private names (`#x`), parameter properties, and module augmentations
  (`declare module './expr.js' { interface Expr { … } }`, which smaltdf uses) are read. The corpus libraries
  (smaltdf, smaltnb, smaltkit, smaltui's tokenizer) as written: no false errors. smaltdf's API in the apps and
  generated scripts, in 683 mutants: no false errors, 285 of tsc's 370 errors caught (77%) before the built-in types.
- The built-in types (`src/builtins.ts`): `Array`, `String`, `Number`, `Boolean`, `Map`, `ReadonlyMap`, `Set`,
  `ReadonlySet`, `Promise`, `Math` and `JSON`, declared in smaltty's own words (the owner's decision, 2026-11-11: our
  own table, not TypeScript's lib) and read like any library's. `test/builtins.test.ts` holds them to TypeScript's
  latest lib: the same members, properties where it has properties, and each method's argument counts across its
  overloads (a method with overloads is `(...args: any[])` and isn't counted). Array literals take their elements'
  widened type where nothing else types them, `await` unwraps a `Promise`, and a class property without an annotation
  takes its initializer's type. Now caught: smaltts's mutants 662 of 847 (78%), smaltdf's 325 of 370 (88%); still no
  false errors on either, on the corpus libraries, or on smaltts's own code.
- Speed ([BENCHMARKS.md](BENCHMARKS.md), "Checking"), with `checkCache()` keeping parsed files between checks: a cold
  check of a smaltts example takes 8.6 ms (median of 14; the slowest 11.4 ms) and of smaltnb's notebooks 2.4–3.7 ms,
  against a target of under 10 ms; a re-check after an edit takes 0.2–0.5 ms (the slowest 1.3 ms), against 1–2 ms. The
  first check in a fresh process takes 43–97 ms, most of it parsing the libraries' source while the JIT warms up.

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

Decided on 2026-11-11: **go to milestone 8.** The targets are met on the median (the slowest smaltts example checks
cold in 11.4 ms); the first check in a fresh process (43–97 ms) is left for later.

## 8. Checking in the apps

Status: done, 2026-11-11.

- smaltty: `globals`, modules whose exports are in scope as globals, as a smaltui tab has smaltdf's (`table`, `col`).
  smaltui's tabs as written and in 118 mutants, against tsc with the same names declared global: no false errors, 37
  of tsc's 38 errors caught. smaltdf read from its declarations (`.d.ts`, what a page has) finds every error its
  source does.
- Messages name types as tsc does for arrays (`Order[]`, where they said `'?'`), primitives and literals, and generic
  instances whose arguments are plain (`Map<string, number>`); a literal argument is written widened (`string`) where
  the parameter has no literals, as tsc does. Where tsc keeps an alias or a mapped type's name (`Rel<RowOf<…>>`,
  `Cols<…>`), smaltty writes a shorter name: 250 of the errors both report in the tests have a message other than
  tsc's (`messageDiffs`; 370 before). The built-in types' messages are tsc's word for word.
- smaltkit: `smaltkit/typecheck` runs the checker in a worker (`typeCheckWorker`; checks answered in order, one replaced
  before it starts resolves to null), and its editor marks warnings (`setWarnings`): the text underlined, the line
  number marked, the message on hover. In Chromium a re-check takes 0.9 ms round trip, the first 51 ms with the
  worker's start (stenhoor/smaltkit#15, #16).
- smaltui: TypeScript tabs are checked against smaltdf's `.d.ts` (`vendor/smaltdf/types.json`, with smaltdf's exports,
  `db` and `show` as globals) when they open and 300 ms after an edit (stenhoor/smaltui#34). smaltnb: the notebook is
  checked against smaltnb's and smaltdf's `.d.ts` each time the kernel takes an edit, and each warning is marked in
  the cell it is in (stenhoor/smaltnb#25). Their end-to-end tests: the demos have no warnings; a misspelt method and an
  argument too many are marked with tsc's messages; an edit clears the marks; the code still runs. Running is
  unchanged: the checker has its own worker, and smaltnb's page grows 1.4 KB.

The plan, as it was:

- smaltkit's wrapper runs the checker in a worker. smaltui and smaltnb show its warnings and still run the code.
- **Done when:** both apps show smaltdf type errors for the corpus's broken cases, and running code is no slower.

**Gate D (owner):** the decisions in [ADR 0029](adr/0029-after-the-checker-trial.md): TypeScript 7 as the reference
(a dev dependency change), the tolerant parse for checking, and the order below; and in
[ADR 0030](adr/0030-changing-smaltty-without-breaking-its-consumers.md): releases and tags, the downstream check,
TypeScript 7 for checking in every smalt repository, and the TypeScript and browser rules.

Decided on 2026-11-12: **yes to all of them** (both ADRs accepted; their "The owner's decisions" sections hold the
answers). TypeScript 7 is the reference, with tsrs and 7's own `tsc`, and `typescript` 6.0.3 kept for its API; the
tolerant parse is allowed for checking only; releases are tagged per milestone; the downstream check runs on a
schedule and before each release; every smalt repository checks with TypeScript 7 now; and the TypeScript and browser
rules are the whole family's. Milestone 9 is next.

The order (ADR 0029, as proposed): speed in the page first (milestones 10–12), then checking through syntax errors and
coverage (13–14), then messages (15). ADR 0030 groups them in three waves by what users notice: tooling (9), speed
(10–12), visible (13–15). Each milestone ends in a tagged release with its changelog, and a release is tagged only with the downstream
check green. Each milestone is measured on the tables in [BENCHMARKS.md](BENCHMARKS.md),
smaltty against tsc and tsrs, in Node and in Chromium; a slowdown is a regression.

## 9. TypeScript 7 as the reference

- `typescript` 5.9.3 becomes 6.0.3, kept for its JavaScript API only (`createSourceFile`, `createProgram`,
  `transpileModule`: the parser's, stripper's and binder's comparisons). TypeScript 7's errors come from its `tsc`
  command (an npm alias beside 6.0.3) or from tsrs, and are the reference for the checker's tests: which errors, where,
  and their messages.
- `test/checking.ts` and `test/tsrs.ts` compare with TypeScript 7; `test/tsrs.ts` also counts the errors smaltty
  misses, by code, for milestone 14. The coverage floors in `test/checker.test.ts` are re-taken on 7's errors.
- smaltty's own `typecheck` runs on TypeScript 7. `tsc` (which builds `dist/`, also when a consumer installs smaltty
  from GitHub) stays 6.0.3's for this release; TypeScript 7 is run by its own name (ADR 0030, decision 5).
- The downstream check (ADR 0030, decision 2): a workflow runs smaltkit's, smaltts's, smaltui's and smaltnb's tests
  (the apps' e2e in Chromium) against smaltty's `main`, on a schedule and before each release.
- Releases: `CHANGELOG.md`, and smaltty 0.1.0 tagged; smaltkit and smaltts move their pins from commits to the tag.
- Milestone 6's status is confirmed.
- **Done when:** the downstream check is green on `main`, CI passes with TypeScript 7 as the checker's reference, BENCHMARKS.md has TypeScript 7's columns, and
  the messages that differ are counted against 7 (the count milestone 15 brings down).

## 10. Entry points and size

- `smaltty/strip` (scanner, parser, stripper) and `smaltty/check` (binder, checker, built-in types) as entry points
  of their own, `smaltty` still exporting everything. smaltkit's `typescript` module imports `smaltty/strip`, and its
  `typecheck` worker `smaltty/check`.
- `dist/` minified when smaltty is built, if loading in Chromium says it pays (the docs keep the readable source).
- **Done when:** the stripping path is under 30 KB gzipped, loading in a page is measured for each entry point, and
  smaltui and smaltnb load no checker code outside the checker's worker.

## 11. Prepared declarations: the first check

- `prepare(files)`: declarations (`.d.ts`) parsed and bound once, written as one buffer (the trees are already flat
  typed arrays) with the names and the index the checker reads. `check()` takes prepared files beside text.
- The built-in types prepared when smaltty is built. smaltui's and smaltnb's build steps that write `types.json` write
  prepared declarations instead (PRs in smaltkit, smaltui and smaltnb, linked with `Depends on:`).
- smaltkit's worker starts while the page is idle and warms with a check of nothing.
- Added, not changed (ADR 0030, decision 3): `check()` and smaltkit's `TypeCheckSetup` take prepared declarations
  beside `.d.ts` text, and the apps move to them one at a time. A prepared buffer carries its format version; one
  smaltty doesn't know is ignored and the text read instead, including a buffer kept in the browser from an earlier
  deploy. Text is still accepted for one minor release after the apps have moved.
- **Done when:** a page's first check, from the worker's start, is under 20 ms in Chromium for smaltui's tabs and
  smaltnb's notebooks (91 ms now for smaltts's examples; measured for each), cold checks stay under 10 ms, and the
  errors found are the same as from `.d.ts` text.

## 12. Incremental re-checks

- Results kept per top-level statement and per notebook cell, keyed by its text and the declarations it uses (ty's
  incremental queries, DESIGN.md). An edit re-parses the file (parsing is cheap) and re-checks only the statements
  whose text or dependencies changed.
- **Done when:** a re-check of `generated/40k.ts` after a one-line edit takes under 3 ms (27 ms now; tsrs's own time
  25 ms), app code re-checks no slower than now (0.3–0.8 ms), and every error is the same as a cold check's.

## 13. Checking through syntax errors

The owner's yes at gate D (2026-11-12): an exception to the node-for-node rule, for checking only.

- A tolerant parse for checking: a syntax error is kept to its top-level statement (or cell), which is reported with
  its line and column, and the rest of the file is parsed and checked. The strict parser, compared with TypeScript
  node for node, stays for stripping.
- smaltui's tabs and smaltnb's notebooks show the other lines' warnings while one line is half typed; smaltnb's own
  `parseTolerant` goes from its checking path.
- An option, off by default (ADR 0030, decision 3): with it off, `check()` reports what it does now, and the strict
  parse still throws `ParseError`, which smaltkit catches. Each app turns it on when it stops reporting syntax errors
  its own way, so none is shown twice.
- **Done when:** on the mutants with a syntax error added to one statement, the other statements' errors are TypeScript
  7's on the same file without it, with no false errors; and the strict parse is no slower.

## 14. Coverage

In the order of milestone 9's count of what is missed most, each part measured on its own:

- Narrowing: `typeof`, `===` and `!==`, `in`, truthiness, optional chaining, so union-typed arguments are checked.
- Locals' types (annotated, or from their initializers) and functions' return types, so values passed through a
  variable are checked.
- Assignments and returns: 2322 outside call arguments.
- Unknown names (2304, and 2552 with a suggestion), once the globals of each page are declared in full (the built-in
  types, `types.json`'s globals, and the browser's that a tab may use).
- A missing `await`.
- The built-in types modern browsers ship: `Date`, `RegExp`, `Object`, `Error`, iterator helpers, `Array.fromAsync`,
  ES2025's `Set` methods, `structuredClone` and `console`, each held to TypeScript's lib by `test/builtins.test.ts`.
- Rolled out as ADR 0030's wave 3: the errors each new group finds in smaltts's tests and examples and in the apps'
  demos are fixed in those repositories before the release that reports them; then smaltui's tabs, then smaltnb.
- **Done when:** smaltts's mutants above 90% caught, smaltdf's above 95%, the floors in `test/checker.test.ts` raised
  to match, still no false errors on any corpus, and cold checks and re-checks no slower than after milestone 12.

## 15. Messages as TypeScript 7 writes them

- Types printed with their alias and mapped-type names (`Rel<RowOf<…>>`, `Cols<…>`) where TypeScript keeps them, and
  unions in TypeScript 7's order.
- **Done when:** the messages that differ from TypeScript 7's on errors both report are under 25 (from milestone 9's
  count), and `messageDiffs` is held to that in the tests.

## Not scheduled

Anything past milestones 9–15: other APIs, more of TypeScript, blocking runs on errors, completions, hover and
go-to-definition. Each one is weighed against the test in DESIGN.md (does it remove outside code from the apps, or make
them faster?) before it is scheduled.
