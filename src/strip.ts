// The stripper: TypeScript in, JavaScript out, with the types replaced by spaces. Nothing moves: every line and column
// of the output is the line and column of the source, so an error in the running code points at what was written.
//
// What goes:
// - found by the parser as it parses: type annotations, return types, type parameters and arguments, `as` and
//   `satisfies` with their types, non-null `!`, `?` on parameters and class members, definite `!`, `this`
//   parameters, `implements` clauses, and the modifiers public, private, protected, readonly, abstract, override and
//   declare;
// - found here, in the tree: interfaces, type aliases, anything declared with `declare`, namespaces with no values,
//   overloads and abstract members, index signatures in classes, and imports and exports marked `type`.
//
// Imports and exports are kept as written unless marked `type` (TypeScript's verbatimModuleSyntax): an import of
// something that is only a type must say so (`import { type Order }`), or the import stays in the output.
//
// What can't be stripped, because it makes code (TypeScript's erasableSyntaxOnly): enums, namespaces with values,
// parameter properties, `import x = …`, `export =`, and `<T>x` type assertions. Each is reported as a SyntaxError with
// its line and column, saying what to write instead.
import { F, K, isTypeNode } from './kinds.js';
import { parseWithErasures } from './parser.js';
import { ParseError, Scanner, lineAndColumn } from './scanner.js';
import { T } from './tokens.js';
import type { Tree } from './tree.js';

export interface StripOptions {
  /** The file name, used in error messages. */
  fileName?: string;
}

/** JavaScript for `code`: its types replaced by spaces. Throws a SyntaxError with the line and column. */
export function strip(code: string, options: StripOptions = {}): string {
  const { tree, erase } = parseWithErasures(code, options.fileName);
  const s = new Stripper(tree, erase, options.fileName);
  s.visit(tree.root);
  return s.output();
}

const SEMICOLON = 59;

/** Statements (and class members) that can end without a semicolon. */
function endsWithOptionalSemicolon(kind: number): boolean {
  switch (kind) {
    case K.VariableStatement: case K.ExpressionStatement: case K.ReturnStatement: case K.ThrowStatement:
    case K.BreakStatement: case K.ContinueStatement: case K.DoStatement: case K.DebuggerStatement:
    case K.ExportAssignment: case K.ExportDeclaration: case K.ImportDeclaration: case K.PropertyDeclaration:
      return true;
  }
  return false;
}

class Stripper {
  readonly t: Tree;
  readonly text: string;
  readonly fileName: string | undefined;
  /** Triples: start, end, character to write at the end (0: none). From the parser, then from the tree. */
  readonly ranges: number[];
  /** Ranges that are whole statements or members: a `;` goes at their start (see output). */
  readonly statements: number[] = [];
  /** Ends of statements that ended without a semicolon. */
  readonly asiEnds: number[] = [];

  constructor(tree: Tree, ranges: number[], fileName: string | undefined) {
    this.t = tree;
    this.text = tree.text;
    this.ranges = ranges;
    this.fileName = fileName;
  }

  error(message: string, pos: number): never {
    const { line, column } = lineAndColumn(this.text, pos);
    throw new ParseError(`${this.fileName ? `${this.fileName}, ` : ''}line ${line}, column ${column}: ${message}`, pos, line, column);
  }

  /** Removes a whole statement or class member; its first character becomes `;` (see output). */
  eraseStatement(n: number): void {
    this.statements.push(this.t.start[n]!, this.t.end[n]!);
  }

