# Benchmarks

smaltty against the tools it replaces, doing the same work, on the corpus in `corpus/` (see
[corpus/README.md](../corpus/README.md)). Each milestone adds its own columns to these tables, measured the same way on
the same machine; smaltty's columns are in bold.

```bash
npm run bench              # a few minutes; prints the tables below
```

```bash
npm run bench -- --quick   # one iteration each: checks the harness runs (CI does this), not a measurement
```

Times are medians after warm-up, in milliseconds. What is measured, and why:

- **sucrase strip:** `@smaltworks/smaltdb-sucrase`'s options, what smaltui runs today.
- **`transpileModule`:** smaltnb's options (`runtime.ts`), what smaltnb runs today.
- **Parse + resolve names:** smaltnb's `format.ts`: parse, a one-file program with no lib, and the declaration of every
  identifier. This is the work smaltty's binder replaces.
- **smaltty strip:** the stripper (milestone 3): parse, then types replaced by spaces.
- **smaltty parse:** the scanner and parser building the full tree (milestone 2).
- **smaltty parse + bind:** the parse, then the binder resolving every name (milestone 5): the same work as the
  compiler's "parse + resolve names" column.
- **Full type check:** a reference for phase 1 only. Nothing smaltty builds before gate B is compared with it.
- **Checking:** one user file and the library it calls, with smaltty's checker, with tsc 6.0 through its API, cold and
  after an edit, and with TypeScript 7's `tsc` and tsrs (a Rust port of TypeScript 7's checker, `tsrs` on npm) as
  processes: neither has an API that keeps a program between checks.
- **Loading:** from a fresh process to the first stripped line. smaltnb pays the compiler's load when its kernel starts.

## Latest run: milestone 12, 2026-11-13

Node v22.23.4, linux x64, Intel(R) Xeon(R) Processor @ 2.10GHz (4 threads). sucrase 3.35.1, typescript 6.0.3, TypeScript 7 7.0.2, tsrs 0.24.0-ts7.1.0-beta.

### Stripping and name analysis

