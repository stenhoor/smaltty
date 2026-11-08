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

- Types removed, line and column positions kept. `enum`, `namespace` with values and constructor parameter properties are
  errors. Syntax errors say where (file, line, column), in the shape of the current `Transpiler` interface.
- **Done when:** on the corpus, smaltty's output runs the same as sucrase's; it's no slower than sucrase; and it's under
  48 KB gzipped.

## 4. smaltui moves over

- A thin smaltty wrapper module in smaltkit. smaltui uses it instead of `vendor/smaltdb-sucrase/`.
- **Done when:** smaltui's tests and e2e pass, and the `@smaltworks/smaltdb-sucrase` pin is removed.
- PRs in smaltkit and smaltui, linked with `Depends on:`.

## 5. Binder

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

## 7. Checker trial

- Built-in types prepared when smaltty is built (only what users call). smaltdf's `.d.ts` read in the page. Checks on
  calls into smaltdf: unknown methods and properties, argument types and counts, option keys, literal values, a missing
  `await`. Anything not modelled is unknown and quiet.
- **Done when:** the checker reports no errors that tsc doesn't (zero false errors) on the corpus and on smaltdf's own
  tests and examples; the share of tsc's errors it does catch is recorded; and cold checks and re-checks after an edit are
  measured against the targets (under 10 ms cold, 1–2 ms per edit).

**Gate C (owner):** targets met → milestone 8. Not met → stop, or fix what the measurements point to.

## 8. Checking in the apps

- smaltkit's wrapper runs the checker in a worker. smaltui and smaltnb show its warnings and still run the code.
- **Done when:** both apps show smaltdf type errors for the corpus's broken cases, and running code is no slower.

## Not scheduled

Anything past checking smaltdf's API: other APIs, more of TypeScript, blocking runs on errors, a prepared smaltdf type
table. Each one is weighed against the test in DESIGN.md (does it remove outside code from the apps, or make them
faster?) before it is scheduled.
