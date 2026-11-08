// The two kinds of smaltdb database smaltdf runs on: the client `Database` from `smaltdb` (the engine in a worker),
// and the in-process engine `Database` from `smaltdb/engine` (Node, tests, a worker of your own). Both are reached
// through `Executor`, which returns results in columns.
import type { SqlValue } from './values.js';

/** Results in columns: a Float64Array for numeric columns without NULLs, a value array otherwise. */
export interface Columns {
  columns: string[];
  length: number;
  data: Record<string, Float64Array | SqlValue[]>;
}

export interface Executor {
  query(sql: string, params: readonly SqlValue[]): Promise<Columns>;
  exec(sql: string, params?: readonly SqlValue[]): Promise<void>;
}

/** A client `Database` (smaltdb): `query(sql, params, { rowMode: 'columnar' })` is async. */
interface ClientLike {
  query(sql: string, params: readonly SqlValue[], options: { rowMode: 'columnar' }): Promise<unknown>;
  exec(sql: string, params?: readonly SqlValue[]): Promise<unknown>;
}

/** An engine `Database` (smaltdb/engine): `queryAsync` returns rows. */
interface EngineLike {
  queryAsync(sql: string, params?: readonly SqlValue[]): Promise<{ columns: string[]; rows: SqlValue[][] }>;
  execAsync(sql: string, params?: readonly SqlValue[]): Promise<void>;
}

/** Any smaltdb database smaltdf can run on. */
export type Connection = ClientLike | EngineLike;

const executors = new WeakMap<object, Executor>();

export function executor(db: Connection | Executor): Executor {
  if (isExecutor(db)) return db;
  let ex = executors.get(db);
  if (!ex) {
    ex = 'queryAsync' in db ? engineExecutor(db) : clientExecutor(db);
    executors.set(db, ex);
  }
  return ex;
}

function isExecutor(db: object): db is Executor {
  return (db as { [EXECUTOR]?: true })[EXECUTOR] === true;
}
const EXECUTOR = Symbol.for('smaltdf.executor');

function clientExecutor(db: ClientLike): Executor {
  return {
    [EXECUTOR]: true,
    query: async (sql, params) => (await db.query(sql, params, { rowMode: 'columnar' })) as Columns,
    exec: async (sql, params) => {
      await db.exec(sql, params);
    },
  } as Executor;
}

function engineExecutor(db: EngineLike): Executor {
  return {
    [EXECUTOR]: true,
    async query(sql, params) {
      const res = await db.queryAsync(sql, params);
      return toColumns(res.columns, res.rows);
    },
    exec: (sql, params) => db.execAsync(sql, params),
  } as Executor;
}

/** Rows to columns, with the client's rule: a Float64Array when every value is a number. */
export function toColumns(columns: string[], rows: SqlValue[][]): Columns {
  const length = rows.length;
  const data: Record<string, Float64Array | SqlValue[]> = {};
  for (let c = 0; c < columns.length; c++) {
    let numeric = true;
    for (let i = 0; i < length; i++) {
      if (typeof rows[i][c] !== 'number') {
        numeric = false;
        break;
      }
    }
    if (numeric) {
      const out = new Float64Array(length);
      for (let i = 0; i < length; i++) out[i] = rows[i][c] as number;
      data[columns[c]] = out;
    } else {
      const out: SqlValue[] = new Array(length);
      for (let i = 0; i < length; i++) out[i] = rows[i][c];
      data[columns[c]] = out;
    }
  }
  return { columns, length, data };
}
