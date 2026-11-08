// Imports and exports that are types only, partly or entirely.
import type { Shape } from './types.js';
import { type Base, Derived } from './classes.js';
import type * as Types from './types.js';
import Default, { type Named as Alias } from './virtual.js';
export type { Shape };
export { type Base, Derived };
export type * from './types.js';
export type * as AllTypes from './types.js';
export const used: Types.ShapeType | Alias = Default as Shape;
export default function <T>(x: T): T { return x; }
