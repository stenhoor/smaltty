// Checking through syntax errors (milestone 13): with `syntax: 'tolerant'`, a syntax error is kept to the top-level
// statement it is in, which is reported, and the rest of the file is checked.
//
// The done-when: the checker tests' mutants (smaltts's examples, smaltdf's API in the apps, the notebooks and generated
// scripts, smaltui's tabs), each with a syntax error added to one statement, of several kinds. For each:
//
// - the syntax error is reported, in the statement broken or at the token right after it (where tsc reports a missing
//   token too);
// - the other statements' errors are exactly smaltty's on the same file with the broken statement removed (blanked,
//   so every offset is the same): the comparison that holds for every error, as smaltty doesn't yet catch all of
//   tsc's (milestone 14), and a cold check of a file with no syntax error is what the other checker tests hold to tsc;
// - and none of them is a false error: each is one TypeScript 7 reports on the file with the statement removed.
//
// With the option off, check() is what it was: a root with a syntax error has no errors, and a file with one declares
// nothing (the other test files run with it off and are unchanged).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { K, ParseError, check, checkCache, parse, prepare, type CheckCache, type CheckOptions, type Diagnostic } from 'smaltty';
import { CHECKED_CODES, DF_PACKAGES, globalsDeclaration, libsCorpus, mutants, smalttsCorpus, typescript7Checks } from './checking.ts';
import { generatedScript } from '../bench/corpus.ts';

const TOLERANT: CheckOptions = { syntax: 'tolerant' };
const smaltts = smalttsCorpus();
const smalttsSrc = new Map([...smaltts].filter(([f]) => f.startsWith('/src/')));
const { smaltdf } = libsCorpus();
const apps = new URL('../corpus/apps/', import.meta.url);
const app = (f: string) => readFileSync(new URL(f, apps), 'utf8');
const withGlobals = new Map([...smaltdf, ['/globals.d.ts', globalsDeclaration(smaltdf, '@smaltdb/df', '/df/index.ts')]]);

/** The kinds of syntax error added: what an editor has while a line is half typed. */
const KINDS = ['paren', 'brace', 'stray', 'member', 'arrow', 'string', 'template', 'keyword'] as const;
type Kind = (typeof KINDS)[number];

interface Broken {
  /** The file with the syntax error. */
  text: string;
  /** The same file with the broken statement blanked: what it would be without it, at the same offsets. */
  without: string;
  /** Where the broken statement is in `text`, and where the statement after it starts. */
  start: number;
  end: number;
  after: number;
}

