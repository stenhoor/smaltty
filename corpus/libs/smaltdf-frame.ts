// LazyFrame (a plan) and DataFrame (collected data). Every operation runs in the smaltdb engine: a LazyFrame
// compiles to one SQL statement when it is collected, and a DataFrame's own operations go through `lazy()`.
import { compile, litType, type Compiled } from './compile.js';
import { Boolean as Bool, Binary, Float64, Int64, Null, String as Str, Unknown, fromDeclaredType, type DataType, type Schema } from './dtypes.js';
import { executor, type Columns, type Connection, type Executor } from './engine.js';
import { SmaltdfError } from './errors.js';
import { Expr, col, len as lenExpr, toColumn, type IntoExpr } from './expr.js';
import type { DataSource, JoinHow, Plan } from './plan.js';
import type { LitValue, SqlValue } from './values.js';

/** Expressions as frame methods take them: column names, expressions, arrays of either, or `{ name: expr }`. */
export type ExprArgs = (IntoExpr | IntoExpr[] | Record<string, IntoExpr>)[];

function exprs(args: ExprArgs): Expr[] {
  const out: Expr[] = [];
  for (const a of args) {
    if (typeof a === 'string' || a instanceof Expr) out.push(toColumn(a));
    else if (Array.isArray(a)) out.push(...a.map(toColumn));
    else for (const [name, e] of Object.entries(a)) out.push(toColumn(e).alias(name));
  }
  return out;
}

export interface SortOptions {
  descending?: boolean | boolean[];
  /** Where NULLs go. Left out, smaltdb's order applies: first when ascending, last when descending. */
  nullsLast?: boolean | boolean[];
}

