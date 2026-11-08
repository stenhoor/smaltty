/** A value as smaltdb stores it. */
export type SqlValue = null | number | bigint | string | Uint8Array;
/** A value a literal may hold: booleans are stored as 1 and 0. */
export type LitValue = SqlValue | boolean;
