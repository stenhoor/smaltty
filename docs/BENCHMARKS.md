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
- **Checking:** one user file and the library it calls, with smaltty's checker and with tsc, cold and after an edit.
- **Loading:** from a fresh process to the first stripped line. smaltnb pays the compiler's load when its kernel starts.

## Latest run: milestone 7, the checker, 2026-11-11

Node v22.23.4, linux x64, Intel(R) Xeon(R) Processor @ 2.10GHz (4 threads). sucrase 3.35.1, typescript 5.9.3.

### Stripping and name analysis

Median milliseconds to process the whole group once, on the files every tool accepts: sucrase rejects one edge case, smaltty refuses the non-erasable files (three of smaltdf's, and the non-erasable edge cases).

| Corpus | Files | Size (KB) | sucrase strip | `transpileModule` | smaltty strip | TypeScript parse | smaltty parse | Parse + resolve names (smaltnb) | smaltty parse + bind |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| App code (smaltui tabs, smaltnb notebooks) | 4 | 2.9 | 0.158 | 5.03 | **0.113** | 0.367 | **0.095** | 3.56 | **0.141** |
| Library code (smaltdf, smaltnb, smaltkit, smaltui) | 13 | 125 | 11.13 | 98.08 | **5.99** | 17.19 | **4.96** | 104 | **7.27** |
| Syntax edge cases | 6 | 7.8 | 0.946 | 11.01 | **0.584** | 1.51 | **0.433** | 10.40 | **0.666** |
| Generated script, 40 KB | 1 | 39 | 3.13 | 26.00 | **2.08** | 6.25 | **1.74** | 46.38 | **2.44** |
| Generated script, 400 KB | 1 | 391 | 62.37 | 276 | **21.52** | 75.24 | **17.74** | 645 | **25.96** |

### App code, per file

| File | Size (bytes) | sucrase strip | `transpileModule` | smaltty strip | smaltty parse | Parse + resolve names | smaltty parse + bind |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `apps/smaltnb-regional.nb.ts` | 1147 | 0.070 | 1.42 | **0.061** | **0.046** | 1.30 | **0.061** |
| `apps/smaltnb-shop.nb.ts` | 945 | 0.040 | 1.04 | **0.031** | **0.026** | 0.754 | **0.044** |
| `apps/smaltui-demo-frames.ts` | 719 | 0.032 | 0.738 | **0.020** | **0.018** | 0.500 | **0.025** |
| `apps/smaltui-starter.ts` | 190 | 0.006 | 0.366 | **0.004** | **0.004** | 0.162 | **0.005** |

### Full type check (reference for phase 1)

`strict`, `lib.es2022`, `skipLibCheck`, one file. Cold reads, parses and binds the lib files every time; warm keeps them and reuses the previous program, as an editor does between edits.

| File | Cold | Warm |
| --- | ---: | ---: |
| `apps/smaltnb-regional.nb.ts` | 48.92 | 4.62 |
| `apps/smaltnb-shop.nb.ts` | 45.06 | 1.98 |
| `apps/smaltui-demo-frames.ts` | 44.31 | 1.62 |
| `apps/smaltui-starter.ts` | 44.36 | 1.07 |
| `generated/40k.ts` | 112 | 60.29 |

### Checking

One user file checked with the library it calls, read from source (smaltts's 16 files, 184 KB; smaltdf's 9, 85 KB): smaltty's `check()` against tsc (`strict`, `lib.es2022`) on the same files. **First check:** a fresh process, smaltty's modules loaded, the first `check()` (median of runs). **Cold:** in a warmed-up process, nothing kept from the previous check. **After an edit:** the user file changed, the rest kept (smaltty: `checkCache()`; tsc: files kept and its previous program reused, as an editor does). Milliseconds; the smaltts row is the median of its 14 examples, with the slowest in brackets.

| Workload | smaltty first check | smaltty cold | tsc cold | smaltty after an edit | tsc after an edit |
| --- | ---: | ---: | ---: | ---: | ---: |
| smaltts's reference and guide examples (14) | 68.94 (97.03) | **8.55 (11.36)** | 141 (200) | **0.459 (1.32)** | 22.22 (31.18) |
| smaltdf: `smaltnb-regional.nb.ts` | 42.75 | **2.38** | 60.47 | **0.183** | 7.93 |
| smaltdf: `smaltnb-shop.nb.ts` | 49.73 | **3.69** | 105 | **0.285** | 3.61 |
| smaltdf: `generated/40k.ts` | 137 | **29.20** | 177 | **30.67** | 68.83 |

### Loading and size

Loading: a fresh process, from first use to the first stripped line, median of runs. smaltnb evaluates `lib/typescript.js` with `new Function`, as here. smaltty: all of `dist/*.js`, unminified.

| Tool | Load (ms) | Size | Gzipped |
| --- | ---: | ---: | ---: |
| sucrase (as `@smaltworks/smaltdb-sucrase` bundles it) | 48.57 | ~200 KB | ~48 KB |
| TypeScript compiler (`lib/typescript.js`) | 217 | 8899 KB | 1606 KB |
| smaltty (`dist/*.js`) | 16.22 | 274 KB | 55 KB |

sucrase's bundled size is from smaltdb-sucrase's README (an esbuild bundle of sucrase and its dependencies); smaltty doesn't bundle sucrase to measure it.

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
