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
- **Checking:** one user file and the library it calls, with smaltty's checker, with tsc, cold and after an edit, and
  with tsrs (a Rust port of TypeScript 7's checker, `tsrs` on npm) as a process.
- **Loading:** from a fresh process to the first stripped line. smaltnb pays the compiler's load when its kernel starts.

## Latest run: tsrs added, 2026-11-11

Node v22.23.4, linux x64, Intel(R) Xeon(R) Processor @ 2.10GHz (4 threads). sucrase 3.35.1, typescript 5.9.3.

### Stripping and name analysis

Median milliseconds to process the whole group once, on the files every tool accepts: sucrase rejects one edge case, smaltty refuses the non-erasable files (three of smaltdf's, and the non-erasable edge cases).

| Corpus | Files | Size (KB) | sucrase strip | `transpileModule` | smaltty strip | TypeScript parse | smaltty parse | Parse + resolve names (smaltnb) | smaltty parse + bind |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| App code (smaltui tabs, smaltnb notebooks) | 4 | 2.9 | 0.156 | 5.53 | **0.105** | 0.318 | **0.150** | 3.32 | **0.126** |
| Library code (smaltdf, smaltnb, smaltkit, smaltui) | 13 | 125 | 16.52 | 140 | **9.26** | 19.84 | **5.11** | 137 | **8.51** |
| Syntax edge cases | 6 | 7.8 | 0.937 | 13.43 | **0.603** | 2.28 | **0.463** | 9.21 | **1.30** |
| Generated script, 40 KB | 1 | 39 | 4.69 | 42.29 | **3.76** | 10.38 | **1.70** | 57.45 | **2.50** |
| Generated script, 400 KB | 1 | 391 | 75.99 | 332 | **28.44** | 80.98 | **27.36** | 938 | **41.76** |

### App code, per file

| File | Size (bytes) | sucrase strip | `transpileModule` | smaltty strip | smaltty parse | Parse + resolve names | smaltty parse + bind |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `apps/smaltnb-regional.nb.ts` | 1147 | 0.071 | 1.95 | **0.083** | **0.074** | 1.26 | **0.108** |
| `apps/smaltnb-shop.nb.ts` | 945 | 0.063 | 0.980 | **0.048** | **0.043** | 1.05 | **0.057** |
| `apps/smaltui-demo-frames.ts` | 719 | 0.030 | 0.986 | **0.020** | **0.018** | 0.458 | **0.025** |
| `apps/smaltui-starter.ts` | 190 | 0.007 | 0.385 | **0.004** | **0.005** | 0.156 | **0.008** |

### Full type check (reference for phase 1)

`strict`, `lib.es2022`, `skipLibCheck`, one file. Cold reads, parses and binds the lib files every time; warm keeps them and reuses the previous program, as an editor does between edits.

| File | Cold | Warm |
| --- | ---: | ---: |
| `apps/smaltnb-regional.nb.ts` | 68.39 | 5.73 |
| `apps/smaltnb-shop.nb.ts` | 52.84 | 2.43 |
| `apps/smaltui-demo-frames.ts` | 63.10 | 2.21 |
| `apps/smaltui-starter.ts` | 55.93 | 1.61 |
| `generated/40k.ts` | 149 | 76.81 |

### Checking

One user file checked with the library it calls, read from source (smaltts's 16 files, 184 KB; smaltdf's 9, 85 KB): smaltty's `check()` against tsc (`strict`, `lib.es2022`) on the same files. **First check:** a fresh process, smaltty's modules loaded, the first `check()` (median of runs). **Cold:** in a warmed-up process, nothing kept from the previous check. **After an edit:** the user file changed, the rest kept (smaltty: `checkCache()`; tsc: files kept and its previous program reused, as an editor does). **tsrs:** tsrs (a Rust port of TypeScript 7's checker, `npm i tsrs`) on the same files, a fresh process each time, as it has no API that keeps a program between checks; in brackets its own total time (`--extendedDiagnostics`), without the process's start. Milliseconds; the smaltts row is the median of its 14 examples, with the slowest in brackets.

| Workload | smaltty first check | smaltty cold | tsc cold | tsrs: process (own time) | smaltty after an edit | tsc after an edit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| smaltts's reference and guide examples (14) | 76.45 (103) | **8.25 (13.19)** | 148 (177) | 93.16 (104) (31.00) | **0.595 (1.08)** | 21.28 (30.56) |
| smaltdf: `smaltnb-regional.nb.ts` | 40.62 | **3.69** | 76.91 | 76.80 (21.00) | **0.328** | 6.69 |
| smaltdf: `smaltnb-shop.nb.ts` | 54.39 | **4.25** | 96.35 | 77.75 (22.00) | **0.336** | 3.94 |
| smaltdf: `generated/40k.ts` | 157 | **31.34** | 224 | 83.20 (25.00) | **27.38** | 70.59 |

### Loading and size

Loading: a fresh process, from first use to the first stripped line, median of runs. smaltnb evaluates `lib/typescript.js` with `new Function`, as here. smaltty: all of `dist/*.js`, unminified.

| Tool | Load (ms) | Size | Gzipped |
| --- | ---: | ---: | ---: |
| sucrase (as `@smaltworks/smaltdb-sucrase` bundles it) | 48.90 | ~200 KB | ~48 KB |
| TypeScript compiler (`lib/typescript.js`) | 259 | 8899 KB | 1606 KB |
| smaltty (`dist/*.js`) | 16.68 | 274 KB | 55 KB |

sucrase's bundled size is from smaltdb-sucrase's README (an esbuild bundle of sucrase and its dependencies); smaltty doesn't bundle sucrase to measure it.

### Checking: which errors each reports

`node test/tsrs.ts`: the checker tests' mutants (a property misspelt, an argument more or fewer or of another type, an
option key or value changed), checked by tsc 5.9 (the reference the tests use), by tsrs 0.24.0 (TypeScript 7.1 beta's
checker, ported to Rust) and by smaltty, with the same files and options. Errors of the codes smaltty checks (2339, 2551,
2554, 2555, 2353, 2561, 2345, 2322), the same file, position and code as tsc's. A mutant with a syntax error is left
out: tsrs, like tsc's command line, checks nothing else in a program with one. Same message: the first line of the
message is tsc's.

| Mutants | tsc 5.9 errors | tsrs: same as tsc | tsrs: other | smaltty: same as tsc | smaltty: other | same message: tsrs, smaltty | tsrs process (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| smaltts's examples, mutated (1076 of 1076) | 1050 | 1050 | 0 | 670 | 0 | 993, 389 | 199 |
| smaltdf's API in a generated script, mutated (560 of 565) | 370 | 370 | 0 | 325 | 0 | 370, 265 | 252 |
| smaltui's tabs (smaltdf as globals), mutated (116 of 118) | 38 | 38 | 0 | 37 | 0 | 38, 37 | 90 |

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
- **What wasn't measured:** tsrs in a page. Its browser build, `@tsrs/wasm`, is 10 MB unpacked, against smaltty's 274
  KB (55 KB gzipped, the checker and built-in types included); its load time and checks in a page are the like-for-like comparison with smaltty in the apps.

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
