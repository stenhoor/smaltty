// The checker (milestone 7): every error it reports, tsc reports too (same file, start and code), on hand-written cases
// and on smaltts's reference examples, as written and mutated (a property misspelt, an argument added or taken away).
// tsc's errors it misses are counted, not failed: the count is how far checking has come.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { K, expectations, parse } from 'smaltty';
import { compareChecks } from './checking.ts';
import { generatedScript } from '../bench/corpus.ts';

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

test('quiet where it cannot know: index signatures, unknown bases, statics, spreads, overloads', () => {
  const r = run(`import { scan, Rel, type Open, FromUnknown } from './lib.js';
declare const o: Open;
o.anything;
new FromUnknown().anything;
Rel.of();
Rel.whatever;
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

test('row callbacks: column names from table() through scan, join prefixes, extend and select', () => {
  const files = new Map([...smaltts].filter(([f]) => f.startsWith('/src/')));
  files.set('/user.ts', `import { agg, fn, int, real, scan, table, text } from './src/index.js';
const orders = table('orders', { id: int().primaryKey(), customerId: int().notNull(), total: real().notNull() });
const customers = table('customers', { id: int().primaryKey(), name: text() });
scan(orders).filter((o) => o.totl.gt(5));
scan(orders).filter((o) => o.total.gt(5)).aggregate((r) => ({ c: r.customerid }), (r) => ({ n: agg.count() }));
scan(orders).join(scan(customers), (o, c) => o.customerId.eq(c.c_idd), { prefix: 'c_' });
scan(orders).join(scan(customers), (o, c) => o.customerId.eq(c.c_id), { prefix: 'c_' }).filter((r) => r.c_nam.isNull());
scan(orders).extend((o) => ({ double: fn.mul(o.total, 2) })).filter((r) => r.doubel.gt(1));
scan(orders).select((o) => ({ t: o.total })).filter((r) => r.total.gt(1));
// @ts-expect-error: silenced, as tsc does
scan(orders).filter((o) => o.nope.gt(5));
`);
  const r = compareChecks(files, { roots: ['/user.ts'] });
  assert.deepEqual(r.falseErrors, []);
  assert.deepEqual(r.smaltty.map((d) => [d.code, d.message.replace(/ on type '[^']*'/, '')]), [
    [2551, "Property 'totl' does not exist. Did you mean 'total'?"],
    [2551, "Property 'customerid' does not exist. Did you mean 'customerId'?"],
    [2551, "Property 'c_idd' does not exist. Did you mean 'c_id'?"],
    [2551, "Property 'c_nam' does not exist. Did you mean 'c_name'?"],
    [2551, "Property 'doubel' does not exist. Did you mean 'double'?"],
    [2339, "Property 'total' does not exist."],
  ]);
  assert.equal(r.caught, r.tsc.length);
  // The compile-time test behind the @ts-expect-error is found, though silenced.
  assert.deepEqual(expectations(files, { roots: ['/user.ts'] }).map((e) => [e.line, e.found]), [[11, true]]);
});

test('argument types: value types through conditional types, sort keys through template literals', () => {
  const files = new Map([...smaltts].filter(([f]) => f.startsWith('/src/')));
  files.set('/user.ts', `import { int, real, scan, table, text } from './src/index.js';
const orders = table('orders', { id: int().primaryKey(), total: real().notNull(), note: text() });
scan(orders).filter((o) => o.total.eq('five'));
scan(orders).filter((o) => o.total.eq(5));
scan(orders).filter((o) => o.note.eq(5));
scan(orders).filter((o) => o.note.eq(null));
scan(orders).sort('-nope');
scan(orders).sort('-total', 'id');
scan(orders).limit('3');
scan(orders).distinct({ keep: 'middle' });
scan(orders).unpivot(['total'], { name: 'col', value: 'v' });
declare const maybe: string | number;
scan(orders).limit(maybe as never);
declare function flag(on: boolean): void;
flag(true);
flag('yes');
`);
  const r = compareChecks(files, { roots: ['/user.ts'] });
  assert.deepEqual(r.falseErrors, []);
  assert.deepEqual(r.smaltty.map((d) => [d.code, d.message.replace(/to (parameter of )?type .*/, '')]), [
    [2345, "Argument of type '\"five\"' is not assignable "],
    [2345, "Argument of type 'number' is not assignable "],
    [2345, "Argument of type '\"-nope\"' is not assignable "],
    [2345, "Argument of type '\"3\"' is not assignable "],
    [2322, "Type '\"middle\"' is not assignable "],
    [2345, "Argument of type '\"yes\"' is not assignable "],
  ]);
  assert.equal(r.caught, r.tsc.length);
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
        // A value of another type.
        const value = t.next[id]!;
        if (t.kind[value] === K.StringLiteral) edit(t.start[value]!, t.end[value]!, '0', 'value');
        else if (t.kind[value] === K.NumericLiteral || t.kind[value] === K.TrueKeyword || t.kind[value] === K.FalseKeyword) edit(t.start[value]!, t.end[value]!, "'x'", 'value');
      }
    } else if (t.kind[n] === K.CallExpression) {
      const args = t.children(n).slice(1);
      // An argument of another type: a string for a number or boolean, a number for a string.
      for (const a of args) {
        const k = t.kind[a];
        if (k === K.StringLiteral) edit(t.start[a]!, t.end[a]!, '0', 'type');
        else if (k === K.NumericLiteral || k === K.TrueKeyword || k === K.FalseKeyword) edit(t.start[a]!, t.end[a]!, "'x'", 'type');
      }
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
  // 2322 is counted apart: most of tsc's are knock-on errors outside a call's arguments, which aren't in scope.
  const of = (code: (c: number) => boolean) => ({ tsc: r.tsc.filter((d) => code(d.code)).length, caught: r.smaltty.filter((d) => code(d.code)).length });
  const main = of((c) => c !== 2322);
  const props = of((c) => c === 2322);
  console.log(`# ${roots.length} mutants: tsc ${main.tsc} errors of the checked codes, smaltty caught ${main.caught} (${((100 * main.caught) / main.tsc).toFixed(0)}%); 2322: ${props.caught} of ${props.tsc}`);
  // A floor, raised as checking grows: caught share must not fall. (72% since tsc's 2345 errors are counted: most
  // of those it misses are knock-on errors of the mutation elsewhere in the file.)
  assert.ok(main.caught / main.tsc >= 0.76, `caught ${main.caught} of ${main.tsc}`);
});

test('this, private names, parameter properties and module augmentations', () => {
  const files = new Map([
    ['/aug.ts', `import { Box } from './box.js';
declare module './box.js' { interface Box { extra(): number } }
`],
    ['/box.ts', `export class Box { constructor(readonly size: number) {} }
`],
    ['/user.ts', `import { Box } from './box.js';
class Cache<V> {
  #items = new Map<string, V>();
  hits = 0;
  get(k: string) {
    if (this.#item) this.hit++;
    const f = () => this.misses;
    return function (this: unknown) { return (this as any).whatever; };
  }
  static make() { return this.anything; }
}
new Box(1).size;
new Box(1).extra();
new Box(1).sizes;
`],
  ]);
  const r = compareChecks(files, { roots: ['/user.ts'] });
  assert.deepEqual(r.falseErrors, []);
  assert.deepEqual(r.smaltty.map((d) => [d.code, d.message.replace(/ on type '[^']*'/, '')]), [
    [2551, "Property '#item' does not exist. Did you mean '#items'?"],
    [2551, "Property 'hit' does not exist. Did you mean 'hits'?"],
    [2339, "Property 'misses' does not exist."],
    [2551, "Property 'sizes' does not exist. Did you mean 'size'?"],
  ]);
});

// smaltdf: its source in corpus/libs, under the paths its imports name, read by the apps and generated scripts.
const smaltdf = new Map<string, string>();
const libs = new URL('../corpus/libs/', import.meta.url);
const others = new Map<string, string>();
for (const f of readdirSync(libs).sort()) (f.startsWith('smaltdf-') ? smaltdf.set(`/df/${f.slice(8)}`, readFileSync(new URL(f, libs), 'utf8')) : others.set(`/libs/${f}`, readFileSync(new URL(f, libs), 'utf8')));
const dfPackages = { '@smaltdb/df': '/df/index.ts' };

test('the corpus libraries (smaltdf, smaltnb, smaltkit, smaltui) as written: no false errors', () => {
  const r = compareChecks(new Map([...smaltdf, ...others]), { packages: dfPackages });
  assert.deepEqual(r.falseErrors.map((d) => `${d.file}:${d.start} ${d.code} ${d.message}`), []);
});

test("smaltdf's API in the apps and generated scripts, mutated: every smaltty error is tsc's", () => {
  const files = new Map(smaltdf);
  const apps = new URL('../corpus/apps/', import.meta.url);
  const sources: [string, string][] = [
    ...['smaltui-demo-frames.ts', 'smaltui-starter.ts'].map((f) => [`/apps/${f}`, readFileSync(new URL(f, apps), 'utf8')] as [string, string]),
    ['/gen/small.ts', generatedScript(6_000)],
  ];
  const roots: string[] = [];
  for (const [name, text] of sources) {
    for (const [m, mt] of mutants(name, text)) {
      files.set(m, mt);
      roots.push(m);
    }
  }
  const r = compareChecks(files, { roots, packages: dfPackages });
  assert.deepEqual(r.falseErrors.map((d) => `${d.file}:${d.start} ${d.code} ${d.message}`).slice(0, 10), []);
  const main = r.tsc.filter((d) => d.code !== 2322).length;
  const caught = r.smaltty.filter((d) => d.code !== 2322).length;
  console.log(`# smaltdf: ${roots.length} mutants: tsc ${main} errors, smaltty caught ${caught} (${((100 * caught) / main).toFixed(0)}%)`);
  assert.ok(caught / main >= 0.85, `caught ${caught} of ${main}`);
});

test('the built-in types: arrays, strings, numbers, maps, sets, promises, Math and JSON', () => {
  const r = compareChecks(new Map([['/user.ts', `const xs = [1, 2, 3];
xs.pussh(4);
xs.push('five');
xs.map((x) => x.toFixd(2));
xs.indexOf(2, 0, 1);
const names = ['a', 'b'];
names.push('c');
'text'.lenght;
'text'.padStart(3, '-').toUpperCas();
const m = new Map<string, number>();
m.get(1);
m.sett('a', 1);
const s = new Set<number>();
s.ad(1);
Math.flor(1.5);
Math.max(1, 2, 3).toFixed(1);
JSON.parse('{}', undefined, 1);
async function f(): Promise<number> { return 1; }
f().thn(() => {});
async function g() { (await f()).toFixd(); }
class C { #items = new Map<string, number>(); get(k: string) { return this.#items.gett(k); } }
`]]));
  assert.deepEqual(r.falseErrors.map((d) => `${d.start} ${d.code} ${d.message}`), []);
  assert.deepEqual(r.smaltty.map((d) => d.message.replace(/ on type '[^']*'/, '')), [
    "Property 'pussh' does not exist. Did you mean 'push'?",
    "Argument of type '\"five\"' is not assignable to parameter of type 'number'.",
    "Property 'toFixd' does not exist. Did you mean 'toFixed'?",
    'Expected 1-2 arguments, but got 3.',
    "Property 'lenght' does not exist. Did you mean 'length'?",
    "Property 'toUpperCas' does not exist. Did you mean 'toUpperCase'?",
    "Argument of type 'number' is not assignable to parameter of type 'K'.",
    "Property 'sett' does not exist. Did you mean 'set'?",
    "Property 'ad' does not exist.",
    "Property 'flor' does not exist. Did you mean 'floor'?",
    'Expected 1-2 arguments, but got 3.',
    "Property 'thn' does not exist. Did you mean 'then'?",
    "Property 'toFixd' does not exist. Did you mean 'toFixed'?",
    "Property 'gett' does not exist. Did you mean 'get'?",
  ]);
  assert.equal(r.caught, r.tsc.length);
});