  visit(n: number): void {
    const t = this.t;
    for (let c = t.first[n]!; c; c = t.next[c]!) {
      const kind = t.kind[c]!;
      if (isTypeNode(kind)) continue; // already in the parser's ranges, nothing inside to keep
      const flags = t.flags[c]!;
      switch (kind) {
        case K.InterfaceDeclaration: case K.TypeAliasDeclaration:
        case K.IndexSignature:
          this.eraseStatement(c);
          continue;
        case K.VariableStatement: case K.ClassDeclaration: case K.EnumDeclaration:
          if (flags & F.Declare) {
            this.eraseStatement(c);
            continue;
          }
          if (kind === K.EnumDeclaration) {
            this.error('An enum makes code, so it can\'t be stripped: use an object instead (const Color = { Red: \'red\' } as const).', t.start[c]!);
          }
          break;
        case K.FunctionDeclaration:
          if (flags & F.Declare || !this.hasChild(c, K.Block)) {
            this.eraseStatement(c); // an overload, or declared
            continue;
          }
          break;
        case K.MethodDeclaration: case K.Constructor: case K.GetAccessor: case K.SetAccessor:
          // Overloads and abstract members have no body. (Object literal methods always have one.)
          if (!this.hasChild(c, K.Block)) {
            this.eraseStatement(c);
            continue;
          }
          if (kind === K.Constructor) this.checkParameterProperties(c);
          break;
        case K.PropertyDeclaration:
          if (flags & (F.Declare | F.Abstract)) {
            this.eraseStatement(c);
            continue;
          }
          break;
        case K.ModuleDeclaration:
          if (flags & F.Declare || !this.isInstantiated(c)) {
            this.eraseStatement(c);
            continue;
          }
          this.error('A namespace with values makes code, so it can\'t be stripped: use a module, or an object.', t.start[c]!);
          break;
        case K.ImportDeclaration:
          if (this.importIsTypeOnly(c)) {
            this.eraseStatement(c);
            continue;
          }
          break;
        case K.ExportDeclaration:
          if (flags & F.TypeOnly) {
            this.eraseStatement(c);
            continue;
          }
          break;
        case K.ImportSpecifier: case K.ExportSpecifier:
          if (flags & F.TypeOnly) this.eraseSpecifier(c);
          continue;
        case K.ImportEqualsDeclaration:
          this.error('import … = makes code, so it can\'t be stripped: use import … from, or a const.', t.start[c]!);
          break;
        case K.ExportAssignment:
          if (flags & F.ExportEquals) this.error('export = can\'t be stripped: use export default.', t.start[c]!);
          break;
        case K.TypeAssertionExpression:
          this.error('A <T>x type assertion can\'t be stripped: write x as T.', t.start[c]!);
          break;
      }
      if (endsWithOptionalSemicolon(kind) && this.text.charCodeAt(t.end[c]! - 1) !== SEMICOLON) this.asiEnds.push(t.end[c]!);
      if (t.first[c]) this.visit(c);
    }
  }

  hasChild(n: number, kind: number): boolean {
    for (let c = this.t.first[n]!; c; c = this.t.next[c]!) if (this.t.kind[c] === kind) return true;
    return false;
  }

  checkParameterProperties(ctor: number): void {
    const t = this.t;
    for (let c = t.first[ctor]!; c; c = t.next[c]!) {
      if (t.kind[c] === K.Parameter && t.flags[c]! & (F.Public | F.Private | F.Protected | F.Readonly | F.Override)) {
        this.error('A parameter property makes code, so it can\'t be stripped: declare the field, and assign it in the constructor.', t.start[c]!);
      }
    }
  }

  /** TypeScript's module instance state: a namespace with only types, or nothing, makes no code. */
  isInstantiated(n: number): boolean {
    const t = this.t;
    for (let c = t.first[n]!; c; c = t.next[c]!) {
      const k = t.kind[c]!;
      if (k === K.ModuleDeclaration) return this.isInstantiated(c);
      if (k !== K.ModuleBlock) continue;
      for (let s = t.first[c]!; s; s = t.next[s]!) {
        const sk = t.kind[s]!;
        if (sk === K.InterfaceDeclaration || sk === K.TypeAliasDeclaration) continue;
        if (t.flags[s]! & F.Declare) continue;
        if (sk === K.ModuleDeclaration && !this.isInstantiated(s)) continue;
        if ((sk === K.ExportDeclaration) && t.flags[s]! & F.TypeOnly) continue;
        if (sk === K.ImportDeclaration && this.importIsTypeOnly(s)) continue;
        return true;
      }
    }
    return false;
  }

  importIsTypeOnly(n: number): boolean {
    for (let c = this.t.first[n]!; c; c = this.t.next[c]!) {
      if (this.t.kind[c] === K.ImportClause) return !!(this.t.flags[c]! & F.TypeOnly);
    }
    return false;
  }

  /** `type A` in `{ type A, B }`: the specifier and the comma after it go. `{ type A }` becomes `{ }`. */
  eraseSpecifier(n: number): void {
    const start = this.t.start[n]!;
    let end = this.t.end[n]!;
    const sc = new Scanner(this.text);
    sc.pos = end;
    if (sc.next() === T.Comma) end = sc.pos;
    this.ranges.push(start, end, 0);
  }

