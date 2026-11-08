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
- **Loading:** from a fresh process to the first stripped line. smaltnb pays the compiler's load when its kernel starts.

## Latest run: milestone 5, the binder, 2026-11-08

Node v22.23.4, linux x64, Intel(R) Xeon(R) Processor (4 threads). sucrase 3.35.1, typescript 5.9.3.

### Stripping and name analysis

Median milliseconds to process the whole group once, on the files every tool accepts: sucrase rejects one edge case, smaltty refuses the non-erasable files (three of smaltdf's, and the non-erasable edge cases).

| Corpus | Files | Size (KB) | sucrase strip | `transpileModule` | smaltty strip | TypeScript parse | smaltty parse | Parse + resolve names (smaltnb) | smaltty parse + bind |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| App code (smaltui tabs, smaltnb notebooks) | 4 | 2.9 | 0.101 | 3.63 | **0.073** | 0.173 | **0.061** | 2.66 | **0.084** |
| Library code (smaltdf, smaltnb, smaltkit, smaltui) | 13 | 125 | 8.11 | 77.23 | **3.95** | 12.84 | **3.13** | 88.12 | **5.08** |
| Syntax edge cases | 6 | 7.8 | 0.638 | 10.73 | **0.371** | 1.12 | **0.270** | 7.59 | **0.464** |
| Generated script, 40 KB | 1 | 39 | 2.52 | 21.86 | **1.42** | 4.55 | **1.08** | 34.44 | **1.66** |
| Generated script, 400 KB | 1 | 391 | 53.09 | 213 | **15.02** | 54.61 | **11.80** | 583 | **18.62** |

### App code, per file

| File | Size (bytes) | sucrase strip | `transpileModule` | smaltty strip | smaltty parse | Parse + resolve names | smaltty parse + bind |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `apps/smaltnb-regional.nb.ts` | 1147 | 0.048 | 1.25 | **0.038** | **0.032** | 1.19 | **0.041** |
| `apps/smaltnb-shop.nb.ts` | 945 | 0.027 | 0.950 | **0.021** | **0.018** | 0.701 | **0.025** |
| `apps/smaltui-demo-frames.ts` | 719 | 0.022 | 0.653 | **0.014** | **0.012** | 0.342 | **0.017** |
| `apps/smaltui-starter.ts` | 190 | 0.004 | 0.306 | **0.003** | **0.003** | 0.074 | **0.003** |

### Full type check (reference for phase 1)

`strict`, `lib.es2022`, `skipLibCheck`, one file. Cold reads, parses and binds the lib files every time; warm keeps them and reuses the previous program, as an editor does between edits.

| File | Cold | Warm |
| --- | ---: | ---: |
| `apps/smaltnb-regional.nb.ts` | 41.70 | 4.29 |
| `apps/smaltnb-shop.nb.ts` | 34.99 | 1.77 |
| `apps/smaltui-demo-frames.ts` | 33.45 | 1.51 |
| `apps/smaltui-starter.ts` | 33.28 | 1.12 |
| `generated/40k.ts` | 91.26 | 55.88 |

### Loading and size

Loading: a fresh process, from first use to the first stripped line, median of runs. smaltnb evaluates `lib/typescript.js` with `new Function`, as here. smaltty: all of `dist/*.js`, unminified.

| Tool | Load (ms) | Size | Gzipped |
| --- | ---: | ---: | ---: |
| sucrase (as `@smaltworks/smaltdb-sucrase` bundles it) | 42.88 | ~200 KB | ~48 KB |
| TypeScript compiler (`lib/typescript.js`) | 191 | 8899 KB | 1606 KB |
| smaltty (`dist/*.js`) | 13.60 | 186 KB | 35 KB |

sucrase's bundled size is from smaltdb-sucrase's README (an esbuild bundle of sucrase and its dependencies); smaltty doesn't bundle sucrase to measure it.

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
