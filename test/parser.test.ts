// The parser's tree matches TypeScript's on the whole corpus: same nodes, same kinds, same start and end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, ParseError } from 'smaltty';
import { corpusFiles, generatedFiles } from '../bench/corpus.ts';
import { firstDifference, smalttyLines, typescriptLines } from './compare.ts';

for (const f of [...corpusFiles(), ...generatedFiles()]) {
  test(`${f.name}: the tree matches TypeScript's`, () => {
    const tree = parse(f.text, { fileName: f.name });
    const diff = firstDifference(typescriptLines(f.name, f.text), smalttyLines(tree), f.text);
    assert.equal(diff, null, diff ?? '');
  });
}

test('a syntax error says where', () => {
  assert.throws(() => parse('const n: number = 2;\ntable(\'orders\').head(n;', { fileName: 'tab.ts' }), (e: unknown) => {
    assert.ok(e instanceof ParseError);
    assert.ok(e instanceof SyntaxError);
    assert.equal(e.line, 2);
    assert.match(e.message, /^tab\.ts, line 2, column \d+: /);
    return true;
  });
});
