// The checker's tolerant parse (milestone 13, ADR 0029 decision 4): a syntax error is kept to the top-level statement
// it is in, which is blanked, and the rest of the file is parsed as usual.
//
// The strict parse stops at the first error, with where the last top-level statement before it ends (parseOrStop).
// The broken statement starts there; where it ends isn't known, as the parser stopped inside it. It is taken to end
// at a line where a statement could start: one no more indented than the line it starts on, starting with something
// other than a closing bracket or an operator that continues an expression. The text from its start to the first such
// line is blanked: `;` where it starts (so the statement before it can't run on into what follows) and spaces for the
// rest, keeping every line break, so every other statement keeps its offsets, lines and columns. The text is parsed
// again: if it parses, that is the tree; if it stops in a later statement, that statement is the next error's; if it
// stops in the statement at that line, the next such line is tried. The tree is of the text so blanked, not
// TypeScript's of the original, and is used only for checking, never for stripping.
//
// Each blanked region is one error, the parser's first in it, reported with the parser's message and position. Its
// code is TypeScript's for the same error where TypeScript has one code for it (`';' expected` is 1005), else
// SYNTAX_ERROR, a code TypeScript doesn't use. Syntax smaltty's parser refuses that TypeScript accepts (decorators) is
// blanked but not reported: what the checker doesn't model is unknown and quiet.
import { parseOrStop } from './parser.js';
import type { ParseError } from './scanner.js';
import type { Tree } from './tree.js';

/** The code of a syntax error TypeScript has no single code for: 1000, which TypeScript doesn't use. */
export const SYNTAX_ERROR = 1000;

/** A syntax error the tolerant parse found, at an offset of the file's text. */
export interface SyntaxProblem {
  readonly start: number;
  readonly length: number;
  readonly code: number;
  readonly message: string;
}

/** The file's tree with each statement that has a syntax error blanked, and those errors. */
export interface TolerantParse {
  readonly tree: Tree;
  readonly errors: readonly SyntaxProblem[];
}

/** At most this many statements are blanked one by one; then the rest of the file is. */
const MAX_REGIONS = 100;
/** At most this many parses in all; then the rest of the file is blanked. */
const MAX_PARSES = 400;

/** Parses `text`, keeping each syntax error to the top-level statement it is in. */
export function parseTolerant(text: string, fileName?: string): TolerantParse {
  const first = parseOrStop(text, fileName);
  if (!('error' in first)) return { tree: first, errors: [] };
  const errors: SyntaxProblem[] = [];
  let cur = text;
  let stop = first;
  let parses = 1;
  for (;;) {
    const start = skipTrivia(cur, stop.after);
    let next: TreeOrStop | undefined;
    let blanked = '';
    let cut = cur.length;
    if (errors.length < MAX_REGIONS - 1 && parses < MAX_PARSES) {
      for (const c of cuts(cur, start)) {
        blanked = blank(cur, start, c);
        const r = parseOrStop(blanked, fileName);
        parses++;
        // Parsed, or stopped in a later statement (that is the next error's).
        if (!('error' in r) || skipTrivia(blanked, r.after) > c) {
          next = r;
          cut = c;
          break;
        }
        if (parses >= MAX_PARSES) break;
      }
    }
    const problem = problemOf(stop.error, cur, fileName, start, cut);
    if (problem) errors.push(problem);
    if (next !== undefined && !('error' in next)) return { tree: next, errors };
    if (next !== undefined) {
      cur = blanked;
      stop = next;
      continue;
    }
    // Nothing up to the end of the file parses after it: blank the rest. The statements before it parsed, so that
    // parses, unless blanking changed how the file is read (a module no longer, say): then nothing is checked.
    const rest = parseOrStop(blank(cur, start, cur.length), fileName);
    if (!('error' in rest)) return { tree: rest, errors };
    const none = parseOrStop(blank(text, 0, text.length), fileName);
    if ('error' in none) throw none.error; // `;` and spaces: never
    return { tree: none, errors };
  }
}

type TreeOrStop = ReturnType<typeof parseOrStop>;

/** The offsets where a statement starting at `start` may end: lines that could start a statement, then the end. */
function* cuts(text: string, start: number): Generator<number> {
  let lineStart = start;
  while (lineStart > 0 && !isLineBreak(text.charCodeAt(lineStart - 1))) lineStart--;
  const indent = skipBlank(text, lineStart) - lineStart;
  for (let i = start; i < text.length; i++) {
    if (!isLineBreak(text.charCodeAt(i))) continue;
    const at = skipBlank(text, i + 1);
    if (at >= text.length) break;
    const c = text.charCodeAt(at);
    if (isLineBreak(c) || at - (i + 1) > indent || CONTINUES.has(c)) continue;
    yield i + 1;
  }
  yield text.length;
}

