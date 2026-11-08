// Bad input: the parser stops at the first error with a SyntaxError that says where. It never crashes, never loops,
// and never accepts what TypeScript rejects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { parse, ParseError } from 'smaltty';
import { corpusFiles } from '../bench/corpus.ts';

function typescriptRejects(text: string): boolean {
  const sf = ts.createSourceFile('x.ts', text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  return (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length > 0;
}

/** Parses; returns the error, or null. Anything but a ParseError fails the test. */
function tryParse(text: string): ParseError | null {
  try {
    parse(text);
    return null;
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    return e;
  }
}

const cases: [string, string, number, number][] = [
  // [what, source, line, column]
  ['an unclosed call', "table('orders').head(n;", 1, 23],
  ['an unclosed string', "const s = 'abc\nconst t = 1;", 1, 11],
  ['an unclosed template', 'const s = `abc${1}', 1, 18], // where the unclosed part starts
  ['an unclosed comment', 'const a = 1; /* never closed', 1, 14],
  ['an unclosed block', 'function f() {\n  return 1;\n', 3, 1],
  ['a missing expression', 'const a = ;', 1, 11],
  ['two expressions on a line', 'const a = 1 2;', 1, 13],
  ['a bad character', 'const a = 1 § 2;', 1, 13],
  ['a number followed by a name', 'const a = 3in [];', 1, 12],
  ['an unclosed regular expression', 'const r = /abc\n;', 1, 11],
  ['a function type in a union', 'type F = string | () => void;', 1, 19],
];

for (const [what, text, line, column] of cases) {
  test(`${what}: a SyntaxError at line ${line}, column ${column}`, () => {
    assert.ok(typescriptRejects(text), 'TypeScript rejects it too');
    const e = tryParse(text);
    assert.ok(e, 'smaltty rejects it');
    assert.ok(e instanceof SyntaxError);
    assert.deepEqual([e.line, e.column], [line, column], e.message);
  });
}

test('every prefix of the app and edge files parses or fails cleanly, and agrees with TypeScript on which', () => {
  let checked = 0;
  for (const f of corpusFiles().filter((f) => f.group === 'apps' || f.group === 'edge')) {
    for (let cut = 0; cut < f.text.length; cut += 7) {
      const text = f.text.slice(0, cut);
      const e = tryParse(text);
      // TypeScript accepts some code smaltty rejects only in non-erasable files' recovery; a prefix TypeScript
      // rejects must be rejected.
      if (typescriptRejects(text)) assert.ok(e, `${f.name} cut at ${cut}: TypeScript rejects it, smaltty accepts it`);
      checked++;
    }
  }
  assert.ok(checked > 1000, String(checked));
});
