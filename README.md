# smaltty

<a href="https://smaltworks.dev/stability"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/stenhoor/smalt-brand/main/badges/work-in-progress-on-dark.svg"><img alt="Work in progress. Come build with us." src="https://raw.githubusercontent.com/stenhoor/smalt-brand/main/badges/work-in-progress.svg" height="56"></picture></a>

**Small. Alternative. Code.** TypeScript for the smalt apps. smaltty is smalt's own implementation of TypeScript, a
top-level smalt product: it parses, strips, binds and type-checks TypeScript in the browser, with no dependencies.

[Documentation](https://stenhoor.github.io/smaltty/) · [smaltworks.dev](https://smaltworks.dev/products/smaltty)

- **Stripping:** types become spaces, so every line and column of the JavaScript is the one written, by TypeScript's
  own rules.
- **Parsing:** TypeScript's own syntax tree, node for node, stored flat.
- **Binding:** which declaration each name means, the way TypeScript's checker says.

```ts
import { strip } from 'smaltty';

strip("const n: number = 2;\ntable('orders').head(n)");
// "const n         = 2;\ntable('orders').head(n)"
```

smaltty is not on npm yet: depend on a commit (`"smaltty": "github:stenhoor/smaltty#<commit>"`). The smalt apps use it
through `smaltkit/typescript`.

```bash
npm install && npm test     # build, then the tests (which compare smaltty with TypeScript)
```

```bash
npm run bench               # the benchmarks in docs/BENCHMARKS.md
```

```bash
npm run docs:dev            # the documentation site
```

<a href="https://smaltworks.dev"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/stenhoor/smalt-brand/main/badges/a-smaltworks-project-on-dark.svg"><img alt="A smaltworks project" src="https://raw.githubusercontent.com/stenhoor/smalt-brand/main/badges/a-smaltworks-project.svg" height="28"></picture></a>

MIT License.
