/**
 * smaltty: a TypeScript kit with no dependencies. So far: the scanner and the parser (milestone 2 in
 * docs/MILESTONES.md). The tree follows TypeScript's own (same node kinds and shapes), stored flat.
 */
export { parse, type ParseOptions } from './parser.js';
export { Tree } from './tree.js';
export { K, F, KIND_NAMES, isTypeNode } from './kinds.js';
export { ParseError } from './scanner.js';

/** The package version, kept by hand until there is a build step that writes it. */
export const VERSION = '0.0.0';
