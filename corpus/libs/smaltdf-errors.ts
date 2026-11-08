// Errors carry the name of the Polars exception they correspond to, so ported error handling can match on it.

export type ErrorKind =
  | 'ColumnNotFoundError'
  | 'DuplicateError'
  | 'InvalidOperationError'
  | 'SchemaError'
  | 'ShapeError'
  | 'ComputeError';

export class SmaltdfError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
  ) {
    super(message);
    this.name = kind;
  }
}

/** An operation smaltdb's SQL cannot run yet. `hook` names the engine change that would make it possible. */
export function needsEngine(what: string, hook: string): SmaltdfError {
  return new SmaltdfError('InvalidOperationError', `${what} is not supported yet: it needs ${hook} in smaltdb`);
}
