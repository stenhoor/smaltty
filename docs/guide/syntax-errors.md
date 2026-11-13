# Syntax errors

While someone types, a line is often half written: `rows.` with no name after the dot, a call not closed yet, a string
not ended. The parser stops at the first syntax error ([Parsing](./parsing)), and by default `check()` reports nothing
for a file that doesn't parse. From 0.14.0, `check()`'s `syntax: 'tolerant'` checks through it: the top-level
statement the error is in is set aside and reported, and the file's other statements are checked as usual. A
notebook's cells are its file's top-level statements, so a cell half typed is set aside and the others are checked.

```ts
import { check } from 'smaltty/check';

const code = `import { make } from './lib.js';
const p = make(1, 2);
p.nrom();
const q = make(1, 2
q.anything;
`;
check(new Map([...libraries, ['/code.ts', code]]), { roots: ['/code.ts'], syntax: 'tolerant' });
// 1005 ',' expected, found 'q'.                        (line 5: the call on line 4 isn't closed)
// 2339 Property 'nrom' does not exist on type 'Point'.  (line 3, checked as usual)
```

## What is set aside

The statement starts where the last top-level statement the parser finished ends. Where it ends isn't known, as the
parser stopped inside it: it is taken to end at the first line after it that could start a statement (no more indented
than its own first line, and not starting with a closing bracket or an operator such as `.`) where the rest of the
file parses. Its text is replaced by spaces, keeping its line breaks, so every other statement keeps its lines,
columns and offsets; the parse is repeated for each further error, so each broken statement is set aside on its own.

What the statement declared is unknown, and the checker is quiet about what it doesn't know: a later statement that
uses a name it declared has no error from that. A file read only for its declarations (a library) is read the same
way, so a syntax error in it hides only the statement it is in.

A string or template literal not closed ends at the line break (a string) or at the next backtick (a template), as in
TypeScript: a template opened and closed by the next template's backtick takes the statements between as its text.

## The errors

Each statement set aside is reported once, at the place the parser stopped, or, where it read on past the line after
the statement (`x.` followed by a statement on the next line), where the statement's text ends:

| | |
| --- | --- |
| `code` | TypeScript's code for the same error where it has one: 1005 (`'x' expected`), 1109 (an expression expected), 1110 (a type), 1003 (a name), 1128 (a declaration), 1002, 1160 and 1161 (a string, template or regular expression not closed), 1010 (a comment not closed), 1127 (an invalid character), 1351 (a name right after a number). Otherwise 1000, which TypeScript doesn't use. All are under 2000, TypeScript's syntax errors, apart from its type errors |
| `message` | smaltty's parser's message (the same as `ParseError`'s, without the line and column) |
| `start`, `length` | the token there, or none at the end of a line |

A root's syntax errors come before its other errors. `// @ts-expect-error`, `// @ts-ignore` and `// @ts-nocheck` don't
silence them, as in TypeScript. Syntax TypeScript accepts that smaltty's parser doesn't (decorators) is set aside but
not reported.

## Only for checking

The tolerant tree isn't TypeScript's tree of the file, so it is used only to check: `parse()`, `strip()` and
`transpile()` still stop at the first error and throw `ParseError`, and their trees still match TypeScript's node for
node. With `syntax` left out, or `'strict'`, `check()` is as before 0.14.0. An app turns it on when it stops reporting
syntax errors its own way, so none is shown twice.

It works with a [cache](./rechecks): a check after an edit that makes or fixes a syntax error gives a cold check's
errors, and the statements it didn't touch keep theirs. A cache shared with strict checks reads a file the tolerant
parse read as one that doesn't parse. [Prepared declarations](./prepared) are always of files that parse.

## How it is checked

`test/tolerant.test.ts` takes every mutant of the checker tests' workloads (smaltts's examples, smaltdf's API in the
apps, notebooks and a generated script, smaltui's tabs with smaltdf's exports as globals: about 2,000 files) and adds a
syntax error to one top-level statement, of eight kinds: a parenthesis or a brace not closed, a stray `]`, a member
access half typed (`x.`), an arrow function with no body, a string and a template not closed, a declaration with no
name. For each, it requires:

- one syntax error, in the statement broken or at the token right after it;
- the other errors exactly those of a check of the same file with the statement removed (replaced by spaces, so every
  offset is the same): a file with no syntax error, which the other checker tests hold to TypeScript 7;
- and every one of them an error TypeScript 7 reports on the file with the statement removed.

It also checks the cache (each kind of error made, read strictly, again, and fixed, each as a cold check), prepared
declarations, notebooks, and that with the option off a root with a syntax error reports nothing, as before.
