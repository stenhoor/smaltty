// From smaltts docs/REFERENCE.md, line 491.
import { Database } from 'smaltdb/engine';
import { attach } from '../src/index.js';

const db = attach(Database.openMemory());
await db.transaction(async (tx) => {
  await tx.analyze();
});
const io = db.plugin('@smaltdb/io');
