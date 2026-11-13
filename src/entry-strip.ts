/**
 * `smaltty/strip`: the scanner, the parser and the stripper, and nothing of the binder or the checker, for a page that
 * only turns TypeScript into JavaScript. Its modules are the stripping path that docs/BENCHMARKS.md measures.
 */
import { transpile, type Transpiler } from './strip.js';
import { VERSION } from './version.js';

export { parse, type ParseOptions } from './parser.js';
export { strip, transpile, type StripOptions, type Transpiler, type TranspileOptions } from './strip.js';
export { Tree } from './tree.js';
export { K, F, KIND_NAMES, isTypeNode } from './kinds.js';
export { ParseError } from './scanner.js';

export { VERSION } from './version.js';

/** The stripper as a Transpiler, for apps that offer more than one. */
const smaltty: Transpiler = { name: 'smaltty', version: VERSION, transpile };
export default smaltty;
