// @smaltdb/df: dataframes for smaltdb. The Polars expression API; every operation runs in the smaltdb engine.
//
//   import { smaltdf, col } from '@smaltdb/df';
//   const pl = smaltdf(db);
//   const top = await pl.scanTable('orders').filter(col('qty').gt(1)).groupBy('region').agg(col('qty').sum()).collect();
import { executor, type Connection, type Executor } from './engine.js';
import { DataFrame, LazyFrame } from './frame.js';
import * as dt from './dtypes.js';
import { all, col, concatStr, corr, count, cov, exclude, len, lit, max, mean, median, min, nUnique, std, sum, var_, when } from './expr.js';
import type { DataType } from './dtypes.js';
import type { SqlValue } from './values.js';

export { DataFrame, LazyFrame, GroupBy, LazyGroupBy, type Column, type Row, type ExprArgs, type SortOptions, type JoinOptions } from './frame.js';
export { Expr, ExprStr, ExprName, When, Then, col, all, exclude, lit, len, sum, mean, min, max, count, nUnique, median, std, var_, corr, cov, concatStr, when, type IntoExpr, type ExprOrValue, type RankMethod, type QuantileInterpolation } from './expr.js';
export { Int64, Float64, String, Utf8, Boolean, Binary, Null, Unknown, dtypes, type DataType, type Schema } from './dtypes.js';
export { SmaltdfError, type ErrorKind } from './errors.js';
export type { Connection, Executor, Columns } from './engine.js';
export type { SqlValue, LitValue } from './values.js';
export type { JoinHow } from './plan.js';

/** Data for a DataFrame: columns (`{ a: [1, 2] }`) or rows (`[{ a: 1 }, { a: 2 }]`). */
export type FrameData = Record<string, ArrayLike<unknown>> | Record<string, unknown>[];

/**
 * smaltdf bound to a database: `pl.DataFrame(…)`, `pl.scanTable(…)`, `pl.readDatabase(…)`, plus the expression
 * functions (`pl.col`, `pl.lit`, `pl.when`, …), so Polars code ports with few changes.
 */
export function smaltdf(db: Connection | Executor) {
  const ex = executor(db);
  return {
    ...dt.dtypes,
    col,
    all,
    exclude,
    lit,
    len,
    sum,
    mean,
    min,
    max,
    count,
    nUnique,
    median,
    std,
    /** `pl.var` (`var` is reserved in JavaScript). */
    var: var_,
    corr,
    cov,
    concatStr,
    when,
    /** A DataFrame from columns or rows; `schema` overrides the inferred types. */
    DataFrame: (data: FrameData, options: { schema?: Record<string, DataType> } = {}): DataFrame => fromData(data, ex, options.schema),
    fromDict: (data: Record<string, ArrayLike<unknown>>, options: { schema?: Record<string, DataType> } = {}): DataFrame => DataFrame.fromData(data, ex, options.schema),
    fromDicts: (rows: Record<string, unknown>[], options: { schema?: Record<string, DataType> } = {}): DataFrame => fromData(rows, ex, options.schema),
    /** A LazyFrame over a table or view. */
    scanTable: (name: string): LazyFrame => new LazyFrame({ k: 'table', name }, ex),
    /** A LazyFrame over a SELECT statement (parameters as `?` or `?N`). */
    scanSql: (sql: string, params: SqlValue[] = []): LazyFrame => new LazyFrame({ k: 'sql', sql, params }, ex),
    /** Run a SELECT statement and collect it (`pl.read_database`). */
    readDatabase: (sql: string, params: SqlValue[] = []): Promise<DataFrame> => new LazyFrame({ k: 'sql', sql, params }, ex).collect(),
    /** Collect a whole table. */
    readTable: (name: string): Promise<DataFrame> => new LazyFrame({ k: 'table', name }, ex).collect(),
  };
}

function fromData(data: FrameData, ex: Executor, schema?: Record<string, DataType>): DataFrame {
  if (!Array.isArray(data)) return DataFrame.fromData(data, ex, schema);
  const names: string[] = [];
  const seen = new Set<string>();
  for (const r of data) for (const k of Object.keys(r)) if (!seen.has(k)) (seen.add(k), names.push(k));
  const cols: Record<string, unknown[]> = {};
  for (const n of names) cols[n] = data.map((r) => r[n] ?? null);
  return DataFrame.fromData(cols, ex, schema);
}