  /** The source with every range replaced by spaces (line breaks kept), and the `;` and `)` the ranges call for. */
  output(): string {
    const text = this.text;
    // All ranges as [start, end, head, tail]; statements get a `;` head.
    const r = this.ranges;
    const count = r.length / 3 + this.statements.length / 2;
    if (count === 0) return text;
    const starts = new Int32Array(count);
    const ends = new Int32Array(count);
    const heads = new Uint8Array(count);
    const tails = new Uint8Array(count);
    let i = 0;
    for (let k = 0; k < r.length; k += 3, i++) {
      starts[i] = r[k]!;
      ends[i] = r[k + 1]!;
      tails[i] = r[k + 2]!;
    }
    for (let k = 0; k < this.statements.length; k += 2, i++) {
      starts[i] = this.statements[k]!;
      ends[i] = this.statements[k + 1]!;
      heads[i] = SEMICOLON;
    }
    // Sort by start, merging overlaps. Ranges from the parser are mostly in order already.
    const order = Array.from({ length: count }, (_, k) => k).sort((a, b) => starts[a]! - starts[b]! || ends[b]! - ends[a]!);
    const ms: number[] = [];
    const me: number[] = [];
    const mh: number[] = [];
    const mt: number[] = [];
    for (const k of order) {
      const last = ms.length - 1;
      if (last >= 0 && starts[k]! < me[last]!) {
        if (ends[k]! > me[last]!) {
          me[last] = ends[k]!;
          mt[last] = tails[k]!;
        }
        continue;
      }
      if (ends[k]! <= starts[k]!) continue;
      ms.push(starts[k]!);
      me.push(ends[k]!);
      mh.push(heads[k]!);
      mt.push(tails[k]!);
    }
    // A statement that ended without a semicolon, and whose last token was erased: the erased text starts with `;`, or
    // the next line could join it (`x as T` then `(f)()` on the next line would become a call).
    for (const end of this.asiEnds) {
      let lo = 0;
      let hi = ms.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (me[mid]! < end) lo = mid + 1;
        else if (ms[mid]! >= end) hi = mid - 1;
        else {
          if (!mh[mid]) mh[mid] = SEMICOLON;
          break;
        }
      }
    }
    const parts: string[] = [];
    let pos = 0;
    for (let k = 0; k < ms.length; k++) {
      const start = ms[k]!;
      const end = me[k]!;
      if (start > pos) parts.push(text.slice(pos, start));
      parts.push(blank(text, start, end, mh[k]!, mt[k]!));
      pos = end;
    }
    if (pos < text.length) parts.push(text.slice(pos));
    return parts.join('');
  }
}

let spaces = ' '.repeat(256);

/** Spaces for text[start, end), keeping its line breaks; `head` and `tail` (char codes, 0 for none) at the ends. */
function blank(text: string, start: number, end: number, head: number, tail: number): string {
  let breaks = false;
  for (let i = start; i < end; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) {
      breaks = true;
      break;
    }
  }
  const n = end - start;
  let out: string;
  if (!breaks) {
    while (spaces.length < n) spaces += spaces;
    out = spaces.slice(0, n);
  } else {
    out = '';
    let run = 0;
    for (let i = start; i < end; i++) {
      const c = text.charCodeAt(i);
      if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) {
        if (run) {
          while (spaces.length < run) spaces += spaces;
          out += spaces.slice(0, run);
          run = 0;
        }
        out += text[i];
      } else run++;
    }
    if (run) {
      while (spaces.length < run) spaces += spaces;
      out += spaces.slice(0, run);
    }
  }
  if (head) out = String.fromCharCode(head) + out.slice(1);
  if (tail) out = out.slice(0, -1) + String.fromCharCode(tail);
  return out;
}

/** Something that turns TypeScript into JavaScript an app can run: the shape apps take for a TypeScript tab. */
export interface Transpiler {
  name: string;
  version: string;
  /** JavaScript for `code`. Throws a SyntaxError, with the line and column, for code that can't be stripped. */
  transpile(code: string, options?: TranspileOptions): string;
}

export interface TranspileOptions {
  /** The file name, used in error messages. */
  filename?: string;
  /** JSX isn't supported: true throws. */
  jsx?: boolean;
}

/** `strip`, in the Transpiler shape. */
export function transpile(code: string, options: TranspileOptions = {}): string {
  if (options.jsx) throw new Error('JSX is not supported.');
  return strip(code, options.filename === undefined ? {} : { fileName: options.filename });
}
