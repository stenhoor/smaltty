// From smaltts docs/REFERENCE.md, line 222.
import assert from 'node:assert/strict';
import { Database } from 'smaltdb/engine';
import { attach, changeSetFile, int, real, table, text } from '../src/index.js';

const v1 = { tables: [table('orders', { id: int().primaryKey(), total: real().notNull() })] };
const v2 = { tables: [table('orders', { id: int().primaryKey(), amount: real().notNull().renamedFrom('total'), note: text() })] };

// In CI: diff a development database against each version, and save each change set.
const dev = attach(Database.openMemory());
const files = [];
for (const [i, desired] of [v1, v2].entries()) {
  const changes = await dev.diff(desired);
  files.push({ name: `000${i + 1}.json`, text: JSON.stringify(changeSetFile(changes, desired)) });
  await dev.apply(changes);
}

// Wherever the application runs: replay what this database hasn't applied.
const db = attach(Database.openMemory());
await db.migrateFiles(files.slice(0, 1));
const { applied, skipped, drift } = await db.migrateFiles(files);
assert.deepEqual([skipped, applied, drift.steps], [['0001.json'], ['0002.json'], []]);
