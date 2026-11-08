// Logical plans: what a LazyFrame is. Plans are immutable trees; compile.ts turns one into a single SQL statement.
import type { Schema } from './dtypes.js';
import type { Node } from './expr.js';
import type { SqlValue } from './values.js';

export type JoinHow = 'inner' | 'left' | 'right' | 'full' | 'semi' | 'anti' | 'cross';

export type Plan =
  /** A table or view in the database. `schema` is filled in when the frame is resolved. */
  | { k: 'table'; name: string; schema?: Schema }
  /** A SELECT statement written by hand. */
  | { k: 'sql'; sql: string; params: SqlValue[]; schema?: Schema }
  /** Data from JavaScript, uploaded to a temporary table when the frame is resolved. */
  | { k: 'data'; source: DataSource; schema: Schema }
  | { k: 'select'; input: Plan; exprs: Node[] }
  | { k: 'with_columns'; input: Plan; exprs: Node[] }
  | { k: 'filter'; input: Plan; pred: Node }
  | { k: 'group_by'; input: Plan; keys: Node[]; aggs: Node[] }
  | { k: 'sort'; input: Plan; by: Node[]; descending: boolean[]; nullsLast: (boolean | undefined)[] }
  | { k: 'slice'; input: Plan; offset: number; length: number | null }
  | { k: 'tail'; input: Plan; n: number }
  | { k: 'join'; left: Plan; right: Plan; how: JoinHow; leftOn: Node[]; rightOn: Node[]; suffix: string }
  | { k: 'unique'; input: Plan; subset: string[] | null }
  | { k: 'rename'; input: Plan; mapping: Record<string, string> }
  | { k: 'drop'; input: Plan; names: string[]; strict: boolean }
  | { k: 'row_index'; input: Plan; name: string; offset: number };

/** A JavaScript-side frame that can be placed in the database: it returns the name of a table holding its rows. */
export interface DataSource {
  table(): Promise<string>;
}
