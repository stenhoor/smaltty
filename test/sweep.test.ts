// The parser against TypeScript on real code beyond the corpus: TypeScript's own declarations (lib.*.d.ts and its API),
// Node's (@types/node), and TypeScript's compiler itself (9 MB of JavaScript).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { sweep } from './sweep.ts';

const require = createRequire(import.meta.url);
const tsLib = dirname(require.resolve('typescript/lib/typescript.js'));
const nodeTypes = dirname(require.resolve('@types/node/package.json'));
const tsDeclarations = readdirSync(tsLib).filter((f) => f.endsWith('.d.ts')).map((f) => join(tsLib, f));

const sets: [string, string[]][] = [
  ['TypeScript and Node declarations', [...tsDeclarations, nodeTypes]],
  ["TypeScript's compiler (typescript.js)", [join(tsLib, 'typescript.js')]],
];

for (const [name, paths] of sets) {
  test(`${name}: every tree matches TypeScript's`, () => {
    const r = sweep(paths);
    assert.ok(r.files > 0);
    assert.deepEqual(r.failures.slice(0, 3), []);
  });
}
