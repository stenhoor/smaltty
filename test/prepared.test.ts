// Prepared declarations (milestone 11): prepare() writes files' trees and names as one buffer, and check() reads them in
// place of the text. A prepared check finds exactly the errors a check of the text finds, on the checker tests' own
// workloads and mutants (smaltts, smaltdf, smaltui's tabs). A buffer this smaltty can't read (another format or
// version, cut short, changed) is ignored, never read: check() then reads the text it is given, and without the text
// the files are unknown and quiet, so a stale buffer never gives a wrong answer (ADR 0030, decision 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bind, check, checkCache, expectations, parse, prepare, readPrepared, PreparedFiles, PREPARED_FORMAT, VERSION, type CheckOptions } from 'smaltty';
import { declarationsOf, DF_PACKAGES, globalsDeclaration, libsCorpus, mutants, smalttsCorpus } from './checking.ts';
import { generatedScript } from '../bench/corpus.ts';

const smaltts = smalttsCorpus();
const { smaltdf, others } = libsCorpus();
const apps = new URL('../corpus/apps/', import.meta.url);
const app = (f: string) => readFileSync(new URL(f, apps), 'utf8');

/** The diagnostics of `roots`, with the libraries as text and then prepared (the roots stay text): both, to compare. */
function both(libs: ReadonlyMap<string, string>, code: ReadonlyMap<string, string>, options: CheckOptions = {}) {
  const roots = [...code.keys()];
  const text = check(new Map([...libs, ...code]), { ...options, roots });
  const prepared = check(new Map(code), { ...options, roots, prepared: prepare(libs) });
  return { text, prepared };
}

test('a prepared file reads back as the tree and bindings parsing its text gives', () => {
  const files = new Map([...smaltts, ...smaltdf, ...others, ...declarationsOf(smaltdf)]);
  files.set('/broken.ts', 'let = ;');
  const read = readPrepared(prepare(files))!;
  assert.ok(read instanceof PreparedFiles);
  assert.equal(read.version, VERSION);
  assert.deepEqual(read.paths, [...files.keys()]);
  for (const [path, text] of files) {
    assert.equal(read.text(path), text);
    const entry = read.entries.get(path)!;
    if (path === '/broken.ts') {
      assert.equal(entry.source(), null); // as check() takes a file that doesn't parse: it declares nothing
      continue;
    }
    const tree = parse(text, { fileName: path });
    const b = bind(tree);
    const got = entry.source()!;
    assert.equal(got.tree.count, tree.count, path);
    assert.equal(got.tree.root, tree.root, path);
    for (const k of ['kind', 'start', 'end', 'first', 'next', 'flags', 'data'] as const) assert.deepEqual([...got.tree[k]], [...tree[k].subarray(0, tree.count)], `${path} ${k}`);
    for (const k of ['symbolOf', 'meaningOf', 'parent'] as const) assert.deepEqual([...got.bindings[k]], [...b[k]], `${path} ${k}`);
    assert.deepEqual(got.bindings.symbols, b.symbols, path);
    assert.equal(got.tree.fileName, path);
    assert.equal(entry.source(), got, 'read once, then kept');
  }
  const buffer = prepare(files);
  assert.equal(readPrepared(buffer), readPrepared(buffer), 'a buffer is read once');
  assert.equal(readPrepared(read), read);
});

test("smaltts's examples, as written and mutated: the same errors from prepared declarations", () => {
  const libs = new Map([...smaltts].filter(([f]) => f.startsWith('/src/')));
  const code = new Map<string, string>();
  for (const [f, text] of smaltts) {
    if (!f.startsWith('/examples/')) continue;
    code.set(f, text);
    for (const [m, mt] of mutants(f, text)) code.set(m, mt);
  }
  const { text, prepared } = both(libs, code);
  assert.ok(text.length > 500, `${text.length} errors`);
  assert.deepEqual(prepared, text);
});

test("smaltdf's API in the apps and generated scripts, mutated: the same errors, from its source and its .d.ts", () => {
  const code = new Map<string, string>();
  for (const [name, text] of [['/apps/smaltui-demo-frames.ts', app('smaltui-demo-frames.ts')], ['/apps/smaltnb-shop.nb.ts', app('smaltnb-shop.nb.ts')], ['/gen/small.ts', generatedScript(6_000)]] as const) {
    code.set(name, text);
    for (const [m, mt] of mutants(name, text)) code.set(m, mt);
  }
  const fromSource = both(smaltdf, code, { packages: DF_PACKAGES });
  assert.ok(fromSource.text.length > 300, `${fromSource.text.length} errors`);
  assert.deepEqual(fromSource.prepared, fromSource.text);
  const dts = declarationsOf(smaltdf);
  const fromDts = both(dts, code, { packages: { '@smaltdb/df': '/df/index.d.ts' } });
  assert.ok(fromDts.text.length > 300, `${fromDts.text.length} errors`);
  assert.deepEqual(fromDts.prepared, fromDts.text);
});