/** `text` with a syntax error of `kind` in its top-level statement `index`, or undefined where that kind can't be made there. */
function breakStatement(text: string, index: number, kind: Kind): Broken | undefined {
  let t;
  try {
    t = parse(text);
  } catch {
    return undefined; // a mutant that doesn't parse
  }
  const statements = t.children(t.root);
  const s = statements[index];
  if (s === undefined) return undefined;
  const start = t.start[s]!;
  const end = t.end[s]!;
  const nextStart = statements[index + 1] === undefined ? text.length : t.start[statements[index + 1]!]!;
  const last = (kinds: readonly number[]): number | undefined => {
    let found: number | undefined;
    t.walk(s, (n) => {
      if (kinds.includes(t.kind[n]!)) found = n;
    });
    if (kinds.includes(t.kind[s]!) && found === undefined) found = s;
    return found;
  };
  let edit: [number, number, string] | undefined;
  switch (kind) {
    case 'paren': {
      const n = last([K.CallExpression]);
      if (n !== undefined && text[t.end[n]! - 1] === ')') edit = [t.end[n]! - 1, t.end[n]!, ''];
      break;
    }
    case 'brace': {
      const n = last([K.Block, K.ObjectLiteralExpression, K.ClassDeclaration, K.InterfaceDeclaration, K.TypeLiteral, K.NamedImports]);
      if (n !== undefined && text[t.end[n]! - 1] === '}') edit = [t.end[n]! - 1, t.end[n]!, ''];
      break;
    }
    case 'stray': {
      const at = text[end - 1] === ';' ? end - 1 : end;
      edit = [at, at, ' ]'];
      break;
    }
    case 'member': {
      // Half typed: `x.` and the rest of the statement gone.
      const n = last([K.PropertyAccessExpression]);
      if (n !== undefined) edit = [t.start[t.next[t.first[n]!]!]!, end, ''];
      break;
    }
    case 'arrow': {
      const n = last([K.ArrowFunction]);
      if (n !== undefined) {
        const body = t.children(n).at(-1)!;
        edit = [t.start[body]!, t.end[body]!, ''];
      }
      break;
    }
    case 'string': {
      const eol = text.indexOf('\n', start);
      const at = eol < 0 || eol > end ? end : eol;
      edit = [at, at, " 'unclosed"];
      break;
    }
    case 'template': {
      // Not closed: a backtick later in the file would close it, and the statements in between be its text, as in
      // TypeScript.
      if (text.indexOf('`', end) >= 0) break;
      const at = text[end - 1] === ';' ? end - 1 : end;
      edit = [at, at, ' `unclosed'];
      break;
    }
    case 'keyword':
      edit = [start, start, 'const = '];
      break;
  }
  if (edit === undefined) return undefined;
  const [from, to, insert] = edit;
  const broken = text.slice(0, from) + insert + text.slice(to);
  try {
    parse(broken);
    return undefined; // still parses: not a syntax error
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
  }
  const delta = insert.length - (to - from);
  const without = broken.slice(0, start) + broken.slice(start, end + delta).replace(/[^\r\n]/g, ' ') + broken.slice(end + delta);
  return { text: broken, without, start, end: end + delta, after: nextStart + delta };
}

interface Workload {
  label: string;
  libs: Map<string, string>;
  sources: [string, string][];
  options: CheckOptions;
}

function workloads(): Workload[] {
  return [
    { label: "smaltts's examples", libs: smalttsSrc, sources: [...smaltts].filter(([f]) => f.startsWith('/examples/')), options: {} },
    {
      label: "smaltdf's API: the apps, the notebooks and a generated script",
      libs: smaltdf,
      sources: [
        ...['smaltui-demo-frames.ts', 'smaltui-starter.ts', 'smaltnb-regional.nb.ts', 'smaltnb-shop.nb.ts'].map((f) => [`/apps/${f}`, app(f)] as [string, string]),
        ['/gen/small.ts', generatedScript(6_000)],
      ],
      options: { packages: DF_PACKAGES },
    },
    {
      label: "smaltui's tabs, smaltdf's exports as globals",
      libs: withGlobals,
      sources: ['smaltui-demo-frames.ts', 'smaltui-starter.ts'].map((f) => [`/tabs/${f}`, app(f)] as [string, string]),
      options: { packages: DF_PACKAGES, globals: ['@smaltdb/df'] },
    },
  ];
}

const key = (d: { file: string; start: number; code: number }) => `${d.file}:${d.start}:${d.code}`;
const isSyntax = (d: Diagnostic) => d.code < 2000;

