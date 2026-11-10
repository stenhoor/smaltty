// From smaltts docs/REFERENCE.md, line 418.
import { Database } from 'smaltdb/engine';
import { attach, fn, int, real, scan, table } from '../src/index.js';

const db = attach(Database.openMemory());
const orders = table('orders', { id: int().primaryKey(), customerId: int().notNull(), total: real().notNull() });
await db.migrate({ tables: [orders] });

await db.load(orders, [{ customerId: 1, total: 10 }]);
await db.load(orders, [{ id: 1, customerId: 1, total: 12 }], { mode: 'upsert' });
await db.load(orders, scan(orders).filter((o) => o.total.gt(0)), { mode: 'swap' });
await db.deleteWhere(orders, (o) => o.total.lt(0));
await db.updateWhere(orders, (o) => ({ total: fn.mul(o.total, 2) }), (o) => o.customerId.eq(1));
