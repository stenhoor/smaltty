// The checker (milestone 7): every error it reports, tsc reports too (same file, start and code), on hand-written cases
// and on smaltts's reference examples, as written and mutated (a property misspelt, an argument added or taken away).
// tsc's errors it misses are counted, not failed: the count is how far checking has come.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { K, parse } from 'smaltty';
import { compareChecks } from './checking.ts';

const lib = `
export class Rel<Row> {
  readonly node: unknown;
  filter(pred: (r: Row) => boolean): Rel<Row> { return this; }
  limit(count: number, offset?: number): Rel<Row> { return this; }
  pick(...names: string[]): Rel<Row> { return this; }
  join<S>(other: Rel<S>, on: unknown, options: { prefix?: string } = {}): Rel<Row & S> { return this as never; }
  static of(): number { return 1; }
}
export interface Spec { name: string; columns(): string[] }
export interface Spec { indexes?: string[] }
export interface Open { [key: string]: unknown }
export type Point = { x: number; y: number };
export function scan(table: string): Rel<unknown>;
export function scan<R>(table: Spec): Rel<R>;
export function scan(table: unknown): Rel<any> { return new Rel(); }
export const make = (name: string, size = 1): Spec => ({ name, columns: () => [] });
export class Base { base(): void {} }
export class Derived extends Base { own(): void {} }
export class FromUnknown extends Mystery { own(): void {} }
declare const Mystery: new () => object;
`;

function run(user: string) {
  const files = new Map([['/lib.ts', lib], ['/user.ts', user]]);
  return compareChecks(files, { roots: ['/user.ts'] });
}

test('unknown properties on classes, merged interfaces and type literals; tsc agrees', () => {
  const r = run(`import { scan, make, type Point, Derived } from './lib.js';
scan('t').filter((x) => true).fliter;
scan('t').nope;
make('a').columns().length;
make('a').indexes;
make('a').nme;
const p: Point = { x: 1, y: 2 };
p.z;
new Derived().base();
new Derived().gone();
`);
  assert.deepEqual(r.falseErrors, []);
  assert.deepEqual(r.smaltty.map((d) => [d.code, d.message]), [
    [2551, "Property 'fliter' does not exist on type 'Rel'. Did you mean 'filter'?"],
    [2339, "Property 'nope' does not exist on type 'Rel'."],
    [2551, "Property 'nme' does not exist on type 'Spec'. Did you mean 'name'?"],
    [2339, "Property 'z' does not exist on type '{ x: number; y: number }'."],
    [2339, "Property 'gone' does not exist on type 'Derived'."],
  ]);
  assert.equal(r.caught, r.tsc.length);
});

test('argument counts: optional, defaulted and rest parameters', () => {
  const r = run(`import { scan, make } from './lib.js';
const rel = scan('t');
rel.limit();
rel.limit(1, 2, 3);
rel.limit(1);
rel.pick();
rel.pick('a', 'b', 'c');
rel.join(rel, 1, {}, 4);
make();
make('a', 2, 3);
`);
  assert.deepEqual(r.falseErrors, []);
  assert.deepEqual(r.smaltty.map((d) => [d.code, d.message]), [
    [2554, 'Expected 1-2 arguments, but got 0.'],
    [2554, 'Expected 1-2 arguments, but got 3.'],
    [2554, 'Expected 2-3 arguments, but got 4.'],
    [2554, 'Expected 1-2 arguments, but got 0.'],
    [2554, 'Expected 1-2 arguments, but got 3.'],
  ]);
});

test('option keys: the first excess property of an object literal argument, nested literals too', () => {
  const r = run(`import { scan, type Point } from './lib.js';
const rel = scan('t');
rel.join(rel, 1, { prefx: 'a' });
rel.join(rel, 1, { other: 1 });
rel.join(rel, 1, { prefix: 'a' });
declare function at(p: Point, o: { at: Point; label?: string }): void;
at({ x: 1, y: 2 }, { at: { x: 1, yy: 2 } });
at({ x: 1, y: 2, z: 3 }, { at: { x: 1, y: 2 }, labl: 'a' });
`);
  assert.deepEqual(r.falseErrors, []);
  assert.deepEqual(r.smaltty.map((d) => [d.code, d.message]), [
    [2561, "Object literal may only specify known properties, but 'prefx' does not exist in type '{ prefix?: string }'. Did you mean to write 'prefix'?"],
    [2353, "Object literal may only specify known properties, and 'other' does not exist in type '{ prefix?: string }'."],
    // No suggestion: tsc suggests a name under 3 characters only when it differs by case alone.
    [2353, "Object literal may only specify known properties, and 'yy' does not exist in type '{ x: number; y: number }'."],
    [2353, "Object literal may only specify known properties, and 'z' does not exist in type '{ x: number; y: number }'."],
  ]);
  assert.equal(r.caught, r.tsc.length);
});