test("smaltui's tabs: smaltdf's declarations as globals, prepared, as written and mutated", () => {
  const dts = declarationsOf(smaltdf);
  const libs = new Map([...dts, ['/globals.d.ts', globalsDeclaration(dts, '@smaltdb/df', '/df/index.d.ts')]]);
  const code = new Map<string, string>();
  for (const f of ['smaltui-demo-frames.ts', 'smaltui-starter.ts']) {
    code.set(`/tabs/${f}`, app(f));
    for (const [m, mt] of mutants(`/tabs/${f}`, app(f))) code.set(m, mt);
  }
  const options = { packages: { '@smaltdb/df': '/df/index.d.ts' }, globals: ['@smaltdb/df'] };
  const { text, prepared } = both(libs, code, options);
  assert.ok(text.length > 30, `${text.length} errors`);
  assert.deepEqual(prepared, text);
  // As smaltkit has them: a cache kept between checks, and the buffer read once.
  const files = readPrepared(prepare(libs))!;
  const cache = checkCache();
  for (const [path, source] of code) {
    const got = check(new Map([[path, source]]), { ...options, roots: [path], prepared: files, cache });
    assert.deepEqual(got, text.filter((d) => d.file === path), path);
  }
  // `// @ts-expect-error` lines: the same answers.
  const expect = new Map([['/tabs/e.ts', "// @ts-expect-error\ntable('t').hed(1);\n// @ts-expect-error\ntable('t').head(1);\n"]]);
  assert.deepEqual(expectations(expect, { ...options, prepared: prepare(libs) }), expectations(new Map([...libs, ...expect]), { ...options, roots: ['/tabs/e.ts'] }));
});

test('module augmentations in prepared files; a file in both is read from its text when the texts differ', () => {
  const box = 'export class Box { constructor(readonly size: number) {} }\n';
  const aug = "import { Box } from './box.js';\ndeclare module './box.js' { interface Box { extra(): number } }\n";
  const user = "import { Box } from './box.js';\nnew Box(1).extra();\nnew Box(1).sizes;\nnew Box(1).other;\n";
  const libs = new Map([['/box.ts', box], ['/aug.ts', aug]]);
  const { text, prepared } = both(libs, new Map([['/user.ts', user]]));
  assert.deepEqual(text.map((d) => d.code), [2551, 2339]);
  assert.deepEqual(prepared, text);
  // The same path given as text that differs from the buffer's: the text is the file.
  const box2 = "export class Box { constructor(readonly size: number) {} other = 'x'; }\n";
  const edited = check(new Map([['/box.ts', box2], ['/user.ts', user]]), { roots: ['/user.ts'], prepared: prepare(libs) });
  assert.deepEqual(edited.map((d) => d.code), [2551]);
  // And the same text: the prepared file is read, with the same answer.
  assert.deepEqual(check(new Map([['/box.ts', box], ['/user.ts', user]]), { roots: ['/user.ts'], prepared: prepare(libs) }), text);
});

/** A copy of a buffer with `change` made to it. */
function changed(buffer: Uint8Array, change: (b: Uint8Array, words: Int32Array) => void): Uint8Array {
  const copy = buffer.slice();
  change(copy, new Int32Array(copy.buffer));
  return copy;
}

test("a buffer this smaltty can't read is ignored, never read: the text is read instead", () => {
  const libs = new Map([...smaltdf]);
  const code = new Map([['/apps/m.ts', app('smaltnb-shop.nb.ts').replace(".alias('revenue')", ".alia('revenue')")]]);
  const options = { packages: DF_PACKAGES, roots: ['/apps/m.ts'] };
  const good = prepare(libs);
  const expected = check(new Map([...libs, ...code]), options);
  assert.equal(expected.length, 1);
  assert.deepEqual(check(code, { ...options, prepared: good }), expected);
  const versionAt = 32; // the version's bytes follow the header's eight words
  const stale: [string, Uint8Array][] = [
    ['another format', changed(good, (_, w) => (w[1] = PREPARED_FORMAT + 1))],
    ['another smaltty', changed(good, (b) => (b[versionAt] = '9'.charCodeAt(0)))],
    ['other node kinds', changed(good, (_, w) => (w[2] = w[2]! + 1))],
    ['cut short', good.slice(0, good.length - 64)],
    ['a byte changed', changed(good, (b) => (b[good.length >> 1] = b[good.length >> 1]! ^ 0x10))],
    ['empty', new Uint8Array(0)],
    ['not a buffer of ours', new TextEncoder().encode(JSON.stringify({ files: Object.fromEntries(libs) }).padEnd(4096))],
  ];
  for (const [what, buffer] of stale) {
    assert.equal(readPrepared(buffer), undefined, what);
    // With the text too: the text is read, and the answer is the text's.
    assert.deepEqual(check(new Map([...libs, ...code]), { ...options, prepared: buffer }), expected, what);
    // Without it: the library is unknown, so quiet, never a wrong error.
    assert.deepEqual(check(code, { ...options, prepared: buffer }), [], what);
  }
  // A buffer at an offset that isn't a word's (inside a larger one) still reads.
  const shifted = new Uint8Array(good.length + 1);
  shifted.set(good, 1);
  assert.ok(readPrepared(shifted.subarray(1)));
  assert.deepEqual(check(code, { ...options, prepared: shifted.subarray(1) }), expected);
  // An ArrayBuffer, as fetch() gives one.
  assert.deepEqual(check(code, { ...options, prepared: good.slice().buffer }), expected);
});

test('the built-in types are prepared when smaltty is built, and read from the buffer', async () => {
  const { BUILTINS_PREPARED } = (await import(new URL('../dist/builtins-prepared.js', import.meta.url).href)) as { BUILTINS_PREPARED: string | undefined };
  const { BUILTINS, BUILTINS_PATH } = (await import(new URL('../dist/builtins.js', import.meta.url).href)) as { BUILTINS: string; BUILTINS_PATH: string };
  assert.equal(typeof BUILTINS_PREPARED, 'string');
  const files = readPrepared(Buffer.from(BUILTINS_PREPARED!, 'base64'))!;
  assert.ok(files, "this smaltty's own buffer");
  assert.deepEqual(files.paths, [BUILTINS_PATH]);
  assert.equal(files.text(BUILTINS_PATH), BUILTINS);
  assert.deepEqual(check(new Map([['/a.ts', "[1].pussh(2);\n'a'.lenght;\n"]])).map((d) => d.code), [2551, 2551]);
});
