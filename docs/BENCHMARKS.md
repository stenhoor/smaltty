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
- **smaltty parse:** the scanner and parser building the full tree (milestone 2). Stripping (milestone 3) adds a pass
  over that tree.
- **Full type check:** a reference for phase 1 only. Nothing smaltty builds before gate B is compared with it.
- **Loading:** from a fresh process to the first stripped line. smaltnb pays the compiler's load when its kernel starts.

## Milestone 2: the parser, 2026-11-08

Node v22.23.4, linux x64, Intel(R) Xeon(R) Processor (4 threads). sucrase 3.35.1, typescript 5.9.3.

### Stripping and name analysis

Median milliseconds to process the whole group once, on the files sucrase accepts (all but one edge case).

| Corpus | Files | Size (KB) | sucrase strip | `transpileModule` | TypeScript parse | smaltty parse | Parse + resolve names (smaltnb) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| App code (smaltui tabs, smaltnb notebooks) | 4 | 2.9 | 0.103 | 3.84 | 0.173 | **0.060** | 2.92 |
| Library code (smaltdf, smaltnb, smaltkit, smaltui) | 16 | 167 | 11.20 | 104 | 18.18 | **4.08** | 116 |
| Syntax edge cases | 10 | 8.7 | 0.752 | 17.81 | 1.27 | **0.290** | 9.24 |
| Generated script, 40 KB | 1 | 39 | 2.59 | 22.12 | 4.82 | **1.03** | 39.70 |
| Generated script, 400 KB | 1 | 391 | 56.41 | 212 | 51.25 | **10.78** | 520 |

### App code, per file

| File | Size (bytes) | sucrase strip | `transpileModule` | smaltty parse | Parse + resolve names |
| --- | ---: | ---: | ---: | ---: | ---: |
| `apps/smaltnb-regional.nb.ts` | 1147 | 0.049 | 1.31 | **0.031** | 1.28 |
| `apps/smaltnb-shop.nb.ts` | 945 | 0.033 | 0.959 | **0.017** | 0.727 |
| `apps/smaltui-demo-frames.ts` | 719 | 0.022 | 0.588 | **0.012** | 0.319 |
| `apps/smaltui-starter.ts` | 190 | 0.004 | 0.332 | **0.003** | 0.071 |


### Full type check (reference for phase 1)

`strict`, `lib.es2022`, `skipLibCheck`, one file. Cold reads, parses and binds the lib files every time; warm keeps them and reuses the previous program, as an editor does between edits.

| File | Cold | Warm |
| --- | ---: | ---: |
| `apps/smaltnb-regional.nb.ts` | 37.83 | 4.23 |
| `apps/smaltnb-shop.nb.ts` | 32.25 | 1.75 |
| `apps/smaltui-demo-frames.ts` | 32.70 | 1.50 |
| `apps/smaltui-starter.ts` | 31.90 | 1.01 |
| `generated/40k.ts` | 91.57 | 53.37 |

### Loading and size

Loading: a fresh process, from first use to the first stripped (or, for smaltty, parsed) line, median of runs. smaltnb evaluates `lib/typescript.js` with `new Function`, as here. smaltty: all of `dist/*.js`, unminified.

| Tool | Load (ms) | Size | Gzipped |
| --- | ---: | ---: | ---: |
| sucrase (as `@smaltworks/smaltdb-sucrase` bundles it) | 32.51 | ~200 KB | ~48 KB |
| TypeScript compiler (`lib/typescript.js`) | 157 | 8899 KB | 1606 KB |
| smaltty (`dist/*.js`) | 7.47 | 139 KB | 25 KB |

sucrase's bundled size is from smaltdb-sucrase's README (an esbuild bundle of sucrase and its dependencies); smaltty doesn't bundle sucrase to measure it.

### What milestone 2 says (gate A)

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