test('option keys: quiet with a spread, an unknown target, or a wrong argument count', () => {
  const r = run(`import { scan, type Open } from './lib.js';
const rel = scan('t');
const base = { prefix: 'a' };
rel.join(rel, 1, { ...base, prefx: 'b' });
declare function open(o: Open): void;
open({ anything: 1 });
declare function generic<T>(o: T): void;
generic({ anything: 1 });
`);
  assert.deepEqual(r.smaltty, []);
});

test('quiet where it cannot know: index signatures, unknown bases, statics, primitives, spreads, overloads', () => {
  const r = run(`import { scan, Rel, type Open, FromUnknown } from './lib.js';
declare const o: Open;
o.anything;
new FromUnknown().anything;
Rel.of();
Rel.whatever;
'text'.whatever;
scan('t').toString();
const args: [number] = [1];
scan('t').limit(...args);
scan();
`);
  assert.deepEqual(r.smaltty, []);
});

// ---------------------------------------------------------------------------------------------------------------
// smaltts's reference examples, against a copy of smaltts's source (corpus/check/smaltts).

const corpus = new URL('../corpus/check/smaltts/', import.meta.url);
const smaltts = new Map<string, string>();
for (const dir of ['src', 'examples']) {
  for (const f of readdirSync(new URL(`${dir}/`, corpus)).sort()) if (f.endsWith('.ts')) smaltts.set(`/${dir}/${f}`, readFileSync(new URL(`${dir}/${f}`, corpus), 'utf8'));
}
const examples = [...smaltts.keys()].filter((f) => f.startsWith('/examples/'));

test("smaltts's examples as written: no errors from either", () => {
  const r = compareChecks(smaltts, { roots: examples });
  assert.deepEqual(r.falseErrors, []);
  assert.deepEqual(r.smaltty, []);
});

/** Every mutant of an example: one property misspelt, or one call with an argument more or none. */
function mutants(name: string, text: string): [string, string][] {
  const t = parse(text, { fileName: name });
  const out: [string, string][] = [];
  const edit = (start: number, end: number, insert: string, label: string) => out.push([`${name.slice(0, -3)}.${label}.${out.length}.ts`, text.slice(0, start) + insert + text.slice(end)]);
  t.walk(t.root, (n) => {
    if (t.kind[n] === K.PropertyAccessExpression) {
      const id = t.next[t.first[n]!]!;
      const word = t.textOf(id);
      if (word.length > 2) edit(t.start[id]!, t.end[id]!, word.slice(0, -1), 'short');
      edit(t.start[id]!, t.end[id]!, `${word}Zz`, 'long');
    } else if (t.kind[n] === K.ObjectLiteralExpression) {
      for (const p of t.children(n)) {
        const id = t.first[p]!;
        if (t.kind[p] !== K.PropertyAssignment || t.kind[id] !== K.Identifier) continue;
        const word = t.textOf(id);
        if (word.length > 2) edit(t.start[id]!, t.end[id]!, word.slice(0, -1), 'key');
        edit(t.start[id]!, t.end[id]!, `${word}Zz`, 'keylong');
      }
    } else if (t.kind[n] === K.CallExpression) {
      const args = t.children(n).slice(1);
      const close = t.end[n]! - 1;
      edit(close, close, args.length ? ', 0' : '0', 'more');
      if (args.length) edit(t.start[args[0]!]!, t.end[args[args.length - 1]!]!, '', 'none');
    }
  });
  return out;
}

test("smaltts's examples mutated: every smaltty error is tsc's; how many of tsc's it catches", () => {
  const files = new Map([...smaltts].filter(([f]) => f.startsWith('/src/')));
  const roots: string[] = [];
  for (const f of examples) {
    for (const [name, text] of mutants(f, smaltts.get(f)!)) {
      files.set(name, text);
      roots.push(name);
    }
  }
  const r = compareChecks(files, { roots });
  assert.deepEqual(r.falseErrors.map((d) => `${d.file}:${d.start} ${d.code} ${d.message}`).slice(0, 10), []);
  console.log(`# ${roots.length} mutants: tsc ${r.tsc.length} errors of the checked codes, smaltty caught ${r.caught} (${((100 * r.caught) / r.tsc.length).toFixed(0)}%)`);
  // A floor, raised as checking grows: caught share must not fall.
  assert.ok(r.caught / r.tsc.length >= 0.7, `caught ${r.caught} of ${r.tsc.length}`);
});
