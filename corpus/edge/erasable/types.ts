// Type syntax that the stripper must remove entirely.
type Id = string | number;
type Pair<A, B = A> = readonly [first: A, second?: B];
type Rest = [string, ...number[]];
type Fn = <T extends object>(value: T, ...rest: unknown[]) => asserts value is T & {};
type Ctor = abstract new (...args: any[]) => object;
type Keys<T> = { readonly [K in keyof T as `get${Capitalize<string & K>}`]-?: () => T[K] };
type Unwrap<T> = T extends Promise<infer U extends object> ? Unwrap<U> : T;
type Lookup = Record<string, { a: 1; 'b-c': 2n; [k: number]: boolean }>['x']['a'];
type Q = typeof import('./types.js');
type Tpl = `a${string}b${number}`;
type U = unique symbol;
type Pred = (x: unknown) => x is string;
type Neg = -1 | 0x10 | 1e3;
type Fnc = (this: Window, cb: (err: Error | null) => void) => void;
interface Shape<T = unknown> extends Base, Other<T> {
  readonly kind: 'shape';
  size?: number;
  (call: string): void;
  new (ctor: number): Shape;
  method?<U>(u: U): T;
  [index: string]: unknown;
  get area(): number;
  set area(v: number);
}
interface Base {}
interface Other<T> { other: T }
declare const declared: number;
declare function declaredFn(a: string): void;
declare let maybe: string | undefined;
declare global { interface Window { smalt?: true } }
declare module 'virtual' { export const v: number; }
export type { Shape as ShapeType };
export {};
