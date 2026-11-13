/**
 * `smaltty/check`: the checker, with the binder and the built-in types it reads, for the worker that checks. It parses
 * the files it is given itself, so it loads the parser too, but not the stripper.
 */
export { bind, Bindings, Meaning, type BindSymbol } from './binder.js';
export { check, checkCache, expectations, type CheckCache, type CheckOptions, type Diagnostic, type Expectation } from './checker.js';
