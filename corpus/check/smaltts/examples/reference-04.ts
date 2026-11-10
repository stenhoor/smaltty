// From smaltts docs/REFERENCE.md, line 135.
import { Database } from 'smaltdb/engine';
import { attach } from '../src/index.js';

const db = attach(Database.openMemory());
const catalog = await db.catalog();
const tables = catalog.tables.map((t) => t.name);
