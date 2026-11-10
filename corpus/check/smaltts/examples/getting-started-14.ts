// From smaltts docs/guide/getting-started.md, line 19.
import { Database } from 'smaltdb/engine';
import { attach, describe, int, real, scan, table, agg } from '../src/index.js';
import { registerSmaltts } from '../src/language.js';

registerSmaltts();
const db = attach(Database.openMemory());

// A table, declared in code: its row type comes with it.
const orders = table('orders', {
  id: int().primaryKey(),
  customerId: int().notNull().indexed(),
  total: real().notNull(),
});

// What it would take to have it: a change set, as data. Nothing runs yet.
const changes = await db.diff({ tables: [orders] });
console.log(describe(changes));
await db.apply(changes);

// Rows in, and a typed plan over them.
await db.load(orders, [{ customerId: 1, total: 10 }, { customerId: 1, total: 30 }]);
const totals = scan(orders).aggregate((o) => ({ customerId: o.customerId }), (o) => ({ total: agg.sum(o.total) }));
console.log(await db.rows(totals)); // [{ customerId: 1, total: 40 }]
