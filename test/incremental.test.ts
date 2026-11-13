// Incremental re-checks (milestone 12): a check with a cache that keeps each statement's results gives exactly the
// errors of a cold check, in the same order, after every kind of edit: inside a statement, a statement added, removed
// or moved, a declaration renamed, an import changed, a `declare module` added, a library file edited, the options
// changed. Every workload of the checker tests is checked this way: smaltts's examples and their mutants, smaltdf's
// API in the apps and generated scripts and their mutants, smaltui's tabs (smaltdf as globals), smaltnb's notebooks
// and the 40 KB generated script. And the cache does keep results: an edit inside one statement checks that one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { K, check, checkCache, parse, prepare, type CheckCache, type CheckOptions } from 'smaltty';
import { compareChecks, DF_PACKAGES, globalsDeclaration, libsCorpus, mutants, smalttsCorpus } from './checking.ts';
import { generatedScript } from '../bench/corpus.ts';

interface Workload {
  label: string;
  files: Map<string, string>;
  root: string;
  options: CheckOptions;
}

const smaltts = smalttsCorpus();
const smalttsSrc = new Map([...smaltts].filter(([f]) => f.startsWith('/src/')));
const { smaltdf } = libsCorpus();
const apps = new URL('../corpus/apps/', import.meta.url);
const app = (f: string) => readFileSync(new URL(f, apps), 'utf8');
const withGlobals = new Map([...smaltdf, ['/globals.d.ts', globalsDeclaration(smaltdf, '@smaltdb/df', '/df/index.ts')]]);

function workloads(): Workload[] {
  const out: Workload[] = [];
  for (const [f, text] of smaltts) {
    if (f.startsWith('/examples/')) out.push({ label: `smaltts ${f}`, files: new Map([...smalttsSrc, [f, text]]), root: f, options: {} });
  }
  for (const f of ['smaltnb-regional.nb.ts', 'smaltnb-shop.nb.ts', 'smaltui-demo-frames.ts', 'smaltui-starter.ts']) {
    out.push({ label: `smaltdf ${f}`, files: new Map([...smaltdf, [`/apps/${f}`, app(f)]]), root: `/apps/${f}`, options: { packages: DF_PACKAGES } });
  }
  for (const f of ['smaltui-demo-frames.ts', 'smaltui-starter.ts']) {
    out.push({ label: `tab ${f}`, files: new Map([...withGlobals, [`/tabs/${f}`, app(f)]]), root: `/tabs/${f}`, options: { packages: DF_PACKAGES, globals: ['@smaltdb/df'] } });
  }
  out.push({ label: 'generated 6 KB', files: new Map([...smaltdf, ['/gen/small.ts', generatedScript(6_000)]]), root: '/gen/small.ts', options: { packages: DF_PACKAGES } });
  out.push({ label: 'generated 40 KB', files: new Map([...smaltdf, ['/gen/40k.ts', generatedScript(40_000)]]), root: '/gen/40k.ts', options: { packages: DF_PACKAGES } });
  return out;
}

/** Checks `files` with the cache and cold, and requires the same errors; returns how many statements were reused. */
function same(label: string, files: ReadonlyMap<string, string>, options: CheckOptions, cache: CheckCache): number {
  const cold = check(files, options);
  const warm = check(files, { ...options, cache });
  assert.deepEqual(warm, cold, label);
  let reused = 0;
  for (const r of cache.statements!.values()) reused += r.reused;
  return reused;
}