Median milliseconds to process the whole group once, on the files every tool accepts: sucrase rejects one edge case, smaltty refuses the non-erasable files (three of smaltdf's, and the non-erasable edge cases).

| Corpus | Files | Size (KB) | sucrase strip | `transpileModule` | smaltty strip | TypeScript parse | smaltty parse | Parse + resolve names (smaltnb) | smaltty parse + bind |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| App code (smaltui tabs, smaltnb notebooks) | 4 | 2.9 | 0.141 | 4.59 | **0.091** | 0.255 | **0.080** | 3.83 | **0.105** |
| Library code (smaltdf, smaltnb, smaltkit, smaltui) | 13 | 125 | 12.24 | 97.27 | **5.01** | 16.53 | **3.94** | 113 | **6.44** |
| Syntax edge cases | 6 | 7.8 | 0.870 | 14.47 | **0.484** | 1.44 | **0.359** | 9.94 | **0.602** |
| Generated script, 40 KB | 1 | 39 | 3.37 | 26.43 | **1.84** | 6.74 | **1.38** | 46.43 | **2.53** |
| Generated script, 400 KB | 1 | 391 | 70.64 | 285 | **19.04** | 70.53 | **15.64** | 689 | **23.12** |

### App code, per file

| File | Size (bytes) | sucrase strip | `transpileModule` | smaltty strip | smaltty parse | Parse + resolve names | smaltty parse + bind |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `apps/smaltnb-regional.nb.ts` | 1147 | 0.058 | 1.49 | **0.046** | **0.038** | 1.37 | **0.051** |
| `apps/smaltnb-shop.nb.ts` | 945 | 0.035 | 1.16 | **0.027** | **0.022** | 0.857 | **0.029** |
| `apps/smaltui-demo-frames.ts` | 719 | 0.030 | 0.867 | **0.016** | **0.018** | 0.687 | **0.022** |
| `apps/smaltui-starter.ts` | 190 | 0.004 | 0.532 | **0.004** | **0.004** | 0.124 | **0.004** |

### Full type check (reference for phase 1)

`strict`, `lib.es2022`, `skipLibCheck`, one file. tsc 6.0.3 through its API: cold reads, parses and binds the lib files every time; warm keeps them and reuses the previous program, as an editor does between edits. TypeScript 7 (7.0.2, the Go compiler): its `tsc` command on the same file, a fresh process each time (it has no API that keeps a program), median of runs; in brackets its own total time (`--extendedDiagnostics`), without the process's start.

| File | tsc cold | tsc warm | TypeScript 7: process (own time) |
| --- | ---: | ---: | ---: |
| `apps/smaltnb-regional.nb.ts` | 45.51 | 4.65 | 39.93 (20.00) |
| `apps/smaltnb-shop.nb.ts` | 38.55 | 1.99 | 39.31 (19.00) |
| `apps/smaltui-demo-frames.ts` | 37.72 | 1.70 | 41.63 (19.00) |
| `apps/smaltui-starter.ts` | 37.87 | 1.21 | 39.13 (18.00) |
| `generated/40k.ts` | 103 | 77.83 | 56.46 (35.00) |

### Checking

One user file checked with the library it calls, read from source (smaltts's 16 files, 184 KB; smaltdf's 9, 85 KB): smaltty's `check()` against tsc (`strict`, `lib.es2022`) on the same files. **First check:** a fresh process, smaltty's modules loaded, the first `check()` (median of runs); **prepared:** the same, with the library read from `prepare()`'s buffer (milestone 11). **Cold:** in a warmed-up process, nothing kept from the previous check. **After an edit:** a one-line edit inside the user file's middle statement, the rest kept (smaltty: `checkCache()`, which keeps each statement's results (milestone 12); **whole file:** `checkCache({ statements: false })`, the parsed files kept and the user file checked whole, as before 0.13.0; tsc: files kept and its previous program reused, as an editor does). **tsrs:** tsrs (a Rust port of TypeScript 7's checker, `npm i tsrs`) on the same files, a fresh process each time, as it has no API that keeps a program between checks; in brackets its own total time (`--extendedDiagnostics`), without the process's start. **TypeScript 7:** its `tsc` command (the Go compiler) the same way, with `lib.es2022`. Milliseconds; the smaltts row is the median of its 14 examples, with the slowest in brackets.

| Workload | smaltty first check | smaltty first check, prepared | smaltty cold | tsc cold | TypeScript 7: process (own time) | tsrs: process (own time) | smaltty after an edit | smaltty after an edit, whole file | tsc after an edit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| smaltts's reference and guide examples (14) | 54.63 (78.37) | **23.79 (26.00)** | **5.97 (9.86)** | 110 (123) | 128 (141) (97.00) | 81.02 (92.29) (30.00) | **0.185 (0.667)** | 0.363 (0.732) | 18.83 (25.23) |
| smaltdf: `smaltnb-regional.nb.ts` | 30.77 | **17.01** | **1.52** | 43.67 | 75.80 (52.00) | 78.19 (26.00) | **0.064** | 0.136 | 5.96 |
| smaltdf: `smaltnb-shop.nb.ts` | 42.65 | **17.23** | **3.16** | 77.60 | 83.81 (58.00) | 75.89 (21.00) | **0.042** | 0.179 | 3.82 |
| smaltdf: `generated/40k.ts` | 111 | **81.31** | **26.41** | 139 | 97.94 (71.00) | 72.85 (23.00) | **2.52** | 22.02 | 73.61 |

### Loading and size

Loading: a fresh process, from first use to the first stripped line, median of runs. smaltnb evaluates `lib/typescript.js` with `new Function`, as here. smaltty: each entry point, the modules it loads (its module graph in `dist/`, comments removed, not minified); gzipped is each module on its own, as a server sends them; for `smaltty/bind` and `smaltty/check` the first use is a line parsed and bound, a one-line check.

| Tool | Load (ms) | Size | Gzipped |
| --- | ---: | ---: | ---: |
| sucrase (as `@smaltworks/smaltdb-sucrase` bundles it) | 42.40 | ~200 KB | ~48 KB |
| TypeScript compiler (`lib/typescript.js`) | 218 | 8930 KB | 1611 KB |
| `smaltty` (14 modules) | 18.39 | 341 KB | 62.4 KB |
| `smaltty/strip` (8 modules) | 14.21 | 141 KB | 24.7 KB |
| `smaltty/bind` (3 modules) | 12.24 | 29 KB | 5.9 KB |
| `smaltty/check` (12 modules) | 15.68 | 329 KB | 59.5 KB |

sucrase's bundled size is from smaltdb-sucrase's README (an esbuild bundle of sucrase and its dependencies); smaltty doesn't bundle sucrase to measure it.

### Checking: which errors each reports

`node test/tsrs.ts --misses`: the checker tests' mutants (a property misspelt, an argument more or fewer or of another
type, an option key or value changed), checked by TypeScript 7.0 (its `tsc` command, the reference the tests use since
milestone 9), by smaltty, by tsrs 0.24.0 (TypeScript 7.1 beta's checker, ported to Rust) and by TypeScript 6.0 (its
API, the reference's line before: 5.9's until milestone 9), with the same files and options. Errors of the codes
smaltty checks (2339, 2551, 2554, 2555, 2353, 2561, 2345, 2322), the same file, position and code as TypeScript 7's. A
mutant with a syntax error is left out: a command-line checker reports nothing else in a program with one. Same
message: the whole message, its chain included, is TypeScript 7's.