export interface JoinOptions {
  on?: IntoExpr | IntoExpr[];
  leftOn?: IntoExpr | IntoExpr[];
  rightOn?: IntoExpr | IntoExpr[];
  how?: JoinHow;
  suffix?: string;
}

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export class LazyFrame {
  private compiled?: Promise<Compiled>;

  /** @internal */
  constructor(
    readonly plan: Plan,
    /** @internal */ readonly ex: Executor,
  ) {}

  private with(plan: Plan): LazyFrame {
    return new LazyFrame(plan, this.ex);
  }

  select(...args: ExprArgs): LazyFrame {
    return this.with({ k: 'select', input: this.plan, exprs: exprs(args).map((e) => e.node) });
  }
  withColumns(...args: ExprArgs): LazyFrame {
    return this.with({ k: 'with_columns', input: this.plan, exprs: exprs(args).map((e) => e.node) });
  }
  withColumn(e: Expr): LazyFrame {
    return this.withColumns(e);
  }
  filter(...predicates: (Expr | Expr[])[]): LazyFrame {
    const ps = predicates.flat();
    if (ps.length === 0) return this;
    const pred = ps.slice(1).reduce((a, b) => a.and(b), ps[0]);
    return this.with({ k: 'filter', input: this.plan, pred: pred.node });
  }
  /** Group rows by keys; aggregate with `.agg(…)`. Groups come back in no particular order, as in Polars. */
  groupBy(...keys: ExprArgs): LazyGroupBy {
    return new LazyGroupBy(this, exprs(keys));
  }
  /** `sort('a')`, `sort('a', 'b', { descending: [true, false] })`, `sort(col('a').abs())`. */
  sort(...args: (IntoExpr | IntoExpr[] | SortOptions)[]): LazyFrame {
    const last = args[args.length - 1];
    const opts: SortOptions = last !== undefined && typeof last === 'object' && !(last instanceof Expr) && !Array.isArray(last) ? (args.pop() as SortOptions) : {};
    const by = (args as (IntoExpr | IntoExpr[])[]).flat().map(toColumn);
    if (by.length === 0) throw new SmaltdfError('InvalidOperationError', 'sort() needs at least one column');
    return this.with({ k: 'sort', input: this.plan, by: by.map((e) => e.node), descending: asArray(opts.descending), nullsLast: asArray(opts.nullsLast) });
  }
  head(n = 5): LazyFrame {
    return this.slice(0, n);
  }
  limit(n = 5): LazyFrame {
    return this.head(n);
  }
  first(): LazyFrame {
    return this.head(1);
  }
  tail(n = 5): LazyFrame {
    return this.with({ k: 'tail', input: this.plan, n });
  }
  last(): LazyFrame {
    return this.tail(1);
  }
  slice(offset: number, length?: number | null): LazyFrame {
    if (offset < 0) throw new SmaltdfError('InvalidOperationError', 'slice() with a negative offset is not supported yet; use tail()');
    return this.with({ k: 'slice', input: this.plan, offset, length: length ?? null });
  }
  join(other: LazyFrame | DataFrame, options: JoinOptions = {}): LazyFrame {
    const right = other instanceof DataFrame ? other.lazy() : other;
    if (right.ex !== this.ex) throw new SmaltdfError('InvalidOperationError', 'both frames of a join must come from the same database');
    const how = options.how ?? 'inner';
    const leftOn = asArray(options.leftOn ?? options.on).map(toColumn);
    const rightOn = asArray(options.rightOn ?? options.on).map(toColumn);
    return this.with({ k: 'join', left: this.plan, right: right.plan, how, leftOn: leftOn.map((e) => e.node), rightOn: rightOn.map((e) => e.node), suffix: options.suffix ?? '_right' });
  }
  /** Distinct rows (by `subset`, keeping any one row of each). The result has no particular order. */
  unique(subset?: string | string[] | null, options: { keep?: 'any' | 'first' | 'last' | 'none'; maintainOrder?: boolean } = {}): LazyFrame {
    if (options.keep !== undefined && options.keep !== 'any') throw new SmaltdfError('InvalidOperationError', `unique(keep=${JSON.stringify(options.keep)}) is not supported yet`);
    if (options.maintainOrder) throw new SmaltdfError('InvalidOperationError', 'unique(maintainOrder) is not supported yet');
    return this.with({ k: 'unique', input: this.plan, subset: subset == null ? null : asArray(subset) });
  }
  rename(mapping: Record<string, string>): LazyFrame {
    return this.with({ k: 'rename', input: this.plan, mapping });
  }
  drop(...columns: (string | string[])[]): LazyFrame {
    return this.with({ k: 'drop', input: this.plan, names: columns.flat(), strict: true });
  }
  /** Rows with no NULL in `subset` (every column when left out). */
  dropNulls(subset?: string | string[]): LazyFrame {
    const names = asArray(subset);
    const which = names.length ? col(names) : col('*');
    return this.filter(which.isNotNull());
  }
  /** Replace NULLs in every column. */
  fillNull(value: LitValue | Expr): LazyFrame {
    return this.withColumns(col('*').fillNull(value));
  }
  withRowIndex(name = 'index', offset = 0): LazyFrame {
    return this.with({ k: 'row_index', input: this.plan, name, offset });
  }
  lazy(): LazyFrame {
    return this;
  }

  /** The SQL statement this frame runs, and its parameters. */
  async explain(): Promise<string> {
    const c = await this.toSql();
    return c.params.length ? `${c.sql}\n-- params: ${JSON.stringify(c.params, (_k, v) => (typeof v === 'bigint' ? `${v}` : v))}` : c.sql;
  }
  /** @internal */
  toSql(): Promise<Compiled> {
    this.compiled ??= resolve(this.plan, this.ex).then(compile);
    return this.compiled;
  }
  async collectSchema(): Promise<Schema> {
    return (await this.toSql()).schema;
  }
  async collect(): Promise<DataFrame> {
    const c = await this.toSql();
    const res = await this.ex.query(c.sql, c.params);
    return DataFrame.fromColumns(res, c.schema, this.ex);
  }
}

export class LazyGroupBy {
  constructor(
    private readonly frame: LazyFrame,
    private readonly keys: Expr[],
  ) {}
  agg(...aggs: ExprArgs): LazyFrame {
    const list = exprs(aggs);
    return new LazyFrame({ k: 'group_by', input: this.frame.plan, keys: this.keys.map((e) => e.node), aggs: list.map((e) => e.node) }, this.frame.ex);
  }
  /** The number of rows in each group, as column `name`. */
  len(name = 'len'): LazyFrame {
    return this.agg(lenExpr().alias(name));
  }
  sum(): LazyFrame {
    return this.all((e) => e.sum());
  }
  mean(): LazyFrame {
    return this.all((e) => e.mean());
  }
  min(): LazyFrame {
    return this.all((e) => e.min());
  }
  max(): LazyFrame {
    return this.all((e) => e.max());
  }
  count(): LazyFrame {
    return this.all((e) => e.count());
  }
  nUnique(): LazyFrame {
    return this.all((e) => e.nUnique());
  }
  /** The same aggregate of every column that is not a key. */
  private all(f: (e: Expr) => Expr): LazyFrame {
    const keyNames = this.keys.map((k) => (k.node.k === 'col' && k.node.names !== '*' ? k.node.names : [])).flat();
    return this.agg(f(col('*').exclude(keyNames)));
  }
}

