// From smaltts docs/REFERENCE.md, line 154.
import { Database } from 'smaltdb/engine';
import { attach, describe, int, real, table } from '../src/index.js';

const db = attach(Database.openMemory());
const orders = table('orders', { id: int().primaryKey(), total: real().notNull() });

const changes = await db.diff({ tables: [orders] }); // nothing runs
console.log(describe(changes));
await db.apply(changes, { allowDataLoss: 'none', label: 'v1' });
