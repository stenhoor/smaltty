// Emits code: a namespace with values is an object at run time.
namespace Space {
  export const value = 1;
  export namespace Inner { export function f(): number { return value; } }
}
module Legacy { export const v = 2; }
namespace TypesOnly { export type T = string; }
export { Space, Legacy };
