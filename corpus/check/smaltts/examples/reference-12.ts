// From smaltts docs/REFERENCE.md, line 466.
import { Database } from 'smaltdb/engine';
import { attach, int, real, scan, table } from '../src/index.js';

const db = attach(Database.openMemory());
const orders = table('orders', { id: int().primaryKey(), customerId: int().notNull().indexed(), total: real().notNull() });
await db.migrate({ tables: [orders] });
await db.analyze();

const rel = scan(orders).filter((o) => o.customerId.eq(2)).pick('total');
const { plan, fields, params } = await db.compile(rel);
const measured = await db.explain(rel, { analyze: true });
console.log(String(measured));
