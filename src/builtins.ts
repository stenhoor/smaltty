// The built-in types the checker knows: what users call on arrays, strings, numbers, maps, sets and promises, and on
// Math and JSON. Written for smaltty (the owner's decision, 2026-11-11: our own table, not TypeScript's lib), as
// declarations the checker reads like any library's.
//
// What the checker needs of them is exact where it reports errors, and loose elsewhere:
// - every member name a lib has (test/builtins.test.ts checks these against TypeScript's latest lib), so no member a
//   user's lib has is reported missing;
// - each method's argument count as TypeScript's, across its overloads; a method with overloads is declared
//   `(...args: any[])`, which the checker doesn't count;
// - parameter types at least as wide as TypeScript's, and return types where calls chain (`map` gives `U[]`).
// Symbol-keyed members (`[Symbol.iterator]`) can't be written with a dot, and aren't listed.

/** The path the declarations are read under. */
export const BUILTINS_PATH = '/__smaltty_builtins__.d.ts';

export const BUILTINS = `
interface Array<T> {
  length: number;
  toString(): string;
  toLocaleString(...args: any[]): string;
  pop(): T | undefined;
  push(...items: T[]): number;
  concat(...args: any[]): T[];
  join(separator?: string): string;
  reverse(): T[];
  shift(): T | undefined;
  slice(start?: number, end?: number): T[];
  sort(compareFn?: (a: T, b: T) => number): T[];
  splice(...args: any[]): T[];
  unshift(...items: T[]): number;
  indexOf(searchElement: T, fromIndex?: number): number;
  lastIndexOf(searchElement: T, fromIndex?: number): number;
  every(...args: any[]): boolean;
  some(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): boolean;
  forEach(callbackfn: (value: T, index: number, array: T[]) => void, thisArg?: any): void;
  map<U>(callbackfn: (value: T, index: number, array: T[]) => U, thisArg?: any): U[];
  filter(...args: any[]): T[];
  reduce(...args: any[]): any;
  reduceRight(...args: any[]): any;
  find(...args: any[]): T | undefined;
  findIndex(predicate: (value: T, index: number, obj: T[]) => unknown, thisArg?: any): number;
  fill(value: T, start?: number, end?: number): T[];
  copyWithin(target: number, start: number, end?: number): T[];
  entries(): any;
  keys(): any;
  values(): any;
  includes(searchElement: T, fromIndex?: number): boolean;
  flatMap(callback: (value: T, index: number, array: T[]) => any, thisArg?: any): any[];
  flat(depth?: number): any[];
  at(index: number): T | undefined;
  findLast(...args: any[]): T | undefined;
  findLastIndex(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): number;
  toReversed(): T[];
  toSorted(compareFn?: (a: T, b: T) => number): T[];
  toSpliced(...args: any[]): T[];
  with(index: number, value: T): T[];
}

interface String {
  length: number;
  toString(): string;
  charAt(pos: number): string;
  charCodeAt(index: number): number;
  concat(...strings: string[]): string;
  indexOf(searchString: string, position?: number): number;
  lastIndexOf(searchString: string, position?: number): number;
  localeCompare(...args: any[]): number;
  match(...args: any[]): any;
  replace(...args: any[]): string;
  search(...args: any[]): number;
  slice(start?: number, end?: number): string;
  split(...args: any[]): string[];
  substring(start: number, end?: number): string;
  toLowerCase(): string;
  toLocaleLowerCase(...args: any[]): string;
  toUpperCase(): string;
  toLocaleUpperCase(...args: any[]): string;
  trim(): string;
  substr(from: number, length?: number): string;
  valueOf(): string;
  codePointAt(pos: number): number | undefined;
  includes(searchString: string, position?: number): boolean;
  endsWith(searchString: string, endPosition?: number): boolean;
  normalize(...args: any[]): string;
  repeat(count: number): string;
  startsWith(searchString: string, position?: number): boolean;
  anchor(name: string): string;
  big(): string;
  blink(): string;
  bold(): string;
  fixed(): string;
  fontcolor(color: string): string;
  fontsize(...args: any[]): string;
  italics(): string;
  link(url: string): string;
  small(): string;
  strike(): string;
  sub(): string;
  sup(): string;
  padStart(maxLength: number, fillString?: string): string;
  padEnd(maxLength: number, fillString?: string): string;
  trimEnd(): string;
  trimStart(): string;
  trimLeft(): string;
  trimRight(): string;
  matchAll(regexp: any): any;
  replaceAll(...args: any[]): string;
  at(index: number): string | undefined;
  isWellFormed(): boolean;
  toWellFormed(): string;
}

interface Number {
  toString(radix?: number): string;
  toFixed(fractionDigits?: number): string;
  toExponential(fractionDigits?: number): string;
  toPrecision(precision?: number): string;
  valueOf(): number;
  toLocaleString(...args: any[]): string;
}

interface Boolean {
  valueOf(): boolean;
}

interface Map<K, V> {
  clear(): void;
  delete(key: K): boolean;
  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void;
  get(key: K): V | undefined;
  has(key: K): boolean;
  set(key: K, value: V): Map<K, V>;
  size: number;
  entries(): any;
  keys(): any;
  values(): any;
}

interface ReadonlyMap<K, V> {
  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: any): void;
  get(key: K): V | undefined;
  has(key: K): boolean;
  size: number;
  entries(): any;
  keys(): any;
  values(): any;
}

interface Set<T> {
  add(value: T): Set<T>;
  clear(): void;
  delete(value: T): boolean;
  forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void, thisArg?: any): void;
  has(value: T): boolean;
  size: number;
  entries(): any;
  keys(): any;
  values(): any;
  union(other: any): Set<any>;
  intersection(other: any): Set<any>;
  difference(other: any): Set<T>;
  symmetricDifference(other: any): Set<any>;
  isSubsetOf(other: any): boolean;
  isSupersetOf(other: any): boolean;
  isDisjointFrom(other: any): boolean;
}

interface ReadonlySet<T> {
  forEach(callbackfn: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: any): void;
  has(value: T): boolean;
  size: number;
  entries(): any;
  keys(): any;
  values(): any;
  union(other: any): Set<any>;
  intersection(other: any): Set<any>;
  difference(other: any): Set<T>;
  symmetricDifference(other: any): Set<any>;
  isSubsetOf(other: any): boolean;
  isSupersetOf(other: any): boolean;
  isDisjointFrom(other: any): boolean;
}

interface Promise<T> {
  then(...args: any[]): Promise<any>;
  catch(...args: any[]): Promise<any>;
  finally(onfinally?: any): Promise<T>;
}

interface Math {
  E: number;
  LN10: number;
  LN2: number;
  LOG2E: number;
  LOG10E: number;
  PI: number;
  SQRT1_2: number;
  SQRT2: number;
  abs(x: number): number;
  acos(x: number): number;
  asin(x: number): number;
  atan(x: number): number;
  atan2(y: number, x: number): number;
  ceil(x: number): number;
  cos(x: number): number;
  exp(x: number): number;
  floor(x: number): number;
  log(x: number): number;
  max(...values: number[]): number;
  min(...values: number[]): number;
  pow(x: number, y: number): number;
  random(): number;
  round(x: number): number;
  sin(x: number): number;
  sqrt(x: number): number;
  tan(x: number): number;
  clz32(x: number): number;
  imul(x: number, y: number): number;
  sign(x: number): number;
  log10(x: number): number;
  log2(x: number): number;
  log1p(x: number): number;
  expm1(x: number): number;
  cosh(x: number): number;
  sinh(x: number): number;
  tanh(x: number): number;
  acosh(x: number): number;
  asinh(x: number): number;
  atanh(x: number): number;
  hypot(...values: number[]): number;
  trunc(x: number): number;
  fround(x: number): number;
  cbrt(x: number): number;
  f16round(x: number): number;
}

interface JSON {
  parse(text: string, reviver?: (this: any, key: string, value: any) => any): any;
  stringify(...args: any[]): string;
}

declare const Math: Math;
declare const JSON: JSON;
`;
