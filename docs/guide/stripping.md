# Stripping types

`strip(code, { fileName })` returns JavaScript with the types replaced by spaces. Line breaks stay, so the JavaScript
has the same length as the TypeScript, and every line and column in it is the one written: an error in the running
code points at what the user typed.

## What goes

- Type annotations and return types: `x: number`, `(): string`.
- Type parameters and type arguments: `<T>`, `f<string>(x)`, `new Map<string, number>()`.
- `as T`, `satisfies T`, and the non-null `!`.
- `?` on parameters and class members, the definite `!` in `let x!: number`.
- `this` parameters, `implements` clauses, and the modifiers `public`, `private`, `protected`, `readonly`, `abstract`,
  `override` and `declare`.
- Whole declarations that are only types: interfaces, type aliases, anything declared with `declare`, namespaces with
  no values, overloads, abstract members and index signatures.
- Imports and exports marked `type`: `import type { … }`, `import { type A, B }`, `export type { … }`.

Imports and exports are otherwise kept as written, as in TypeScript's `verbatimModuleSyntax`: an import of something
that is only a type says `type`.

## What is refused

Types are removed, never compiled, as with TypeScript's `erasableSyntaxOnly`. Code that would make code of its own is
refused with a `SyntaxError` that gives its line and column and says what to write instead:

| Instead of | Write |
| --- | --- |
| `enum Color { Red, Green }` | `const Color = { Red: 'red', Green: 'green' } as const` |
| `<number>x` | `x as number` |
| `constructor(private n: number) {}` | a field `n: number`, assigned in the constructor |
| `namespace N { export const x = 1 }` | a module, or an object: `const N = { x: 1 }` |
| `import fs = require('fs')` | `import … from` |
| `export = x` | `export default x` |

`declare enum`, `declare namespace` and namespaces holding only types make no code, and are stripped.

## Two edits that keep the meaning

Removing text alone could change what the code means in two places, so the stripper writes one character there:

- **A `;`.** A statement that ended without a semicolon, and whose last token was a type, gets a `;` where the removed
  text starts, as does every removed statement. Otherwise a next line starting with `(` or `[` would join it:
  `x as T` followed by `(f)()` on the next line would become a call.
- **A `)`.** `=>` must be on the line of an arrow function's `)`. When the return type spans lines, the `)` moves to
  the end of the removed type.

## How it is checked

The stripped program is the one TypeScript's own transpile gives with `verbatimModuleSyntax`, on the
[corpus](../../corpus/README.md) and on the TypeScript in the smalt repositories; and smaltty's own tests run on code
smaltty stripped. See [Benchmarks](../BENCHMARKS) for the numbers.
