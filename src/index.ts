/**
 * smaltty: smalt's own implementation of TypeScript, with no dependencies. So far: the parser (its tree follows TypeScript's own, stored flat)
 * and the stripper (types replaced by spaces, so lines and columns stay put). See docs/MILESTONES.md.
 */
import { transpile, type Transpiler } from './strip.js';

export { parse, type ParseOptions } from './parser.js';
export { bind, Bindings, Meaning, type BindSymbol } from './binder.js';
export { check, checkCache, expectations, type CheckCache, type CheckOptions, type Diagnostic, type Expectation } from './checker.js';
export { strip, transpile, type StripOptions, type Transpiler, type TranspileOptions } from './strip.js';
export { Tree } from './tree.js';
export { K, F, KIND_NAMES, isTypeNode } from './kinds.js';
export { ParseError } from './scanner.js';

/** The package version, kept by hand until there is a build step that writes it. */
export const VERSION = '0.0.0';

/** The stripper as a Transpiler, for apps that offer more than one. */
const smaltty: Transpiler = { name: 'smaltty', version: VERSION, transpile };
export default smaltty;