/** Characters a line can't start a statement with: closing brackets and operators that continue an expression. */
const CONTINUES = new Set([...')]}.,:?=|&>'].map((c) => c.charCodeAt(0)));

/** `text` with [from, to) blanked: `;` at its first character that isn't a space, spaces for the rest, line breaks kept. */
function blank(text: string, from: number, to: number): string {
  let out = '';
  let semi = false;
  for (let i = from; i < to; i++) {
    const c = text.charCodeAt(i);
    if (isLineBreak(c)) out += text[i];
    else if (!semi && c !== 32 && c !== 9) {
      out += ';';
      semi = true;
    } else out += ' ';
  }
  return text.slice(0, from) + out + text.slice(to);
}

/** The first offset from `pos` that isn't whitespace or a comment (a comment not closed is where it starts). */
function skipTrivia(text: string, pos: number): number {
  while (pos < text.length) {
    const c = text.charCodeAt(pos);
    if (c === 47 && text.charCodeAt(pos + 1) === 47) {
      while (pos < text.length && !isLineBreak(text.charCodeAt(pos))) pos++;
      continue;
    }
    if (c === 47 && text.charCodeAt(pos + 1) === 42) {
      const end = text.indexOf('*/', pos + 2);
      if (end < 0) break;
      pos = end + 2;
      continue;
    }
    if (c !== 32 && c !== 9 && c !== 11 && c !== 12 && c !== 0xfeff && c !== 0xa0 && !isLineBreak(c)) break;
    pos++;
  }
  return pos;
}

/** The first offset from `pos` that isn't a space or a tab. */
function skipBlank(text: string, pos: number): number {
  while (pos < text.length && (text.charCodeAt(pos) === 32 || text.charCodeAt(pos) === 9)) pos++;
  return pos;
}

function isLineBreak(c: number): boolean {
  return c === 10 || c === 13 || c === 0x2028 || c === 0x2029;
}

/** Syntax TypeScript accepts that smaltty's parser refuses: blanked, not reported. */
const UNSUPPORTED = /^(Decorators are not supported|Import attributes in import types are not supported|'export as namespace' is not supported)\./;

/** TypeScript's code for the same syntax error, by the start of smaltty's message. */
const CODES: readonly (readonly [RegExp, number])[] = [
  [/^'[^']*' expected[.,]/, 1005],
  [/^An expression expected/, 1109],
  [/^A type expected/, 1110],
  [/^A name expected/, 1003],
  [/^A declaration expected/, 1128],
  [/^The string is not closed/, 1002],
  [/^The template literal is not closed/, 1160],
  [/^The regular expression is not closed/, 1161],
  [/^The comment is not closed/, 1010],
  [/^Invalid character '/, 1127],
  [/^An identifier cannot follow a number directly/, 1351],
];

/**
 * The error as a diagnostic: smaltty's message without the file, line and column, at the token it is about. Where the
 * parser read past the statement blanked, [start, cut), and the token after it, before it stopped (`x.` and a
 * statement on the next line read as `x.const`), it is reported where the statement's text ends, as TypeScript does:
 * after a `.`, a name expected (TypeScript's 1003).
 */
function problemOf(e: ParseError, text: string, fileName: string | undefined, start: number, cut: number): SyntaxProblem | undefined {
  const prefix = `${fileName ? `${fileName}, ` : ''}line ${e.line}, column ${e.column}: `;
  let message = e.message.startsWith(prefix) ? e.message.slice(prefix.length) : e.message;
  if (UNSUPPORTED.test(message)) return undefined;
  let pos = e.pos;
  if (pos > tokenEnd(text, skipTrivia(text, cut))) {
    pos = cut;
    while (pos > start && isSpace(text.charCodeAt(pos - 1))) pos--;
    if (text.charCodeAt(pos - 1) === 46) message = 'A name expected, found the end of the line.';
  }
  const code = CODES.find(([re]) => re.test(message))?.[1] ?? SYNTAX_ERROR;
  return { start: pos, length: tokenLength(text, pos), code, message };
}

function isSpace(c: number): boolean {
  return c === 32 || c === 9 || isLineBreak(c);
}

/** Where the word at `pos` ends, or the character there. */
function tokenEnd(text: string, pos: number): number {
  return pos + Math.max(tokenLength(text, pos), 1);
}

/** The length of the word at `pos`, or one character (none at the end of a line or of the text). */
function tokenLength(text: string, pos: number): number {
  if (pos >= text.length || isLineBreak(text.charCodeAt(pos))) return 0;
  let end = pos;
  while (end < text.length && /[\p{ID_Continue}$]/u.test(text[end]!)) end++;
  return Math.max(end - pos, 1);
}