| Mutants | TypeScript 7.0.2 errors | smaltty: same as 7 | smaltty: other | smaltty: message differs | tsrs: same as 7 | tsrs: other | TypeScript 6.0.3: same as 7 | 6.0.3: other | same message: smaltty, tsrs, 6.0.3 | tsrs process (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| smaltts's examples, mutated (1076 of 1076) | 1050 | 670 | 0 | 170 | 1050 | 0 | 1050 | 0 | 500, 1003, 1036 | 201 |
| smaltdf's API in a generated script, mutated (560 of 565) | 370 | 325 | 0 | 60 | 370 | 0 | 370 | 0 | 265, 370, 370 | 278 |
| smaltui's tabs (smaltdf as globals), mutated (116 of 118) | 38 | 37 | 0 | 0 | 38 | 0 | 38 | 0 | 37, 38, 38 | 72 |

TypeScript 7's errors smaltty misses, of every code, on the same mutants (all three sets), not counting an error the
unmutated file has too (the same code and message): the order of milestone 14's work.

| Code | Missed | Checked by smaltty |
| ---: | ---: | --- |
| 7006 | 75 | no |
| 2551 | 47 | yes |
| 2559 | 45 | no |
| 2345 | 41 | yes |
| 2554 | 40 | yes |
| 2561 | 24 | yes |
| 2322 | 9 | yes |
| 7005 | 8 | no |
| 2339 | 7 | yes |
| 2820 | 4 | no |
| 2769 | 3 | no |
| 7034 | 3 | no |

7006 and 7005 are implicit `any`s where a mutant took away the argument that typed a callback; 2559 a value with no
property in common with the parameter's type; 2820 a string literal with a suggestion; 2769 no overload matching.

On TypeScript 5.9 (2026-11-11, the table this one replaces): the same errors at the same places in all three sets
(1,050, 370 and 38), and smaltty catching the same 670, 325 and 37. In the checker tests, 250 messages differ from
TypeScript 7's, as 250 did from 5.9's.

### Checking in a page

Milestone 10's run (0.11.0's build); milestone 11's first checks, from the worker's start, are in "What milestone 11
says".

`NODE_PATH=$(npm root -g) npm run bench:page` (it needs Playwright, which isn't a dependency): smaltty's checker and
tsrs's WebAssembly build (`@tsrs/wasm`, the same checker as native tsrs, single-threaded) in headless Chromium, each in a
fresh page, as an app would run them, on the workloads of the checking table above. **Load:** from the page's first
import to the checker ready to check (tsrs: its module fetched and compiled), from a local server, so without network
time. **Cold**, **first check:** the first check of each workload in the page (the smaltts row's slowest is the page's
first check of all). **After an edit:** the median of checks with the user file edited; smaltty keeps a `checkCache()`,
tsrs makes a fresh instance for each call (its API has no program kept between checks). **Entry points** (the first
table): each of smaltty's entry points in fresh pages, from the first import to its first use (a line stripped; for
`smaltty/check` a one-line check), median of 15 pages; downloads are its module graph, each module gzipped on its own.
`smaltty/bind` is left out: it parses nothing, and loads three modules, two of them `smaltty/strip`'s.

Chromium 153.0.8010.12, @tsrs/wasm 0.24.0-ts7.1.0-beta.

| Entry point | Modules | Downloads | Load and first use (ms) |
| --- | ---: | ---: | ---: |
| `smaltty` | 11 | 242 KB (44.3 KB gzipped) | 21.40 |
| `smaltty/strip` | 7 | 141 KB (24.5 KB gzipped) | 16.30 |
| `smaltty/check` | 9 | 230 KB (41.4 KB gzipped) | 22.50 |

