# smaltty design

Status: **proposal**, from the owner interview of 2026-11-08. Nothing is built yet.

## Why

TypeScript written against smaltdf runs in two apps, and neither checks its types:

| App | How user TypeScript runs today | Outside code |
| --- | --- | --- |
| smaltui (TypeScript tabs) | `@smaltworks/smaltdb-sucrase`: sucrase's `typescript` transform | sucrase 3.35.1 and its dependencies, ~200 KB (48 KB gzipped) |
| smaltnb (notebook cells) | The TypeScript compiler: `transpileModule` with diagnostics off, plus a `noLib` checker used only to resolve names | `lib/typescript.js`, 8.7 MB, from jsDelivr or the app's copy |

smaltdf, smaltql and smaltdb don't compile or strip TypeScript at run time. They use esbuild and tsc when they are built,
and ship JavaScript with `.d.ts` files. (smaltdb generates JavaScript of its own with `new Function` to run expressions;
that is not TypeScript.) So types are checked while smaltdf is built, and dropped just before user code runs.

## What smaltty is, and isn't

smaltty is a kit, one of smaltworks' kits as the community sees them, in its own repository. smaltworks isn't in the
business of writing TypeScript compilers. smaltty exists because it removes dependencies from the apps and may make them
faster. It becomes a product in its own right, with its own brand, only if it grows into our own TypeScript compiler or a
significant part of one. That is a possible outcome, not a goal.

Use this test for any piece of work: does it remove outside code from the smalt apps, or make them faster? If not, it is
a distraction and waits.

## Goals, in order

1. **Remove the outside code.** One parser of our own replaces sucrase in smaltui and the TypeScript compiler in
   smaltnb, for stripping and for smaltnb's name analysis.
2. **Measure it.** Speed and correctness against sucrase and tsc, on the same inputs.
3. **Then decide how far checking goes**, from that data. The first checking target is smaltdf's API, as smaltui tabs and
   smaltnb cells use it. Other APIs wait until this is proven.

Not a goal: a 1:1 replacement for tsc. The design must not rule one out, but nothing commits to it. If the checker can't
be made fast, smaltty stays the minimal kit from goal 1.

Out of scope: checking table and column names against a database schema. That is a separate future project, **smaltsc**
(smalt schema checker), parallel to smaltty.

## Decisions

