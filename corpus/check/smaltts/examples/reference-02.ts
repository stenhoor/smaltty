// From smaltts docs/REFERENCE.md, line 52.
import { table, int, real, text, tableSpec, inferTable } from '../src/index.js';

const customers = table('customers', {
  id: int().primaryKey(),
  email: text().notNull().unique().collate('nocase'),
  name: text(),
});
const orders = table('orders', {
  id: int().primaryKey(),
  customerId: int().notNull().indexed(),
  total: real().notNull(),
}, { storage: 'columnar' });

type Order = NonNullable<typeof orders.$row>; // { id: number; customerId: number; total: number }

const products = inferTable('products', [{ sku: 'a-1', price: 9.5 }], { primaryKey: ['sku'] });
const copy = tableSpec({ ...orders, name: 'orders_archive', indexes: [] });
