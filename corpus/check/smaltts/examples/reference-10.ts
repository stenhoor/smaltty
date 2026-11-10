// From smaltts docs/REFERENCE.md, line 369.
import assert from 'node:assert/strict';
import { Database } from 'smaltdb/engine';
import { agg, attach, int, real, scan, table } from '../src/index.js';
import { registerSmaltts } from '../src/language.js';

registerSmaltts();
const db = attach(Database.openMemory());
const orders = table('orders', { id: int().primaryKey(), customerId: int().notNull(), total: real().notNull() });
await db.migrate({ tables: [orders] });
await db.load(orders, [{ customerId: 1, total: 150 }]);

// A reflecting view: its columns follow the table.
await db.createView('big_orders', scan(orders).filter((o) => o.total.gt(100)));
// An interface view: these columns, in this order, whatever changes underneath.
const totals = scan(orders).aggregate((o) => ({ customerId: o.customerId }), (o) => ({ total: agg.sum(o.total) }));
await db.createView('order_totals', totals, { columns: ['customerId', 'total'], materialized: true, storage: 'columnar' });
await db.refresh('order_totals', { concurrently: true });

// Rename a column and add one: the reflecting view follows, the interface holds.
await db.migrate({ tables: [table('orders', { id: int().primaryKey(), customer: int().notNull().renamedFrom('customerId'), total: real().notNull(), note: real() })] });
assert.deepEqual(Object.keys((await db.rows(scan('big_orders')))[0]!), ['id', 'customer', 'total', 'note']);
await db.refresh('order_totals');
assert.deepEqual(await db.rows(scan('order_totals')), [{ customerId: 1, total: 150 }]);