| Decision | Choice |
| --- | --- |
| Language | TypeScript only. No Rust, no WASM. Output is plain ES2022 modules that load in a page without a bundler. |
| Dependencies | None at run time. sucrase and typescript are allowed as dev dependencies for differential tests and benchmarks only; nothing from them reaches `dist/`. |
| Syntax | Erasable TypeScript only (as `erasableSyntaxOnly` and Node's type stripping): `enum`, `namespace` with values and constructor parameter properties are errors with a clear message, not transforms. Line and column positions are kept. |
| Built-in types | Our own: a compact declaration set for what users call (Array, Promise, Math, JSON, string methods, …), turned into a type table at build time. Anything not covered is unknown, and unknown is never an error. |
| Type errors on Run | Warn and run, for now. Severity is part of every diagnostic so that blocking can be added later. |
| smaltdf's types | Read from smaltdf's `.d.ts` in the page, when checking starts (decided 2026-11-08). smaltdf doesn't change, and there is no build step. A prepared table built when the app is built, or shipped by smaltdf, can come later if measurements call for it. |
| How apps use it | smaltkit wraps smaltty (a thin module that runs it in a worker and hands its diagnostics to the editors). Apps import smaltkit; smaltty doesn't depend on smaltkit. |

## Model: ty

Astral's ty (a Python type checker) is the model to follow. We're taking its design, not its language:

- **Incremental queries:** results are kept per file and scope, and an edit re-checks only what depends on it.
- **The gradual guarantee:** code without annotations isn't flagged, and anything the checker doesn't model is unknown
  and quiet. This lets checking start small with no false errors.
- **One parser** for the stripper, smaltnb's analysis and the checker.
- **Prepared types:** in tsc, reading, parsing and binding `lib.d.ts` is most of a cold check: app code takes 32–40 ms
  cold and 1–4 ms once the lib files are kept ([BENCHMARKS.md](BENCHMARKS.md)).
  smaltty's built-in types are compiled into a table at build time and load at once. smaltdf's `.d.ts` is small and is
  read in the page for now.

## Parts and phases

The order of work, with its gates, is in [MILESTONES.md](MILESTONES.md).

| Phase | Part | Replaces | Size estimate |
| --- | --- | --- | --- |
| 0 | Scanner and parser: all TypeScript syntax users write, into a compact AST | sucrase's parser, `ts.createSourceFile` | 4,000–6,000 lines |
| 0 | Stripper: types removed, positions kept | sucrase, `ts.transpileModule` | 300–600 lines |
| 0 | Binder (scope analysis): scopes, declarations, references, value and type names | smaltnb's `noLib` checker | 800–1,200 lines |
| 1+ | Checker over the binder, against smaltdf's declarations and the built-in types | nothing today | grows with the data |

### What the binder adds (smaltnb)

smaltnb's `format.ts` (446 lines) uses the compiler for: parsing; `getSymbolAtLocation` and
`getShorthandAssignmentValueSymbol` to map each identifier to its declaration; telling type positions from value
positions; and node positions. `runtime.ts` uses it to find `export` modifiers and the last expression of a cell before
stripping. Replacing that means:

- **A binder:** module, function, block, class, catch, parameter and for-loop scopes; `var` and function hoisting; the
  separate value and type namespaces (an interface and a const can share a name); destructuring; shorthand properties;
  property names that are not references; `typeof x` in a type (a value name read in a type position); function and
  class expression names visible only inside themselves.
- **Porting smaltnb** from the compiler's AST to smaltty's: `parseNotebook`, `compileCell`, `compileSetup`,
  `compileGuard`. That is a rewrite of the parts that walk the tree, not of smaltnb's rules.
- **One behaviour change:** with erasable syntax only, a notebook that uses `enum` or `namespace` gets an error. Today
  they are accepted.

Cost: about 15–20% more than the parser and stripper alone, plus the smaltnb port. A stripper could skip types without
building a tree (as sucrase does); the binder needs a tree. So the tree must be cheap to build: flat arrays of nodes, not
an object per node. The checker needs the binder anyway, so this work is pulled forward, not extra.

## Speed targets

Measured against the tool it replaces, doing the same work, in Node and in a browser worker. Baselines are from
milestone 1's harness ([BENCHMARKS.md](BENCHMARKS.md)), median times after warm-up:

| Measure | Baseline | Target |
| --- | --- | --- |
| Strip a 945 B notebook | sucrase 0.028 ms; `transpileModule` 0.93 ms | ≤ sucrase |
| Strip a 40 KB script | sucrase 2.4 ms; `transpileModule` 20 ms | ≤ sucrase |
| Parse and resolve names, 945 B notebook | compiler 0.69 ms | ≤ the compiler |
| Parse and resolve names, 167 KB of library code | compiler 113 ms | ≤ the compiler |
| First use, fresh process | sucrase 33 ms; compiler 162 ms | ≤ sucrase |
| Size | sucrase ~48 KB gzipped; compiler 1.6 MB gzipped (8.9 MB) | under 48 KB gzipped for phase 0 |
| Check, cold (phase 1) | tsc 32–40 ms for app code, 83 ms for 40 KB | < 10 ms, built-in types included |
| Re-check after an edit (phase 1) | tsc, program reused: 1–4 ms for app code, 49 ms for 40 KB | ≤ tsc, and 1–2 ms for app code |

What the baseline changes: warmed up, tsc re-checks a small tab in 1–4 ms when it reuses its previous program, as an
editor does. For checking, smaltty's lead over tsc is in loading (8.9 MB and 162 ms before the first check) and in cold
checks, not in re-checking small code. A smaltty checker that isn't faster than that has only the dependency to
recommend it.

## Correctness

- **Differential tests:** smaltty's stripped output runs the same as sucrase's, and its declarations and references
  match the TypeScript compiler's, over a corpus of tabs, notebooks (smaltnb's examples) and generated programs.
- **Phase 1 and later:** every diagnostic smaltty reports is compared with tsc's on the same code. A smaltty error that
  tsc doesn't report is a bug. tsc errors that smaltty misses are counted, and that count is the measure of how far
  checking has come.

## Consumers

- smaltui: smaltkit's wrapper replaces `vendor/smaltdb-sucrase/`; the `@smaltworks/smaltdb-sucrase` pin can then go.
- smaltnb: the `ts` option to `parseNotebook`, `createRuntime` and `serveKernel` goes, with `loadTypeScript` and
  `TYPESCRIPT_URL`. That is a breaking change for smaltnb's API.
- smaltdb-sucrase: retired once both apps have moved.

## Open questions

- The package name on npm.
