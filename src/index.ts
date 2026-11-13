/**
 * smaltty: smalt's own implementation of TypeScript, with no dependencies: the parser (its tree follows TypeScript's
 * own, stored flat), the stripper (types replaced by spaces, so lines and columns stay put), the binder and the checker.
 * See docs/MILESTONES.md.
 *
 * Everything is exported here. A page that loads only part of it imports an entry point of its own: `smaltty/strip`
 * (the scanner, parser and stripper), `smaltty/bind` (the binder) or `smaltty/check` (the binder and the checker).
 */
export { parse, type ParseOptions } from './parser.js';
export { bind, Bindings, Meaning, type BindSymbol } from './binder.js';
export { check, checkCache, expectations, type CheckCache, type CheckOptions, type Diagnostic, type Expectation, type StatementResults } from './checker.js';
export { prepare, readPrepared, PreparedFiles, PREPARED_FORMAT } from './prepared.js';
export { strip, transpile, type StripOptions, type Transpiler, type TranspileOptions } from './strip.js';
export { Tree } from './tree.js';
export { K, F, KIND_NAMES, isTypeNode } from './kinds.js';
export { ParseError } from './scanner.js';
export { VERSION, default } from './entry-strip.js';
