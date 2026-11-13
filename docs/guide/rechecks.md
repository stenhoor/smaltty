# Re-checks

An editor checks the same code again after every edit. A cache kept between checks makes that cheap: `checkCache()`
keeps the files `check()` parsed, and, from 0.13.0, each root's results statement by statement. After an edit the
root is parsed again (parsing is cheap), and only the top-level statements whose text, or the declarations they use,
changed are checked again; the others keep their errors. A notebook's cells are its file's top-level statements, so an
edit in one cell checks that cell and the cells that read what it declares.

```ts
import { check, checkCache } from 'smaltty/check';

const cache = checkCache();
const files = new Map([...libraries, ['/code.ts', code]]);
const options = { roots: ['/code.ts'], packages: { '@smaltdb/df': '/df/index.d.ts' }, cache };

check(files, options); // the first check: everything
files.set('/code.ts', edited);
check(files, options); // the statements the edit changed, and those that read what they declare
```

The errors are always a cold check's: the same errors, in the same order, at the same places, as `check()` without a
cache gives. What a statement's errors depend on is recorded as it is checked:

- **Its text.** A statement edited is checked again. Statements that moved (text added or taken away before them) keep
  their errors, moved with them.
- **The names it resolves** to the file's top-level declarations, or to none (a global, a built-in type), including
  the names inside the declarations it follows: a declaration of such a name edited, added or taken away checks it
  again. An import is a declaration of the names it imports.
- **Other statements' results it reads** (a declaration's type, a call resolved where it was declared): it keeps its
  errors only if those statements keep theirs.
- **The rest of the check:** the other files, `packages`, `globals` and `prepared` (the same buffer or `PreparedFiles`
  object). A change to any of them checks every statement again; so does a `declare module` block in the root added,
  edited or taken away, and a statement that reads its own file as a module (an import of itself).

Where the checker cuts a result short (a cycle, such as `const a = b; const b = a;`, or a type nested too deep), what
it finds may depend on what was checked before, so such a check keeps no statement's errors: the root is checked whole,
as without a cache, until the cycle is gone.

A cache made with `checkCache({ statements: false })`, or a cache object made by hand without `statements` (as before
0.13.0), keeps only the parsed files, and each root is checked whole. `cache.statements.get(root)` tells what the last
check did: `reused` statements kept their errors, `checked` were checked.

## How it is checked

`test/incremental.test.ts` checks with a cache and without one after every kind of edit, and requires the same errors:
on smaltts's examples and their mutants, smaltdf's API in the apps and in generated scripts and their mutants,
smaltui's tabs with smaltdf's exports as globals, smaltnb's notebooks and the 40 KB generated script. The edits: inside
one statement, a line added, a statement inserted, deleted or moved, a comment at the top (every statement moves), a
declaration renamed where it is declared and everywhere, an interface merged, a global declared in the file, each
imported name taken out, the module imported changed, a module augmented, `@ts-expect-error` and `@ts-nocheck` added, a
syntax error; then a library file edited, the globals, the packages and prepared declarations changed. Every mutant of
each workload is also checked as an edit of the one before it.

What it saves is in [Benchmarks](../BENCHMARKS) ("What milestone 12 says").
