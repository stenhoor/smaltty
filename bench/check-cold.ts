// One cold check in a fresh process, for bench/run.ts: `node bench/check-cold.ts <workload index>` prints the
// milliseconds of the first check() call (smaltty's modules already loaded, as an editor has them when the first file
// opens; loading itself is in the "Loading and size" table).
import { check } from 'smaltty';
import { checkWorkloads } from './corpus.ts';

const w = checkWorkloads()[Number(process.argv[2])]!;
const t = performance.now();
check(w.files, { roots: [w.root], packages: w.packages });
console.log(performance.now() - t);