/** Edits of a file's text, each from the text before it (an editor's session), and back to the original at the end. */
function edits(text: string): [string, string][] {
  const t = parse(text);
  const statements = t.children(t.root);
  const out: [string, string][] = [];
  const mid = statements[statements.length >> 1];
  const splice = (s: string, start: number, end: number, insert: string) => s.slice(0, start) + insert + s.slice(end);
  out.push(['unchanged', text]);
  out.push(['a comment at the top: every statement moves', `// edited\n${text}`]);
  out.push(['the original again', text]);
  if (mid === undefined) return out;
  const ms = t.start[mid]!;
  const me = t.end[mid]!;
  // Inside one statement: a property misspelt, or else a space.
  let inside: string | undefined;
  t.walk(mid, (n) => {
    if (inside === undefined && t.kind[n] === K.PropertyAccessExpression) {
      const id = t.next[t.first[n]!]!;
      inside = splice(text, t.end[id]!, t.end[id]!, 'x');
    }
  });
  inside ??= splice(text, me - 1, me - 1, ' ');
  out.push(['inside one statement', inside]);
  out.push(['inside it again: a line added', splice(inside, ms, ms, '\n')]);
  out.push(['the original again', text]);
  out.push(['a statement inserted', splice(text, ms, ms, 'const insertedHere = [1].mapp((x) => x);\n')]);
  out.push(['a statement deleted', splice(text, ms, me, '')]);
  if (statements.length > 2) {
    const next = statements[(statements.length >> 1) + 1];
    if (next !== undefined) {
      const ns = t.start[next]!;
      const ne = t.end[next]!;
      out.push(['two statements swapped', text.slice(0, ms) + text.slice(ns, ne) + text.slice(me, ns) + text.slice(ms, me) + text.slice(ne)]);
    }
  }
  out.push(['an error silenced', splice(text, ms, ms, '// @ts-expect-error\n')]);
  out.push(['the whole file unchecked', `// @ts-nocheck\n${text}`]);
  out.push(['a syntax error', splice(text, ms, ms, 'const = ;\n')]);
  out.push(['the original again', text]);
  // A declaration others use, renamed: its uses resolve to nothing; then the uses renamed too; then back.
  const declared = new Map<string, number>();
  for (const s of statements) {
    const k = t.kind[s];
    let name = 0;
    if (k === K.VariableStatement) name = t.first[t.first[t.first[s]!]!]!;
    else if (k === K.FunctionDeclaration || k === K.ClassDeclaration || k === K.InterfaceDeclaration || k === K.TypeAliasDeclaration) name = t.first[s]!;
    if (name && t.kind[name] === K.Identifier) declared.set(t.textOf(name), name);
  }
  const uses = new Map<string, number[]>();
  t.walk(t.root, (n) => {
    if (t.kind[n] === K.Identifier && declared.has(t.textOf(n)) && declared.get(t.textOf(n)) !== n) uses.set(t.textOf(n), [...(uses.get(t.textOf(n)) ?? []), n]);
  });
  for (const used of [...uses.keys()].slice(0, 6)) {
    const d = declared.get(used)!;
    out.push([`${used} renamed where declared`, splice(text, t.start[d]!, t.end[d]!, `${used}Renamed`)]);
    let all = text;
    for (const n of [d, ...uses.get(used)!].sort((a, b) => t.start[b]! - t.start[a]!)) all = splice(all, t.start[n]!, t.end[n]!, `${used}Renamed`);
    out.push([`${used} renamed everywhere`, all]);
  }
  out.push(['the original again', text]);
  // Interfaces merged: another declaration of one the file declares.
  for (const s of statements) {
    if (t.kind[s] !== K.InterfaceDeclaration) continue;
    const exported = t.textOf(s).startsWith('export');
    out.push(['an interface merged', `${text}\n${exported ? 'export ' : ''}interface ${t.textOf(t.first[s]!)} { mergedHere: number }\n`]);
    out.push(['the original again', text]);
    break;
  }
  // A name the file reads from outside (a global, a built-in), declared in the file.
  let outside: string | undefined;
  t.walk(t.root, (n) => {
    if (outside !== undefined || t.kind[n] !== K.CallExpression) return;
    const callee = t.first[n]!;
    if (t.kind[callee] === K.Identifier && !declared.has(t.textOf(callee)) && !uses.has(t.textOf(callee))) outside = t.textOf(callee);
  });
  if (outside !== undefined) {
    out.push([`${outside} declared in the file`, `${text}\ndeclare function ${outside}(only: number): { declaredHere: number };\n`]);
    out.push(['the original again', text]);
  }
  // An import changed: a name taken out, then the module.
  const imp = statements.find((s) => t.kind[s] === K.ImportDeclaration);
  if (imp !== undefined) {
    const it = t.textOf(imp);
    const named = /\{\s*([^,}]+),?/.exec(it);
    // Each imported name taken out in turn: statements that read it, or read a declaration that does, change.
    const names = /\{([^}]*)\}/.exec(it)?.[1]?.split(',').map((x) => x.trim()).filter(Boolean) ?? [];
    for (const name of names.slice(0, 8)) {
      const rest = names.filter((x) => x !== name).join(', ');
      out.push([`${name} no longer imported`, splice(text, t.start[imp]!, t.end[imp]!, it.replace(/\{[^}]*\}/, `{ ${rest} }`))]);
    }
    out.push(['the module imported changed', splice(text, t.start[imp]!, t.end[imp]!, it.replace(/(['"])[^'"]*\1/, "'./nowhere.js'"))]);
    const spec = /(['"])([^'"]*)\1/.exec(it)?.[2];
    const first = named?.[1]?.replace(/^type\s+/, '').trim();
    if (spec && first) {
      out.push(['a module augmented', `${text}\ndeclare module '${spec}' { interface ${first} { augmentedHere(): number } }\n`]);
      out.push(['the augmentation changed', `${text}\ndeclare module '${spec}' { interface ${first} { augmentedThere(): number } }\n`]);
    }
    out.push(['the original again', text]);
  }
  return out;
}

/** Each edit of the root, then the libraries and options changed under it; every check the same as a cold one. */
function session(w: Workload, cache: CheckCache): number {
  const files = new Map(w.files);
  const options: CheckOptions = { ...w.options, roots: [w.root] };
  let reused = 0;
  for (const [label, text] of edits(w.files.get(w.root)!)) {
    files.set(w.root, text);
    reused += same(`${w.label}: ${label}`, files, options, cache);
  }
  // A library file edited: a method renamed, then back.
  const lib = [...files.keys()].find((f) => f !== w.root && /\b(filter|select|limit|table)\(/.test(files.get(f)!));
  if (lib !== undefined) {
    const original = files.get(lib)!;
    files.set(lib, original.replace(/\b(filter|select|limit|table)\(/, '$1Renamed('));
    same(`${w.label}: a library edited`, files, options, cache);
    files.set(lib, original);
    same(`${w.label}: the library as it was`, files, options, cache);
  }
  // The options: the globals, the packages, prepared declarations.
  same(`${w.label}: globals changed`, files, { ...options, globals: w.options.globals ? [] : ['@smaltdb/df'] }, cache);
  same(`${w.label}: packages changed`, files, { ...options, packages: {} }, cache);
  const libs = new Map([...files].filter(([f]) => f !== w.root));
  const prepared = prepare(libs);
  same(`${w.label}: prepared`, files, { ...options, prepared }, cache);
  same(`${w.label}: prepared, the same buffer`, files, { ...options, prepared }, cache);
  same(`${w.label}: as it was`, files, options, cache);
  return reused;
}

test('every edit of every workload, and of mutants with errors: the same errors as a cold check', () => {
  for (const w of workloads()) {
    session(w, checkCache());
    // The same edits on mutants with an error (a statement's errors that depend on what other statements read).
    let n = 0;
    for (const [, text] of mutants(w.root, w.files.get(w.root)!)) {
      if (n === 3) break;
      const files = new Map(w.files).set(w.root, text);
      if (!check(files, { ...w.options, roots: [w.root] }).length) continue;
      session({ ...w, files }, checkCache());
      n++;
    }
  }
});

test("mutants as edits: smaltts's examples, smaltdf's API and the tabs, each mutant checked after the one before", () => {
  const sets: Workload[] = workloads().filter((w) => !w.label.includes('40 KB'));
  let checks = 0;
  for (const w of sets) {
    const cache = checkCache();
    const files = new Map(w.files);
    const options: CheckOptions = { ...w.options, roots: [w.root] };
    same(w.label, files, options, cache);
    for (const [name, text] of mutants(w.root, w.files.get(w.root)!)) {
      files.set(w.root, text);
      same(`${w.label}: ${name}`, files, options, cache);
      checks++;
    }
  }
  assert.ok(checks > 1500, `${checks} mutants`);
});

test('statements are reused: an edit inside one statement of the 40 KB script checks that statement', () => {
  const root = '/gen/40k.ts';
  const text = generatedScript(40_000);
  const files = new Map([...smaltdf, [root, text]]);
  const cache = checkCache();
  const options = { roots: [root], packages: DF_PACKAGES, cache };
  check(files, options);
  const first = cache.statements!.get(root)!;
  assert.equal(first.reused, 0);
  const total = first.checked;
  // A one-line edit in the middle: one statement checked again (and those that read what it declares).
  const at = text.indexOf("const cache20 = ");
  files.set(root, `${text.slice(0, at)}const cache20 = new Cache20<LazyFrame>(); // edited\n${text.slice(text.indexOf('\n', at) + 1)}`);
  check(files, options);
  const edited = cache.statements!.get(root)!;
  assert.ok(edited.checked <= 3, `${edited.checked} of ${total} checked`);
  assert.equal(edited.reused + edited.checked, total);
  // Nothing changed: nothing checked.
  check(files, options);
  assert.equal(cache.statements!.get(root)!.checked, 0);
  // A library edited: everything checked.
  files.set('/df/frame.ts', `${files.get('/df/frame.ts')!}\n`);
  check(files, options);
  assert.equal(cache.statements!.get(root)!.checked, total);
});

test('several roots, each kept; one edited', () => {
  const files = new Map([...smaltdf, ...['smaltnb-regional.nb.ts', 'smaltnb-shop.nb.ts', 'smaltui-demo-frames.ts'].map((f) => [`/apps/${f}`, app(f)] as [string, string])]);
  const roots = [...files.keys()].filter((f) => f.startsWith('/apps/'));
  const cache = checkCache();
  const options = { roots, packages: DF_PACKAGES };
  same('several roots', files, options, cache);
  same('several roots, again', files, options, cache);
  for (const [label, text] of edits(files.get(roots[1]!)!)) {
    files.set(roots[1]!, text);
    same(`several roots: ${label}`, files, options, cache);
  }
});

test('a cache without statements, and one made before 0.13.0, check each root whole', () => {
  const files = new Map([...smaltdf, ['/gen/small.ts', generatedScript(6_000)]]);
  const options = { roots: ['/gen/small.ts'], packages: DF_PACKAGES };
  const off = checkCache({ statements: false });
  assert.equal(off.statements, undefined);
  const old: CheckCache = { files: new Map(), augments: new Map() };
  for (const cache of [off, old]) assert.deepEqual(check(files, { ...options, cache }), check(files, options));
});

test('results cut short by a cycle: the same errors as a cold check', () => {
  // `b` and `a` are a cycle: what each is depends on which statement asks first.
  const user = `declare function id<T>(x: T): T;
const a = id(b).nope;
const b = id(a).nope;
a.length;
b.length;
[1].mapp(() => a);
`;
  const files = new Map([['/user.ts', user]]);
  const cache = checkCache();
  for (const text of [user, user.replace('a.length;', 'a.lenght;'), user.replace('const b = id(a)', 'const b = id(1)'), user]) {
    files.set('/user.ts', text);
    same('cycle', files, { roots: ['/user.ts'] }, cache);
  }
  // A call with an argument too many is not resolved where it is checked, so its callback's parameter, typed by
  // resolving it, is read while that is under way: `pick`'s result is cut short there, and `v` is unknown to the
  // statement after it. A check that took that statement from the last one doesn't know what it would have cut short:
  // it checks everything again.
  const picked = `declare function pick<T>(fn: (r: { x: string }) => T): T;
const v = pick((r) => r.x, 1);
v.foo;
`;
  const r = compareChecks(new Map([['/user.ts', picked]]), { roots: ['/user.ts'] });
  assert.deepEqual(r.falseErrors, []);
  assert.deepEqual(r.smaltty.map((d) => d.code), [2554]);
  const resolved = picked.replace(', 1)', ')');
  for (const text of [picked, picked.replace('v.foo', 'v.fooo'), picked.replace('v.foo', 'v.length'), picked, resolved, picked, resolved]) {
    files.set('/user.ts', text);
    same('cut short', files, { roots: ['/user.ts'] }, cache);
  }
  // Whether `pick`'s result is cut short depends on which statement resolves it first: here a function before it
  // reads `v` (hoisted), and resolves it whole, so `v` is a string to the statements after it. Once that function
  // doesn't, the call is cut short where it is checked, and `v` is unknown.
  const hoisted = `declare function pick<T>(fn: (r: { x: string }) => T): T;
function early() { return v.length; }
var v = pick((r) => r.x, 1);
v.foo;
`;
  for (const text of [hoisted, hoisted.replace('v.length', '1'), hoisted, hoisted.replace('v.foo', 'v.fooo'), hoisted.replace('return v.length', 'return v.lengthh')]) {
    files.set('/user.ts', text);
    same('hoisted', files, { roots: ['/user.ts'] }, cache);
  }
  assert.deepEqual(check(new Map([['/user.ts', hoisted]])).map((d) => d.code), [2554, 2339]);
  assert.deepEqual(check(new Map([['/user.ts', hoisted.replace('v.length', '1')]])).map((d) => d.code), [2554]);
});

test("what a statement reads through another's results: the names that statement used", () => {
  // `rows.map` reads the call `makeRows()` resolved while `const rows` was checked; that call read `Row`.
  const user = `function makeRows(): Row[] { return []; }
interface Row { id: number }
const rows = makeRows();
rows.map((r) => r.idd);
const first = rows[0];
`;
  const files = new Map([['/user.ts', user]]);
  const cache = checkCache();
  const steps = [user, user.replace('{ id: number }', '{ idd: number }'), user, user.replace('(): Row[]', '(): number[]'), user, `// moved\n${user}`];
  for (const text of steps) {
    files.set('/user.ts', text);
    same('reads', files, { roots: ['/user.ts'] }, cache);
  }
  assert.equal(check(files, { roots: ['/user.ts'] }).length, 1);
});

test('a declare module block in the root, and a root that imports itself: the whole file checked again', () => {
  const box = `export class Box { size = 1; }\n`;
  const user = `import { Box } from './box.js';
new Box().extra();
new Box().size;
`;
  const files = new Map([['/box.ts', box], ['/user.ts', user]]);
  const cache = checkCache();
  const options = { roots: ['/user.ts'] };
  const augmented = `${user}declare module './box.js' { interface Box { extra(): number } }\n`;
  for (const text of [user, augmented, augmented.replace('extra()', 'extras()'), user, augmented]) {
    files.set('/user.ts', text);
    same('augmented', files, options, cache);
  }
  assert.deepEqual(check(new Map([['/box.ts', box], ['/user.ts', augmented]]), options), []);
  // `me.thing` reads this file's own exports.
  const self = `import * as me from './user.js';
me.thing.foo;
export const thing = { bar: 1 };
`;
  for (const text of [self, self.replace('bar', 'foo'), self, self.replace('me.thing.foo', 'me.thing.fooo')]) {
    files.set('/user.ts', text);
    same('itself', files, options, cache);
  }
  assert.equal(check(new Map([['/user.ts', self]]), options).length, 1);
  // The globals module is the root itself.
  for (const text of [`thing.foo;\nexport const thing = { bar: 1 };\n`, `thing.foo;\nexport const thing = { foo: 1 };\n`]) {
    files.set('/user.ts', text);
    same('globals', files, { ...options, globals: ['/user.ts'] }, cache);
  }
});
