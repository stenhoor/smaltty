# Benchmarks

What the tools smaltty replaces cost, doing the same work smaltty will do, on the corpus in `corpus/` (see
[corpus/README.md](../corpus/README.md)). Each smaltty milestone adds its own columns to these tables, measured the same
way on the same machine.

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
- **Full type check:** a reference for phase 1 only. Nothing smaltty builds before gate B is compared with it.
- **Loading:** from a fresh process to the first stripped line. smaltnb pays the compiler's load when its kernel starts.

## Baseline, 2026-11-08

Node v22.23.4, linux x64, Intel(R) Xeon(R) Processor (4 threads). sucrase 3.35.1, typescript 5.9.3.

### Stripping and name analysis

Median milliseconds to process the whole group once. Stripping covers the files sucrase accepts.

| Corpus | Files | Size (KB) | sucrase strip | `transpileModule` | Parse (`createSourceFile`) | Parse + resolve names (smaltnb) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| App code (smaltui tabs, smaltnb notebooks) | 4 | 2.9 | 0.108 | 4.01 | 0.176 | 2.86 |
| Library code (smaltdf, smaltnb, smaltkit, smaltui) | 16 | 167 | 11.23 | 110 | 17.23 | 113 |
| Syntax edge cases | 10 | 5.7 | 0.408 | 10.74 | 0.678 | 5.11 |
| Generated script, 40 KB | 1 | 39 | 2.36 | 20.23 | 4.38 | 37.91 |
| Generated script, 400 KB | 1 | 391 | 64.89 | 243 | 50.70 | 579 |

### App code, per file

| File | Size (bytes) | sucrase strip | `transpileModule` | Parse + resolve names |
| --- | ---: | ---: | ---: | ---: |
| `apps/smaltnb-regional.nb.ts` | 1147 | 0.050 | 1.29 | 1.53 |
| `apps/smaltnb-shop.nb.ts` | 945 | 0.028 | 0.934 | 0.694 |
| `apps/smaltui-demo-frames.ts` | 719 | 0.022 | 0.601 | 0.383 |
| `apps/smaltui-starter.ts` | 190 | 0.004 | 0.349 | 0.075 |

### Full type check (reference for phase 1)

`strict`, `lib.es2022`, `skipLibCheck`, one file. Cold reads, parses and binds the lib files every time; warm keeps them and reuses the previous program, as an editor does between edits.

| File | Cold | Warm |
| --- | ---: | ---: |
| `apps/smaltnb-regional.nb.ts` | 40.47 | 4.45 |
| `apps/smaltnb-shop.nb.ts` | 34.03 | 1.75 |
| `apps/smaltui-demo-frames.ts` | 32.65 | 1.47 |
| `apps/smaltui-starter.ts` | 32.07 | 1.05 |
| `generated/40k.ts` | 83.19 | 49.04 |

### Loading and size

Loading: a fresh process, from first use to the first stripped line (median of runs). smaltnb evaluates `lib/typescript.js` with `new Function`, as here.

| Tool | Load (ms) | Size | Gzipped |
| --- | ---: | ---: | ---: |
| sucrase (as `@smaltworks/smaltdb-sucrase` bundles it) | 33.30 | ~200 KB | ~48 KB |
| TypeScript compiler (`lib/typescript.js`) | 162 | 8899 KB | 1606 KB |

sucrase's bundled size is from smaltdb-sucrase's README (an esbuild bundle of sucrase and its dependencies); smaltty doesn't bundle sucrase to measure it.

## What the baseline says

- **sucrase is the bar for stripping, and it's high:** 28 µs for a 945-byte notebook, about 15 MB/s on library code: 10 to
  30 times faster than `transpileModule`. Matching it while building a full syntax tree is what gate A decides.
- **Name analysis is where smaltnb pays:** the compiler takes 0.7–1.5 ms per notebook and 113 ms for 167 KB, plus 162 ms
  to load before any of it.
- **A warm tsc re-checks small code in 1–4 ms.** The phase 1 targets in DESIGN.md were set before this was measured, and
  are now stated against it.
- **sucrase rejects code TypeScript accepts:** `a as number < 2`
  ([corpus/edge/erasable/sucrase-differs.ts](../corpus/edge/erasable/sucrase-differs.ts)). smaltty follows TypeScript.