for (const w of workloads()) {
  test(`${w.label}, mutated, a syntax error in one statement: reported, and the rest checked as without it`, () => {
    const broken = new Map<string, Broken>();
    let n = 0;
    for (const [name, text] of w.sources) {
      const count = parse(text).children(parse(text).root).length;
      for (const [m, mt] of [[name, text] as [string, string], ...mutants(name, text)]) {
        // A statement and a kind for each mutant, in turn; the next kind where one can't be made there.
        for (let k = 0; k < KINDS.length; k++) {
          const kind = KINDS[(n + k) % KINDS.length]!;
          const b = breakStatement(mt, (n * 7) % count, kind);
          if (b === undefined) continue;
          broken.set(`${m.slice(0, -3)}.${kind}.ts`, b);
          break;
        }
        n++;
      }
    }
    const roots = [...broken.keys()];
    const tolerant = check(new Map([...w.libs, ...[...broken].map(([f, b]) => [f, b.text] as [string, string])]), { ...w.options, ...TOLERANT, roots });
    const withoutFiles = new Map([...w.libs, ...[...broken].map(([f, b]) => [f, b.without] as [string, string])]);
    const cold = check(withoutFiles, { ...w.options, roots });
    // With the option off, as before: a root with a syntax error has no errors.
    assert.deepEqual(check(new Map([...w.libs, ...[...broken].map(([f, b]) => [f, b.text] as [string, string])]), { ...w.options, roots }), []);
    const byFile = (ds: readonly Diagnostic[]) => {
      const m = new Map<string, Diagnostic[]>();
      for (const d of ds) m.set(d.file, [...(m.get(d.file) ?? []), d]);
      return m;
    };
    const got = byFile(tolerant);
    const want = byFile(cold);
    const kinds = new Map<string, number>();
    for (const [f, b] of broken) {
      const mine = got.get(f) ?? [];
      const syntax = mine.filter(isSyntax);
      assert.ok(syntax.length >= 1, `${f}: no syntax error reported`);
      // The first is the broken statement's: in it, or at the token right after it.
      const first = syntax[0]!;
      assert.ok(first.start >= b.start && first.start <= b.after, `${f}: the syntax error at ${first.start}, the statement at ${b.start}-${b.end} (next at ${b.after}): ${first.message}`);
      assert.ok(first.message.length > 0 && first.code >= 1000 && first.code < 2000, `${f}: ${first.code} ${first.message}`);
      // The rest: exactly the errors of the file without the broken statement.
      assert.deepEqual(mine.filter((d) => !isSyntax(d)), want.get(f) ?? [], f);
      // Only the statement broken is set aside: one syntax error.
      assert.equal(syntax.length, 1, `${f}: ${syntax.map((d) => `${d.start} ${d.message}`).join('; ')}`);
      const kind = f.split('.').at(-2)!;
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }
    // No false errors: each is TypeScript 7's on the file without the broken statement.
    const tsc = typescript7Checks(withoutFiles, { roots, packages: w.options.packages ?? {} });
    assert.deepEqual(tsc.skipped, []);
    const tscKeys = new Set(tsc.errors.filter((d) => CHECKED_CODES.has(d.code)).map(key));
    assert.deepEqual(tolerant.filter((d) => !isSyntax(d) && !tscKeys.has(key(d))).map((d) => `${d.file}:${d.start} ${d.code} ${d.message}`), []);
    const semantic = tolerant.filter((d) => !isSyntax(d)).length;
    console.log(`# ${w.label}: ${roots.length} files with a syntax error (${[...kinds].map(([k, c]) => `${k} ${c}`).join(', ')}): ${semantic} other errors, the same as without the statement, all TypeScript 7's`);
    for (const kind of KINDS) assert.ok((kinds.get(kind) ?? 0) > 0 || w.sources.length < 3, `no ${kind}`);
  });
}

test('the syntax error: where and what, by kind', () => {
  const at = (text: string) => check(new Map([['/a.ts', text]]), TOLERANT).map((d) => [text.slice(0, d.start).split('\n').length, d.code, d.message]);
  // Unclosed paren: tsc's place, the token after it.
  assert.deepEqual(at('const a = 1;\nfoo(1, 2\nconst b = 2;\n'), [[3, 1005, "',' expected, found 'const'."]]);
  // Unclosed brace: the function set aside up to the next line that starts a statement.
  assert.deepEqual(at('function f() {\n  a();\n\nconst y = 1;\n'), [[2, 1005, "'}' expected."]]);
  // Half-typed member access: at the end of the line, as tsc.
  assert.deepEqual(at('const x = obj.\nconst y = 2;\n'), [[1, 1003, 'A name expected, found the end of the line.']]);
  // Strings and templates not closed: the rest of the file isn't swallowed.
  assert.deepEqual(at('const s = `abc\nconst y = 2;\n'), [[1, 1160, 'The template literal is not closed.']]);
  assert.deepEqual(at("const s = 'abc\nconst y = 2;\n"), [[1, 1002, 'The string is not closed.']]);
  assert.deepEqual(at('/* open\nconst y = 1;\n'), [[1, 1010, 'The comment is not closed: */ expected.']]);
  // Several: each its own.
  assert.deepEqual(at('a(); b(;\nc();\nd(];\ne();\n'), [[1, 1109, "An expression expected, found ';'."], [3, 1109, "An expression expected, found ']'."]]);
  // A code TypeScript has no single one for: 1000.
  assert.deepEqual(at('type T = { a: number = 1 };\n'), [[1, 1000, 'A type member cannot have an initializer.']]);
  // Syntax TypeScript accepts that smaltty's parser doesn't: set aside, not reported.
  assert.deepEqual(at('@dec class A {}\nconst y = 1;\n'), []);
});

