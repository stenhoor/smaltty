// The binder agrees with TypeScript's checker (one file, no lib, no module resolution, as smaltnb used it) on every
// name it binds: the corpus, TypeScript's and Node's declarations, and TypeScript's own compiler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { bind, parse, K, Meaning } from 'smaltty';
import { corpusFiles, generatedFiles } from '../bench/corpus.ts';
import { bindingSweep, compareBindings } from './binding.ts';

/** Identifiers the binder leaves alone, by their parent: names that aren't names in a scope (TypeScript's kind names). */
const NOT_SCOPE_NAMES = new Set([
  'PropertyAccessExpression', 'PropertyAssignment', 'PropertySignature', 'PropertyDeclaration', 'MethodDeclaration',
  'MethodSignature', 'GetAccessor', 'SetAccessor', 'NamedTupleMember', 'ImportSpecifier', 'ExportSpecifier',
  'BindingElement', 'MetaProperty', 'LabeledStatement', 'BreakStatement', 'ContinueStatement', 'ImportAttribute',
  'FirstNode' /* QualifiedName */, 'LastTypeNode' /* ImportType */,
]);

const skippedOk = (skipped: Map<string, number>) => [...skipped.keys()].filter((k) => !NOT_SCOPE_NAMES.has(k));

for (const f of [...corpusFiles(), ...generatedFiles()]) {
  test(`${f.name}: every name binds as TypeScript's checker says`, () => {
    const r = compareBindings(f.name, f.text);
    assert.deepEqual(r.differences.slice(0, 5), []);
    assert.deepEqual(skippedOk(r.skipped), []);
    assert.ok(r.compared > 0);
  });
}

const require = createRequire(import.meta.url);
const tsLib = dirname(require.resolve('typescript/lib/typescript.js'));
const nodeTypes = dirname(require.resolve('@types/node/package.json'));

for (const [name, paths] of [
  ['TypeScript and Node declarations', [...readdirSync(tsLib).filter((f) => f.endsWith('.d.ts')).map((f) => join(tsLib, f)), nodeTypes]],
  ["TypeScript's compiler (typescript.js)", [join(tsLib, 'typescript.js')]],
] as const) {
  test(`${name}: every name binds as TypeScript's checker says`, () => {
    const r = bindingSweep([...paths]);
    assert.ok(r.compared > 10000, String(r.compared));
    assert.deepEqual(r.failures.slice(0, 2), []);
    assert.deepEqual(skippedOk(r.skipped), []);
  });
}

test('the API: declarations, references, meanings', () => {
  const text = 'interface T { a: number }\nconst T = 1;\nfunction f<T>(x: T): typeof T { const y = x; return y as never }\nlet z: T = { a: T };';
  const tree = parse(text);
  const b = bind(tree);
  const ids = (name: string) => {
    const out: number[] = [];
    for (let n = 1; n < tree.count; n++) if (tree.kind[n] === K.Identifier && tree.textOf(n) === name) out.push(n);
    return out;
  };
  const [tInterface, tConst, tParam, tParamUse, tTypeof, tAnnotation, tValue] = ids('T');
  // The interface and the const merge into one symbol; the type parameter is another.
  assert.equal(b.declaration(tInterface!), tInterface);
  assert.equal(b.declaration(tConst!), tInterface);
  assert.equal(b.symbol(tInterface!)!.meaning, Meaning.Type | Meaning.Value);
  assert.equal(b.declaration(tParamUse!), tParam, '`x: T` is the type parameter');
  assert.equal(b.meaningOf[tParamUse!], Meaning.Type);
  assert.equal(b.declaration(tTypeof!), tInterface, '`typeof T` is a value: the const, not the type parameter');
  assert.equal(b.meaningOf[tTypeof!], Meaning.Value);
  assert.equal(b.declaration(tAnnotation!), tInterface);
  assert.equal(b.declaration(tValue!), tInterface);
  const [, yUse] = ids('y');
  assert.equal(tree.textOf(b.declaration(yUse!)), 'y');
  // `a` in `{ a: T }` is a property name: not bound.
  const a = ids('a')[1]!;
  assert.equal(b.symbolOf[a], 0);
  assert.equal(b.meaningOf[a], 0);
});