declare module './expr.js' {
  interface Expr {
    /** Every column this expression selects, except these (only on `col('*')` and `col(…)`). */
    exclude(...names: (string | string[])[]): Expr;
  }
}
Expr.prototype.exclude = function (this: Expr, ...names: (string | string[])[]): Expr {
  const n = this.node;
  if (n.k !== 'col') throw new SmaltdfError('InvalidOperationError', 'exclude() applies to column selections only');
  const drop = names.flat();
  if (n.names === '*') return new Expr({ k: 'col', names: '*', exclude: [...n.exclude, ...drop] });
  return new Expr({ k: 'col', names: n.names.filter((x) => !drop.includes(x)), exclude: [] });
};

// ------------------------------------------------------------------ resolving

/** Fill in the schema of every table and SQL source, and place JavaScript data in the database. */
async function resolve(plan: Plan, ex: Executor): Promise<Plan> {
  switch (plan.k) {
    case 'table': {
      if (plan.schema) return plan;
      const info = await ex.query(`PRAGMA table_info(${quoteIdent(plan.name)})`, []);
      if (info.length === 0) throw new SmaltdfError('ColumnNotFoundError', `no such table: ${plan.name}`);
      const names = info.data.name as SqlValue[];
      const types = info.data.type as SqlValue[];
      const schema: Schema = new Map(names.map((n, i) => [String(n), fromDeclaredType(String(types[i] ?? ''))]));
      return { ...plan, schema };
    }
    case 'sql': {
      if (plan.schema) return plan;
      const res = await ex.query(`SELECT * FROM (${plan.sql}) LIMIT 0`, plan.params);
      return { ...plan, schema: new Map(res.columns.map((n) => [n, Unknown])) };
    }
    case 'data':
      return { k: 'table', name: await plan.source.table(), schema: plan.schema };
    case 'join':
      return { ...plan, left: await resolve(plan.left, ex), right: await resolve(plan.right, ex) };
    default:
      return { ...plan, input: await resolve(plan.input, ex) } as Plan;
  }
}

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

// ------------------------------------------------------------------ DataFrame

export type Column = Float64Array | SqlValue[] | (boolean | null)[];
export type Row = Record<string, SqlValue | boolean>;

let tableSeq = 0;
const dropTables = new FinalizationRegistry<{ ex: Executor; name: string }>(({ ex, name }) => {
  ex.exec(`DROP TABLE IF EXISTS temp.${quoteIdent(name)}`).catch(() => {});
});

/** Collected data. Operations on it (`filter`, `select`, …) run in the engine through `lazy()` and are async. */
export class DataFrame implements DataSource {
  private placed?: Promise<string>;

  /** @internal */
  constructor(
    private readonly cols: Map<string, Column>,
    readonly schema: Schema,
    readonly height: number,
    /** @internal */ readonly ex: Executor,
  ) {}

  /** @internal */
  static fromColumns(res: Columns, schema: Schema, ex: Executor): DataFrame {
    const cols = new Map<string, Column>();
    const out: Schema = new Map();
    for (const name of res.columns) {
      let data: Column = res.data[name];
      let t = schema.get(name) ?? Unknown;
      if (t === Unknown || t === Null) t = inferType(data);
      if (t === Bool) data = Array.from(data as ArrayLike<SqlValue>, (v) => (v === null ? null : v !== 0 && v !== 0n));
      cols.set(name, data);
      out.set(name, t);
    }
    return new DataFrame(cols, out, res.length, ex);
  }

  /** @internal Build from columns of JavaScript values. */
  static fromData(data: Record<string, ArrayLike<unknown>>, ex: Executor, schema?: Record<string, DataType>): DataFrame {
    const cols = new Map<string, Column>();
    const types: Schema = new Map();
    let height = -1;
    for (const [name, values] of Object.entries(data)) {
      if (height >= 0 && values.length !== height) throw new SmaltdfError('ShapeError', `column ${JSON.stringify(name)} has ${values.length} values, expected ${height}`);
      height = values.length;
      const declared = schema?.[name];
      let column: Column = values instanceof Float64Array ? values : (Array.from(values, normalize) as SqlValue[]);
      // An Int64 column keeps integers beyond 2^53 exact: they are stored as bigint.
      if (declared === Int64) column = Array.from(column as ArrayLike<SqlValue>, (v) => (typeof v === 'number' && Number.isInteger(v) && !Number.isSafeInteger(v) ? BigInt(v) : v));
      cols.set(name, column);
      types.set(name, schema?.[name] ?? inferType(column));
    }
    return new DataFrame(cols, types, Math.max(height, 0), ex);
  }