const lib = `export class Point { constructor(readonly x: number, readonly y: number) {} norm(): number { return 0; } }
export function make(x: number, y: number): Point { return new Point(x, y); }
`;

test('the other statements are checked; what the broken statement declared is unknown and quiet', () => {
  const user = `import { make, Point } from './lib.js';
const p = make(1, 2);
p.nrom();
const q = make(1, 2
const r = q.whatever.more(1, 2, 3);
function g(a: Point) { return a.z; }
q.anything;
`;
  const files = new Map([['/lib.ts', lib], ['/user.ts', user]]);
  const d = check(files, { ...TOLERANT, roots: ['/user.ts'] });
  assert.deepEqual(d.map((x) => [x.code, x.message]), [
    [1005, "',' expected, found 'const'."],
    [2339, "Property 'nrom' does not exist on type 'Point'."],
    [2339, "Property 'z' does not exist on type 'Point'."],
  ]);
  // Off: nothing, as before.
  assert.deepEqual(check(files, { roots: ['/user.ts'] }), []);
  // A library with a syntax error: declares nothing with it off, its other declarations with it on.
  const broken = new Map([['/lib.ts', `${lib}export const half = make(1,\n`], ['/user.ts', `import { make, half } from './lib.js';\nmake(1, 2).nrom();\nhalf.anything;\n`]]);
  assert.deepEqual(check(broken, { roots: ['/user.ts'] }), []);
  assert.deepEqual(check(broken, { ...TOLERANT, roots: ['/user.ts'] }).map((x) => x.code), [2339]);
  // Its syntax errors are reported where it is a root.
  assert.deepEqual(check(broken, TOLERANT).map((x) => [x.file, x.code]), [['/lib.ts', 1109], ['/user.ts', 2339]]);
});

test('@ts-nocheck and @ts-expect-error: a syntax error is still reported, as tsc does', () => {
  assert.deepEqual(check(new Map([['/a.ts', '// @ts-nocheck\nfoo(;\n']]), TOLERANT).map((d) => d.code), [1109]);
  assert.deepEqual(check(new Map([['/a.ts', '// @ts-expect-error\nfoo(;\n']]), TOLERANT).map((d) => d.code), [1109]);
});

test('a notebook: a cell half typed is set aside, the other cells are checked', () => {
  const nb = app('smaltnb-shop.nb.ts').replace(".alias('revenue')", ".alia('revenue')");
  const files = (text: string) => new Map([...smaltdf, ['/apps/nb.ts', text]]);
  const options = { packages: DF_PACKAGES, roots: ['/apps/nb.ts'] };
  const before = check(files(nb), options);
  assert.deepEqual(before.map((d) => d.code), [2551]);
  // Cells after the error, half typed: a call not closed, a cell's call not closed.
  for (const typing of [nb.replace('\nbyRegion;', '\nbyRegion.filter(;'), nb.replace("cell('byRegion', { lang: 'sql' });", "cell('byRegion', { lang: 'sql' ")]) {
    assert.throws(() => parse(typing), ParseError);
    assert.deepEqual(check(files(typing), options), []); // off: as before
    const d = check(files(typing), { ...options, ...TOLERANT });
    assert.equal(d.filter(isSyntax).length, 1);
    assert.deepEqual(d.filter((x) => !isSyntax(x)), before);
  }
});

/** Checks with the cache and cold, and requires the same errors. */
function same(label: string, files: ReadonlyMap<string, string>, options: CheckOptions, cache: CheckCache): Diagnostic[] {
  const cold = check(files, options);
  const warm = check(files, { ...options, cache });
  assert.deepEqual(warm, cold, label);
  return cold;
}

