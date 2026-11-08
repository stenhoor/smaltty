// Data types. The names follow Polars (`Int64`, `Float64`, `String`, …); each maps to the smaltdb column type it is
// stored as. smaltdb has no boolean type: Boolean values are stored and computed as the integers 0 and 1, and a
// collected DataFrame shows them as `true` / `false`.

export interface DataType {
  /** The Polars name, e.g. `Int64`. */
  readonly name: string;
  /** The smaltdb type used for CAST and for tables smaltdf creates. */
  readonly sql: string;
  toString(): string;
}

function dtype(name: string, sql: string): DataType {
  return Object.freeze({ name, sql, toString: () => name });
}

export const Int64 = dtype('Int64', 'INTEGER');
export const Float64 = dtype('Float64', 'REAL');
export const String = dtype('String', 'TEXT');
/** Polars' older name for {@link String}. */
export const Utf8 = String;
export const Boolean = dtype('Boolean', 'INTEGER');
export const Binary = dtype('Binary', 'BLOB');
export const Null = dtype('Null', 'ANY');
/** A column whose type smaltdf cannot know before running the query (`ANY` columns, raw SQL). */
export const Unknown = dtype('Unknown', 'ANY');

export const dtypes = { Int64, Float64, String, Utf8, Boolean, Binary, Null, Unknown } as const;

/** An ordered map of column name to data type, as Polars' `Schema`. */
export type Schema = Map<string, DataType>;

/** The DataType for a declared smaltdb column type (SQLite affinity rules). */
export function fromDeclaredType(decl: string): DataType {
  const t = decl.toUpperCase();
  if (t === '') return Unknown;
  if (t.includes('INT')) return Int64;
  if (t.includes('CHAR') || t.includes('CLOB') || t.includes('TEXT')) return String;
  if (t.includes('BLOB')) return Binary;
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return Float64;
  if (t === 'BOOLEAN' || t === 'BOOL') return Boolean;
  return Unknown;
}

const numeric = new Set<DataType>([Int64, Float64, Boolean]);
export const isNumeric = (t: DataType): boolean => numeric.has(t);
