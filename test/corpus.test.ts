// The corpus is valid input: every file parses with TypeScript, the erasable flag matches what TypeScript's
// erasableSyntaxOnly reports, sucrase strips every file, and the generated scripts are stable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { transform } from 'sucrase';
import { corpusFiles, generatedFiles, generatedScript } from '../bench/corpus.ts';

const files = [...corpusFiles(), ...generatedFiles()];

/** TypeScript's diagnostics for code that isn't erasable (TS1294). */
function erasableErrors(name: string, text: string): string[] {
  const host = ts.createCompilerHost({});
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  host.getSourceFile = (f) => (f === name ? sf : undefined);
  host.fileExists = (f) => f === name;
  const program = ts.createProgram([name], { noLib: true, noResolve: true, types: [], erasableSyntaxOnly: true, noEmit: true }, host);
  return program.getSemanticDiagnostics(sf).filter((d) => d.code === 1294).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

test('the corpus has every group', () => {
  for (const g of ['apps', 'libs', 'edge', 'generated']) assert.ok(files.some((f) => f.group === g), g);
});

for (const f of files) {
  test(`${f.name}: parses with TypeScript`, () => {
    const sf = ts.createSourceFile(f.name, f.text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const errors = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
    assert.deepEqual(errors.map((d) => `${d.start}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`), []);
  });

  test(`${f.name}: ${f.erasable ? 'erasable' : 'not erasable'}`, () => {
    assert.equal(erasableErrors(f.name, f.text).length === 0, f.erasable);
  });

  test(`${f.name}: sucrase ${f.sucrase ? 'strips it' : 'rejects it'}`, () => {
    const strip = () => transform(f.text, { transforms: ['typescript'], disableESTransforms: true });
    if (f.sucrase) assert.doesNotThrow(strip);
    else assert.throws(strip, SyntaxError);
  });
}

test('generated scripts are the same every time and about the size asked for', () => {
  assert.equal(generatedScript(40_000), generatedScript(40_000));
  const n = generatedScript(40_000).length;
  assert.ok(n >= 40_000 && n < 42_000, String(n));
});
