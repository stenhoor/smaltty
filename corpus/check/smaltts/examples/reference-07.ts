// From smaltts docs/REFERENCE.md, line 254.
import { agg, int, param, real, scan, table, text } from '../src/index.js';

const customers = table('customers', { id: int().primaryKey(), name: text() });
const orders = table('orders', { id: int().primaryKey(), customerId: int().notNull(), total: real().notNull() });

const spend = scan(orders)
  .filter((o) => o.total.gte(param.real('min')))
  .join(scan(customers), (o, c) => o.customerId.eq(c.c_id), { prefix: 'c_' })
  .aggregate((r) => ({ name: r.c_name }), (r) => ({ spent: agg.sum(r.total), orders: agg.count() }))
  .sort('-spent');
