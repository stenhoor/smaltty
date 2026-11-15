# More checks

Milestone 14 widens what the checker catches, a group of checks at a time. Each group is off unless `check()`'s
`checks` names it, as [ADR 0030](../adr/0030-changing-smaltty-without-breaking-its-consumers) says new errors come: an
app turns a group on once the errors it finds in that app's own code are fixed. With `checks` left out, `check()` is as
before 0.15.0.

```ts
import { check } from 'smaltty/check';

const code = `import { LinearRegression, StandardScaler, trainTestSplit } from '@smaltworks/smaltml';
const model = await new LinearRegression().fit(X, y);
model.coeff;
trainTestSplit();
const n: number = new StandardScaler().fitSync(X).transformSync(X);
`;
check(new Map([...library, ['/code.ts', code]]), { roots: ['/code.ts'], checks: ['this', 'overloads', 'variables'] });
// 2551 Property 'coeff' does not exist on type 'LinearRegression'. Did you mean 'coef'?
// 2554 Expected 1-3 arguments, but got 0.
// 2322 Type 'Matrix' is not assignable to type 'number'.
```

## The groups

| Group | What it checks | Codes |
| --- | --- | --- |
| `'this'` | A member's `this` type is the type it is read from. A method that returns `this` or `Promise<this>` gives its receiver (`await new Model().fit(x)` is a `Model`; on a subclass, the subclass), and that receiver's members are checked. Without it such a value is unknown, and quiet | 2339, 2551 |
| `'overloads'` | A call to an overloaded function or method, or a `new` of a class with overloaded constructors, with an argument count no overload takes. Without it only a function with one signature has its count checked | 2554, 2555, and 2575 for a count between two overloads' |
| `'variables'` | An annotated variable whose initializer can't be assigned to its annotation, reported at its name, and an object literal there checked as an argument's is | 2322, 2353, 2561 |

Each error is TypeScript 7's, with its code, place and message. What the checker can't say for certain stays quiet, as
everywhere else:

- `'overloads'` is quiet where an overload has a rest parameter, or the call has type arguments (TypeScript first keeps
  the overloads that take that many). Which overload a call means, where its count fits one, is overload resolution
  (2769), not modelled.
- `'variables'` reports 2322 only where one side is a primitive or a literal (`number`, `'a' | 'b'`), and the value's
  type is one it writes as TypeScript does (a primitive, a literal, a class or interface by name). Between two objects
  TypeScript often names the properties missing instead (2739, 2741), and an alias's expansion isn't how it writes the
  alias; milestone 15 brings both. A destructuring isn't checked yet.

The checks work with a [cache](./rechecks): a check with other groups than the cache's last is checked again where they
change what a statement finds, and gives a cold check's errors.

## How it is checked

`test/checker.test.ts` holds each group to TypeScript 7 on the forms above and on those where it must stay quiet, and
each on its own, off by default. `CHECKS=1 node --test test/checker.test.ts` runs every comparison in the checker
tests with all the groups on: no error TypeScript doesn't report, and smaltts's mutated examples caught 694 of 847
(from 662 without them). `node test/checking.ts <project> --checks` compares a project's files with TypeScript 7 the
same way.
