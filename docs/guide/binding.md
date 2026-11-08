# Binding names

`bind(tree)` says which declaration each name means. It follows TypeScript's binder and name resolution, on one file:
a name declared nowhere in the file (a global, the target of an import) is unresolved.

```ts
import { parse, bind, K, Meaning } from 'smaltty';

const tree = parse('const total = 1;\nfunction f(n: number) { return total + n }');
const b = bind(tree);
for (let n = 1; n < tree.count; n++) {
  if (tree.kind[n] !== K.Identifier) continue;
  const d = b.declaration(n);
  console.log(tree.textOf(n), '→', d ? `line ${tree.text.slice(0, tree.start[d]).split('\n').length}` : 'unbound');
}
```

## What it answers

- `b.declaration(id)`: the name node of the first declaration of the symbol an identifier declares or refers to, or 0.
- `b.symbol(id)`: that symbol: its `name`, its `meaning`, and all its `declarations`.
- `b.meaningOf[id]`: what a reference was looked up as: `Meaning.Value`, `Meaning.Type` or `Meaning.Namespace`.
- `b.parent[n]`: each node's parent.

## TypeScript's rules

- Scopes where TypeScript has them: functions (whose body shares the function's scope), blocks, `for` statements,
  `catch`, classes, namespaces, type parameters, mapped and conditional types.
- `var`, and functions outside strict code, are hoisted to their function; `let`, `const` and classes stay in their
  block.
- A name has separate meanings as a value, a type and a namespace: `x: T` looks for a type, `typeof T` for a value.
- Merged declarations share: an interface and a class of the same name share their type parameters, and the blocks of
  a namespace share its exports.
- `infer U` names `U` in its conditional type's true branch.
- Imports answer to every meaning, since what they import is outside the file.

Property names (`b` in `a.b`, members of classes, interfaces and object literals) are not bound: what they mean depends
on types.

## How it is checked

For every name it binds, the binder must name the declaration TypeScript's checker names, run on one file with no lib
(the way smaltnb used it): the corpus, TypeScript's and Node's declarations, TypeScript's compiler, all the TypeScript
in the smalt repositories, and sucrase. That is over 500,000 names, with no differences.
