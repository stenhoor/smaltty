// The stripper: on every erasable corpus file, its output is the program TypeScript's own type removal gives, with
// every line and column where it was. Non-erasable files are refused with a SyntaxError.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strip, transpile, ParseError } from 'smaltty';
import smaltty from 'smaltty';
import { corpusFiles, generatedFiles } from '../bench/corpus.ts';
import { firstLineDifference, programLines, typescriptStrip } from './js.ts';

const lineBreaks = (s: string): number[] => [...s.matchAll(/\r\n?|\n|\u2028|\u2029/g)].map((m) => m.index!);

for (const f of [...corpusFiles(), ...generatedFiles()]) {
  if (!f.erasable) {
    test(`${f.name}: refused, with where`, () => {
      assert.throws(() => strip(f.text, { fileName: f.name }), (e: unknown) => e instanceof ParseError && /line \d+, column \d+: .*can't be stripped/.test(e.message));
    });
    continue;
  }
  test(`${f.name}: the same program as TypeScript's, every position kept`, () => {
    const js = strip(f.text, { fileName: f.name });
    assert.equal(js.length, f.text.length);
    assert.deepEqual(lineBreaks(js), lineBreaks(f.text));
    const diff = firstLineDifference(programLines(typescriptStrip(f.text)), programLines(js));
    assert.equal(diff, null, diff ?? '');
  });
}

test('the Transpiler shape', () => {
  assert.equal(smaltty.name, 'smaltty');
  assert.equal(transpile('const n: number = 2;\ntable(n)', { filename: 'tab.ts' }), 'const n         = 2;\ntable(n)');
  assert.throws(() => transpile('const n = 2;\ntable(n;', { filename: 'tab.ts' }), /^SyntaxError: tab\.ts, line 2, column 8: /);
  assert.throws(() => transpile('<div/>', { jsx: true }), /JSX is not supported/);
});
