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
- **Full type check:** a reference for phase 1 only. Nothing smaltty builds before gate B is compared with it.
- **Loading:** from a fresh process to the first stripped line. smaltnb pays the compiler's load when its kernel starts.

## Latest run: milestone 3, the stripper, 2026-11-08

Node v22.23.4, linux x64, Intel(R) Xeon(R) Processor (4 threads). sucrase 3.35.1, typescript 5.9.3.

### Stripping and name analysis

Median milliseconds to process the whole group once, on the files every tool accepts: sucrase rejects one edge case, smaltty refuses the non-erasable files (three of smaltdf's, and the non-erasable edge cases).

| Corpus | Files | Size (KB) | sucrase strip | `transpileModule` | smaltty strip | TypeScript parse | smaltty parse | Parse + resolve names (smaltnb) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| App code (smaltui tabs, smaltnb notebooks) | 4 | 2.9 | 0.102 | 3.80 | **0.074** | 0.174 | **0.062** | 2.92 |
| Library code (smaltdf, smaltnb, smaltkit, smaltui) | 13 | 125 | 8.02 | 73.42 | **3.93** | 12.47 | **3.03** | 76.67 |
| Syntax edge cases | 6 | 7.8 | 0.636 | 12.25 | **0.365** | 1.14 | **0.267** | 6.76 |
| Generated script, 40 KB | 1 | 39 | 2.23 | 20.69 | **1.42** | 4.39 | **1.07** | 34.55 |
| Generated script, 400 KB | 1 | 391 | 59.93 | 195 | **15.00** | 55.55 | **12.35** | 616 |

### App code, per file

| File | Size (bytes) | sucrase strip | `transpileModule` | smaltty strip | smaltty parse | Parse + resolve names |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `apps/smaltnb-regional.nb.ts` | 1147 | 0.046 | 1.34 | **0.038** | **0.031** | 1.32 |
| `apps/smaltnb-shop.nb.ts` | 945 | 0.027 | 0.944 | **0.021** | **0.018** | 0.667 |
| `apps/smaltui-demo-frames.ts` | 719 | 0.021 | 0.639 | **0.014** | **0.012** | 0.332 |
| `apps/smaltui-starter.ts` | 190 | 0.004 | 0.338 | **0.003** | **0.003** | 0.077 |

### Full type check (reference for phase 1)

`strict`, `lib.es2022`, `skipLibCheck`, one file. Cold reads, parses and binds the lib files every time; warm keeps them and reuses the previous program, as an editor does between edits.

| File | Cold | Warm |
| --- | ---: | ---: |
| `apps/smaltnb-regional.nb.ts` | 41.36 | 4.39 |
| `apps/smaltnb-shop.nb.ts` | 35.19 | 1.85 |
| `apps/smaltui-demo-frames.ts` | 34.59 | 1.61 |
| `apps/smaltui-starter.ts` | 33.21 | 1.10 |
| `generated/40k.ts` | 92.72 | 56.70 |

### Loading and size

Loading: a fresh process, from first use to the first stripped line, median of runs. smaltnb evaluates `lib/typescript.js` with `new Function`, as here. smaltty: all of `dist/*.js`, unminified.

| Tool | Load (ms) | Size | Gzipped |
| --- | ---: | ---: | ---: |
| sucrase (as `@smaltworks/smaltdb-sucrase` bundles it) | 31.41 | ~200 KB | ~48 KB |
| TypeScript compiler (`lib/typescript.js`) | 268 | 8899 KB | 1606 KB |
| smaltty (`dist/*.js`) | 8.97 | 156 KB | 30 KB |

sucrase's bundled size is from smaltdb-sucrase's README (an esbuild bundle of sucrase and its dependencies); smaltty doesn't bundle sucrase to measure it.

### What milestone 3 says

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
