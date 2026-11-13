# Prepared declarations

A page's first check used to parse the declarations it checks against (a library's `.d.ts`) and the built-in types
before it could check a line. `prepare(files)` does that work once, when an app is built: it parses and binds the
files and writes them as one buffer. `check()` reads the buffer in place of the text, so a page's first check parses
only the code it checks.

```ts
import { prepare } from 'smaltty/check';

// At build time: the declarations, path to text, as check() would be given them.
const buffer: Uint8Array = prepare({ '/df/index.d.ts': dfIndex, '/df/frame.d.ts': dfFrame });
writeFileSync('types.bin', buffer);
```

```ts
import { check, readPrepared } from 'smaltty/check';

// In the page (or its worker): the buffer as fetched, beside the code.
const prepared = await (await fetch('types.bin')).arrayBuffer();
const errors = check(new Map([['/code.ts', code]]), {
  roots: ['/code.ts'],
  packages: { '@smaltdb/df': '/df/index.d.ts' },
  prepared,
});
```

`prepare()` and `readPrepared()` come from `smaltty/check` and `smaltty`, not `smaltty/strip`: a page that only strips
types loads none of it.

## What the buffer holds

Each file's text, its tree (already flat typed arrays, as `parse()` builds it; four of its columns written as
differences, which compress better) and its bindings (`bind()`'s symbols and typed arrays), and whether the file may
augment a module. A header says what wrote it: a format version (`PREPARED_FORMAT`), smaltty's version, and a
fingerprint of the node kinds, flags and meanings its numbers stand for, with the buffer's length and a checksum.

The files in a buffer are files of the check, as `files` are: imports resolve to them, `packages` and `globals` can
name them. Each is read when the checker first needs it, and then kept with the files `readPrepared()` returns, so
checks that pass the same buffer (or the same `PreparedFiles`) read each file once. `readPrepared(buffer).readAll()`
reads them all at once, for a worker that warms itself while the page is idle.

The built-in types are prepared the same way when smaltty is built (`npm run build` ends by writing them into
`dist/builtins-prepared.js`), so no first check parses them.

## A buffer this smaltty can't read

A buffer is persisted outside smaltty (an app's build writes it; a browser may keep one from an earlier deploy), so a
later smaltty may be given an earlier one. It is read only if its format, smaltty version and fingerprint are this
smaltty's, and its length and checksum are right. Any other buffer is ignored, never read:

- `readPrepared(buffer)` gives `undefined`;
- `check()` with it reads only `files`: give the files' text there too, or check with `readPrepared()` first and fetch
  the text when it gives `undefined` (smaltkit's worker does this, from its setup's `fallback`).

Without the text, the files are unknown to the checker, and unknown is quiet: a stale buffer never gives a wrong error.
A path given both as text and in the buffer is read from the buffer only when the texts are the same; otherwise the
text is the file.

## How it is checked

`test/prepared.test.ts`: every prepared file reads back as the tree and bindings `parse()` and `bind()` give its text,
node for node; a prepared check gives exactly the errors a check of the text gives on the checker tests' workloads and
mutants (smaltts's examples, smaltdf's API from its source and its `.d.ts`, smaltui's tabs with smaltdf's exports as
globals, `@ts-expect-error` lines, module augmentations); and a buffer of another format, smaltty or node kinds, cut
short, with a byte changed, empty, or not one of ours, is ignored, with the text's answer when the text is given and
none when it isn't.

What it saves is in [Benchmarks](../BENCHMARKS) ("What milestone 11 says").
