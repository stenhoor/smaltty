// One cold check in a fresh process, for bench/run.ts: `node bench/check-cold.ts <workload index> [<prepared file>]`
// prints the milliseconds of the first check() call (smaltty's modules already loaded, as an editor has them when the
// first file opens; loading itself is in the "Loading and size" table). With a prepared file (prepare()'s buffer for the
// workload's libraries, written by run.ts), the libraries are read from it in place of their text.
import { readFileSync } from 'node:fs';
import { check } from 'smaltty';
import { checkWorkloads } from './corpus.ts';

const w = checkWorkloads()[Number(process.argv[2])]!;
const preparedFile = process.argv[3];
const prepared = preparedFile ? new Uint8Array(readFileSync(preparedFile)) : undefined;
const files = prepared ? new Map([[w.root, w.files.get(w.root)!]]) : w.files;
const t = performance.now();
check(files, { roots: [w.root], packages: w.packages, ...(prepared ? { prepared } : {}) });
console.log(performance.now() - t);