| | Downloads | Load (ms) |
| --- | ---: | ---: |
| smaltty (`dist/*.js`) | 242 KB (44.5 KB gzipped) | 23.00 |
| tsrs (`@tsrs/wasm`: browser.js, core.js, tsrs.wasm) | 9764 KB (2851.8 KB gzipped) | 229 |

| Workload | smaltty cold | tsrs first check | smaltty after an edit | tsrs after an edit |
| --- | ---: | ---: | ---: | ---: |
| smaltts's examples (14) | **9.70 (64.90)** | 73.20 (313) | **0.800 (1.40)** | 70.30 (109) |
| smaltdf: `smaltnb-regional.nb.ts` | **9.80** | 38.30 | **0.400** | 37.50 |
| smaltdf: `smaltnb-shop.nb.ts` | **8.30** | 45.00 | **0.300** | 33.10 |
| smaltdf: `generated/40k.ts` | **33.00** | 41.80 | **17.20** | 42.10 |

Errors of the checked codes found (all workloads as written): smaltty 0, tsrs 3.

The 3 errors tsrs finds are tsc's too (tsc 5.9 reports the same three, in two of smaltts's examples as the corpus holds
them); smaltty reports none of them, as it may: it reports only what tsc does, not all of it.

### What milestone 12 says

- **A re-check after an edit checks what the edit touched.** `checkCache()` keeps each root's results statement by
  statement; a one-line edit inside the 40 KB generated script's middle statement is re-checked in **2.52 ms**, against
  22.02 ms for the same cache checking the file whole (`checkCache({ statements: false })`, as 0.12.0 did), tsc's
  73.61 ms with its program reused and tsrs's 23 ms of its own. The target was under 3 ms.
- **App code is quicker too:** 0.04–0.19 ms after an edit (smaltnb's notebooks 0.042 and 0.064 ms, smaltts's examples
  0.185 ms, the slowest 0.667), against 0.14–0.36 ms checked whole.
- **The same errors as a cold check, always.** `test/incremental.test.ts` edits every checker workload and mutant (an
  edit inside a statement, a declaration renamed where it is declared and everywhere, an imported name taken out, the
  module changed, a library edited and put back, the globals, packages and prepared declarations changed) and checks
  each result against a check with no cache: the same errors in the same order. Where a statement's dependencies
  can't be told (a `declare module` block in the root, a root that imports itself), the whole file is checked again.
- **No slowdown.** The binder now keeps the file's top-level names (`Bindings.top`, references to maps it already
  builds); binding the 40 KB script measured 0.63–0.67 ms against 0.65–0.86 ms on 0.12.0, alternated. `smaltty/check`
  grows from 56.0 to 59.5 KB gzipped.
- "Checking in a page" below is milestone 11's run, not repeated here.

### What milestone 11 says

`node bench/page.ts --first` (Chromium 153; Playwright through `NODE_PATH`): each workload in fresh pages of headless
Chromium, its checker in a worker as smaltkit runs it, with the libraries as text and prepared (`prepare()`). The page
fetches its setup first, so no network time is counted. **From the worker's start:** `new Worker` to the first
check's answer: loading `smaltty/check` in the worker, the setup and the check. **First check():** that check alone,
inside the worker. **Warmed while idle:** the worker started and warmed (a check of nothing, the prepared files read
with `readAll()`) while the page is idle, then the first check, asked to answered. **Cold:** later checks with nothing
kept but the prepared files; **after an edit:** a cache kept. Medians of 7 pages each. The corpus workloads read
smaltdf's `.d.ts` (made by TypeScript from `corpus/libs`); the smaltts example reads smaltts's source (16 files);
"its types.json" rows are the apps' own, as their builds write them (`--app=`).

