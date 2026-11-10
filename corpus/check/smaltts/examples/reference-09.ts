// From smaltts docs/REFERENCE.md, line 322.
import assert from 'node:assert/strict';
import { Database } from 'smaltdb/engine';
import { agg, attach, int, list, scan, table, text } from '../src/index.js';

const posts = table('posts', { id: int().primaryKey(), author: text(), tags: list(text()) });
const db = attach(Database.openMemory());
await db.migrate({ tables: [posts] });
await db.load(posts, [{ id: 1, author: 'ann', tags: ['db', 'ts'] }, { id: 2, author: 'bo', tags: ['db'] }]);

// One row per tag, then a column per author.
const byTag = scan(posts)
  .explode('tags')
  .pivot({ keys: (r) => ({ tag: r.tags }), on: (r) => r.author, values: ['ann', 'bo'], aggs: () => ({ n: agg.count() }), ordered: true });
assert.deepEqual(await db.rows(byTag), [{ tag: 'db', ann: 1, bo: 1 }, { tag: 'ts', ann: 1, bo: 0 }]);