test('with the per-statement cache: a syntax error made and fixed, the same errors as a cold check', () => {
  const sources: [string, Map<string, string>, CheckOptions][] = [
    ['/apps/smaltnb-shop.nb.ts', smaltdf, { packages: DF_PACKAGES }],
    ['/apps/smaltui-demo-frames.ts', smaltdf, { packages: DF_PACKAGES }],
    ['/gen/small.ts', smaltdf, { packages: DF_PACKAGES }],
  ];
  for (const [root, libs, base] of sources) {
    const original = root.startsWith('/gen/') ? generatedScript(6_000) : app(root.slice('/apps/'.length));
    const variants = mutants(root, original).slice(0, 2).map(([, m]) => m);
    for (const text of [original, ...variants]) {
      const cache = checkCache();
      const files = new Map([...libs, [root, text]]);
      const options: CheckOptions = { ...base, ...TOLERANT, roots: [root] };
      const clean = same(`${root}: clean`, files, options, cache);
      let reused = 0;
      const kept = () => (reused += cache.statements!.get(root)!.reused);
      const count = parse(text).children(parse(text).root).length;
      for (const [i, kind] of KINDS.entries()) {
        const b = breakStatement(text, (i * 5 + 1) % count, kind);
        if (b === undefined) continue;
        files.set(root, b.text);
        same(`${root}: ${kind} made`, files, options, cache);
        kept();
        // Strict, then tolerant again, with the same cache: each as cold.
        same(`${root}: ${kind}, strict`, files, { ...options, syntax: 'strict' }, cache);
        same(`${root}: ${kind} again`, files, options, cache);
        files.set(root, text);
        assert.deepEqual(same(`${root}: ${kind} fixed`, files, options, cache), clean);
        kept();
      }
      // The cache did keep statements' results across the edits.
      assert.ok(reused > 0, root);
    }
  }
});

test('the cache: a declaration in a broken statement, then fixed, is read again by the statements that use it', () => {
  const cache = checkCache();
  const text = (decl: string) => `import { make } from './lib.js';\n${decl}\np.nrom();\nconst other = make(1, 2);\nother.norm();\n`;
  const files = new Map([['/lib.ts', lib], ['/user.ts', text('const p = make(1, 2')]]);
  const options: CheckOptions = { ...TOLERANT, roots: ['/user.ts'] };
  assert.deepEqual(same('broken', files, options, cache).map((d) => d.code), [1005]);
  files.set('/user.ts', text('const p = make(1, 2);'));
  assert.deepEqual(same('fixed', files, options, cache).map((d) => d.code), [2339]);
  assert.ok(cache.statements!.get('/user.ts')!.reused > 0);
  files.set('/user.ts', text('const p = make(1, 2'));
  assert.deepEqual(same('broken again', files, options, cache).map((d) => d.code), [1005]);
});

test('with prepared declarations: the same errors as with the libraries as text', () => {
  const libs = new Map(smaltdf);
  const prepared = prepare(libs);
  for (const f of ['smaltnb-shop.nb.ts', 'smaltui-demo-frames.ts']) {
    const root = `/apps/${f}`;
    for (const [, m] of mutants(root, app(f)).slice(0, 20)) {
      const b = breakStatement(m, 2, 'paren') ?? breakStatement(m, 2, 'stray')!;
      const options: CheckOptions = { packages: DF_PACKAGES, ...TOLERANT, roots: [root] };
      const text = check(new Map([...libs, [root, b.text]]), options);
      assert.deepEqual(check(new Map([[root, b.text]]), { ...options, prepared }), text);
      assert.equal(text.filter(isSyntax).length, 1);
    }
  }
});

test('the strict parse is unchanged: it throws, and check() off reads a broken file as before', () => {
  assert.throws(() => parse('foo(;'), ParseError);
  const files = new Map([['/a.ts', 'foo(;']]);
  assert.deepEqual(check(files), []);
  assert.deepEqual(check(files, { syntax: 'strict' }), []);
});