| Workload | Setup | From the worker's start | First check() | Warmed while idle, then the first check | Cold | After an edit | Same errors |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| smaltui's tab: `smaltui-demo-frames.ts` | text | 62.70 | 25.60 | 23.30 | 3.90 | 1.00 | yes (0) |
| smaltui's tab: `smaltui-demo-frames.ts` | prepared | **54.00** | 17.00 | 9.00 | 2.00 | 1.30 | yes (0) |
| smaltnb's notebook: `smaltnb-shop.nb.ts` | text | 65.80 | 27.50 | 21.50 | 4.10 | 1.00 | yes (0) |
| smaltnb's notebook: `smaltnb-shop.nb.ts` | prepared | **56.30** | 14.80 | 10.20 | 1.40 | 1.30 | yes (0) |
| smaltts's example: `getting-started-14.ts` | text | 111 | 69.90 | 70.70 | 23.80 | 1.30 | yes (0) |
| smaltts's example: `getting-started-14.ts` | prepared | **67.00** | 22.90 | 12.60 | 2.10 | 1.60 | yes (0) |
| smaltui's tab, its types.json: `smaltui-demo-frames.ts` | text | 67.90 | 28.90 | 27.40 | 4.50 | 1.30 | yes (0) |
| smaltui's tab, its types.json: `smaltui-demo-frames.ts` | prepared | **63.00** | 18.80 | 14.10 | 2.30 | 1.80 | yes (0) |
| smaltnb's notebook, its types.json: `demo.nb.ts` | text | 77.30 | 35.80 | 38.20 | 8.00 | 1.80 | yes (0) |
| smaltnb's notebook, its types.json: `demo.nb.ts` | prepared | **63.90** | 20.80 | 13.60 | 3.00 | 1.90 | yes (0) |

| Workload | Text (types.json) | Prepared |
| --- | ---: | ---: |
| smaltui's tab: `smaltui-demo-frames.ts` | 25.2 KB (6.8 KB gzipped) | 120.5 KB (21.9 KB gzipped) |
| smaltnb's notebook: `smaltnb-shop.nb.ts` | 25.2 KB (6.8 KB gzipped) | 120.5 KB (21.9 KB gzipped) |
| smaltts's example: `getting-started-14.ts` | 182.9 KB (48.5 KB gzipped) | 1096.7 KB (189.2 KB gzipped) |
| smaltui's tab, its types.json: `smaltui-demo-frames.ts` | 30.8 KB (8.5 KB gzipped) | 107.4 KB (22.0 KB gzipped) |
| smaltnb's notebook, its types.json: `demo.nb.ts` | 74.2 KB (19.7 KB gzipped) | 251.9 KB (52.4 KB gzipped) |

