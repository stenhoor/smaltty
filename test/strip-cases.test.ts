// The stripper's hard cases, run: each is stripped by smaltty and by TypeScript, both are executed, and the results must
// be the expected value. These are the places where removing text could change what the code means.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strip } from 'smaltty';
import { typescriptStrip } from './js.ts';

const run = (js: string): unknown => new Function(js)();

const cases: [string, string, unknown][] = [
  ['an erased declaration before a line starting with [', 'let a = 1\ntype T = 1\n[a] = [2]\nreturn a', 2],
  ['an erased interface before a line starting with (', 'let a = 1\ninterface I { x: 1 }\n(() => { a = 3 })()\nreturn a', 3],
  ['as T at the end of a statement, then (', 'const f = () => 5\nconst y = f as any\n(1)\nreturn typeof y', 'function'],
  ['satisfies T at the end of a statement, then [', 'const xs = [1] satisfies number[]\n[2].length\nreturn xs.length', 1],
  // In TypeScript too, `(` on the next line continues `o.v!` as a call.
  ['a non-null ! then ( on the next line: a call, as in TypeScript', 'const o = { v: (n: number) => n + 1 }\nconst v = o.v!\n(1)\nreturn v', 2],
  ['an annotation at the end of a declaration, then [', 'let n: number\n[n] = [4]\nreturn n', 4],
  ['an arrow return type over two lines', 'const g = (a: number):\n  number => a * 2\nreturn g(2)', 4],
  ['a this parameter', 'function h(this: { v: number }, k: number) { return this.v + k }\nreturn h.call({ v: 1 }, 2)', 3],
  ['a lone this parameter', 'function h(this: { v: number }) { return this.v }\nreturn h.call({ v: 5 })', 5],
  ['overloads', "function o(a: string): string;\nfunction o(a: number): number;\nfunction o(a: any) { return a }\nreturn o('k')", 'k'],
  ['class members', 'class C<T> {\n  declare d: number\n  private readonly x: number = 1\n  static s?: string\n  y!: number\n  m(): number\n  m(a?: number): number { return this.x + (a ?? 0) }\n  [key: string]: unknown\n}\nreturn new C<string>().m(1)', 2],
  ['a field without semicolon before an erased member, then [', "class D {\n  x = 1\n  declare y: number\n  ['z'] = 2\n}\nreturn new D().x", 1],
  ['generic calls and instantiation expressions', 'const id = <T,>(v: T): T => v\nconst idn = id<number>\nreturn id<string>("a") + idn(1)', 'a1'],
  ['an abstract class', 'abstract class A { abstract f(): number; g() { return this.f() + 1 } }\nclass B extends A { f() { return 1 } }\nreturn new B().g()', 2],
  ['optional chaining with type arguments', 'const o: any = { f: (x: number) => x }\nreturn o?.f<number>(9)', 9],
  ['a type-only namespace', 'namespace N { export type T = 1 }\nlet a = 1\nreturn a', 1],
  ['declare statements', "declare const g: number\ndeclare function k(): void\ndeclare global { interface Window { z: 1 } }\nreturn 'ok'", 'ok'],
  ['implements and type arguments in extends', 'class Base<T> { v = 2 }\ninterface I {}\nclass K extends Base<number> implements I {}\nreturn new K().v', 2],
];

for (const [what, code, expected] of cases) {
  test(`${what}`, () => {
    const js = strip(code);
    assert.equal(js.length, code.length);
    assert.deepEqual(run(js), expected, js);
    assert.deepEqual(run(typescriptStrip(code)), expected, 'TypeScript agrees');
  });
}

test('type-only import and export specifiers go with their commas', () => {
  assert.equal(strip("import { type A, B, type C } from 'x';"), "import {         B,        } from 'x';");
  assert.equal(strip("import { type A } from 'x';"), "import {        } from 'x';");
  assert.equal(strip("export { type A, B };"), "export {         B };");
  const lines = ["import type { A } from 'x';", 'export type { A };'];
  assert.equal(strip(lines.join('\n')), lines.map((l) => ';' + ' '.repeat(l.length - 1)).join('\n'));
});

test('what makes code is refused, with where and what to write instead', () => {
  const refused: [string, RegExp][] = [
    ['let a = 1;\nenum E { A }', /line 2, column 1: An enum makes code/],
    ['namespace N { export const x = 1 }', /line 1, column 1: A namespace with values/],
    ['class C { constructor(private x: number) {} }', /line 1, column 23: A parameter property/],
    ["import fs = require('fs');", /line 1, column 1: import … = /],
    ['export = 1;', /line 1, column 1: export = /],
    ['let a = <number>1;', /line 1, column 9: A <T>x type assertion/],
  ];
  for (const [code, message] of refused) assert.throws(() => strip(code), message, code);
  // Declared forms make no code and are stripped.
  assert.doesNotThrow(() => strip('declare enum E { A }\ndeclare namespace N { const x: 1 }\nconst enum_ = 1;'));
});
