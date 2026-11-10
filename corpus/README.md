# Corpus

The input smaltty's tests and benchmarks run over. Every file parses with TypeScript; `test/corpus.test.ts` checks that,
and that each file's erasable or not-erasable label matches TypeScript's `erasableSyntaxOnly`.

| Folder | What | Source |
| --- | --- | --- |
| `apps/` | Code users write: smaltui's TypeScript tab (the demo's tab and the starter) and smaltnb's example notebooks | smaltui `envs/demo/env.json` and `app/main.ts`; smaltnb `examples/` |
| `libs/` | Larger real code: smaltdf's source, smaltnb's parser and runtime, smaltkit's modules, smaltui's tokenizer | copied from those repositories (MIT), 2026-11-08 |
| `edge/erasable/` | Type syntax the stripper must remove, and JavaScript grammar corners (`grammar.ts`), written to cover the grammar | written for smaltty |
| `edge/non-erasable/` | `enum`, `namespace`, parameter properties, `import =`: smaltty reports these as errors | written for smaltty |
| `check/smaltts/` | The checker's input (not part of the files above): smaltts's source in `src/`, and its reference's and guide's examples in `examples/`, importing `../src/index.js` | copied from smaltts `6aca829` (MIT), 2026-11-10 |

Generated scripts (40 KB and 400 KB, smaltdf-style) are made by `bench/corpus.ts`, not stored.

Library files are copies, not kept in step with their repositories: refresh them when the code users write changes in a
way the corpus doesn't cover. `smaltdf-errors.ts`, `smaltdf-expr.ts` and `smaltdf-frame.ts` use parameter properties, so
they are not erasable.