- **The first check a user waits for is under 20 ms.** With the worker started and warmed while the page is idle (what
  ADR 0029 prescribes, and what smaltkit's `warm` option and both apps now do), the first check takes 9.0 ms for
  smaltui's tab and 10.2 ms for smaltnb's notebook on the corpus's smaltdf declarations, 14.1 and 13.6 ms on the apps'
  own `types.json`, and 12.6 ms for the smaltts example (from text: 21.5 to 70.7 ms). The first `check()` call alone,
  in a worker not warmed, is 14.8 to 22.9 ms (25.6 to 69.9 ms from text).
- **From the worker's start it is not.** Counted from `new Worker`, the first answer comes after 54 to 67 ms (63 to
  111 ms from text): most of it is loading `smaltty/check` in the worker (12 modules, 30.8 ms in a page for the module
  graph and a one-line check, from 22.5 ms in 0.11.0: the built-in types' buffer adds 10.5 KB gzipped) while the JIT
  is cold. A worker started only when the first check is wanted can't be under 20 ms this way; started while the page
  is idle, that time is spent before anyone waits.
- **Where the rest of the first check goes:** with nothing left to parse but the code, the checker's own code runs
  cold (the same check takes 1.4 to 3.0 ms once warmed: the cold column). In Node, a CPU profile of a prepared first
  check puts reading the buffers at about a tenth (decoding text, rebuilding four columns, the checksum, the built-in
  types' base64), parsing the user's code at about a fifth, and the rest in the checker. Preparing the built-in types
  pays: without them, the first `check()` was 18.8 and 22.5 ms (tab, notebook) and the warmed first check 22.0 and
  14.9 ms.
- **In the apps' own pages** (Chromium, medians of 7, measured with a wrapper on `Worker`): smaltui, a new tab on a
  page left idle, its first check answered 6.3 ms after it is asked (64.2 ms before, when the worker started at the
  first check); the demo's tab, checked as the page loads, 73.9 ms from the worker's start (84.1 ms before). smaltnb,
  the demo notebook checked as the page opens, with the worker started as the page starts: 21.2 ms from asking (61.3
  ms before), 48.8 ms from the worker's start (61.5 ms before).
- **Cold checks stay under 10 ms** (1.4 to 3.0 ms prepared, 3.9 to 23.8 ms from text) and **re-checks after an edit are
  unchanged** (1.0 to 1.9 ms, a cache kept, as before).
- **The same errors.** Every workload finds the same errors prepared as from text (here, on code as written, none),
  and `test/prepared.test.ts` holds every checker test's mutants to the same diagnostics.
- **The buffer is larger than the text: about 2.6 times gzipped** (smaltui's 22.0 KB against 8.5 KB, smaltnb's 52.4 KB
  against 19.7 KB): the tree has about one node per 4 characters, at 28 bytes a node. Writing start, end, first and
  next as differences took smaltui's from 36.4 KB to 23.9 KB gzipped, and leaving out symbol names that are their
  declaration's text to 22.5 KB. Smaller encodings (narrower columns) would trade decoding time for it.
- **No slowdown of the scanner, parser, stripper or binder.** `Tree` and `Bindings` gained an optional constructor
  argument; on the corpus (libraries and apps), the medians of six alternated runs against 0.11.0's build: parse 5.76
  against 5.66 ms, parse and bind 8.51 against 8.50, strip 5.15 against 5.08 (within run-to-run noise). The latest
  run above is slower than milestone 10's across every tool, sucrase and TypeScript included (the machine).

### What milestone 10 says

- **The stripping path is 24.5 KB gzipped, under the 30 KB target.** Each module gzipped on its own, as a server sends
  it:

  | Entry point | Modules | 0.10.0 | Split | Split, comments removed |
  | --- | ---: | ---: | ---: | ---: |
  | `smaltty` | 10, then 11 | 58.2 KB | 58.7 KB | **44.3 KB** |
  | `smaltty/strip` (scanner, parser, stripper) | 7 | (30.7 KB, not loadable alone) | 31.1 KB | **24.5 KB** |
  | `smaltty/bind` (binder) | 3 | | 8.8 KB | **5.9 KB** |
  | `smaltty/check` (checker, binder, parser) | 9 | | 54.2 KB | **41.4 KB** |

  The split alone left the stripping path at 31.1 KB: the scanner, parser and stripper are 30.7 KB with comments, the
  entry point 0.4 KB more. What pulled the weight in was the comments (about a fifth of every module): `dist/*.js` is
  now built without them (`removeComments`), the `.d.ts` files keep theirs (a second `tsc` pass that emits only
  declarations), and the source maps point at `src/`, which the package ships. Nothing else was worth taking out: the
  node kinds' name table (`KIND_NAMES`) is built from the kinds object at load, and the scanner's tables are what it
  runs on.
- **Removing comments costs nothing in speed.** The same modules with and without comments, each in its own process,
  alternated five times (medians, milliseconds): app code strip 0.120 and 0.121, parse 0.087 and 0.087; library code
  strip 4.83 and 4.78, parse 3.71 and 3.33; edge cases strip 0.519 and 0.428; generated scripts strip 18.9 and 18.1,
  parse 14.8 and 13.4. The full run above against the run before the change moves both ways by more than that, the
  tools smaltty is compared with too (`transpileModule` 74 ms then 86 ms on the library code): that is this machine.
- **Loading, by entry point:** in a fresh Node process `smaltty/strip` loads and strips its first line in 7.8 ms,
  against 11.1 ms for all of smaltty; in a fresh page of Chromium (local server, so no network time) in 16.3 ms,
  against 21.4 ms. `smaltty/check` loads and checks a line in 12.8 ms in Node and 22.5 ms in a page.
- **Minifying would save another fifth over the network, and little time on loading.** Measured ad hoc (esbuild 0.25.10
  and terser 5.44.0 run from a scratch folder with `npx`, each module minified on its own; neither is a dependency),
  in fresh pages of Chromium as above:

  | Build | `smaltty/strip` | `smaltty/check` | `smaltty` | strip: load and first use (ms) |
  | --- | ---: | ---: | ---: | ---: |
  | With comments (0.10.0's build) | 157 KB (31.1 KB gzipped) | 263 KB (54.2 KB) | 278 KB (58.7 KB) | 17.6 |
  | Comments removed (this build) | 141 KB (24.5 KB) | 230 KB (41.4 KB) | 242 KB (44.3 KB) | 17.3 |
  | esbuild `--minify` | 82 KB (20.2 KB) | 132 KB (34.0 KB) | 139 KB (36.4 KB) | 15.6 |
  | terser `-c -m` | 82 KB (20.0 KB) | 133 KB (33.5 KB) | 139 KB (35.9 KB) | 14.9 |

  Against this build, a minifier takes 4.3–4.5 KB off the stripping path gzipped (18%) and 1.7–2.4 ms off its load in
  a page, where nothing is fetched over a network; on a slow connection (200 KB/s) 4.5 KB is about 22 ms. The target
  is met without one, and a minifier is outside code (a dev dependency needs the owner's yes), so `dist/` is not
  minified: the numbers are here for that decision.

### What milestone 9 says

- **TypeScript 7 reports what 5.9 and 6.0 report, on what smaltty checks.** On the 1,752 mutants all of them check,
  TypeScript 7.0's errors of the checked codes are 6.0's and 5.9's, at the same places; so smaltty's share is
  unchanged (smaltts's mutants 78%, smaltdf's 88%, the tabs' 97%), with no false errors. The messages differ in 14 of
  smaltts's 1,050 between 6.0 and 7.0, and in 47 between 7.0 and tsrs (7.1 beta): not on errors where smaltty's message
  was right, so the 250 that differ in the checker tests are still 250, now counted against 7.
- **What smaltty misses, by code.** Of TypeScript 7's errors that the mutations bring, beyond what the unmutated files
  have, smaltty misses 306: 168 of the codes it checks (2551, 2345, 2554 and 2561 first, mostly knock-on errors further
  down a file), and 138 of codes it doesn't (implicit `any`s, 7006 and 7005, where a callback lost the argument that
  typed it; 2559, no property in common). Milestone 14 starts from this table.
- **TypeScript 7 doesn't check faster than tsc 6.0 on these files; it starts faster.** A one-file check takes 33–40 ms
  as a process (17–24 ms of its own), about tsc 6.0's cold check through its API; on the 40 KB script 49 ms against
  107 ms. With the libraries smaltts's examples read (184 KB of source), its own time is 96 ms, more than tsrs's 28 ms
  and close to its whole process time, against smaltty's 6.8 ms cold. It has no API to keep a program between checks,
  so every check is a cold one: the editor's case stays smaltty's (0.1–0.7 ms after an edit) and tsc 6.0's (4–25 ms).
- **No change to smaltty's speed.** Milestone 9 changes no scanner, parser, stripper or binder code; the tables above are
  this machine's run of the same code, with only the comparison tools changed.

### What adding tsrs says

- **tsrs reports what tsc reports.** On all 1,752 mutants it checks, its errors are tsc 5.9's (1,458, at the same
  places), with none of its own; their first lines are tsc's in 1,401, the rest differing in how TypeScript 7 prints a
  type (the order of a union's members, where a long type is cut). smaltty reports 1,032 of tsc's (71%), also with none
  of its own: tsrs is the whole checker, and smaltty checks calls into the libraries it reads.
- **Per check, smaltty is faster where the apps check.** tsrs runs as a process (it has no API that keeps a program
  between checks): 77–104 ms each time, of which its own work is 21–31 ms, most of it reading the lib files. smaltty's
  cold check in a warm page is 3.7–8.3 ms on app code, and a re-check after an edit 0.3–0.6 ms.
- **On a large file, tsrs's own time is the better one.** The 40 KB script: tsrs 25 ms of its own (83 ms with the
  process), smaltty 31 ms cold and 27 ms after an edit, tsc 224 ms and 71 ms.
- **In a page, where the apps check, smaltty is ahead at each step.** tsrs's WebAssembly build is 9.8 MB (2.9 MB
  gzipped) to smaltty's 277 KB (58 KB), loads in 62 ms against 27 ms before any network time, and checks app code in
  36–81 ms against smaltty's 7.7–10 ms cold; after an edit smaltty re-checks in under a millisecond, tsrs in the same
  time as its first check. On the 40 KB script tsrs is close: 48 ms a check, against smaltty's 39 ms cold and 18 ms
  after an edit.

### What milestone 7 says

- **Milestone 7's targets are met on the median, not on every example.** A cold check of a smaltts example, built-in
  types and smaltts's 184 KB of source included, takes 8.6 ms (median of 14; the slowest 11.4 ms), against a target of
  under 10 ms and tsc's 141 ms. smaltnb's notebooks with smaltdf take 2.4–3.7 ms, against tsc's 60–105 ms.
- **Re-checks after an edit take 0.2–0.5 ms for app code** (the slowest smaltts example 1.3 ms), against a target of
  1–2 ms and tsc's 3.6–22 ms with its program reused. `checkCache()` keeps parsed files between checks, so an edit
  parses only the file that changed. A 40 KB script is re-checked whole in 31 ms, against tsc's 69 ms.
- **The first check in a fresh process is slower: 43–97 ms**, while the JIT warms up, most of it parsing the
  libraries' source. The design reads smaltdf's and smaltts's declarations in the page; read as `.d.ts` instead of
  source, there would be less to parse. tsc pays 191 ms to load before its first check.

### What milestone 5 says

- **Parse and bind take 2–5% of the compiler's time** for the same answer: 0.084 ms against 2.66 ms for the app code,
  5.1 ms against 88 ms for the library code, 19 ms against 583 ms at 400 KB. That is before counting the compiler's
  load (191 ms here), which smaltnb pays when its kernel starts.
- **Binding adds 25–60% to the parse;** a notebook binds in 0.025–0.041 ms.
- **The answers are TypeScript's:** every name smaltty binds names the declaration TypeScript's checker names, on the
  corpus, TypeScript's and Node's declarations and TypeScript's compiler (all in CI), and the smalt repositories plus
  sucrase (by hand, `node test/binding.ts`): over 500,000 names, with no differences.
- **Size:** 35 KB gzipped for all of `dist/` with the binder.

### What milestone 3 said

- **Stripping is faster than sucrase on every group and every app file:** 0.074 ms against 0.102 ms for the app
  code, 3.9 ms against 8.0 ms for the library code, 15 ms against 60 ms at 400 KB. The stripping pass on top of the
  parse adds 20–37% to the parse.
- **Size:** 30 KB gzipped for all of `dist/`, with comments and no minifying, against sucrase's ~48 KB. Loading takes
  9 ms in a fresh process, against 31 ms for sucrase.
- **The output is TypeScript's own:** on the corpus and on the TypeScript in the smalt repositories (261 erasable files
  out of 301, by `node test/strip-sweep.ts`), the stripped program is the one TypeScript's transpile gives with
  `verbatimModuleSyntax`, with every line and column where it was. The other 40 files are the ones TypeScript's
  `erasableSyntaxOnly` rejects, and smaltty refuses all of them.
- **It runs:** smaltty's own test suite (`npm run test:self`, in CI) and smaltkit's run on code smaltty stripped, with
  the same results as under Node's type stripping.
- The library code group is smaller than in milestone 2 (13 files, 125 KB): the three smaltdf files with parameter
  properties are left out, since smaltty refuses them.

### What milestone 2 said (gate A)

From the milestone 2 run, which still counted the three non-erasable smaltdf files in the library code (167 KB).

- **Building the full tree is faster than sucrase's stripping**, on every group and every app file: 0.060 ms against
  0.103 ms for the app code, 4.1 ms against 11.2 ms for 167 KB of library code, 10.8 ms against 56 ms at 400 KB. It is
  about 4.5 times faster than TypeScript's own parser.
- **Small files:** the 190-byte starter tab parses in 3 µs (sucrase strips it in 4 µs). Most of that is allocating the
  tree, which takes one buffer for all its columns.
- **Notebooks are parsed once.** A file that starts with an import is known to be a module, where `await` at the top
  level is an operator. A module whose imports come later and that uses top-level `await` is parsed twice, as
  TypeScript also does.
- **Loading:** 7 ms in a fresh process, against 33 ms for sucrase and 157 ms for the compiler; 25 KB gzipped, with
  comments and no minifying.
- **Correctness:** the tree matches TypeScript's node for node (kind, start, end) on the corpus, TypeScript's and Node's
  declarations and TypeScript's 9 MB compiler (tested in CI), and on all the TypeScript in the smalt repositories plus
  sucrase's JavaScript (390 files, 636,000 nodes, checked by hand with `node test/sweep.ts`), with no differences.

## What the baseline said (milestone 1)

- **sucrase is the bar for stripping, and it's high:** 28 µs for a 945-byte notebook, about 15 MB/s on library code: 10 to
  30 times faster than `transpileModule`. Matching it while building a full syntax tree is what gate A decides.
- **Name analysis is where smaltnb pays:** the compiler takes 0.7–1.5 ms per notebook and 113 ms for 167 KB, plus 162 ms
  to load before any of it.
- **A warm tsc re-checks small code in 1–4 ms.** The phase 1 targets in DESIGN.md were set before this was measured, and
  are now stated against it.
- **sucrase rejects code TypeScript accepts:** `a as number < 2`
  ([corpus/edge/erasable/sucrase-differs.ts](../corpus/edge/erasable/sucrase-differs.ts)). smaltty follows TypeScript.
