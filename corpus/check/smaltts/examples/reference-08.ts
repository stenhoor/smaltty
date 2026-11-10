// From smaltts docs/REFERENCE.md, line 303.
import assert from 'node:assert/strict';
import { Database } from 'smaltdb/engine';
import { agg, attach, exists, int, scan, table, text } from '../src/index.js';

const authors = table('authors', { id: int().primaryKey(), name: text() });
const books = table('books', { id: int().primaryKey(), authorId: int(), year: int() });
const db = attach(Database.openMemory());
await db.migrate({ tables: [authors, books] });
await db.load(authors, [{ id: 1, name: 'ann' }, { id: 2, name: 'bo' }]);
await db.load(books, [{ id: 1, authorId: 1, year: 2001 }, { id: 2, authorId: 1, year: 2010 }]);

// Authors with a book, and each book's place among its author's, newest first.
const published = scan(authors).filter((a) => exists(scan(books).filter((b) => b.authorId.eq(a.id))));
assert.deepEqual(await db.rows(published), [{ id: 1, name: 'ann' }]);
const ranked = scan(books).window(() => ({ place: agg.row_number() }), { partition: ['authorId'], order: ['-year'] });
assert.deepEqual((await db.rows(ranked)).map((b) => b.place), [2, 1]);
