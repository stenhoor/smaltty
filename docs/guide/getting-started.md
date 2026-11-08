# Getting started

smaltty turns TypeScript into JavaScript an app can run, in the browser, with no dependencies. It is the TypeScript
kit of the smalt apps: smaltui's TypeScript tabs use it, through `smaltkit/typescript`, and smaltnb's notebook cells
are next. Type checking against smaltdf comes after that.

## Install

smaltty is not on npm yet. Depend on a commit of this repository:

```json
"dependencies": { "smaltty": "github:stenhoor/smaltty#<commit>" }
```

npm clones that commit and runs `prepare`, which builds `dist/`: plain ES2022 modules, one file per module, that a page
loads without a bundler. In the smalt apps, use [`smaltkit/typescript`](https://github.com/stenhoor/smaltkit), which
carries smaltty in its own `dist/`.

## Strip types

```ts
import { strip } from 'smaltty';

const js = strip("const n: number = 2;\ntable('orders').head(n)");
// "const n         = 2;\ntable('orders').head(n)"
```

The types become spaces, so every line and column of `js` is the one written. Code that would need compiling (an enum,
for example) is refused with a `SyntaxError` that says where and what to write instead: see
[Stripping types](./stripping).

## Errors

Every error is a `ParseError`, a `SyntaxError` with the 1-based `line` and `column`, and a message that starts with
them:

```ts
import { strip, ParseError } from 'smaltty';

try {
  strip("table('orders').head(n;", { fileName: 'tab.ts' });
} catch (e) {
  if (e instanceof ParseError) console.log(e.line, e.column, e.message);
  // 1 23 "tab.ts, line 1, column 23: ',' expected, found ';'."
}
```

## As a Transpiler

The default export is a Transpiler, `{ name, version, transpile }`, the shape an app takes when it offers more than one
way to run TypeScript:

```ts
import smaltty from 'smaltty';

smaltty.transpile(code, { filename: 'tab.ts' });
```

## The rest of the kit

- [`parse`](./parsing) gives TypeScript's syntax tree, stored flat.
- [`bind`](./binding) says which declaration each name means.