  get columns(): string[] {
    return [...this.cols.keys()];
  }
  get dtypes(): DataType[] {
    return [...this.schema.values()];
  }
  get width(): number {
    return this.cols.size;
  }
  get shape(): [number, number] {
    return [this.height, this.width];
  }
  isEmpty(): boolean {
    return this.height === 0;
  }
  /** A column's values: a Float64Array for numbers without NULLs, an array otherwise. */
  getColumn(name: string): Column {
    const c = this.cols.get(name);
    if (!c) throw new SmaltdfError('ColumnNotFoundError', `unable to find column ${JSON.stringify(name)}; valid columns: ${JSON.stringify(this.columns)}`);
    return c;
  }
  getColumns(): Column[] {
    return [...this.cols.values()];
  }
  /** One value: `item()` of a 1×1 frame, or `item(row, column)`. */
  item(row?: number, column?: string | number): SqlValue | boolean {
    if (row === undefined) {
      if (this.height !== 1 || this.width !== 1) throw new SmaltdfError('InvalidOperationError', `item() needs a 1×1 frame, not ${this.height}×${this.width}`);
      return this.getColumns()[0][0];
    }
    const c = typeof column === 'number' ? this.getColumns()[column] : this.getColumn(column ?? this.columns[0]);
    return c[row < 0 ? this.height + row : row];
  }
  /** Rows as arrays. */
  rows(): (SqlValue | boolean)[][] {
    const cols = this.getColumns();
    const out = new Array(this.height);
    for (let i = 0; i < this.height; i++) out[i] = cols.map((c) => c[i]);
    return out;
  }
  row(index: number): (SqlValue | boolean)[] {
    return this.getColumns().map((c) => c[index < 0 ? this.height + index : index]);
  }
  /** Rows as objects (`to_dicts`). */
  toDicts(): Row[] {
    const names = this.columns;
    const cols = this.getColumns();
    const out: Row[] = new Array(this.height);
    for (let i = 0; i < this.height; i++) {
      const r: Row = {};
      for (let c = 0; c < names.length; c++) r[names[c]] = cols[c][i];
      out[i] = r;
    }
    return out;
  }
  /** Columns as arrays (`to_dict(as_series=False)`). */
  toDict(): Record<string, (SqlValue | boolean)[]> {
    const out: Record<string, (SqlValue | boolean)[]> = {};
    for (const [name, c] of this.cols) out[name] = Array.from(c as ArrayLike<SqlValue | boolean>);
    return out;
  }

  /** A LazyFrame over this data (placed in a temporary table of the database the first time it is run). */
  lazy(): LazyFrame {
    return new LazyFrame({ k: 'data', source: this, schema: this.schema }, this.ex);
  }

  /** @internal Place the rows in a temporary table (once) and return its name. */
  table(): Promise<string> {
    this.placed ??= this.upload();
    return this.placed;
  }

  private async upload(): Promise<string> {
    const name = `__smaltdf_${++tableSeq}_${Math.random().toString(36).slice(2, 8)}`;
    const names = this.columns;
    if (names.length === 0) throw new SmaltdfError('InvalidOperationError', 'a frame with no columns cannot be queried');
    const decl = names.map((n) => `${quoteIdent(n)} ${tableType(this.schema.get(n)!)}`).join(', ');
    await this.ex.exec(`CREATE TEMP TABLE ${quoteIdent(name)} (${decl})`);
    dropTables.register(this, { ex: this.ex, name });
    const cols = this.getColumns();
    const width = names.length;
    const per = Math.max(1, Math.floor(30000 / width));
    for (let start = 0; start < this.height; start += per) {
      const end = Math.min(this.height, start + per);
      const params: SqlValue[] = new Array((end - start) * width);
      let k = 0;
      for (let i = start; i < end; i++) for (let c = 0; c < width; c++) params[k++] = toSql(cols[c][i]);
      const row = `(${new Array(width).fill('?').join(', ')})`;
      await this.ex.exec(`INSERT INTO ${quoteIdent(name)} VALUES ${new Array(end - start).fill(row).join(', ')}`, params);
    }
    return name;
  }

