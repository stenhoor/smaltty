// The entry points (milestone 10): `smaltty/strip`, `smaltty/bind` and `smaltty/check` export what they say, the same
// values as `smaltty`, and load only their own modules: a page that strips loads none of the binder's or the
// checker's. The modules loaded are recorded by a resolve hook in a fresh process, so this is the module graph Node
// really loads, not what the exports list says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as all from 'smaltty';
import smaltty from 'smaltty';
import * as stripEntry from 'smaltty/strip';
import stripTranspiler from 'smaltty/strip';
import * as bindEntry from 'smaltty/bind';
import * as checkEntry from 'smaltty/check';

/** The files of smaltty's dist/ that importing `specifier` loads, in a fresh process. */
function loaded(specifier: string): string[] {
  const code = `
    import { registerHooks } from 'node:module';
    const urls = new Set();
    registerHooks({ resolve(s, c, next) { const r = next(s, c); urls.add(r.url); return r; } });
    await import(${JSON.stringify(specifier)});
    console.log(JSON.stringify([...urls].filter((u) => u.includes('/dist/')).map((u) => u.slice(u.lastIndexOf('/') + 1)).sort()));`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', cwd: import.meta.dirname }));
}

test('smaltty/strip loads the scanner, parser and stripper, and nothing of the binder or the checker', () => {
  assert.deepEqual(loaded('smaltty/strip'), ['entry-strip.js', 'kinds.js', 'parser.js', 'scanner.js', 'strip.js', 'tokens.js', 'tree.js']);
});

test('smaltty/bind loads the binder and the node kinds only', () => {
  assert.deepEqual(loaded('smaltty/bind'), ['binder.js', 'entry-bind.js', 'kinds.js']);
});

test('smaltty/check loads the checker, binder, built-in types and parser, and not the stripper', () => {
  assert.deepEqual(loaded('smaltty/check'), ['binder.js', 'builtins.js', 'checker.js', 'entry-check.js', 'kinds.js', 'parser.js', 'scanner.js', 'tokens.js', 'tree.js']);
});

test('smaltty still loads and exports everything', () => {
  assert.deepEqual(loaded('smaltty'), ['binder.js', 'builtins.js', 'checker.js', 'entry-strip.js', 'index.js', 'kinds.js', 'parser.js', 'scanner.js', 'strip.js', 'tokens.js', 'tree.js']);
  const names = Object.keys(all).sort();
  assert.deepEqual(names, ['Bindings', 'F', 'K', 'KIND_NAMES', 'Meaning', 'ParseError', 'Tree', 'VERSION', 'bind', 'check', 'checkCache', 'default', 'expectations', 'isTypeNode', 'parse', 'strip', 'transpile']);
  // Every value an entry point exports is smaltty's own, the same object: a tree from one is a tree to the other.
  for (const entry of [stripEntry, bindEntry, checkEntry]) {
    for (const [name, value] of Object.entries(entry)) assert.equal(value, (all as Record<string, unknown>)[name], name);
  }
});

test('smaltty/strip: the stripper, the parser and the tree', () => {
  assert.deepEqual(Object.keys(stripEntry).sort(), ['F', 'K', 'KIND_NAMES', 'ParseError', 'Tree', 'VERSION', 'default', 'isTypeNode', 'parse', 'strip', 'transpile']);
  assert.equal(stripEntry.strip('let a: number = 1;'), 'let a         = 1;');
  assert.equal(stripTranspiler, smaltty);
  assert.equal(stripTranspiler.name, 'smaltty');
  assert.equal(stripTranspiler.transpile('const s = (x as string);'), 'const s = (x          );');
  const tree = stripEntry.parse('type T = number;');
  assert.ok(tree instanceof stripEntry.Tree);
  assert.ok(stripEntry.isTypeNode(tree.kind[tree.children(tree.children(tree.root)[0]!).at(-1)!]!));
  assert.throws(() => stripEntry.strip('enum E { A }'), stripEntry.ParseError);
});

test('the version is the package version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  assert.equal(stripEntry.VERSION, pkg.version);
  assert.equal(smaltty.version, pkg.version);
});

test('smaltty/bind: the binder, on a tree from smaltty/strip', () => {
  assert.deepEqual(Object.keys(bindEntry).sort(), ['Bindings', 'Meaning', 'bind']);
  const tree = stripEntry.parse('const total = 1;\ntotal + 1;');
  const b = bindEntry.bind(tree);
  assert.ok(b instanceof bindEntry.Bindings);
  const ids: number[] = [];
  for (let n = 1; n < tree.count; n++) if (tree.kind[n] === stripEntry.K.Identifier) ids.push(n);
  assert.equal(ids.length, 2);
  assert.equal(b.symbolOf[ids[0]!], b.symbolOf[ids[1]!]);
  assert.equal(b.symbols[b.symbolOf[ids[0]!]! - 1]!.meaning & bindEntry.Meaning.Value, bindEntry.Meaning.Value);
});

test('smaltty/check: the checker, with a cache, and the binder', () => {
  assert.deepEqual(Object.keys(checkEntry).sort(), ['Bindings', 'Meaning', 'bind', 'check', 'checkCache', 'expectations']);
  const files = new Map([
    ['/lib.d.ts', 'export declare function total(xs: number[]): number;\n'],
    ['/code.ts', "import { total } from 'lib';\ntotal([1, 2]).toFixd(2);\n"],
  ]);
  const options = { roots: ['/code.ts'], packages: { lib: '/lib.d.ts' }, cache: checkEntry.checkCache() };
  const [d, ...rest] = checkEntry.check(files, options);
  assert.equal(rest.length, 0);
  assert.equal(d!.code, 2551);
  assert.match(d!.message, /Property 'toFixd' does not exist on type 'number'\. Did you mean 'toFixed'\?/);
  files.set('/code.ts', "import { total } from 'lib';\ntotal([1, 2]).toFixed(2);\n");
  assert.deepEqual(checkEntry.check(files, options), []);
});
