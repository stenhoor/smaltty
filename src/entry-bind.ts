/**
 * `smaltty/bind`: the binder (which declaration each name means), without the checker, for code that reads a file's
 * names, as smaltnb's notebook format does. It parses nothing itself: give it a tree from `smaltty/strip`'s `parse`.
 */
export { bind, Bindings, Meaning, type BindSymbol } from './binder.js';
