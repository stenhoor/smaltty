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

## Latest run: milestone 10, 2026-11-13

Node v22.23.4, linux x64, Intel(R) Xeon(R) Processor @ 2.10GHz (4 threads). sucrase 3.35.1, typescript 6.0.3, TypeScript 7 7.0.2, tsrs 0.24.0-ts7.1.0-beta.

### Stripping and name analysis

Median milliseconds to process the whole group once, on the files every tool accepts: sucrase rejects one edge case, smaltty refuses the non-erasable files (three of smaltdf's, and the non-erasable edge cases).

| Corpus | Files | Size (KB) | sucrase strip | `transpileModule` | smaltty strip | TypeScript parse | smaltty parse | Parse + resolve names (smaltnb) | smaltty parse + bind |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| App code (smaltui tabs, smaltnb notebooks) | 4 | 2.9 | 0.125 | 4.41 | **0.084** | 0.233 | **0.066** | 3.26 | **0.085** |
| Library code (smaltdf, smaltnb, smaltkit, smaltui) | 13 | 125 | 8.33 | 86.25 | **4.60** | 14.40 | **3.85** | 88.54 | **5.37** |
| Syntax edge cases | 6 | 7.8 | 0.791 | 12.48 | **0.398** | 1.27 | **0.333** | 8.48 | **0.518** |
| Generated script, 40 KB | 1 | 39 | 2.38 | 24.94 | **1.70** | 4.87 | **1.16** | 36.66 | **2.00** |
| Generated script, 400 KB | 1 | 391 | 58.63 | 227 | **14.76** | 49.54 | **13.70** | 567 | **20.52** |

### App code, per file

| File | Size (bytes) | sucrase strip | `transpileModule` | smaltty strip | smaltty parse | Parse + resolve names | smaltty parse + bind |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `apps/smaltnb-regional.nb.ts` | 1147 | 0.057 | 1.37 | **0.037** | **0.032** | 1.53 | **0.045** |
| `apps/smaltnb-shop.nb.ts` | 945 | 0.031 | 0.959 | **0.022** | **0.020** | 0.782 | **0.027** |
| `apps/smaltui-demo-frames.ts` | 719 | 0.023 | 0.716 | **0.016** | **0.014** | 0.508 | **0.020** |
| `apps/smaltui-starter.ts` | 190 | 0.004 | 0.419 | **0.003** | **0.003** | 0.106 | **0.004** |

### Full type check (reference for phase 1)

`strict`, `lib.es2022`, `skipLibCheck`, one file. tsc 6.0.3 through its API: cold reads, parses and binds the lib files every time; warm keeps them and reuses the previous program, as an editor does between edits. TypeScript 7 (7.0.2, the Go compiler): its `tsc` command on the same file, a fresh process each time (it has no API that keeps a program), median of runs; in brackets its own total time (`--extendedDiagnostics`), without the process's start.

| File | tsc cold | tsc warm | TypeScript 7: process (own time) |
| --- | ---: | ---: | ---: |
| `apps/smaltnb-regional.nb.ts` | 39.80 | 5.04 | 34.01 (18.00) |
| `apps/smaltnb-shop.nb.ts` | 35.48 | 1.91 | 37.34 (18.00) |
| `apps/smaltui-demo-frames.ts` | 33.38 | 1.64 | 36.16 (18.00) |
| `apps/smaltui-starter.ts` | 35.05 | 1.16 | 34.47 (18.00) |
| `generated/40k.ts` | 105 | 60.39 | 49.72 (32.00) |

### Checking

One user file checked with the library it calls, read from source (smaltts's 16 files, 184 KB; smaltdf's 9, 85 KB): smaltty's `check()` against tsc (`strict`, `lib.es2022`) on the same files. **First check:** a fresh process, smaltty's modules loaded, the first `check()` (median of runs). **Cold:** in a warmed-up process, nothing kept from the previous check. **After an edit:** the user file changed, the rest kept (smaltty: `checkCache()`; tsc: files kept and its previous program reused, as an editor does). **tsrs:** tsrs (a Rust port of TypeScript 7's checker, `npm i tsrs`) on the same files, a fresh process each time, as it has no API that keeps a program between checks; in brackets its own total time (`--extendedDiagnostics`), without the process's start. **TypeScript 7:** its `tsc` command (the Go compiler) the same way, with `lib.es2022`. Milliseconds; the smaltts row is the median of its 14 examples, with the slowest in brackets.

| Workload | smaltty first check | smaltty cold | tsc cold | TypeScript 7: process (own time) | tsrs: process (own time) | smaltty after an edit | tsc after an edit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| smaltts's reference and guide examples (14) | 50.13 (65.82) | **5.86 (9.55)** | 99.04 (116) | 116 (123) (86.00) | 71.99 (77.99) (24.00) | **0.335 (0.802)** | 16.77 (23.45) |
| smaltdf: `smaltnb-regional.nb.ts` | 30.82 | **1.94** | 41.39 | 69.12 (45.00) | 63.21 (20.00) | **0.147** | 5.77 |
| smaltdf: `smaltnb-shop.nb.ts` | 39.73 | **3.30** | 62.01 | 73.88 (51.00) | 65.04 (15.00) | **0.192** | 3.77 |
| smaltdf: `generated/40k.ts` | 95.88 | **27.58** | 141 | 87.19 (63.00) | 64.27 (14.00) | **19.78** | 67.27 |

### Loading and size

Loading: a fresh process, from first use to the first stripped line, median of runs. smaltnb evaluates `lib/typescript.js` with `new Function`, as here. smaltty: each entry point, the modules it loads (its module graph in `dist/`, comments removed, not minified); gzipped is each module on its own, as a server sends them; for `smaltty/bind` and `smaltty/check` the first use is a line parsed and bound, a one-line check.

| Tool | Load (ms) | Size | Gzipped |
| --- | ---: | ---: | ---: |
| sucrase (as `@smaltworks/smaltdb-sucrase` bundles it) | 38.88 | ~200 KB | ~48 KB |
| TypeScript compiler (`lib/typescript.js`) | 180 | 8930 KB | 1611 KB |
| `smaltty` (11 modules) | 11.14 | 242 KB | 44.3 KB |
| `smaltty/strip` (7 modules) | 7.78 | 141 KB | 24.5 KB |
| `smaltty/bind` (3 modules) | 10.21 | 28 KB | 5.9 KB |
| `smaltty/check` (9 modules) | 12.83 | 230 KB | 41.4 KB |

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
