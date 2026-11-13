# Parsing

`parse(code, { fileName })` returns a `Tree`: TypeScript's own syntax tree, with the same node kinds (by name), the
same children in the same order, and the same start and end for every node. Code that knows TypeScript's tree reads
this one.

```ts
import { parse, K } from 'smaltty/strip';

const tree = parse('const a: number = 1;');
tree.walk(tree.root, (n, depth) => console.log('  '.repeat(depth) + tree.kindName(n), tree.textOf(n)));
// VariableStatement const a: number = 1;
//   VariableDeclarationList const a: number = 1
//     VariableDeclaration a: number = 1
//       Identifier a
//       NumberKeyword number
//       NumericLiteral 1
```

## The tree

The tree is stored flat: a row per node, in typed arrays, all in one buffer, with no object per node.

| Column | Per node |
| --- | --- |
| `kind` | the node kind (`K.Identifier`, …); `kindName(n)` gives its name |
| `start`, `end` | offsets in the source, the end exclusive |
| `first`, `next` | the first child and the next sibling (0 for none) |
| `flags` | modifiers and small facts (`F.Export`, `F.Optional`, `F.Async`, …) |
| `data` | the operator of a unary, binary or type operator expression |

Node 0 is "no node", and `tree.root` is the SourceFile. `tree.children(n)` lists a node's children; `tree.walk(n, fn)`
visits a subtree, parents first.

Modifiers and punctuation are not nodes, as they are in TypeScript: a modifier is a flag on its declaration.

## Errors

The parser stops at the first syntax error and throws a `ParseError` with its line and column. There is no recovery.
The checker can check through syntax errors, setting aside the statement each is in: see [Syntax errors](./syntax-errors).

## How it is checked

The tests compare the tree with TypeScript's node for node (kind, start, end) on the
[corpus](../../corpus/README.md), TypeScript's and Node's declarations, and TypeScript's 9 MB compiler; and every prefix
of the app code either parses or fails cleanly, agreeing with TypeScript on which.
