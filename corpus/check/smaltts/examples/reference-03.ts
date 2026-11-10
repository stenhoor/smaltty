// From smaltts docs/REFERENCE.md, line 115.
import { fn, int, real, table, text } from '../src/index.js';

const customers = table('customers', { id: int().primaryKey(), name: text().notNull() });
const orders = table('orders', {
  id: int().primaryKey(),
  customerId: int().notNull().references(customers, 'id', { onDelete: 'CASCADE' }),
  qty: int().notNull().check((q) => q.gt(0), 'qty_positive'),
  price: real().notNull(),
  priority: int().defaultExpr(fn.abs(-5)),
}, { checks: (r) => ({ affordable: r.price.lte(1000) }) });
