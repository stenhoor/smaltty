// Plans to SQL. A whole LazyFrame becomes one SELECT statement, so smaltdb's planner sees the entire query: filters
// and projections fold into a single query block where that keeps the meaning, and become a subquery where it does
// not (smaltdb flattens those again: `SELECT … FROM (SELECT …) WHERE …` runs as one fused scan).
//
// Literals are bound as numbered parameters (`?1`, `?2`, …), so the text of a statement depends only on its shape.
import { Binary, Boolean as Bool, Float64, Int64, Null, String as Str, Unknown, type DataType, type Schema } from './dtypes.js';
import { SmaltdfError, needsEngine } from './errors.js';
import type { Node } from './expr.js';
import type { Plan } from './plan.js';
import type { LitValue, SqlValue } from './values.js';

export interface Compiled {
  sql: string;
  params: SqlValue[];
  schema: Schema;
}

export const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`;

class Params {
  readonly values: SqlValue[] = [];
  add(v: LitValue): string {
    if (v === null) return 'NULL';
    this.values.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
    return `?${this.values.length}`;
  }
}

// ------------------------------------------------------------------ expressions

interface Ctx {
  /** The quoted alias column references are qualified with. */
  q: string;
  schema: Schema;
  params: Params;
  /** 'agg': aggregates are plain (GROUP BY or a whole-table aggregate); 'window': aggregates get OVER (…). */
  mode: 'agg' | 'window';
  /** The PARTITION BY expressions of the enclosing `over()`. */
  partition: string[];
  /** Column references that stand for select items of the same block (ORDER BY over computed columns). */
  subst?: Map<string, string>;
}

const BIN_SQL: Record<string, string> = { '=': '=', '<>': '<>', '<': '<', '<=': '<=', '>': '>', '>=': '>=', '+': '+', '-': '-', '*': '*', '/': '/', '%': '%', AND: 'AND', OR: 'OR', IS: 'IS', 'IS NOT': 'IS NOT', '||': '||' };

function litValue(n: Node): LitValue {
  if (n.k !== 'lit') throw new SmaltdfError('InvalidOperationError', 'expected a literal argument');
  return n.v;
}

export function compileExpr(n: Node, c: Ctx): string {
  switch (n.k) {
    case 'col': {
      if (n.names === '*' || n.names.length !== 1) throw new SmaltdfError('ComputeError', 'multi-column expression in a single-column position');
      const name = n.names[0];
      if (!c.schema.has(name)) throw columnNotFound(name, c.schema);
      return c.subst?.get(name) ?? `${c.q}.${quote(name)}`;
    }
    case 'lit':
      return c.params.add(n.v);
    case 'bin': {
      const l = compileExpr(n.l, c);
      const r = compileExpr(n.r, c);
      // Polars' floor division: rounded down, an integer for integer operands.
      if (n.op === '//') {
        const q = `floor(CAST(${l} AS REAL) / ${r})`;
        const ints = dtypeOf(n.l, c.schema) === Int64 && dtypeOf(n.r, c.schema) === Int64;
        return ints ? `CAST(${q} AS INTEGER)` : q;
      }
      return `(${l} ${BIN_SQL[n.op]} ${r})`;
    }
    case 'not':
      return `(NOT ${compileExpr(n.x, c)})`;
    case 'neg':
      return `(- ${compileExpr(n.x, c)})`;
    case 'isnull':
      return `(${compileExpr(n.x, c)} IS ${n.not ? 'NOT ' : ''}NULL)`;
    case 'fn':
      return compileFn(n.name, n.args, c);
    case 'agg':
      return compileAgg(n, c);
    case 'alias':
    case 'rename':
      return compileExpr(n.x, c);
    case 'cast': {
      const x = compileExpr(n.x, c);
      if (n.dtype === Bool) return `(${x} <> 0)`;
      if (n.dtype === Null || n.dtype === Unknown) return x;
      return `CAST(${x} AS ${n.dtype.sql})`;
    }
    case 'case': {
      const whens = n.whens.map(([w, t]) => ` WHEN ${compileExpr(w, c)} THEN ${compileExpr(t, c)}`).join('');
      return `(CASE${whens}${n.otherwise ? ` ELSE ${compileExpr(n.otherwise, c)}` : ''} END)`;
    }
    case 'in': {
      const x = compileExpr(n.x, c);
      if (n.values.length === 0) return `(CASE WHEN ${x} IS NULL THEN NULL ELSE 0 END)`;
      return `(${x} IN (${n.values.map((v) => c.params.add(v)).join(', ')}))`;
    }
    case 'over': {
      if (c.mode === 'agg') throw new SmaltdfError('InvalidOperationError', 'over() inside an aggregation is not supported');
      if (c.partition.length > 0) throw new SmaltdfError('InvalidOperationError', 'nested over() is not supported');
      const partition = n.partition.map((p) => compileExpr(p, c));
      return compileExpr(n.x, { ...c, partition });
    }
    case 'rank': {
      if (c.mode === 'agg') throw new SmaltdfError('InvalidOperationError', 'rank() inside an aggregation is not supported');
      const x = compileExpr(n.x, c);
      const part = c.partition.length ? `PARTITION BY ${c.partition.join(', ')} ` : '';
      const w = `OVER (${part}ORDER BY ${x} ${n.descending ? 'DESC' : 'ASC'} NULLS LAST)`;
      const peers = `count(*) OVER (PARTITION BY ${[...c.partition, x].join(', ')})`;
      const rank = {
        ordinal: `row_number() ${w}`,
        min: `rank() ${w}`,
        dense: `dense_rank() ${w}`,
        max: `(rank() ${w} + ${peers} - 1)`,
        average: `((2 * rank() ${w} + ${peers} - 1) / 2.0)`,
      }[n.method];
      return `(CASE WHEN ${x} IS NULL THEN NULL ELSE ${rank} END)`;
    }
  }
}

function compileFn(name: string, args: Node[], c: Ctx): string {
  const x = compileExpr(args[0], c);
  switch (name) {
    case 'str_contains':
      return `(instr(${x}, ${compileExpr(args[1], c)}) > 0)`;
    case 'str_starts_with': {
      if (litValue(args[1]) === '') return `(CASE WHEN ${x} IS NULL THEN NULL ELSE 1 END)`;
      const p = compileExpr(args[1], c);
      return `(substr(${x}, 1, length(${p})) = ${p})`;
    }
    case 'str_ends_with': {
      if (litValue(args[1]) === '') return `(CASE WHEN ${x} IS NULL THEN NULL ELSE 1 END)`;
      const p = compileExpr(args[1], c);
      return `(substr(${x}, - length(${p})) = ${p})`;
    }
    case 'str_replace_first': {
      const p = compileExpr(args[1], c);
      const v = compileExpr(args[2], c);
      const at = `instr(${x}, ${p})`;
      return `(CASE WHEN ${at} > 0 THEN substr(${x}, 1, ${at} - 1) || ${v} || substr(${x}, ${at} + length(${p})) ELSE ${x} END)`;
    }
    case 'str_slice': {
      const offset = Number(litValue(args[1]));
      const length = litValue(args[2]);
      const start = offset >= 0 ? offset + 1 : offset;
      if (length === null) return `substr(${x}, ${start})`;
      return `substr(${x}, ${start}, ${Number(length)})`;
    }
    case 'str_tail': {
      const k = Number(litValue(args[1]));
      if (k === 0) return `(CASE WHEN ${x} IS NULL THEN NULL ELSE '' END)`;
      return `substr(${x}, ${-k})`;
    }
    default:
      return `${name}(${[x, ...args.slice(1).map((a) => compileExpr(a, c))].join(', ')})`;
  }
}

function compileAgg(n: Extract<Node, { k: 'agg' }>, c: Ctx): string {
  const over = c.mode === 'window' ? ` OVER (${c.partition.length ? `PARTITION BY ${c.partition.join(', ')}` : ''})` : '';
  const call = (sql: string): string => sql + over;
  if (n.x === null) return call('count(*)');
  const x = compileExpr(n.x, c);
  switch (n.fn) {
    case 'sum':
      return call(`sum(${x})`);
    case 'mean':
      return call(`avg(${x})`);
    case 'min':
      return call(`min(${x})`);
    case 'max':
      return call(`max(${x})`);
    case 'count':
      return call(`count(${x})`);
    case 'len':
      return call('count(*)');
    case 'n_unique':
      if (over) throw needsEngine('nUnique() over a window', 'DISTINCT in window aggregates');
      return `(count(DISTINCT ${x}) + (count(${x}) < count(*)))`;
    case 'var':
    case 'std': {
      const d = n.ddof ?? 1;
      const sq = n.fn === 'std' ? 'stddev' : 'var';
      if (d === 1 || d === 0) return call(`${sq}_${d === 1 ? 'samp' : 'pop'}(${x})`);
      // Polars' ddof: the population variance scaled by n / (n - ddof); NULL unless n > ddof.
      const k = call(`count(${x})`);
      const v = `(${call(`var_pop(${x})`)} * ${k} / (${k} - ${d}))`;
      const val = n.fn === 'std' ? `sqrt(${v})` : v;
      return `(CASE WHEN ${k} > ${d} THEN ${val} END)`;
    }
    case 'median':
      return call(`median(${x})`);
    case 'quantile':
      return call(`${n.interpolation === 'lower' ? 'percentile_disc' : 'percentile_cont'}(${x}, ${c.params.add(n.quantile!)})`);
    case 'skew':
      return call(`skewness${n.bias ? '_pop' : ''}(${x})`);
    case 'kurtosis': {
      const k = call(`kurtosis${n.bias ? '_pop' : ''}(${x})`);
      return n.fisher ? k : `(${k} + 3)`;
    }
    case 'corr':
      return call(`corr(${x}, ${compileExpr(n.y!, c)})`);
    case 'cov': {
      const d = n.ddof ?? 1;
      const y = compileExpr(n.y!, c);
      if (d === 1 || d === 0) return call(`covar_${d === 1 ? 'samp' : 'pop'}(${x}, ${y})`);
      const k = call(`count(${x} + ${y})`);
      return `(CASE WHEN ${k} > ${d} THEN ${call(`covar_pop(${x}, ${y})`)} * ${k} / (${k} - ${d}) END)`;
    }
  }
}

function columnNotFound(name: string, schema: Schema): SmaltdfError {
  return new SmaltdfError('ColumnNotFoundError', `unable to find column ${JSON.stringify(name)}; valid columns: ${JSON.stringify([...schema.keys()])}`);
}

// ------------------------------------------------------------------ expression analysis

/** The output name Polars gives an expression: its alias, or the name of its leftmost column. */
export function outputName(n: Node): string {
  switch (n.k) {
    case 'alias':
      return n.name;
    case 'rename':
      return n.how === 'prefix' ? n.s + rootName(n.x) : rootName(n.x) + n.s;
    default:
      return rootName(n, true);
  }
}

function rootName(n: Node, aliases = false): string {
  switch (n.k) {
    case 'col':
      return n.names === '*' ? '*' : n.names[0];
    case 'lit':
      return 'literal';
    case 'alias':
      return aliases ? n.name : rootName(n.x);
    case 'rename':
      return aliases ? outputName(n) : rootName(n.x);
    case 'bin':
      return rootName(n.l, aliases);
    case 'fn':
      return rootName(n.args[0], aliases);
    case 'agg':
      return n.x ? rootName(n.x, aliases) : 'len';
    case 'case':
      return rootName(n.whens[0][1], aliases);
    default:
      return rootName(n.x, aliases);
  }
}

function children(n: Node): Node[] {
  switch (n.k) {
    case 'col':
    case 'lit':
      return [];
    case 'bin':
      return [n.l, n.r];
    case 'fn':
      return n.args;
    case 'agg':
      return [...(n.x ? [n.x] : []), ...(n.y ? [n.y] : [])];
    case 'case':
      return [...n.whens.flat(), ...(n.otherwise ? [n.otherwise] : [])];
    case 'over':
      return [n.x, ...n.partition];
    default:
      return [n.x];
  }
}

/** A value per group: every column reference is inside an aggregate. */
function isAggregated(n: Node): boolean {
  if (n.k === 'col') return false;
  if (n.k === 'agg') return true;
  if (n.k === 'over' || n.k === 'rank') return false;
  return children(n).every(isAggregated);
}

const contains = (n: Node, pred: (n: Node) => boolean): boolean => pred(n) || children(n).some((ch) => contains(ch, pred));
const hasAgg = (n: Node): boolean => contains(n, (m) => m.k === 'agg');
const hasColumn = (n: Node): boolean => contains(n, (m) => m.k === 'col');
/** Needs a window function: an aggregate broadcast to rows, `over()` or `rank()`. */
const hasWindow = (n: Node): boolean => contains(n, (m) => m.k === 'agg' || m.k === 'over' || m.k === 'rank');

/** Expand multi-column expressions (`col('a', 'b')`, `col('*')`, `exclude(…)`) into one expression per column. */
export function expand(nodes: Node[], schema: Schema): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    let names: string[] | null = null;
    const find = (m: Node): void => {
      if (m.k === 'col' && (m.names === '*' || m.names.length > 1)) {
        const these = m.names === '*' ? [...schema.keys()].filter((k) => !m.exclude.includes(k)) : m.names;
        if (names && names.join('\0') !== these.join('\0')) {
          throw new SmaltdfError('ComputeError', 'an expression may expand to several columns only once');
        }
        names = these;
      }
      children(m).forEach(find);
    };
    find(n);
    if (names === null) out.push(n);
    else for (const name of names as string[]) out.push(substitute(n, name));
  }
  return out;
}

function substitute(n: Node, name: string): Node {
  if (n.k === 'col') return n.names === '*' || n.names.length > 1 ? { k: 'col', names: [name], exclude: [] } : n;
  switch (n.k) {
    case 'lit':
      return n;
    case 'bin':
      return { ...n, l: substitute(n.l, name), r: substitute(n.r, name) };
    case 'fn':
      return { ...n, args: n.args.map((a) => substitute(a, name)) };
    case 'agg':
      return { ...n, x: n.x && substitute(n.x, name), y: n.y && substitute(n.y, name) };
    case 'case':
      return { ...n, whens: n.whens.map(([w, t]) => [substitute(w, name), substitute(t, name)] as [Node, Node]), otherwise: n.otherwise && substitute(n.otherwise, name) };
    case 'over':
      return { ...n, x: substitute(n.x, name), partition: n.partition.map((p) => substitute(p, name)) };
    default:
      return { ...n, x: substitute(n.x, name) } as Node;
  }
}

/** The data type of an expression's result, as far as it is known before running it. */
export function dtypeOf(n: Node, schema: Schema): DataType {
  switch (n.k) {
    case 'col':
      return n.names !== '*' && n.names.length === 1 ? (schema.get(n.names[0]) ?? Unknown) : Unknown;
    case 'lit':
      return litType(n.v);
    case 'bin': {
      if (['=', '<>', '<', '<=', '>', '>=', 'AND', 'OR', 'IS', 'IS NOT'].includes(n.op)) return Bool;
      if (n.op === '||') return Str;
      const l = dtypeOf(n.l, schema);
      const r = dtypeOf(n.r, schema);
      if (l === Float64 || r === Float64) return Float64;
      if ((l === Int64 || l === Bool) && (r === Int64 || r === Bool)) return Int64;
      return n.op === '//' ? Float64 : Unknown;
    }
    case 'not':
    case 'isnull':
    case 'in':
      return Bool;
    case 'neg':
    case 'alias':
    case 'rename':
    case 'over':
      return dtypeOf(n.x, schema);
    case 'cast':
      return n.dtype;
    case 'case': {
      for (const [, t] of n.whens) {
        const d = dtypeOf(t, schema);
        if (d !== Null) return d;
      }
      return n.otherwise ? dtypeOf(n.otherwise, schema) : Null;
    }
    case 'rank':
      return n.method === 'average' ? Float64 : Int64;
    case 'agg':
      switch (n.fn) {
        case 'mean':
        case 'var':
        case 'std':
        case 'median':
        case 'quantile':
        case 'skew':
        case 'kurtosis':
        case 'corr':
        case 'cov':
          return Float64;
        case 'count':
        case 'len':
        case 'n_unique':
          return Int64;
        default: {
          const d = n.x ? dtypeOf(n.x, schema) : Int64;
          return n.fn === 'sum' && d === Bool ? Int64 : d;
        }
      }
    case 'fn':
      switch (n.name) {
        case 'length':
        case 'octet_length':
        case 'sign':
          return Int64;
        case 'floor':
        case 'ceil':
          return dtypeOf(n.args[0], schema) === Int64 ? Int64 : Float64;
        case 'abs':
        case 'coalesce':
          return dtypeOf(n.args[0], schema);
        case 'str_contains':
        case 'str_starts_with':
        case 'str_ends_with':
          return Bool;
        case 'upper':
        case 'lower':
        case 'trim':
        case 'ltrim':
        case 'rtrim':
        case 'replace':
        case 'str_replace_first':
        case 'str_slice':
        case 'str_tail':
          return Str;
        default:
          // round and the math functions (sqrt, pow, ln, sin, …) give REALs.
          return Float64;
      }
  }
}

export function litType(v: LitValue): DataType {
  if (v === null) return Null;
  if (typeof v === 'boolean') return Bool;
  if (typeof v === 'bigint') return Int64;
  if (typeof v === 'number') return Number.isInteger(v) ? Int64 : Float64;
  if (typeof v === 'string') return Str;
  return Binary;
}

// ------------------------------------------------------------------ query blocks

interface Item {
  sql: string;
  name: string;
}

/** One SELECT block being built. */
interface Block {
  from: string;
  /** The alias expressions qualify columns with; '' when `from` is a join (items are qualified already). */
  alias: string;
  /** Columns available to expressions through `alias`. */
  inSchema: Schema;
  /** The block's output columns. */
  schema: Schema;
  select: Item[] | null;
  where: string[];
  groupBy: string[] | null;
  aggregate: boolean;
  orderBy: string[] | null;
  limit: number | null;
  offset: number;
  distinct: boolean;
}

class Compiler {
  readonly params = new Params();
  private n = 0;

  alias(): string {
    return quote(`_t${this.n++}`);
  }

  ctx(b: Block, mode: Ctx['mode']): Ctx {
    return { q: b.alias, schema: b.inSchema, params: this.params, mode, partition: [] };
  }

  block(from: string, alias: string, schema: Schema): Block {
    return { from, alias, inSchema: schema, schema, select: null, where: [], groupBy: null, aggregate: false, orderBy: null, limit: null, offset: 0, distinct: false };
  }

  wrap(b: Block): Block {
    const alias = this.alias();
    return this.block(`(${toSql(b)}) AS ${alias}`, alias, b.schema);
  }

  /** A block rows can be filtered, projected, grouped or sorted in without changing what it already does. */
  open(b: Block): Block {
    const plain = b.select === null && b.groupBy === null && !b.aggregate && !b.distinct && b.limit === null && b.offset === 0;
    return plain ? b : this.wrap(b);
  }

  /** A FROM item for a join side, and the alias its columns are qualified with. */
  source(b: Block): { from: string; alias: string } {
    const bare = b.select === null && b.where.length === 0 && b.groupBy === null && !b.aggregate && b.orderBy === null && b.limit === null && b.offset === 0 && !b.distinct && b.alias !== '';
    if (bare) return { from: b.from, alias: b.alias };
    const alias = this.alias();
    return { from: `(${toSql(b)}) AS ${alias}`, alias };
  }

  items(b: Block): Item[] {
    return [...b.schema.keys()].map((name) => ({ sql: `${b.alias}.${quote(name)}`, name }));
  }

  plan(p: Plan): Block {
    switch (p.k) {
      case 'table': {
        const alias = this.alias();
        return this.block(`${quote(p.name)} AS ${alias}`, alias, p.schema!);
      }
      case 'sql': {
        const alias = this.alias();
        const sql = renumber(p.sql, p.params, this.params);
        return this.block(`(${sql}) AS ${alias}`, alias, p.schema!);
      }
      case 'data':
        throw new SmaltdfError('ComputeError', 'internal: unresolved data source');
      case 'select':
        return this.select(this.plan(p.input), p.exprs, false);
      case 'with_columns':
        return this.select(this.plan(p.input), p.exprs, true);
      case 'filter':
        return this.filter(this.plan(p.input), p.pred);
      case 'group_by':
        return this.groupBy(this.plan(p.input), p.keys, p.aggs);
      case 'sort': {
        // Sorting a block that already selects (or groups) orders by its select items: one statement, no subquery.
        let b = this.plan(p.input);
        let c: Ctx;
        if (b.select !== null && b.limit === null && b.offset === 0) {
          c = { ...this.ctx(b, b.aggregate || b.groupBy !== null ? 'agg' : 'window'), schema: b.schema, subst: new Map(b.select.map((it) => [it.name, it.sql])) };
          const by = expand(p.by, b.schema);
          if (by.some((e) => hasWindow(e) && (b.groupBy !== null || b.aggregate))) {
            b = this.wrap(b);
            c = this.ctx(b, 'window');
          }
        } else {
          b = this.open(b);
          c = this.ctx(b, 'window');
        }
        const by = expand(p.by, c.schema);
        b.orderBy = by.map((e, i) => {
          const d = p.descending[i] ?? p.descending[0] ?? false;
          const nl = p.nullsLast[i] ?? p.nullsLast[0];
          return `${compileExpr(e, c)} ${d ? 'DESC' : 'ASC'}${nl === undefined ? '' : nl ? ' NULLS LAST' : ' NULLS FIRST'}`;
        });
        return b;
      }
      case 'slice': {
        const b = this.plan(p.input);
        const len = p.length;
        if (b.limit === null) {
          b.offset += p.offset;
          b.limit = len;
        } else {
          const rest = Math.max(0, b.limit - p.offset);
          b.offset += p.offset;
          b.limit = len === null ? rest : Math.min(rest, len);
        }
        return b;
      }
      case 'tail': {
        const inner = this.wrap(this.plan(p.input));
        const names = [...inner.schema.keys()];
        inner.select = [...this.items(inner), { sql: 'row_number() OVER ()', name: '__smaltdf_rn' }, { sql: 'count(*) OVER ()', name: '__smaltdf_n' }];
        const outer = this.wrap(inner);
        outer.where.push(`${outer.alias}."__smaltdf_rn" > ${outer.alias}."__smaltdf_n" - ${Math.max(0, p.n)}`);
        outer.select = names.map((name) => ({ sql: `${outer.alias}.${quote(name)}`, name }));
        outer.schema = new Map(names.map((nm) => [nm, inner.schema.get(nm)!]));
        return outer;
      }
      case 'join':
        return this.join(p);
      case 'unique': {
        if (p.subset === null) {
          const b = this.plan(p.input);
          const u = b.distinct || b.limit !== null || b.offset !== 0 || b.groupBy !== null || b.aggregate ? this.wrap(b) : b;
          u.orderBy = null;
          u.distinct = true;
          return u;
        }
        const inner = this.open(this.plan(p.input));
        for (const s of p.subset) if (!inner.schema.has(s)) throw columnNotFound(s, inner.schema);
        const names = [...inner.schema.keys()];
        inner.select = [...this.items(inner), { sql: `row_number() OVER (PARTITION BY ${p.subset.map((s) => `${inner.alias}.${quote(s)}`).join(', ')})`, name: '__smaltdf_rn' }];
        inner.schema = new Map([...inner.schema, ['__smaltdf_rn', Int64]]);
        const outer = this.wrap(inner);
        outer.where.push(`${outer.alias}."__smaltdf_rn" = 1`);
        outer.select = names.map((name) => ({ sql: `${outer.alias}.${quote(name)}`, name }));
        outer.schema = new Map(names.map((nm) => [nm, inner.schema.get(nm)!]));
        return outer;
      }
      case 'rename': {
        const b = this.plan(p.input);
        for (const from of Object.keys(p.mapping)) if (!b.schema.has(from)) throw columnNotFound(from, b.schema);
        const rn = (name: string): string => p.mapping[name] ?? name;
        if (b.select === null) b.select = this.items(b);
        b.select = b.select.map((it) => ({ sql: it.sql, name: rn(it.name) }));
        b.schema = new Map([...b.schema].map(([k, v]) => [rn(k), v]));
        checkUnique(b.select.map((it) => it.name));
        return b;
      }
      case 'drop': {
        let b = this.plan(p.input);
        if (p.strict) for (const name of p.names) if (!b.schema.has(name)) throw columnNotFound(name, b.schema);
        if (b.distinct || b.groupBy !== null || b.aggregate) b = this.wrap(b);
        if (b.select === null) b.select = this.items(b);
        b.select = b.select.filter((it) => !p.names.includes(it.name));
        b.schema = new Map([...b.schema].filter(([k]) => !p.names.includes(k)));
        return b;
      }
      case 'row_index': {
        const b = this.open(this.plan(p.input));
        const order = b.orderBy ? `ORDER BY ${b.orderBy.join(', ')}` : '';
        const idx = `(row_number() OVER (${order}) - 1${p.offset ? ` + ${p.offset | 0}` : ''})`;
        if (b.schema.has(p.name)) throw new SmaltdfError('DuplicateError', `column ${JSON.stringify(p.name)} already exists`);
        b.select = [{ sql: idx, name: p.name }, ...this.items(b)];
        b.schema = new Map([[p.name, Int64], ...b.schema]);
        return b;
      }
    }
  }

  /** `select` (only the expressions) and `with_columns` (the input's columns, replaced or extended). */
  select(input: Block, exprs: Node[], keep: boolean): Block {
    const b = this.open(input);
    const nodes = expand(exprs, b.inSchema);
    const aggregate = !keep && nodes.length > 0 && nodes.every(isAggregated) && nodes.some(hasAgg);
    const noRows = !keep && nodes.length > 0 && nodes.every((n) => !hasColumn(n) && !hasWindow(n) && n.k !== 'agg');
    const c = this.ctx(b, aggregate ? 'agg' : 'window');
    const items: Item[] = nodes.map((n) => ({ sql: compileExpr(n, c), name: outputName(n) }));
    const types = nodes.map((n) => dtypeOf(n, b.inSchema));
    let out: Item[];
    let schema: Schema;
    if (keep) {
      out = this.items(b);
      schema = new Map(b.schema);
      items.forEach((it, i) => {
        const at = out.findIndex((o) => o.name === it.name);
        if (at >= 0) out[at] = it;
        else out.push(it);
        schema.set(it.name, types[i]);
      });
      checkUnique(items.map((it) => it.name));
    } else {
      out = items;
      checkUnique(out.map((it) => it.name));
      schema = new Map(out.map((it, i) => [it.name, types[i]]));
    }
    b.select = out;
    b.schema = schema;
    if (aggregate) {
      b.aggregate = true;
      b.orderBy = null;
    }
    if (noRows) {
      b.from = '';
      b.where = [];
      b.orderBy = null;
    }
    return b;
  }

  filter(input: Block, pred: Node): Block {
    const b = this.open(input);
    // A predicate over several columns (`col('*').isNotNull()`) holds when it holds for each of them.
    const p = expand([pred], b.inSchema).reduce((a, x): Node => ({ k: 'bin', op: 'AND', l: a, r: x }));
    if (!hasWindow(p)) {
      b.where.push(compileExpr(p, this.ctx(b, 'window')));
      return b;
    }
    // Window functions cannot appear in WHERE: compute the predicate as a column, then filter on it.
    const names = [...b.schema.keys()];
    b.select = [...this.items(b), { sql: compileExpr(p, this.ctx(b, 'window')), name: '__smaltdf_pred' }];
    b.schema = new Map([...b.schema, ['__smaltdf_pred', Bool]]);
    const outer = this.wrap(b);
    outer.where.push(`${outer.alias}."__smaltdf_pred"`);
    outer.select = names.map((name) => ({ sql: `${outer.alias}.${quote(name)}`, name }));
    outer.schema = new Map(names.map((nm) => [nm, b.schema.get(nm)!]));
    return outer;
  }

  groupBy(input: Block, keyNodes: Node[], aggNodes: Node[]): Block {
    const b = this.open(input);
    b.orderBy = null;
    const keys = expand(keyNodes, b.inSchema);
    const aggs = expand(aggNodes, b.inSchema);
    const kc = this.ctx(b, 'window');
    const keyItems = keys.map((k) => {
      if (hasWindow(k)) throw new SmaltdfError('InvalidOperationError', `group_by key ${outputName(k)} may not aggregate`);
      return { sql: compileExpr(k, kc), name: outputName(k) };
    });
    const ac = this.ctx(b, 'agg');
    const aggItems = aggs.map((a) => {
      if (!isAggregated(a)) {
        throw needsEngine(`${outputName(a)}: an expression that is not aggregated in group_by().agg() (it would be a list column)`, 'list columns');
      }
      return { sql: compileExpr(a, ac), name: outputName(a) };
    });
    const select = [...keyItems, ...aggItems];
    checkUnique(select.map((it) => it.name));
    b.groupBy = keyItems.map((k) => k.sql);
    b.select = select;
    b.schema = new Map([...keys.map((k) => [outputName(k), dtypeOf(k, b.inSchema)] as const), ...aggs.map((a) => [outputName(a), dtypeOf(a, b.inSchema)] as const)]);
    if (keyItems.length === 0) b.aggregate = true;
    return b;
  }

  join(p: Extract<Plan, { k: 'join' }>): Block {
    const lb = this.plan(p.left);
    const rb = this.plan(p.right);
    const l = this.source(lb);
    const r = this.source(rb);
    const lc: Ctx = { q: l.alias, schema: lb.schema, params: this.params, mode: 'window', partition: [] };
    const rc: Ctx = { q: r.alias, schema: rb.schema, params: this.params, mode: 'window', partition: [] };
    const leftOn = expand(p.leftOn, lb.schema);
    const rightOn = expand(p.rightOn, rb.schema);
    if (leftOn.length !== rightOn.length) throw new SmaltdfError('InvalidOperationError', 'join needs as many left_on as right_on columns');
    if (p.how !== 'cross' && leftOn.length === 0) throw new SmaltdfError('InvalidOperationError', 'join needs columns to join on');
    const cond = leftOn.map((le, i) => `${compileExpr(le, lc)} = ${compileExpr(rightOn[i], rc)}`).join(' AND ');
    const lnames = [...lb.schema.keys()];
    if (p.how === 'semi' || p.how === 'anti') {
      const b = this.block(l.from, l.alias, lb.schema);
      b.where.push(`${p.how === 'anti' ? 'NOT ' : ''}EXISTS (SELECT 1 FROM ${r.from} WHERE ${cond})`);
      b.select = lnames.map((name) => ({ sql: `${l.alias}.${quote(name)}`, name }));
      return b;
    }
    // As in Polars: an inner or left join keeps the left key columns and drops the right ones; a right join keeps the
    // right keys and drops the left ones; a full join keeps both (the right ones suffixed when the names clash).
    const keyName = (n: Node): string | null => (n.k === 'col' ? outputName(n) : null);
    const dropRight = new Set(p.how === 'inner' || p.how === 'left' ? rightOn.map(keyName).filter((k): k is string => k !== null) : []);
    const dropLeft = new Set(p.how === 'right' ? leftOn.map(keyName).filter((k): k is string => k !== null) : []);
    const select: Item[] = [];
    const schema: Schema = new Map();
    const add = (sql: string, name: string, t: DataType): void => {
      const nm = schema.has(name) ? name + p.suffix : name;
      if (schema.has(nm)) throw new SmaltdfError('DuplicateError', `column ${JSON.stringify(nm)} appears twice in the join result`);
      select.push({ sql, name: nm });
      schema.set(nm, t);
    };
    for (const name of lnames) if (!dropLeft.has(name)) add(`${l.alias}.${quote(name)}`, name, lb.schema.get(name)!);
    for (const [name, t] of rb.schema) if (!dropRight.has(name)) add(`${r.alias}.${quote(name)}`, name, t);
    const kind = { inner: 'JOIN', left: 'LEFT JOIN', right: 'RIGHT JOIN', full: 'FULL JOIN', cross: 'CROSS JOIN' }[p.how];
    const from = `${l.from} ${kind} ${r.from}${p.how === 'cross' ? '' : ` ON ${cond}`}`;
    const b = this.block(from, '', schema);
    b.select = select;
    return b;
  }
}

function checkUnique(names: string[]): void {
  const seen = new Set<string>();
  for (const n of names) {
    if (seen.has(n)) throw new SmaltdfError('DuplicateError', `the name ${JSON.stringify(n)} is used more than once; use alias() to rename`);
    seen.add(n);
  }
}

function toSql(b: Block): string {
  const cols = b.select === null ? '*' : b.select.length === 0 ? 'NULL AS "__smaltdf_empty"' : b.select.map((it) => `${it.sql} AS ${quote(it.name)}`).join(', ');
  let sql = `SELECT ${b.distinct ? 'DISTINCT ' : ''}${cols}`;
  if (b.from) sql += ` FROM ${b.from}`;
  if (b.where.length) sql += ` WHERE ${b.where.join(' AND ')}`;
  if (b.groupBy?.length) sql += ` GROUP BY ${b.groupBy.join(', ')}`;
  if (b.orderBy?.length) sql += ` ORDER BY ${b.orderBy.join(', ')}`;
  if (b.limit !== null) sql += ` LIMIT ${b.limit}`;
  if (b.offset > 0) sql += `${b.limit === null ? ' LIMIT -1' : ''} OFFSET ${b.offset}`;
  return sql;
}

/**
 * The parameters of hand-written SQL, renumbered after the ones already bound: `?` and `?N` become `?M`. Quoted
 * strings, identifiers and comments are left alone. Named parameters (`:a`, `@a`, `$a`) are not supported.
 */
function renumber(sql: string, values: SqlValue[], params: Params): string {
  const base = params.values.length;
  let out = '';
  let next = 0;
  let max = 0;
  for (let i = 0; i < sql.length; ) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === close) {
          if (close !== ']' && sql[j + 1] === close) j += 2;
          else break;
        } else j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '-' && sql[i + 1] === '-') {
      const j = sql.indexOf('\n', i);
      const end = j < 0 ? sql.length : j;
      out += sql.slice(i, end);
      i = end;
    } else if (ch === '/' && sql[i + 1] === '*') {
      const j = sql.indexOf('*/', i + 2);
      const end = j < 0 ? sql.length : j + 2;
      out += sql.slice(i, end);
      i = end;
    } else if (ch === '?') {
      let j = i + 1;
      while (j < sql.length && sql[j] >= '0' && sql[j] <= '9') j++;
      const n = j > i + 1 ? Number(sql.slice(i + 1, j)) : ++next;
      if (j > i + 1) next = Math.max(next, n);
      max = Math.max(max, n);
      out += `?${base + n}`;
      i = j;
    } else if ((ch === ':' || ch === '@' || ch === '$') && /[A-Za-z_]/.test(sql[i + 1] ?? '')) {
      throw new SmaltdfError('InvalidOperationError', 'named parameters are not supported in scanSql(); use ? or ?N');
    } else {
      out += ch;
      i++;
    }
  }
  if (max !== values.length) throw new SmaltdfError('InvalidOperationError', `the SQL has ${max} parameters but ${values.length} values were given`);
  params.values.push(...values);
  return out;
}

/** Compile a resolved plan (every table and SQL source has its schema) to one SELECT statement. */
export function compile(plan: Plan): Compiled {
  const c = new Compiler();
  const b = c.plan(plan);
  return { sql: toSql(b), params: c.params.values, schema: b.schema };
}