  // Eager operations: each runs as a lazy query and collects.
  select(...args: ExprArgs): Promise<DataFrame> {
    return this.lazy().select(...args).collect();
  }
  withColumns(...args: ExprArgs): Promise<DataFrame> {
    return this.lazy().withColumns(...args).collect();
  }
  filter(...predicates: (Expr | Expr[])[]): Promise<DataFrame> {
    return this.lazy().filter(...predicates).collect();
  }
  groupBy(...keys: ExprArgs): GroupBy {
    return new GroupBy(this.lazy().groupBy(...keys));
  }
  sort(...args: (IntoExpr | IntoExpr[] | SortOptions)[]): Promise<DataFrame> {
    return this.lazy().sort(...args).collect();
  }
  join(other: DataFrame | LazyFrame, options: JoinOptions = {}): Promise<DataFrame> {
    return this.lazy().join(other, options).collect();
  }
  unique(subset?: string | string[] | null, options?: { keep?: 'any'; maintainOrder?: boolean }): Promise<DataFrame> {
    return this.lazy().unique(subset, options).collect();
  }
  rename(mapping: Record<string, string>): Promise<DataFrame> {
    return this.lazy().rename(mapping).collect();
  }
  drop(...columns: (string | string[])[]): Promise<DataFrame> {
    return this.lazy().drop(...columns).collect();
  }
  dropNulls(subset?: string | string[]): Promise<DataFrame> {
    return this.lazy().dropNulls(subset).collect();
  }
  fillNull(value: LitValue | Expr): Promise<DataFrame> {
    return this.lazy().fillNull(value).collect();
  }
  withRowIndex(name = 'index', offset = 0): Promise<DataFrame> {
    return this.lazy().withRowIndex(name, offset).collect();
  }
  /** The first rows, taken from the collected data without a query. */
  head(n = 5): DataFrame {
    return this.sliceLocal(0, Math.min(this.height, Math.max(0, n)));
  }
  tail(n = 5): DataFrame {
    const k = Math.min(this.height, Math.max(0, n));
    return this.sliceLocal(this.height - k, this.height);
  }
  slice(offset: number, length?: number | null): DataFrame {
    const start = offset < 0 ? Math.max(0, this.height + offset) : Math.min(offset, this.height);
    return this.sliceLocal(start, length == null ? this.height : Math.min(this.height, start + length));
  }
  private sliceLocal(start: number, end: number): DataFrame {
    const cols = new Map<string, Column>();
    for (const [name, c] of this.cols) cols.set(name, c.slice(start, end) as Column);
    return new DataFrame(cols, this.schema, end - start, this.ex);
  }
}

export class GroupBy {
  constructor(private readonly g: LazyGroupBy) {}
  agg(...aggs: ExprArgs): Promise<DataFrame> {
    return this.g.agg(...aggs).collect();
  }
  len(name = 'len'): Promise<DataFrame> {
    return this.g.len(name).collect();
  }
  sum(): Promise<DataFrame> {
    return this.g.sum().collect();
  }
  mean(): Promise<DataFrame> {
    return this.g.mean().collect();
  }
  min(): Promise<DataFrame> {
    return this.g.min().collect();
  }
  max(): Promise<DataFrame> {
    return this.g.max().collect();
  }
  count(): Promise<DataFrame> {
    return this.g.count().collect();
  }
  nUnique(): Promise<DataFrame> {
    return this.g.nUnique().collect();
  }
}

function normalize(v: unknown): SqlValue | boolean {
  // smaltdb has no NaN: it is stored as NULL (docs/divergences.md, "nan-input").
  if (v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v))) return null;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint' || typeof v === 'boolean' || v instanceof Uint8Array) return v;
  if (v instanceof Date) return v.toISOString();
  throw new SmaltdfError('SchemaError', `unsupported value ${String(v)}: use numbers, bigints, strings, booleans, Uint8Arrays or null`);
}

function toSql(v: SqlValue | boolean): SqlValue {
  return typeof v === 'boolean' ? (v ? 1 : 0) : v;
}

/** The type of a column of values: one kind (ints and floats count as Float64 together), else Unknown. */
function inferType(values: ArrayLike<unknown>): DataType {
  if (values instanceof Float64Array) {
    for (let i = 0; i < values.length; i++) if (!Number.isInteger(values[i])) return Float64;
    return values.length ? Int64 : Null;
  }
  let t: DataType = Null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as LitValue;
    if (v === null) continue;
    const vt = litType(v);
    if (t === Null) t = vt;
    else if (t !== vt) {
      if ((t === Int64 && vt === Float64) || (t === Float64 && vt === Int64)) t = Float64;
      else return Unknown;
    }
  }
  return t;
}

function tableType(t: DataType): string {
  if (t === Int64 || t === Bool) return 'INTEGER';
  if (t === Float64) return 'REAL';
  if (t === Str) return 'TEXT';
  if (t === Binary) return 'BLOB';
  return 'ANY';
}

export { executor, type Connection };
