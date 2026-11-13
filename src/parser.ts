// The parser: recursive descent over the scanner's tokens, building a flat Tree. Its rules follow TypeScript's own
// parser closely (same node kinds, same shapes, same start and end of every node), so that the tests can compare the
// two trees node for node. Where the grammar is ambiguous (arrow functions, type arguments in expressions, modifiers
// that are also identifiers), it decides the way TypeScript does: a look at the next tokens, and when that isn't enough,
// a try that is undone if it fails.
//
// Errors stop the parse: the first one is thrown as a SyntaxError with the line and column. There is no recovery.
import { F, K } from './kinds.js';
import { ParseError, Scanner } from './scanner.js';
import { T, isAssignment, isKeyword, PUNCTUATION } from './tokens.js';
import { Tree } from './tree.js';

export interface ParseOptions {
  /** The file name, used in error messages. */
  fileName?: string;
}

/** Parses TypeScript source into a Tree. Throws a SyntaxError (a ParseError, with line and column) on bad syntax. */
export function parse(text: string, options: ParseOptions = {}): Tree {
  return parseWithErasures(text, options.fileName).tree;
}

/**
 * @internal The tree, and the TypeScript-only syntax the parser met (see Parser.erase), for the stripper.
 */
export function parseWithErasures(text: string, fileName?: string, seen?: (p: { readonly after: number }) => void): { tree: Tree; erase: number[] } {
  const declarationFile = !!fileName?.endsWith('.d.ts');
  const first = new Parser(text, fileName, 0);
  seen?.(first);
  // A file that starts with an import or export is a module: `await` at its top level is an operator from the start,
  // and the second parse below is not needed. Notebooks start this way.
  if (!declarationFile && first.startsAsModule()) return parser(text, fileName, seen).run();
  const result = first.run();
  // In a module, `await` at the top level is an operator. Whether the file is a module is known only once it is
  // parsed, so a module that used `await` outside a function is parsed again with that set, as TypeScript does.
  if (first.possibleTopLevelAwait && !declarationFile && (first.sawImportMeta || isModule(result.tree))) {
    return parser(text, fileName, seen).run();
  }
  return result;
}

function parser(text: string, fileName: string | undefined, seen: ((p: { readonly after: number }) => void) | undefined): Parser {
  const p = new Parser(text, fileName, C_AWAIT);
  seen?.(p);
  return p;
}

/**
 * @internal For the checker's tolerant parse (milestone 13): the tree, as parse() gives it, or the syntax error and
 * where the last top-level statement before it ends (where the statement the error is in, or the comments before it,
 * starts).
 */
export function parseOrStop(text: string, fileName?: string): Tree | { readonly error: ParseError; readonly after: number } {
  let last: { readonly after: number } | undefined;
  try {
    return parseWithErasures(text, fileName, (p) => (last = p)).tree;
  } catch (e) {
    if (!(e instanceof ParseError) || last === undefined) throw e;
    return { error: e, after: last.after };
  }
}

/** TypeScript's isFileProbablyExternalModule, without import.meta (the parser tracks that). */
function isModule(t: Tree): boolean {
  for (let n = t.first[t.root]!; n; n = t.next[n]!) {
    const k = t.kind[n]!;
    if (k === K.ImportDeclaration || k === K.ExportDeclaration || k === K.ExportAssignment) return true;
    if (k === K.ImportEqualsDeclaration) {
      for (let c = t.first[n]!; c; c = t.next[c]!) if (t.kind[c] === K.ExternalModuleReference) return true;
    }
    if (t.flags[n]! & F.Export && k !== K.ExportSpecifier) return true;
  }
  return false;
}

/** Thrown inside a speculative parse; never escapes the parser. */
const FAIL = { fail: true };

// Answers of a lookahead that may not be able to decide (TypeScript's Tristate).
const FALSE = 0;
const TRUE = 1;
const UNKNOWN = 2;

/** Modifiers that are TypeScript only: the stripper removes them. */
const TYPE_ONLY_MODIFIERS = F.Public | F.Private | F.Protected | F.Readonly | F.Abstract | F.Override | F.Declare | F.In | F.Out;

function hasLineBreak(text: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

/** Binary operator precedence, as TypeScript's getBinaryOperatorPrecedence; -1 when the token isn't one. */
function binaryPrecedence(t: number): number {
  switch (t) {
    case T.QuestionQuestion: return 4;
    case T.BarBar: return 5;
    case T.AmpersandAmpersand: return 6;
    case T.Bar: return 7;
    case T.Caret: return 8;
    case T.Ampersand: return 9;
    case T.EqualsEquals: case T.ExclamationEquals: case T.EqualsEqualsEquals: case T.ExclamationEqualsEquals: return 10;
    case T.LessThan: case T.GreaterThan: case T.LessThanEquals: case T.GreaterThanEquals: case T.Instanceof: case T.In:
    case T.As: case T.Satisfies: return 11;
    case T.LessThanLessThan: case T.GreaterThanGreaterThan: case T.GreaterThanGreaterThanGreaterThan: return 12;
    case T.Plus: case T.Minus: return 13;
    case T.Asterisk: case T.Slash: case T.Percent: return 14;
    case T.AsteriskAsterisk: return 15;
  }
  return -1;
}

/** Modifier keywords and their flags. */
function modifierFlag(t: number): number {
  switch (t) {
    case T.Export: return F.Export;
    case T.Default: return F.Default;
    case T.Declare: return F.Declare;
    case T.Abstract: return F.Abstract;
    case T.Public: return F.Public;
    case T.Private: return F.Private;
    case T.Protected: return F.Protected;
    case T.Readonly: return F.Readonly;
    case T.Static: return F.Static;
    case T.Override: return F.Override;
    case T.Async: return F.Async;
    case T.Const: return F.Const;
    case T.Accessor: return F.Accessor;
    case T.In: return F.In;
    case T.Out: return F.Out;
  }
  return 0;
}

/** Keyword types: `number` is a NumberKeyword node. */
function keywordType(t: number): number {
  switch (t) {
    case T.Any: return K.AnyKeyword;
    case T.Unknown: return K.UnknownKeyword;
    case T.Number: return K.NumberKeyword;
    case T.Bigint: return K.BigIntKeyword;
    case T.Object: return K.ObjectKeyword;
    case T.Boolean: return K.BooleanKeyword;
    case T.String: return K.StringKeyword;
    case T.Symbol: return K.SymbolKeyword;
    case T.Undefined: return K.UndefinedKeyword;
    case T.Never: return K.NeverKeyword;
    case T.Intrinsic: return K.IntrinsicKeyword;
  }
  return 0;
}

const LITERAL_KIND: Record<number, number> = {
  [T.NumericLiteral]: K.NumericLiteral,
  [T.BigIntLiteral]: K.BigIntLiteral,
  [T.StringLiteral]: K.StringLiteral,
  [T.NoSubstitutionTemplateLiteral]: K.NoSubstitutionTemplateLiteral,
  [T.RegularExpressionLiteral]: K.RegularExpressionLiteral,
  [T.TemplateHead]: K.TemplateHead,
  [T.TemplateMiddle]: K.TemplateMiddle,
  [T.TemplateTail]: K.TemplateTail,
};

// Context bits
const C_AWAIT = 1; // inside an async function: `await` is an operator
const C_YIELD = 2; // inside a generator: `yield` is an operator
const C_NO_IN = 4; // `in` is not a binary operator (for-statement initializers)
const C_NO_CONDITIONAL_TYPES = 8; // in a conditional type's extends clause

class Parser {
  readonly s: Scanner;
  readonly t: Tree;
  /** The current token (the scanner's). */
  tok: number = T.EOF;
  /** End of the previous token: where a node that ends before the current token ends. */
  prevEnd = 0;
  /** Children waiting for their parent; see fin(). */
  readonly st: number[] = [];
  ctx = 0;
  /** Depth of speculative parses: errors inside one throw FAIL instead of reporting. */
  spec = 0;
  /**
   * TypeScript-only syntax met while parsing, for the stripper: triples of start, end and a character to write at the
   * end (0 for none). Whole declarations (interfaces, overloads …) are found later from the tree.
   */
  readonly erase: number[] = [];
  /** `await` was met outside an async function: a module must be parsed again (see parse). */
  possibleTopLevelAwait = false;
  sawImportMeta = false;
  /** Where the last top-level statement parsed ends (see parseOrStop). */
  after = 0;

  constructor(text: string, fileName: string | undefined, ctx: number) {
    this.s = new Scanner(text, fileName);
    this.t = new Tree(text, fileName);
    this.ctx = ctx;
  }

  // ------------------------------------------------------------------ tokens

  next(): number {
    this.prevEnd = this.s.pos;
    return (this.tok = this.s.next());
  }

  error(message: string, pos = this.s.tokenStart): never {
    if (this.spec) throw FAIL;
    this.s.error(message, pos);
  }

  expect(t: number): void {
    if (this.tok !== t) this.error(`${PUNCTUATION[t] ? `'${PUNCTUATION[t]}'` : 'Keyword'} expected, found ${this.found()}.`);
    this.next();
  }

  found(): string {
    if (this.tok === T.EOF) return 'the end of the file';
    return `'${this.s.tokenText()}'`;
  }

  eat(t: number): boolean {
    if (this.tok !== t) return false;
    this.next();
    return true;
  }

  isIdent(): boolean {
    return this.tok === T.Identifier || this.tok >= T.FirstContextual;
  }

  /** Reserved words are allowed: property names, names after `.`. */
  isIdentOrKeyword(): boolean {
    return this.tok === T.Identifier || isKeyword(this.tok);
  }

  canParseSemicolon(): boolean {
    return this.tok === T.Semicolon || this.tok === T.CloseBrace || this.tok === T.EOF || this.s.newLine;
  }

  semicolon(): void {
    if (this.tok === T.Semicolon) this.next();
    else if (!this.canParseSemicolon()) this.error(`';' expected, found ${this.found()}.`);
  }

  // ------------------------------------------------------------------ nodes

  /** A node made of the children pushed on the stack since `mark`, ending at the previous token. */
  fin(kind: number, start: number, flags: number, mark: number): number {
    const t = this.t;
    const n = t.add(kind, start, this.prevEnd, flags);
    const st = this.st;
    let prev = 0;
    for (let i = mark; i < st.length; i++) {
      const c = st[i]!;
      if (c === 0) continue;
      if (prev === 0) t.first[n] = c;
      else t.next[prev] = c;
      prev = c;
    }
    st.length = mark;
    return n;
  }

  /** A node of the current token alone. */
  tokenNode(kind: number): number {
    const n = this.t.add(kind, this.s.tokenStart, this.s.pos, 0);
    this.next();
    return n;
  }

  push(n: number): void {
    this.st.push(n);
  }

  /** Records text the stripper removes. */
  rec(start: number, end: number, tail = 0): void {
    this.erase.push(start, end, tail);
  }

  /** Runs `fn`; if it fails (returns 0 or hits a syntax error), undoes everything it did and returns 0. */
  tryParse(fn: () => number): number {
    const saved = this.s.save();
    const tok = this.tok, prevEnd = this.prevEnd, count = this.t.count, sl = this.st.length, ctx = this.ctx;
    const el = this.erase.length;
    this.spec++;
    let result = 0;
    try {
      result = fn();
    } catch (e) {
      if (e !== FAIL && !(e instanceof ParseError)) throw e;
    }
    this.spec--;
    if (result) return result;
    this.s.restore(saved);
    this.tok = tok;
    this.prevEnd = prevEnd;
    this.t.count = count;
    this.st.length = sl;
    this.ctx = ctx;
    this.erase.length = el;
    return 0;
  }

  /** Runs `fn` and undoes everything, returning what it returned. */
  lookAhead<R>(fn: () => R): R {
    const saved = this.s.save();
    const tok = this.tok, prevEnd = this.prevEnd, count = this.t.count, sl = this.st.length, ctx = this.ctx;
    const el = this.erase.length;
    this.spec++;
    let result: R | undefined;
    try {
      result = fn();
    } catch (e) {
      if (e !== FAIL && !(e instanceof ParseError)) throw e;
    }
    this.spec--;
    this.s.restore(saved);
    this.tok = tok;
    this.prevEnd = prevEnd;
    this.t.count = count;
    this.st.length = sl;
    this.ctx = ctx;
    this.erase.length = el;
    return result as R;
  }

  nextIsOnSameLine(): boolean {
    this.next();
    return !this.s.newLine;
  }

  nextIsIdentOnSameLine(): boolean {
    this.next();
    return !this.s.newLine && this.isIdent();
  }

  // ------------------------------------------------------------------ names

  identifier(): number {
    if (!this.isIdent()) this.error(`A name expected, found ${this.found()}.`);
    if (this.tok === T.Await && !(this.ctx & C_AWAIT)) this.possibleTopLevelAwait = true;
    return this.tokenNode(K.Identifier);
  }

  /** An identifier where reserved words are allowed (after `.`, property names). */
  identifierName(): number {
    if (!this.isIdentOrKeyword()) this.error(`A name expected, found ${this.found()}.`);
    return this.tokenNode(K.Identifier);
  }

  /** Identifier, or A.B.C as nested QualifiedNames. Type positions allow reserved words (`typeof this`). */
  entityName(allowReserved: boolean): number {
    const start = this.s.tokenStart;
    let left = allowReserved ? this.identifierName() : this.identifier();
    while (this.tok === T.Dot) {
      this.next();
      const m = this.st.length;
      this.push(left);
      this.push(allowReserved ? this.identifierName() : this.identifier());
      left = this.fin(K.QualifiedName, start, 0, m);
    }
    return left;
  }

  isLiteralPropertyName(): boolean {
    const t = this.tok;
    return t === T.Identifier || isKeyword(t) || t === T.StringLiteral || t === T.NumericLiteral || t === T.BigIntLiteral ||
      t === T.PrivateIdentifier;
  }

  propertyName(): number {
    switch (this.tok) {
      case T.StringLiteral: return this.tokenNode(K.StringLiteral);
      case T.NumericLiteral: return this.tokenNode(K.NumericLiteral);
      case T.BigIntLiteral: return this.tokenNode(K.BigIntLiteral);
      case T.PrivateIdentifier: return this.tokenNode(K.PrivateIdentifier);
      case T.OpenBracket: {
        const start = this.s.tokenStart;
        this.next();
        const m = this.st.length;
        const saved = this.ctx;
        this.ctx &= ~C_NO_IN;
        this.push(this.expression());
        this.ctx = saved;
        this.expect(T.CloseBracket);
        return this.fin(K.ComputedPropertyName, start, 0, m);
      }
    }
    return this.identifierName();
  }

  // ------------------------------------------------------------------ source file and statements

  /**
   * The first statement is certainly an import or export declaration (so the file is a module). Conservative: `import x
   * = A.B`, `import(…)` and `import.meta` say no, and the caller falls back to finding out after the parse.
   */
  startsAsModule(): boolean {
    return this.lookAhead(() => {
      this.next();
      if (this.tok === T.Export) return true;
      if (this.tok !== T.Import) return false;
      this.next();
      if (this.tok === T.OpenBrace || this.tok === T.Asterisk || this.tok === T.StringLiteral) return true;
      if (!this.isIdent()) return false;
      this.next();
      return this.tok === T.Comma || this.tok === T.From || this.tok === T.OpenBrace || this.tok === T.Asterisk;
    });
  }

  run(): { tree: Tree; erase: number[] } {
    return { tree: this.parseSourceFile(), erase: this.erase };
  }

  parseSourceFile(): Tree {
    this.next();
    const m = this.st.length;
    while (this.tok !== T.EOF) {
      this.push(this.statement());
      this.after = this.prevEnd;
    }
    this.prevEnd = this.s.text.length;
    this.t.root = this.fin(K.SourceFile, 0, 0, m);
    return this.t;
  }

  statement(): number {
    switch (this.tok) {
      case T.Semicolon: {
        const n = this.t.add(K.EmptyStatement, this.s.tokenStart, this.s.pos, 0);
        this.next();
        return n;
      }
      case T.OpenBrace: return this.block();
      case T.Var: return this.variableStatement(this.s.tokenStart, 0);
      case T.Let:
        if (this.lookAhead(() => this.nextIsBindingStart())) return this.variableStatement(this.s.tokenStart, 0);
        break;
      case T.Await:
        if (this.isAwaitUsing()) return this.variableStatement(this.s.tokenStart, 0);
        break;
      case T.Using:
        if (this.isUsing()) return this.variableStatement(this.s.tokenStart, 0);
        break;
      case T.Function: return this.functionDeclaration(this.s.tokenStart, 0);
      case T.Class: return this.classLike(K.ClassDeclaration, this.s.tokenStart, 0);
      case T.If: return this.ifStatement();
      case T.Do: return this.doStatement();
      case T.While: return this.whileStatement();
      case T.For: return this.forStatement();
      case T.Continue: return this.breakOrContinue(K.ContinueStatement);
      case T.Break: return this.breakOrContinue(K.BreakStatement);
      case T.Return: return this.returnStatement();
      case T.Switch: return this.switchStatement();
      case T.Throw: return this.throwStatement();
      case T.Try: case T.Catch: case T.Finally: return this.tryStatement();
      case T.Debugger: {
        const start = this.s.tokenStart;
        this.next();
        this.semicolon();
        return this.t.add(K.DebuggerStatement, start, this.prevEnd, 0);
      }
      case T.With: this.error("'with' statements are not allowed in strict mode.");
      // eslint-disable-next-line no-fallthrough
      case T.At: this.error('Decorators are not supported.');
      // eslint-disable-next-line no-fallthrough
      case T.Async: case T.Interface: case T.Type: case T.Module: case T.Namespace: case T.Declare: case T.Const:
      case T.Enum: case T.Export: case T.Import: case T.Private: case T.Protected: case T.Public: case T.Abstract:
      case T.Accessor: case T.Static: case T.Readonly: case T.Global:
        if (this.isStartOfDeclaration()) return this.declaration();
        break;
    }
    return this.expressionOrLabeledStatement();
  }

  nextIsBindingStart(): boolean {
    this.next();
    return this.isIdent() || this.tok === T.OpenBracket || this.tok === T.OpenBrace;
  }

  isUsing(): boolean {
    return this.lookAhead(() => {
      this.next();
      return !this.s.newLine && this.isIdent();
    });
  }

  isAwaitUsing(): boolean {
    return this.lookAhead(() => {
      this.next();
      if (this.tok !== T.Using || this.s.newLine) return false;
      this.next();
      return !this.s.newLine && this.isIdent();
    });
  }

  /** TypeScript's isDeclaration: can a declaration start here, given what follows. */
  isStartOfDeclaration(): boolean {
    return this.lookAhead(() => {
      for (;;) {
        switch (this.tok) {
          case T.Var: case T.Let: case T.Const: case T.Function: case T.Class: case T.Enum:
            return true;
          case T.Using:
            return this.isUsing();
          case T.Await:
            return this.isAwaitUsing();
          case T.Interface: case T.Type:
            return this.nextIsIdentOnSameLine();
          case T.Module: case T.Namespace:
            this.next();
            return !this.s.newLine && (this.isIdent() || this.tok === T.StringLiteral);
          case T.Abstract: case T.Accessor: case T.Async: case T.Declare: case T.Private: case T.Protected:
          case T.Public: case T.Readonly: {
            const previous = this.tok;
            this.next();
            if (this.s.newLine) return false;
            if (previous === T.Declare && this.tok === T.Type) return true;
            continue;
          }
          case T.Global:
            this.next();
            return this.tok === T.OpenBrace || this.tok === T.Identifier || this.tok === T.Export;
          case T.Import:
            this.next();
            return this.tok === T.StringLiteral || this.tok === T.Asterisk || this.tok === T.OpenBrace || this.isIdentOrKeyword();
          case T.Export: {
            let t = this.next();
            if (t === T.Type) t = this.lookAhead(() => this.next());
            if (t === T.Equals || t === T.Asterisk || t === T.OpenBrace || t === T.Default || t === T.As || t === T.At) return true;
            continue;
          }
          case T.Static:
            this.next();
            continue;
          default:
            return false;
        }
      }
    });
  }

  /** Modifiers before a declaration or member, as flags; `start` of the first is the caller's node start. */
  modifiers(permitConst: boolean, stopAtStaticBlock: boolean): number {
    let flags = 0;
    for (;;) {
      const t = this.tok;
      const flag = modifierFlag(t);
      if (!flag) break;
      const ms = this.s.tokenStart, me = this.s.pos;
      if (t === T.Const && permitConst) {
        if (!this.tryParse(() => (this.nextIsOnSameLine() && this.canFollowModifier() ? 1 : 0))) break;
      } else if (stopAtStaticBlock && t === T.Static && this.lookAhead(() => this.next() === T.OpenBrace)) {
        break;
      } else if (t === T.Static && flags & F.Static) {
        break;
      } else if (!this.tryParse(() => (this.nextCanFollowModifier() ? 1 : 0))) {
        break;
      }
      flags |= flag;
      if (flag & TYPE_ONLY_MODIFIERS) this.rec(ms, me);
    }
    return flags;
  }

  /** At a modifier keyword: moves past it and says whether the token after it lets it be a modifier. */
  nextCanFollowModifier(): boolean {
    switch (this.tok) {
      case T.Const:
        return this.next() === T.Enum;
      case T.Export:
        this.next();
        if (this.tok === T.Default) return this.lookAhead(() => this.nextCanFollowDefault());
        if (this.tok === T.Type) return this.lookAhead(() => (this.next(), this.canFollowExport()));
        return this.canFollowExport();
      case T.Default:
        return this.nextCanFollowDefault();
      case T.Static:
        this.next();
        return this.canFollowModifier();
      case T.Get: case T.Set:
        this.next();
        return this.tok === T.OpenBracket || this.isLiteralPropertyName();
      default:
        this.next();
        return !this.s.newLine && this.canFollowModifier();
    }
  }

  canFollowModifier(): boolean {
    const t = this.tok;
    return t === T.OpenBracket || t === T.OpenBrace || t === T.Asterisk || t === T.DotDotDot || this.isLiteralPropertyName();
  }

  canFollowExport(): boolean {
    const t = this.tok;
    return t === T.At || (t !== T.Asterisk && t !== T.As && t !== T.OpenBrace && this.canFollowModifier());
  }

  nextCanFollowDefault(): boolean {
    this.next();
    const t = this.tok;
    return t === T.Class || t === T.Function || t === T.Interface || t === T.At ||
      (t === T.Abstract && this.lookAhead(() => this.next() === T.Class && !this.s.newLine)) ||
      (t === T.Async && this.lookAhead(() => this.next() === T.Function && !this.s.newLine));
  }

  declaration(): number {
    const start = this.s.tokenStart;
    const flags = this.modifiers(false, false);
    switch (this.tok) {
      case T.Var: case T.Let: case T.Const: case T.Using: case T.Await:
        return this.variableStatement(start, flags);
      case T.Function: return this.functionDeclaration(start, flags);
      case T.Class: return this.classLike(K.ClassDeclaration, start, flags);
      case T.Interface: return this.interfaceDeclaration(start, flags);
      case T.Type: return this.typeAliasDeclaration(start, flags);
      case T.Enum: return this.enumDeclaration(start, flags);
      case T.Global: case T.Module: case T.Namespace: return this.moduleDeclaration(start, flags);
      case T.Import: return this.importDeclaration(start, flags);
      case T.Export:
        this.next();
        switch (this.tok as number) {
          case T.Default: case T.Equals: return this.exportAssignment(start, flags);
          case T.As: this.error("'export as namespace' is not supported.");
          // eslint-disable-next-line no-fallthrough
          default: return this.exportDeclaration(start, flags);
        }
    }
    return this.error(`A declaration expected, found ${this.found()}.`);
  }

  block(): number {
    const start = this.s.tokenStart;
    this.expect(T.OpenBrace);
    const m = this.st.length;
    while (this.tok !== T.CloseBrace) {
      if (this.tok === T.EOF) this.error("'}' expected.");
      this.push(this.statement());
    }
    this.next();
    return this.fin(K.Block, start, 0, m);
  }

  /** A function body: a block with `await` and `yield` set for the function. */
  functionBody(fnFlags: number): number {
    const saved = this.ctx;
    this.ctx = (saved & ~(C_AWAIT | C_YIELD | C_NO_IN)) | (fnFlags & F.Async ? C_AWAIT : 0) | (fnFlags & F.Generator ? C_YIELD : 0);
    const b = this.block();
    this.ctx = saved;
    return b;
  }

  variableStatement(start: number, flags: number): number {
    const m = this.st.length;
    this.push(this.variableDeclarationList(false));
    this.semicolon();
    return this.fin(K.VariableStatement, start, flags, m);
  }

  variableDeclarationList(inForInit: boolean): number {
    const start = this.s.tokenStart;
    let flags = 0;
    switch (this.tok) {
      case T.Var: break;
      case T.Let: flags = F.Let; break;
      case T.Const: flags = F.Const; break;
      case T.Using: flags = F.Using; break;
      case T.Await: flags = F.Using | F.Await; this.next(); break;
      default: this.error(`'var', 'let' or 'const' expected, found ${this.found()}.`);
    }
    this.next();
    const m = this.st.length;
    // `for (let of x)` and similar: an empty list.
    if (inForInit && this.tok === T.Of && this.lookAhead(() => this.next() === T.CloseParen)) {
      return this.fin(K.VariableDeclarationList, start, flags, m);
    }
    do this.push(this.variableDeclaration(inForInit));
    while (this.eat(T.Comma));
    return this.fin(K.VariableDeclarationList, start, flags, m);
  }

  variableDeclaration(inForInit: boolean): number {
    const start = this.s.tokenStart;
    const m = this.st.length;
    this.push(this.bindingName());
    let flags = 0;
    if (this.tok === T.Exclamation && !this.s.newLine) {
      this.rec(this.s.tokenStart, this.s.pos);
      this.next();
      flags |= F.Exclamation;
    }
    this.push(this.typeAnnotation());
    if (!(inForInit && (this.tok === T.In || this.tok === T.Of)) && this.eat(T.Equals)) this.push(this.assignmentExpression());
    return this.fin(K.VariableDeclaration, start, flags, m);
  }

  bindingName(): number {
    if (this.tok === T.OpenBracket) return this.arrayBindingPattern();
    if (this.tok === T.OpenBrace) return this.objectBindingPattern();
    return this.identifier();
  }

  arrayBindingPattern(): number {
    const start = this.s.tokenStart;
    this.next();
    const m = this.st.length;
    const saved = this.ctx;
    this.ctx &= ~C_NO_IN;
    while (this.tok !== T.CloseBracket) {
      if (this.tok === T.Comma) {
        this.push(this.t.add(K.OmittedExpression, this.prevEnd, this.prevEnd, 0));
      } else {
        const es = this.s.tokenStart;
        const em = this.st.length;
        let flags = 0;
        if (this.eat(T.DotDotDot)) flags |= F.Rest;
        this.push(this.bindingName());
        if (this.eat(T.Equals)) this.push(this.assignmentExpression());
        this.push(this.fin(K.BindingElement, es, flags, em));
      }
      if (this.tok !== T.CloseBracket) this.expect(T.Comma);
    }
    this.ctx = saved;
    this.next();
    return this.fin(K.ArrayBindingPattern, start, 0, m);
  }

  objectBindingPattern(): number {
    const start = this.s.tokenStart;
    this.next();
    const m = this.st.length;
    const saved = this.ctx;
    this.ctx &= ~C_NO_IN;
    while (this.tok !== T.CloseBrace) {
      const es = this.s.tokenStart;
      const em = this.st.length;
      let flags = 0;
      if (this.eat(T.DotDotDot)) {
        flags |= F.Rest;
        this.push(this.identifier());
      } else {
        const tokenIsIdentifier = this.isIdent();
        const name = this.propertyName();
        if (tokenIsIdentifier && this.tok !== T.Colon) {
          this.push(name);
        } else {
          this.expect(T.Colon);
          flags |= F.PropertyName;
          this.push(name);
          this.push(this.bindingName());
        }
        if (this.eat(T.Equals)) this.push(this.assignmentExpression());
      }
      this.push(this.fin(K.BindingElement, es, flags, em));
      if (this.tok !== T.CloseBrace) this.expect(T.Comma);
    }
    this.ctx = saved;
    this.next();
    return this.fin(K.ObjectBindingPattern, start, 0, m);
  }

  /** `: Type`, or 0. */
  typeAnnotation(): number {
    if (this.tok !== T.Colon) return 0;
    const start = this.s.tokenStart;
    this.next();
    const type = this.type();
    this.rec(start, this.prevEnd);
    return type;
  }

  functionDeclaration(start: number, flags: number): number {
    this.expect(T.Function);
    if (this.eat(T.Asterisk)) flags |= F.Generator;
    const m = this.st.length;
    // `export default function () {}` has no name.
    if (!(flags & F.Default) || this.isIdent()) this.push(this.identifier());
    this.signature(flags, false);
    this.functionBlockOrSemicolon(flags);
    return this.fin(K.FunctionDeclaration, start, flags, m);
  }

  functionBlockOrSemicolon(flags: number): void {
    if (this.tok !== T.OpenBrace && this.canParseSemicolon()) this.semicolon();
    else this.push(this.functionBody(flags));
  }

  /** Type parameters, parameters and return type, pushed. Parameters take the function's await/yield. */
  signature(flags: number, isType: boolean): void {
    this.typeParameters();
    const saved = this.ctx;
    this.ctx = (saved & ~(C_AWAIT | C_YIELD)) | (flags & F.Async ? C_AWAIT : 0) | (flags & F.Generator ? C_YIELD : 0);
    this.parameters();
    this.ctx = saved;
    if (isType) {
      // A function or constructor type: `=> Type`.
      this.expect(T.EqualsGreaterThan);
      this.push(this.typeOrTypePredicate());
    } else if (this.tok === T.Colon) {
      const colon = this.s.tokenStart;
      this.next();
      this.push(this.typeOrTypePredicate());
      this.rec(colon, this.prevEnd);
    }
  }

  typeParameters(): void {
    if (this.tok !== T.LessThan && this.s.reScanLessThan() !== T.LessThan) {
      this.tok = this.s.token;
      return;
    }
    this.tok = this.s.token;
    const start = this.s.tokenStart;
    this.next();
    do {
      if (this.tok === T.GreaterThan) break;
      this.push(this.typeParameter());
    } while (this.eat(T.Comma));
    this.expect(T.GreaterThan);
    this.rec(start, this.prevEnd);
  }

  typeParameter(): number {
    const start = this.s.tokenStart;
    const flags = this.modifiers(true, false);
    const m = this.st.length;
    this.push(this.identifier());
    if (this.eat(T.Extends)) this.push(this.type());
    if (this.eat(T.Equals)) this.push(this.type());
    return this.fin(K.TypeParameter, start, flags, m);
  }

  parameters(): void {
    this.expect(T.OpenParen);
    const saved = this.ctx;
    this.ctx &= ~C_NO_IN;
    while (this.tok !== T.CloseParen) {
      // A `this` parameter is a type only: it goes, with its comma.
      const isThis = this.tok === T.This;
      const start = this.s.tokenStart;
      this.push(this.parameter());
      if (isThis) this.rec(start, this.tok === T.Comma ? this.s.pos : this.prevEnd);
      if (this.tok !== T.CloseParen) this.expect(T.Comma);
    }
    this.ctx = saved;
    this.next();
  }

  parameter(): number {
    const start = this.s.tokenStart;
    if (this.tok === T.At) this.error('Decorators are not supported.');
    const m = this.st.length;
    if (this.tok === T.This) {
      this.push(this.tokenNode(K.Identifier));
      this.push(this.typeAnnotation());
      return this.fin(K.Parameter, start, 0, m);
    }
    let flags = this.modifiers(false, false);
    if (this.eat(T.DotDotDot)) flags |= F.Rest;
    this.push(this.bindingName());
    if (this.tok === T.Question) {
      this.rec(this.s.tokenStart, this.s.pos);
      this.next();
      flags |= F.Optional;
    }
    this.push(this.typeAnnotation());
    if (this.eat(T.Equals)) this.push(this.assignmentExpression());
    return this.fin(K.Parameter, start, flags, m);
  }

  // ------------------------------------------------------------------ classes and interfaces

  classLike(kind: number, start: number, flags: number): number {
    this.expect(T.Class);
    const m = this.st.length;
    // `class implements I {}` has no name.
    if (this.isIdent() && !(this.tok === T.Implements && this.lookAhead(() => (this.next(), this.isIdentOrKeyword())))) {
      this.push(this.identifier());
    }
    this.typeParameters();
    this.heritageClauses();
    this.expect(T.OpenBrace);
    while (this.tok !== T.CloseBrace) {
      if (this.tok === T.EOF) this.error("'}' expected.");
      this.push(this.classElement());
    }
    this.next();
    return this.fin(kind, start, flags, m);
  }

  heritageClauses(): void {
    while (this.tok === T.Extends || this.tok === T.Implements) {
      const start = this.s.tokenStart;
      const implementsClause = this.tok === T.Implements;
      const m = this.st.length;
      this.next();
      do this.push(this.expressionWithTypeArguments());
      while (this.eat(T.Comma));
      this.push(this.fin(K.HeritageClause, start, 0, m));
      if (implementsClause) this.rec(start, this.prevEnd);
    }
  }

  expressionWithTypeArguments(): number {
    const start = this.s.tokenStart;
    const expr = this.leftHandSideExpression();
    if (this.t.kind[expr] === K.ExpressionWithTypeArguments) return expr;
    const m = this.st.length;
    this.push(expr);
    if (this.tok === T.LessThan) this.typeArguments();
    return this.fin(K.ExpressionWithTypeArguments, start, 0, m);
  }

  classElement(): number {
    const start = this.s.tokenStart;
    if (this.tok === T.Semicolon) {
      this.next();
      return this.t.add(K.SemicolonClassElement, start, this.prevEnd, 0);
    }
    if (this.tok === T.At) this.error('Decorators are not supported.');
    const flags = this.modifiers(true, true);
    if (this.tok === T.Static && this.lookAhead(() => this.next() === T.OpenBrace)) {
      this.next();
      const m = this.st.length;
      this.push(this.functionBody(0));
      return this.fin(K.ClassStaticBlockDeclaration, start, 0, m);
    }
    if ((this.tok === T.Get || this.tok === T.Set) && this.lookAhead(() => (this.next(), this.tok === T.OpenBracket || this.isLiteralPropertyName()))) {
      return this.accessor(start, flags, this.tok === T.Get ? K.GetAccessor : K.SetAccessor, false);
    }
    if (this.tok === T.Constructor || (this.tok === T.StringLiteral && this.s.tokenText().slice(1, -1) === 'constructor')) {
      if (this.lookAhead(() => (this.next(), this.tok === T.OpenParen))) {
        this.next();
        const m = this.st.length;
        this.signature(flags, false);
        this.functionBlockOrSemicolon(flags);
        return this.fin(K.Constructor, start, flags, m);
      }
    }
    if (this.tok === T.OpenBracket && this.isIndexSignature()) return this.indexSignature(start, flags);
    // Property or method.
    let f = flags;
    if (this.eat(T.Asterisk)) f |= F.Generator;
    const m = this.st.length;
    this.push(this.propertyName());
    if (this.tok === T.Question) {
      this.rec(this.s.tokenStart, this.s.pos);
      this.next();
      f |= F.Optional;
    }
    if (f & F.Generator || this.tok === T.OpenParen || this.tok === T.LessThan) {
      this.signature(f, false);
      this.functionBlockOrSemicolon(f);
      return this.fin(K.MethodDeclaration, start, f, m);
    }
    if (!(f & F.Optional) && this.tok === T.Exclamation && !this.s.newLine) {
      this.rec(this.s.tokenStart, this.s.pos);
      this.next();
      f |= F.Exclamation;
    }
    this.push(this.typeAnnotation());
    if (this.tok === T.Equals) {
      // A property initializer is outside any function's await and yield.
      this.next();
      const saved = this.ctx;
      this.ctx &= ~(C_AWAIT | C_YIELD | C_NO_IN);
      this.push(this.assignmentExpression());
      this.ctx = saved;
    }
    this.semicolon();
    return this.fin(K.PropertyDeclaration, start, f, m);
  }

  accessor(start: number, flags: number, kind: number, isTypeMember: boolean): number {
    this.next(); // get / set
    const m = this.st.length;
    this.push(this.propertyName());
    this.signature(flags, false);
    if (isTypeMember) {
      if (this.tok === T.OpenBrace) this.push(this.functionBody(flags));
      else this.typeMemberSemicolon();
    } else this.functionBlockOrSemicolon(flags);
    return this.fin(kind, start, flags, m);
  }

  isIndexSignature(): boolean {
    return this.lookAhead(() => {
      this.next(); // [
      if (this.tok === T.DotDotDot || this.tok === T.CloseBracket) return true;
      if (modifierFlag(this.tok)) {
        this.next();
        if (this.isIdent()) return true;
      } else if (!this.isIdent()) return false;
      else this.next();
      if (this.tok === T.Colon || this.tok === T.Comma) return true;
      if (this.tok !== T.Question) return false;
      this.next();
      return this.tok === T.Colon || this.tok === T.Comma || this.tok === T.CloseBracket;
    });
  }

  indexSignature(start: number, flags: number): number {
    const m = this.st.length;
    this.next(); // [
    while (this.tok !== T.CloseBracket) {
      this.push(this.parameter());
      if (this.tok !== T.CloseBracket) this.expect(T.Comma);
    }
    this.next();
    this.push(this.typeAnnotation());
    this.typeMemberSemicolon();
    return this.fin(K.IndexSignature, start, flags, m);
  }

  typeMemberSemicolon(): void {
    if (this.eat(T.Comma)) return;
    this.semicolon();
  }

  interfaceDeclaration(start: number, flags: number): number {
    this.expect(T.Interface);
    const m = this.st.length;
    this.push(this.identifier());
    this.typeParameters();
    this.heritageClauses();
    this.typeMembers();
    return this.fin(K.InterfaceDeclaration, start, flags, m);
  }

  /** `{ members }`, the members pushed. */
  typeMembers(): void {
    this.expect(T.OpenBrace);
    while (this.tok !== T.CloseBrace) {
      if (this.tok === T.EOF) this.error("'}' expected.");
      this.push(this.typeMember());
    }
    this.next();
  }

  typeMember(): number {
    const start = this.s.tokenStart;
    if (this.tok === T.OpenParen || this.tok === T.LessThan) {
      const m = this.st.length;
      this.typeSignatureRest();
      return this.fin(K.CallSignature, start, 0, m);
    }
    if (this.tok === T.New && this.lookAhead(() => (this.next(), this.tok === T.OpenParen || this.tok === T.LessThan))) {
      this.next();
      const m = this.st.length;
      this.typeSignatureRest();
      return this.fin(K.ConstructSignature, start, 0, m);
    }
    const flags = this.modifiers(false, false);
    if ((this.tok === T.Get || this.tok === T.Set) && this.lookAhead(() => (this.next(), this.tok === T.OpenBracket || this.isLiteralPropertyName()))) {
      return this.accessor(start, flags, this.tok === T.Get ? K.GetAccessor : K.SetAccessor, true);
    }
    if (this.tok === T.OpenBracket && this.isIndexSignature()) return this.indexSignature(start, flags);
    const m = this.st.length;
    this.push(this.propertyName());
    let f = flags;
    if (this.eat(T.Question)) f |= F.Optional;
    if (this.tok === T.OpenParen || this.tok === T.LessThan) {
      this.typeSignatureRest();
      return this.fin(K.MethodSignature, start, f, m);
    }
    this.push(this.typeAnnotation());
    // An initializer is an error in a type member; TypeScript parses it to report it.
    if (this.tok === T.Equals) this.error('A type member cannot have an initializer.');
    this.typeMemberSemicolon();
    return this.fin(K.PropertySignature, start, f, m);
  }

  /** Type parameters, parameters, `: type`, then `;` or `,`. */
  typeSignatureRest(): void {
    this.typeParameters();
    const saved = this.ctx;
    this.ctx &= ~(C_AWAIT | C_YIELD);
    this.parameters();
    this.ctx = saved;
    if (this.eat(T.Colon)) this.push(this.typeOrTypePredicate());
    this.typeMemberSemicolon();
  }

  typeAliasDeclaration(start: number, flags: number): number {
    this.expect(T.Type);
    const m = this.st.length;
    this.push(this.identifier());
    this.typeParameters();
    this.expect(T.Equals);
    if (this.tok === T.Intrinsic && this.lookAhead(() => (this.next(), this.canParseSemicolon()))) this.push(this.tokenNode(K.IntrinsicKeyword));
    else this.push(this.type());
    this.semicolon();
    return this.fin(K.TypeAliasDeclaration, start, flags, m);
  }

  enumDeclaration(start: number, flags: number): number {
    this.expect(T.Enum);
    const m = this.st.length;
    this.push(this.identifier());
    this.expect(T.OpenBrace);
    const saved = this.ctx;
    this.ctx &= ~C_NO_IN;
    while (this.tok !== T.CloseBrace) {
      const ms = this.s.tokenStart;
      const mm = this.st.length;
      this.push(this.propertyName());
      if (this.eat(T.Equals)) this.push(this.assignmentExpression());
      this.push(this.fin(K.EnumMember, ms, 0, mm));
      if (this.tok !== T.CloseBrace) this.expect(T.Comma);
    }
    this.ctx = saved;
    this.next();
    return this.fin(K.EnumDeclaration, start, flags, m);
  }

  moduleDeclaration(start: number, flags: number): number {
    const m = this.st.length;
    if (this.tok === T.Global) {
      this.push(this.tokenNode(K.Identifier));
      flags |= F.Global;
    } else {
      const isNamespace = this.tok === T.Namespace;
      this.next();
      if (isNamespace) flags |= F.Namespace;
      if (this.tok === T.StringLiteral) this.push(this.tokenNode(K.StringLiteral));
      else return this.namespaceRest(start, flags);
    }
    if (this.tok === T.OpenBrace) this.push(this.moduleBlock());
    else this.semicolon();
    return this.fin(K.ModuleDeclaration, start, flags, m);
  }

  /** `A.B.C { … }`: nested ModuleDeclarations, from the name on. */
  namespaceRest(start: number, flags: number): number {
    const m = this.st.length;
    this.push(this.identifier());
    if (this.eat(T.Dot)) this.push(this.namespaceRest(this.s.tokenStart, (flags & (F.Namespace)) | F.Export));
    else this.push(this.moduleBlock());
    return this.fin(K.ModuleDeclaration, start, flags, m);
  }

  moduleBlock(): number {
    const start = this.s.tokenStart;
    this.expect(T.OpenBrace);
    const m = this.st.length;
    while (this.tok !== T.CloseBrace) {
      if (this.tok === T.EOF) this.error("'}' expected.");
      this.push(this.statement());
    }
    this.next();
    return this.fin(K.ModuleBlock, start, 0, m);
  }

  // ------------------------------------------------------------------ imports and exports

  importDeclaration(start: number, flags: number): number {
    this.expect(T.Import);
    const afterImport = this.s.tokenStart;
    const m = this.st.length;
    let identifier = 0;
    if (this.isIdent()) identifier = this.identifier();
    let typeOnly = false;
    if (identifier && this.t.textOf(identifier) === 'type' &&
      (this.tok !== T.From || (this.isIdent() && this.lookAhead(() => (this.next(), this.tok === T.From || this.tok === T.Equals)))) &&
      (this.isIdent() || this.tok === T.Asterisk || this.tok === T.OpenBrace)) {
      typeOnly = true;
      identifier = this.isIdent() ? this.identifier() : 0;
    }
    if (identifier && this.tok !== T.Comma && this.tok !== T.From) {
      // import x = require('…') / import x = A.B
      this.expect(T.Equals);
      this.push(identifier);
      if (this.tok === T.Require && this.lookAhead(() => this.next() === T.OpenParen)) {
        const rs = this.s.tokenStart;
        this.next();
        this.next();
        const rm = this.st.length;
        if (this.tok !== T.StringLiteral) this.error('A string literal expected.');
        this.push(this.tokenNode(K.StringLiteral));
        this.expect(T.CloseParen);
        this.push(this.fin(K.ExternalModuleReference, rs, 0, rm));
      } else this.push(this.entityName(false));
      this.semicolon();
      return this.fin(K.ImportEqualsDeclaration, start, flags | (typeOnly ? F.TypeOnly : 0), m);
    }
    if (identifier || this.tok === T.Asterisk || this.tok === T.OpenBrace) {
      const cm = this.st.length;
      this.push(identifier);
      if (!identifier || this.eat(T.Comma)) {
        if (this.tok === T.Asterisk) {
          const ns = this.s.tokenStart;
          this.next();
          this.expect(T.As);
          const nm = this.st.length;
          this.push(this.identifier());
          this.push(this.fin(K.NamespaceImport, ns, 0, nm));
        } else this.push(this.namedImportsOrExports(K.NamedImports));
      }
      this.push(this.fin(K.ImportClause, afterImport, typeOnly ? F.TypeOnly : 0, cm));
      this.expect(T.From);
    }
    if (this.tok !== T.StringLiteral) this.error(`A module name (a string) expected, found ${this.found()}.`);
    this.push(this.tokenNode(K.StringLiteral));
    if ((this.tok === T.With || this.tok === T.Assert) && !this.s.newLine) this.push(this.importAttributes());
    this.semicolon();
    return this.fin(K.ImportDeclaration, start, flags, m);
  }

  importAttributes(): number {
    const start = this.s.tokenStart;
    this.next();
    this.expect(T.OpenBrace);
    const m = this.st.length;
    while (this.tok !== T.CloseBrace) {
      const as = this.s.tokenStart;
      const am = this.st.length;
      this.push(this.tok === T.StringLiteral ? this.tokenNode(K.StringLiteral) : this.identifierName());
      this.expect(T.Colon);
      this.push(this.assignmentExpression());
      this.push(this.fin(K.ImportAttribute, as, 0, am));
      if (this.tok !== T.CloseBrace) this.expect(T.Comma);
    }
    this.next();
    return this.fin(K.ImportAttributes, start, 0, m);
  }

  namedImportsOrExports(kind: number): number {
    const start = this.s.tokenStart;
    this.expect(T.OpenBrace);
    const m = this.st.length;
    const spec = kind === K.NamedImports ? K.ImportSpecifier : K.ExportSpecifier;
    while (this.tok !== T.CloseBrace) {
      this.push(this.importOrExportSpecifier(spec));
      if (this.tok !== T.CloseBrace) this.expect(T.Comma);
    }
    this.next();
    return this.fin(kind, start, 0, m);
  }

  /** `a`, `a as b`, `type a`, `type a as b`, and the corner cases of `type` and `as` as names (TypeScript's rules). */
  importOrExportSpecifier(kind: number): number {
    const start = this.s.tokenStart;
    const m = this.st.length;
    let flags = 0;
    const name = (): number => (this.tok === T.StringLiteral ? this.tokenNode(K.StringLiteral) : this.identifierName());
    let first = name();
    let property = 0;
    let local = first;
    if (this.t.textOf(first) === 'type' && this.t.kind[first] === K.Identifier) {
      if (this.tok === T.As) {
        // type as …
        const firstAs = this.tokenNode(K.Identifier);
        if (this.tok === T.As) {
          // type as as …
          const secondAs = this.tokenNode(K.Identifier);
          if (this.isIdentOrKeyword() || this.tok === T.StringLiteral) {
            flags |= F.TypeOnly;
            property = firstAs;
            local = name();
          } else {
            property = first;
            local = secondAs;
          }
        } else if (this.isIdentOrKeyword() || this.tok === T.StringLiteral) {
          property = first;
          local = name();
        } else {
          flags |= F.TypeOnly;
          local = firstAs;
        }
      } else if (this.isIdentOrKeyword() || this.tok === T.StringLiteral) {
        flags |= F.TypeOnly;
        first = name();
        local = first;
      }
    }
    if (!property && this.tok === T.As) {
      this.next();
      property = local;
      local = name();
    }
    this.push(property);
    this.push(local);
    return this.fin(kind, start, flags, m);
  }

  exportDeclaration(start: number, flags: number): number {
    const m = this.st.length;
    let f = flags;
    if (this.eat(T.Type)) f |= F.TypeOnly;
    if (this.tok === T.Asterisk) {
      const ns = this.s.tokenStart;
      this.next();
      if (this.eat(T.As)) {
        const nm = this.st.length;
        this.push(this.tok === T.StringLiteral ? this.tokenNode(K.StringLiteral) : this.identifierName());
        this.push(this.fin(K.NamespaceExport, ns, 0, nm));
      }
      this.expect(T.From);
      if (this.tok !== T.StringLiteral) this.error('A module name (a string) expected.');
      this.push(this.tokenNode(K.StringLiteral));
    } else {
      this.push(this.namedImportsOrExports(K.NamedExports));
      if (this.tok === T.From || (this.tok === T.StringLiteral && !this.s.newLine)) {
        this.expect(T.From);
        if (this.tok !== T.StringLiteral) this.error('A module name (a string) expected.');
        this.push(this.tokenNode(K.StringLiteral));
      }
    }
    if ((this.tok === T.With || this.tok === T.Assert) && !this.s.newLine && this.st.length > m) this.push(this.importAttributes());
    this.semicolon();
    return this.fin(K.ExportDeclaration, start, f, m);
  }

  exportAssignment(start: number, flags: number): number {
    let f = flags;
    if (this.eat(T.Equals)) f |= F.ExportEquals;
    else this.expect(T.Default);
    const m = this.st.length;
    const saved = this.ctx;
    this.ctx |= C_AWAIT;
    this.push(this.assignmentExpression());
    this.ctx = saved;
    this.semicolon();
    return this.fin(K.ExportAssignment, start, f, m);
  }

  // ------------------------------------------------------------------ other statements

  ifStatement(): number {
    const start = this.s.tokenStart;
    this.next();
    const m = this.st.length;
    this.push(this.parenthesizedCondition());
    this.push(this.statement());
    if (this.eat(T.Else)) this.push(this.statement());
    return this.fin(K.IfStatement, start, 0, m);
  }

  parenthesizedCondition(): number {
    this.expect(T.OpenParen);
    const saved = this.ctx;
    this.ctx &= ~C_NO_IN;
    const e = this.expression();
    this.ctx = saved;
    this.expect(T.CloseParen);
    return e;
  }

  doStatement(): number {
    const start = this.s.tokenStart;
    this.next();
    const m = this.st.length;
    this.push(this.statement());
    this.expect(T.While);
    this.push(this.parenthesizedCondition());
    // A semicolon after do-while is optional, even on the same line.
    this.eat(T.Semicolon);
    return this.fin(K.DoStatement, start, 0, m);
  }

  whileStatement(): number {
    const start = this.s.tokenStart;
    this.next();
    const m = this.st.length;
    this.push(this.parenthesizedCondition());
    this.push(this.statement());
    return this.fin(K.WhileStatement, start, 0, m);
  }

  forStatement(): number {
    const start = this.s.tokenStart;
    this.next();
    let flags = 0;
    if (this.tok === T.Await) {
      this.next();
      flags |= F.Await;
    }
    this.expect(T.OpenParen);
    const m = this.st.length;
    let init = 0;
    if (this.tok !== T.Semicolon) {
      const saved = this.ctx;
      this.ctx |= C_NO_IN;
      if (this.tok === T.Var || this.tok === T.Const ||
        (this.tok === T.Let && this.lookAhead(() => this.nextIsBindingStart())) ||
        (this.tok === T.Using && this.lookAhead(() => (this.next(), this.isIdent() && this.tok !== T.Of))) ||
        (this.tok === T.Await && this.isAwaitUsing())) {
        init = this.variableDeclarationList(true);
      } else init = this.expression();
      this.ctx = saved;
    }
    this.push(init);
    let kind = K.ForStatement;
    if (init && this.tok === T.Of) {
      this.next();
      kind = K.ForOfStatement;
      this.push(this.withIn(() => this.assignmentExpression()));
    } else if (init && this.tok === T.In) {
      this.next();
      kind = K.ForInStatement;
      this.push(this.withIn(() => this.expression()));
    } else {
      this.expect(T.Semicolon);
      if (this.tok !== T.Semicolon && this.tok !== T.CloseParen) this.push(this.withIn(() => this.expression()));
      this.expect(T.Semicolon);
      if (this.tok !== T.CloseParen) this.push(this.withIn(() => this.expression()));
    }
    this.expect(T.CloseParen);
    this.push(this.statement());
    return this.fin(kind, start, flags, m);
  }

  withIn(fn: () => number): number {
    const saved = this.ctx;
    this.ctx &= ~C_NO_IN;
    const r = fn();
    this.ctx = saved;
    return r;
  }

  breakOrContinue(kind: number): number {
    const start = this.s.tokenStart;
    this.next();
    const m = this.st.length;
    if (!this.canParseSemicolon()) this.push(this.identifier());
    this.semicolon();
    return this.fin(kind, start, 0, m);
  }

  returnStatement(): number {
    const start = this.s.tokenStart;
    this.next();
    const m = this.st.length;
    if (!this.canParseSemicolon()) this.push(this.withIn(() => this.expression()));
    this.semicolon();
    return this.fin(K.ReturnStatement, start, 0, m);
  }

  throwStatement(): number {
    const start = this.s.tokenStart;
    this.next();
    const m = this.st.length;
    if (!this.s.newLine) this.push(this.withIn(() => this.expression()));
    this.semicolon();
    return this.fin(K.ThrowStatement, start, 0, m);
  }

  switchStatement(): number {
    const start = this.s.tokenStart;
    this.next();
    const m = this.st.length;
    this.push(this.parenthesizedCondition());
    const bs = this.s.tokenStart;
    this.expect(T.OpenBrace);
    const bm = this.st.length;
    while (this.tok !== T.CloseBrace) {
      const cs = this.s.tokenStart;
      const cm = this.st.length;
      let kind = K.CaseClause;
      if (this.eat(T.Case)) this.push(this.withIn(() => this.expression()));
      else {
        this.expect(T.Default);
        kind = K.DefaultClause;
      }
      this.expect(T.Colon);
      while (this.tok !== T.Case && this.tok !== T.Default && this.tok !== T.CloseBrace) {
        if (this.tok === T.EOF) this.error("'}' expected.");
        this.push(this.statement());
      }
      this.push(this.fin(kind, cs, 0, cm));
    }
    this.next();
    this.push(this.fin(K.CaseBlock, bs, 0, bm));
    return this.fin(K.SwitchStatement, start, 0, m);
  }

  tryStatement(): number {
    const start = this.s.tokenStart;
    const m = this.st.length;
    this.expect(T.Try);
    this.push(this.block());
    if (this.tok === T.Catch) {
      const cs = this.s.tokenStart;
      this.next();
      const cm = this.st.length;
      if (this.eat(T.OpenParen)) {
        const vs = this.s.tokenStart;
        const vm = this.st.length;
        this.push(this.bindingName());
        this.push(this.typeAnnotation());
        this.push(this.fin(K.VariableDeclaration, vs, 0, vm));
        this.expect(T.CloseParen);
      }
      this.push(this.block());
      this.push(this.fin(K.CatchClause, cs, 0, cm));
    }
    if (this.eat(T.Finally)) this.push(this.block());
    else if (this.st.length === m + 1) this.error(`'catch' or 'finally' expected, found ${this.found()}.`);
    return this.fin(K.TryStatement, start, 0, m);
  }

  expressionOrLabeledStatement(): number {
    const start = this.s.tokenStart;
    const m = this.st.length;
    const expr = this.withIn(() => this.expression());
    if (this.t.kind[expr] === K.Identifier && this.tok === T.Colon) {
      this.next();
      this.push(expr);
      this.push(this.statement());
      return this.fin(K.LabeledStatement, start, 0, m);
    }
    this.push(expr);
    this.semicolon();
    return this.fin(K.ExpressionStatement, start, 0, m);
  }

  // ------------------------------------------------------------------ expressions

  /** Expression, with commas. */
  expression(): number {
    let left = this.assignmentExpression();
    while (this.tok === T.Comma) {
      const start = this.t.start[left]!;
      this.next();
      const m = this.st.length;
      this.push(left);
      this.push(this.assignmentExpression());
      left = this.fin(K.BinaryExpression, start, 0, m);
      this.t.data[left] = T.Comma;
    }
    return left;
  }

  assignmentExpression(allowReturnTypeInArrow = true): number {
    if (this.tok === T.Yield && this.isYieldExpression()) return this.yieldExpression();
    const arrow = this.tryParenthesizedArrow(allowReturnTypeInArrow) || this.tryAsyncSimpleArrow();
    if (arrow) return arrow;
    const start = this.s.tokenStart;
    const expr = this.binaryExpression(0);
    if (this.t.kind[expr] === K.Identifier && this.tok === T.EqualsGreaterThan) {
      return this.simpleArrow(start, expr, 0);
    }
    if (this.tok === T.GreaterThan) this.tok = this.s.reScanGreater();
    if (isAssignment(this.tok) && this.isLeftHandSide(expr)) {
      const op = this.tok;
      this.next();
      const m = this.st.length;
      this.push(expr);
      this.push(this.assignmentExpression(allowReturnTypeInArrow));
      const n = this.fin(K.BinaryExpression, start, 0, m);
      this.t.data[n] = op;
      return n;
    }
    return this.conditionalRest(start, expr, allowReturnTypeInArrow);
  }

  isLeftHandSide(n: number): boolean {
    const k = this.t.kind[n]!;
    return !(k === K.PrefixUnaryExpression || k === K.PostfixUnaryExpression || k === K.BinaryExpression ||
      k === K.ConditionalExpression || k === K.ArrowFunction || k === K.TypeOfExpression || k === K.VoidExpression ||
      k === K.DeleteExpression || k === K.AwaitExpression || k === K.YieldExpression || k === K.TypeAssertionExpression ||
      k === K.AsExpression || k === K.SatisfiesExpression);
  }

  conditionalRest(start: number, cond: number, allowReturnTypeInArrow: boolean): number {
    if (this.tok !== T.Question) return cond;
    this.next();
    const m = this.st.length;
    this.push(cond);
    this.push(this.withIn(() => this.assignmentExpression(false)));
    this.expect(T.Colon);
    this.push(this.assignmentExpression(allowReturnTypeInArrow));
    return this.fin(K.ConditionalExpression, start, 0, m);
  }

  isYieldExpression(): boolean {
    if (this.ctx & C_YIELD) return true;
    return this.lookAhead(() => this.nextIsIdentOrKeywordOrLiteralOnSameLine());
  }

  nextIsIdentOrKeywordOrLiteralOnSameLine(): boolean {
    this.next();
    const t = this.tok;
    return !this.s.newLine && (this.isIdentOrKeyword() || t === T.NumericLiteral || t === T.BigIntLiteral || t === T.StringLiteral);
  }

  yieldExpression(): number {
    const start = this.s.tokenStart;
    this.next();
    const m = this.st.length;
    let flags = 0;
    if (!this.s.newLine && (this.tok === T.Asterisk || this.isStartOfExpression())) {
      if (this.eat(T.Asterisk)) flags |= F.Generator;
      this.push(this.assignmentExpression());
    }
    return this.fin(K.YieldExpression, start, flags, m);
  }

  binaryExpression(precedence: number): number {
    const left = this.unaryExpression();
    return this.binaryRest(precedence, left);
  }

  binaryRest(precedence: number, left: number): number {
    const start = this.t.start[left]!;
    for (;;) {
      if (this.tok === T.GreaterThan) this.tok = this.s.reScanGreater();
      const op = this.tok;
      const p = binaryPrecedence(op);
      const consume = op === T.AsteriskAsterisk ? p >= precedence : p > precedence;
      if (p < 0 || !consume) break;
      if (op === T.In && this.ctx & C_NO_IN) break;
      if (op === T.As || op === T.Satisfies) {
        if (this.s.newLine) break;
        const opStart = this.s.tokenStart;
        this.next();
        const m = this.st.length;
        this.push(left);
        this.push(this.type());
        this.rec(opStart, this.prevEnd);
        left = this.fin(op === T.As ? K.AsExpression : K.SatisfiesExpression, start, 0, m);
        continue;
      }
      this.next();
      const m = this.st.length;
      this.push(left);
      this.push(this.binaryExpression(p));
      left = this.fin(K.BinaryExpression, start, 0, m);
      this.t.data[left] = op;
    }
    return left;
  }

  unaryExpression(): number {
    const t = this.tok;
    if (t === T.Plus || t === T.Minus || t === T.Tilde || t === T.Exclamation || t === T.Delete || t === T.Typeof ||
      t === T.Void || t === T.LessThan || (t === T.Await && this.isAwaitExpression())) {
      const start = this.s.tokenStart;
      const operand = this.simpleUnaryExpression();
      if (this.tok === T.AsteriskAsterisk) {
        this.error('A unary expression cannot be the left operand of **: add parentheses.', start);
      }
      return operand;
    }
    const start = this.s.tokenStart;
    const update = this.updateExpression();
    if (this.tok === T.AsteriskAsterisk) {
      void start;
      return this.binaryRest(binaryPrecedence(T.AsteriskAsterisk), update);
    }
    return update;
  }

  isAwaitExpression(): boolean {
    if (this.ctx & C_AWAIT) return true;
    this.possibleTopLevelAwait = true;
    return this.lookAhead(() => this.nextIsIdentOrKeywordOrLiteralOnSameLine());
  }

  simpleUnaryExpression(): number {
    const start = this.s.tokenStart;
    const t = this.tok;
    switch (t) {
      case T.Plus: case T.Minus: case T.Tilde: case T.Exclamation: {
        this.next();
        const m = this.st.length;
        this.push(this.simpleUnaryExpression());
        const n = this.fin(K.PrefixUnaryExpression, start, 0, m);
        this.t.data[n] = t;
        return n;
      }
      case T.Delete: case T.Typeof: case T.Void: case T.Await: {
        if (t === T.Await && !this.isAwaitExpression()) break;
        this.next();
        const m = this.st.length;
        this.push(this.simpleUnaryExpression());
        return this.fin(t === T.Delete ? K.DeleteExpression : t === T.Typeof ? K.TypeOfExpression : t === T.Void ? K.VoidExpression : K.AwaitExpression, start, 0, m);
      }
      case T.LessThan: {
        // <T>expr: a type assertion (no JSX in .ts files).
        this.next();
        const m = this.st.length;
        this.push(this.type());
        this.expect(T.GreaterThan);
        this.push(this.simpleUnaryExpression());
        return this.fin(K.TypeAssertionExpression, start, 0, m);
      }
    }
    return this.updateExpression();
  }

  updateExpression(): number {
    const start = this.s.tokenStart;
    if (this.tok === T.PlusPlus || this.tok === T.MinusMinus) {
      const op = this.tok;
      this.next();
      const m = this.st.length;
      this.push(this.leftHandSideExpression());
      const n = this.fin(K.PrefixUnaryExpression, start, 0, m);
      this.t.data[n] = op;
      return n;
    }
    const expr = this.leftHandSideExpression();
    if ((this.tok === T.PlusPlus || this.tok === T.MinusMinus) && !this.s.newLine) {
      const op = this.tok;
      this.next();
      const m = this.st.length;
      this.push(expr);
      const n = this.fin(K.PostfixUnaryExpression, start, 0, m);
      this.t.data[n] = op;
      return n;
    }
    return expr;
  }

  leftHandSideExpression(): number {
    const start = this.s.tokenStart;
    let expr: number;
    if (this.tok === T.Import && this.lookAhead(() => (this.next(), this.tok === T.OpenParen || this.tok === T.LessThan))) {
      expr = this.tokenNode(K.ImportKeyword);
    } else if (this.tok === T.Import && this.lookAhead(() => this.next() === T.Dot)) {
      this.next();
      this.next();
      const m = this.st.length;
      this.push(this.identifierName());
      expr = this.fin(K.MetaProperty, start, 0, m);
      this.sawImportMeta = true;
    } else if (this.tok === T.Super) {
      expr = this.tokenNode(K.SuperKeyword);
      if (this.tok === T.LessThan) this.error("'super' can't take type arguments.");
    } else {
      expr = this.primaryExpression();
    }
    return this.memberAndCallRest(start, expr, true);
  }

  /** `.x`, `?.x`, `[x]`, `!`, tagged templates, calls and type arguments after an expression. */
  memberAndCallRest(start: number, expr: number, allowCall: boolean): number {
    for (;;) {
      const t = this.tok;
      if (t === T.Dot) {
        this.next();
        const m = this.st.length;
        this.push(expr);
        this.push(this.tok === T.PrivateIdentifier ? this.tokenNode(K.PrivateIdentifier) : this.identifierName());
        expr = this.fin(K.PropertyAccessExpression, start, 0, m);
        continue;
      }
      if (t === T.QuestionDot) {
        if (!allowCall) break;
        this.next();
        const m = this.st.length;
        this.push(expr);
        if (this.tok === T.OpenParen) {
          this.arguments();
          expr = this.fin(K.CallExpression, start, F.Optional, m);
        } else if (this.tok === T.LessThan || this.tok === T.LessThanLessThan) {
          this.typeArguments();
          this.arguments();
          expr = this.fin(K.CallExpression, start, F.Optional, m);
        } else if (this.tok === T.OpenBracket) {
          this.next();
          this.push(this.withIn(() => this.expression()));
          this.expect(T.CloseBracket);
          expr = this.fin(K.ElementAccessExpression, start, F.Optional, m);
        } else {
          this.push(this.tok === T.PrivateIdentifier ? this.tokenNode(K.PrivateIdentifier) : this.identifierName());
          expr = this.fin(K.PropertyAccessExpression, start, F.Optional, m);
        }
        continue;
      }
      if (t === T.Exclamation && !this.s.newLine) {
        this.rec(this.s.tokenStart, this.s.pos);
        this.next();
        const m = this.st.length;
        this.push(expr);
        expr = this.fin(K.NonNullExpression, start, 0, m);
        continue;
      }
      if (t === T.OpenBracket) {
        this.next();
        const m = this.st.length;
        this.push(expr);
        this.push(this.withIn(() => this.expression()));
        this.expect(T.CloseBracket);
        expr = this.fin(K.ElementAccessExpression, start, 0, m);
        continue;
      }
      if (t === T.NoSubstitutionTemplateLiteral || t === T.TemplateHead) {
        const m = this.st.length;
        this.push(expr);
        this.push(this.templateExpression());
        expr = this.fin(K.TaggedTemplateExpression, start, 0, m);
        continue;
      }
      if (t === T.OpenParen && allowCall) {
        const m = this.st.length;
        this.push(expr);
        this.arguments();
        expr = this.fin(K.CallExpression, start, 0, m);
        continue;
      }
      if (t === T.LessThan || t === T.LessThanLessThan) {
        const m = this.st.length;
        this.push(expr);
        if (!this.tryParse(() => this.typeArgumentsInExpression())) {
          this.st.length = m;
          break;
        }
        const tt = this.tok as number;
        if (tt === T.OpenParen && allowCall) {
          this.arguments();
          expr = this.fin(K.CallExpression, start, 0, m);
        } else if (tt === T.NoSubstitutionTemplateLiteral || tt === T.TemplateHead) {
          this.push(this.templateExpression());
          expr = this.fin(K.TaggedTemplateExpression, start, 0, m);
        } else {
          expr = this.fin(K.ExpressionWithTypeArguments, start, 0, m);
        }
        continue;
      }
      break;
    }
    return expr;
  }

  /** Type arguments in an expression: pushed, returns 1 if they parsed and something that can follow them comes next. */
  typeArgumentsInExpression(): number {
    if (this.s.reScanLessThan() !== T.LessThan) return 0;
    this.tok = T.LessThan;
    const start = this.s.tokenStart;
    this.next();
    do this.push(this.type());
    while (this.eat(T.Comma));
    if (this.tok !== T.GreaterThan) return 0;
    if (this.s.reScanGreater() !== T.GreaterThan) return 0;
    this.next();
    if (!this.canFollowTypeArguments()) return 0;
    this.rec(start, this.prevEnd);
    return 1;
  }

  canFollowTypeArguments(): boolean {
    switch (this.tok) {
      case T.OpenParen: case T.NoSubstitutionTemplateLiteral: case T.TemplateHead:
        return true;
      case T.LessThan: case T.GreaterThan: case T.Plus: case T.Minus:
        return false;
    }
    return this.s.newLine || this.isBinaryOperator() || !this.isStartOfExpression();
  }

  isBinaryOperator(): boolean {
    if (this.ctx & C_NO_IN && this.tok === T.In) return false;
    return binaryPrecedence(this.tok) > 0;
  }

  isStartOfExpression(): boolean {
    switch (this.tok) {
      case T.This: case T.Super: case T.Null: case T.True: case T.False: case T.NumericLiteral: case T.BigIntLiteral:
      case T.StringLiteral: case T.NoSubstitutionTemplateLiteral: case T.TemplateHead: case T.OpenParen:
      case T.OpenBracket: case T.OpenBrace: case T.Function: case T.Class: case T.New: case T.Slash: case T.SlashEquals:
      case T.Identifier:
      case T.Plus: case T.Minus: case T.Tilde: case T.Exclamation: case T.Delete: case T.Typeof: case T.Void:
      case T.PlusPlus: case T.MinusMinus: case T.LessThan: case T.Await: case T.Yield: case T.PrivateIdentifier: case T.At:
        return true;
      case T.Import:
        return this.lookAhead(() => (this.next(), this.tok === T.OpenParen || this.tok === T.LessThan || this.tok === T.Dot));
    }
    if (this.isBinaryOperator()) return true;
    return this.isIdent();
  }

  /** `<T, U>` in a type position: pushed. */
  typeArguments(): void {
    if (this.s.reScanLessThan() !== T.LessThan) this.error("'<' expected.");
    this.tok = T.LessThan;
    const start = this.s.tokenStart;
    this.next();
    do this.push(this.type());
    while (this.eat(T.Comma));
    this.expect(T.GreaterThan);
    this.rec(start, this.prevEnd);
  }

  arguments(): void {
    this.expect(T.OpenParen);
    const saved = this.ctx;
    this.ctx &= ~C_NO_IN;
    while (this.tok !== T.CloseParen) {
      if (this.tok === T.DotDotDot) {
        const start = this.s.tokenStart;
        this.next();
        const m = this.st.length;
        this.push(this.assignmentExpression());
        this.push(this.fin(K.SpreadElement, start, 0, m));
      } else this.push(this.assignmentExpression());
      if (this.tok !== T.CloseParen) this.expect(T.Comma);
    }
    this.ctx = saved;
    this.next();
  }

  primaryExpression(): number {
    const start = this.s.tokenStart;
    switch (this.tok) {
      case T.NumericLiteral: case T.BigIntLiteral: case T.StringLiteral: case T.NoSubstitutionTemplateLiteral:
        return this.tokenNode(LITERAL_KIND[this.tok]!);
      case T.This: return this.tokenNode(K.ThisKeyword);
      case T.Super: return this.tokenNode(K.SuperKeyword);
      case T.Null: return this.tokenNode(K.NullKeyword);
      case T.True: return this.tokenNode(K.TrueKeyword);
      case T.False: return this.tokenNode(K.FalseKeyword);
      case T.PrivateIdentifier: return this.tokenNode(K.PrivateIdentifier);
      case T.OpenParen: {
        this.next();
        const m = this.st.length;
        this.push(this.withIn(() => this.expression()));
        this.expect(T.CloseParen);
        return this.fin(K.ParenthesizedExpression, start, 0, m);
      }
      case T.OpenBracket: return this.arrayLiteral();
      case T.OpenBrace: return this.objectLiteral();
      case T.Async:
        if (this.lookAhead(() => this.next() === T.Function && !this.s.newLine)) {
          this.next();
          return this.functionExpression(start, F.Async);
        }
        break;
      case T.Function: return this.functionExpression(start, 0);
      case T.Class: return this.classLike(K.ClassExpression, start, 0);
      case T.New: return this.newExpression();
      case T.Slash: case T.SlashEquals:
        this.tok = this.s.reScanSlash();
        return this.tokenNode(K.RegularExpressionLiteral);
      case T.TemplateHead: return this.templateExpression();
      case T.At: this.error('Decorators are not supported.');
    }
    if (!this.isIdent()) this.error(`An expression expected, found ${this.found()}.`);
    return this.identifier();
  }

  functionExpression(start: number, flags: number): number {
    this.expect(T.Function);
    if (this.eat(T.Asterisk)) flags |= F.Generator;
    const m = this.st.length;
    const saved = this.ctx;
    this.ctx = (saved & ~(C_AWAIT | C_YIELD)) | (flags & F.Async ? C_AWAIT : 0) | (flags & F.Generator ? C_YIELD : 0);
    if (this.isIdent()) this.push(this.identifier());
    this.ctx = saved;
    this.signature(flags, false);
    this.push(this.functionBody(flags));
    return this.fin(K.FunctionExpression, start, flags, m);
  }

  newExpression(): number {
    const start = this.s.tokenStart;
    this.next();
    if (this.tok === T.Dot) {
      this.next();
      const m = this.st.length;
      this.push(this.identifierName());
      return this.fin(K.MetaProperty, start, 0, m);
    }
    const es = this.s.tokenStart;
    const expr = this.memberAndCallRest(es, this.primaryExpression(), false);
    const m = this.st.length;
    if (this.t.kind[expr] === K.ExpressionWithTypeArguments) {
      // new X<T>(…): the type arguments belong to the new expression, as in TypeScript. The ExpressionWithTypeArguments
      // memberAndCallRest just made is the last row; its children move up and the row is dropped.
      for (let c = this.t.first[expr]!; c; c = this.t.next[c]!) this.push(c);
      this.t.count--;
    } else this.push(expr);
    if (this.tok === T.OpenParen) this.arguments();
    return this.fin(K.NewExpression, start, 0, m);
  }

  templateExpression(): number {
    if (this.tok === T.NoSubstitutionTemplateLiteral) return this.tokenNode(K.NoSubstitutionTemplateLiteral);
    const start = this.s.tokenStart;
    const m = this.st.length;
    this.push(this.tokenNode(K.TemplateHead));
    for (;;) {
      const ss = this.s.tokenStart;
      const sm = this.st.length;
      this.push(this.withIn(() => this.expression()));
      if (this.tok !== T.CloseBrace) this.error(`'}' expected, found ${this.found()}.`);
      this.tok = this.s.reScanTemplate();
      const tail = this.tok === T.TemplateTail;
      this.push(this.tokenNode(tail ? K.TemplateTail : K.TemplateMiddle));
      this.push(this.fin(K.TemplateSpan, ss, 0, sm));
      if (tail) break;
    }
    return this.fin(K.TemplateExpression, start, 0, m);
  }

  arrayLiteral(): number {
    const start = this.s.tokenStart;
    this.next();
    const m = this.st.length;
    const saved = this.ctx;
    this.ctx &= ~C_NO_IN;
    while (this.tok !== T.CloseBracket) {
      if (this.tok === T.Comma) {
        this.push(this.t.add(K.OmittedExpression, this.prevEnd, this.prevEnd, 0));
      } else if (this.tok === T.DotDotDot) {
        const es = this.s.tokenStart;
        this.next();
        const em = this.st.length;
        this.push(this.assignmentExpression());
        this.push(this.fin(K.SpreadElement, es, 0, em));
      } else this.push(this.assignmentExpression());
      if (this.tok !== T.CloseBracket) this.expect(T.Comma);
    }
    this.ctx = saved;
    this.next();
    return this.fin(K.ArrayLiteralExpression, start, 0, m);
  }

  objectLiteral(): number {
    const start = this.s.tokenStart;
    this.next();
    const m = this.st.length;
    const saved = this.ctx;
    this.ctx &= ~C_NO_IN;
    while (this.tok !== T.CloseBrace) {
      this.push(this.objectMember());
      if (this.tok !== T.CloseBrace) this.expect(T.Comma);
    }
    this.ctx = saved;
    this.next();
    return this.fin(K.ObjectLiteralExpression, start, 0, m);
  }

  objectMember(): number {
    const start = this.s.tokenStart;
    if (this.tok === T.DotDotDot) {
      this.next();
      const m = this.st.length;
      this.push(this.assignmentExpression());
      return this.fin(K.SpreadAssignment, start, 0, m);
    }
    const flags = this.modifiers(false, false);
    if ((this.tok === T.Get || this.tok === T.Set) && this.lookAhead(() => (this.next(), this.tok === T.OpenBracket || this.isLiteralPropertyName()))) {
      return this.accessor(start, flags, this.tok === T.Get ? K.GetAccessor : K.SetAccessor, false);
    }
    let f = flags;
    if (this.eat(T.Asterisk)) f |= F.Generator;
    const tokenIsIdentifier = this.isIdent();
    const m = this.st.length;
    this.push(this.propertyName());
    if (this.eat(T.Question)) f |= F.Optional;
    if (this.tok === T.Exclamation) this.next();
    if (f & F.Generator || this.tok === T.OpenParen || this.tok === T.LessThan) {
      this.signature(f, false);
      this.push(this.functionBody(f));
      return this.fin(K.MethodDeclaration, start, f, m);
    }
    if (tokenIsIdentifier && this.tok !== T.Colon) {
      // Shorthand: { a } or { a = 1 } (in a destructuring assignment).
      if (this.eat(T.Equals)) this.push(this.withIn(() => this.assignmentExpression()));
      return this.fin(K.ShorthandPropertyAssignment, start, f, m);
    }
    this.expect(T.Colon);
    this.push(this.withIn(() => this.assignmentExpression()));
    return this.fin(K.PropertyAssignment, start, f, m);
  }

  // ------------------------------------------------------------------ arrow functions

  tryParenthesizedArrow(allowReturnType: boolean): number {
    const t = this.tok;
    if (t !== T.OpenParen && t !== T.LessThan && t !== T.Async) return 0;
    const kind = this.lookAhead(() => this.isParenthesizedArrow());
    if (kind === FALSE) return 0;
    if (kind === TRUE) return this.parenthesizedArrow(true, allowReturnType);
    return this.tryParse(() => this.parenthesizedArrow(false, allowReturnType));
  }

  /** TypeScript's isParenthesizedArrowFunctionExpressionWorker. */
  isParenthesizedArrow(): number {
    if (this.tok === T.Async) {
      this.next();
      if (this.s.newLine) return FALSE;
      if (this.tok !== T.OpenParen && this.tok !== T.LessThan) return FALSE;
    }
    const first = this.tok;
    const second = this.next();
    if (first === T.OpenParen) {
      if (second === T.CloseParen) {
        const third = this.next();
        return third === T.EqualsGreaterThan || third === T.Colon || third === T.OpenBrace ? TRUE : FALSE;
      }
      if (second === T.OpenBracket || second === T.OpenBrace) return UNKNOWN;
      if (second === T.DotDotDot) return TRUE;
      if (modifierFlag(second) && second !== T.Async && this.lookAhead(() => (this.next(), this.isIdent()))) {
        return this.next() === T.As ? FALSE : TRUE;
      }
      if (!this.isIdent() && second !== T.This) return FALSE;
      switch (this.next()) {
        case T.Colon: return TRUE;
        case T.Question:
          this.next();
          return this.tok === T.Colon || this.tok === T.Comma || this.tok === T.Equals || this.tok === T.CloseParen ? TRUE : FALSE;
        case T.Comma: case T.Equals: case T.CloseParen: return UNKNOWN;
      }
      return FALSE;
    }
    // `<`: generic arrow function or type assertion.
    if (!this.isIdent() && this.tok !== T.Const) return FALSE;
    return UNKNOWN;
  }

  parenthesizedArrow(allowAmbiguity: boolean, allowReturnType: boolean): number {
    const start = this.s.tokenStart;
    let flags = 0;
    if (this.tok === T.Async) {
      this.next();
      flags |= F.Async;
    }
    const m = this.st.length;
    this.typeParameters();
    const saved = this.ctx;
    this.ctx = (saved & ~(C_AWAIT | C_YIELD)) | (flags & F.Async ? C_AWAIT : 0);
    this.parameters();
    this.ctx = saved;
    let hasReturnColon = false;
    if (this.tok === T.Colon) {
      hasReturnColon = true;
      const closeParen = this.prevEnd - 1;
      const colon = this.s.tokenStart;
      this.next();
      this.push(this.typeOrTypePredicate());
      // `=>` must be on the line of `)`. If the return type spans lines, the `)` moves to the end of the erased text.
      if (hasLineBreak(this.s.text, closeParen, this.prevEnd)) this.rec(closeParen, this.prevEnd, 41 /* ) */);
      else this.rec(colon, this.prevEnd);
    }
    if (!allowAmbiguity && this.tok !== T.EqualsGreaterThan && this.tok !== T.OpenBrace) return 0;
    this.expect(T.EqualsGreaterThan);
    this.push(this.arrowBody(flags));
    // In `c ? (x): y => …`, a return type is only taken if a ':' still follows for the conditional.
    if (!allowAmbiguity && hasReturnColon && !allowReturnType && this.tok !== T.Colon) return 0;
    return this.fin(K.ArrowFunction, start, flags, m);
  }

  arrowBody(flags: number): number {
    if (this.tok === T.OpenBrace) return this.functionBody(flags);
    const saved = this.ctx;
    this.ctx = (saved & ~(C_AWAIT | C_YIELD)) | (flags & F.Async ? C_AWAIT : 0);
    const e = this.assignmentExpression();
    this.ctx = saved;
    return e;
  }

  tryAsyncSimpleArrow(): number {
    if (this.tok !== T.Async) return 0;
    const ok = this.lookAhead(() => {
      this.next();
      if (this.s.newLine || this.tok === T.EqualsGreaterThan) return false;
      if (!this.isIdent()) return false;
      this.next();
      return !this.s.newLine && this.tok === T.EqualsGreaterThan;
    });
    if (!ok) return 0;
    const start = this.s.tokenStart;
    this.next();
    const param = this.identifier();
    return this.simpleArrow(start, param, F.Async);
  }

  /** `x => …`: the identifier becomes a Parameter. */
  simpleArrow(start: number, ident: number, flags: number): number {
    const t = this.t;
    const param = t.add(K.Parameter, t.start[ident]!, t.end[ident]!, 0);
    t.first[param] = ident;
    const m = this.st.length;
    this.push(param);
    this.expect(T.EqualsGreaterThan);
    this.push(this.arrowBody(flags));
    return this.fin(K.ArrowFunction, start, flags, m);
  }

  // ------------------------------------------------------------------ types

  type(): number {
    if (this.isStartOfFunctionOrConstructorType()) return this.functionOrConstructorType();
    const start = this.s.tokenStart;
    const type = this.unionType();
    if (!(this.ctx & C_NO_CONDITIONAL_TYPES) && !this.s.newLine && this.tok === T.Extends) {
      this.next();
      const m = this.st.length;
      this.push(type);
      const saved = this.ctx;
      this.ctx |= C_NO_CONDITIONAL_TYPES;
      this.push(this.type());
      this.ctx = saved & ~C_NO_CONDITIONAL_TYPES;
      this.expect(T.Question);
      this.push(this.type());
      this.expect(T.Colon);
      this.push(this.type());
      this.ctx = saved;
      return this.fin(K.ConditionalType, start, 0, m);
    }
    return type;
  }

  /** A type where a type predicate (`x is T`) may stand: return types. */
  typeOrTypePredicate(): number {
    const start = this.s.tokenStart;
    if (this.isIdent() && this.lookAhead(() => (this.next(), this.tok === T.Is && !this.s.newLine))) {
      const m = this.st.length;
      this.push(this.identifier());
      this.next(); // is
      this.push(this.type());
      return this.fin(K.TypePredicate, start, 0, m);
    }
    return this.type();
  }

  isStartOfFunctionOrConstructorType(): boolean {
    const t = this.tok;
    if (t === T.LessThan) return true;
    if (t === T.OpenParen) return this.lookAhead(() => this.isUnambiguouslyStartOfFunctionType());
    return t === T.New || (t === T.Abstract && this.lookAhead(() => this.next() === T.New));
  }

  isUnambiguouslyStartOfFunctionType(): boolean {
    this.next();
    if (this.tok === T.CloseParen || this.tok === T.DotDotDot) return true;
    if (this.skipParameterStart()) {
      const t = this.tok;
      if (t === T.Colon || t === T.Comma || t === T.Question || t === T.Equals) return true;
      if (t === T.CloseParen) return this.next() === T.EqualsGreaterThan;
    }
    return false;
  }

  skipParameterStart(): boolean {
    if (modifierFlag(this.tok)) this.modifiers(false, false);
    if (this.isIdent() || this.tok === T.This) {
      this.next();
      return true;
    }
    if (this.tok === T.OpenBracket || this.tok === T.OpenBrace) {
      const before = this.t.count;
      try {
        this.bindingName();
      } catch (e) {
        if (e === FAIL || e instanceof ParseError) return false;
        throw e;
      }
      return this.t.count > before;
    }
    return false;
  }

  functionOrConstructorType(): number {
    const start = this.s.tokenStart;
    let flags = 0;
    let kind = K.FunctionType;
    if (this.tok === T.Abstract) {
      this.next();
      flags |= F.Abstract;
    }
    if (this.eat(T.New)) kind = K.ConstructorType;
    const m = this.st.length;
    this.signature(0, true);
    return this.fin(kind, start, flags, m);
  }

  unionType(): number {
    return this.unionOrIntersection(T.Bar, K.UnionType);
  }

  unionOrIntersection(op: number, kind: number): number {
    const start = this.s.tokenStart;
    const leading = this.eat(op);
    const constituent = (): number => {
      if (leading || this.st.length > mark) {
        if (this.isStartOfFunctionOrConstructorType()) {
          this.error(`A function type in a${kind === K.UnionType ? ' union' : 'n intersection'} type must be in parentheses.`);
        }
      }
      return kind === K.UnionType ? this.unionOrIntersection(T.Ampersand, K.IntersectionType) : this.typeOperator();
    };
    const mark = this.st.length;
    const first = constituent();
    if (this.tok !== op && !leading) return first;
    const m = mark;
    this.push(first);
    while (this.eat(op)) this.push(constituent());
    return this.fin(kind, start, 0, m);
  }

  typeOperator(): number {
    const start = this.s.tokenStart;
    const t = this.tok;
    if (t === T.Keyof || t === T.Unique || t === T.Readonly) {
      this.next();
      const m = this.st.length;
      this.push(this.typeOperator());
      const n = this.fin(K.TypeOperator, start, 0, m);
      this.t.data[n] = t;
      return n;
    }
    if (t === T.Infer) {
      this.next();
      const m = this.st.length;
      const ps = this.s.tokenStart;
      const pm = this.st.length;
      this.push(this.identifier());
      const constraint = this.tryParse(() => {
        if (!this.eat(T.Extends)) return 0;
        const saved = this.ctx;
        this.ctx |= C_NO_CONDITIONAL_TYPES;
        const c = this.type();
        this.ctx = saved;
        if (!(saved & C_NO_CONDITIONAL_TYPES) && this.tok === T.Question) return 0;
        return c;
      });
      this.push(constraint);
      this.push(this.fin(K.TypeParameter, ps, 0, pm));
      return this.fin(K.InferType, start, 0, m);
    }
    const saved = this.ctx;
    this.ctx &= ~C_NO_CONDITIONAL_TYPES;
    const r = this.postfixType();
    this.ctx = saved;
    return r;
  }

  postfixType(): number {
    const start = this.s.tokenStart;
    let type = this.nonArrayType();
    while (!this.s.newLine && this.tok === T.OpenBracket) {
      this.next();
      const m = this.st.length;
      this.push(type);
      if (this.tok === T.CloseBracket) {
        this.next();
        type = this.fin(K.ArrayType, start, 0, m);
      } else {
        this.push(this.type());
        this.expect(T.CloseBracket);
        type = this.fin(K.IndexedAccessType, start, 0, m);
      }
    }
    return type;
  }

  nonArrayType(): number {
    const start = this.s.tokenStart;
    const t = this.tok;
    const kw = keywordType(t);
    if (kw) {
      if (this.lookAhead(() => this.next() !== T.Dot)) return this.tokenNode(kw);
      return this.typeReference();
    }
    switch (t) {
      case T.Void: return this.tokenNode(K.VoidKeyword);
      case T.Null: case T.True: case T.False: {
        const m = this.st.length;
        this.push(this.tokenNode(t === T.Null ? K.NullKeyword : t === T.True ? K.TrueKeyword : K.FalseKeyword));
        return this.fin(K.LiteralType, start, 0, m);
      }
      case T.StringLiteral: case T.NumericLiteral: case T.BigIntLiteral: case T.NoSubstitutionTemplateLiteral: {
        const m = this.st.length;
        this.push(this.tokenNode(LITERAL_KIND[t]!));
        return this.fin(K.LiteralType, start, 0, m);
      }
      case T.Minus:
        if (this.lookAhead(() => (this.next(), this.tok === T.NumericLiteral || this.tok === T.BigIntLiteral))) {
          const m = this.st.length;
          const um = this.st.length;
          this.next();
          this.push(this.tokenNode(LITERAL_KIND[this.tok]!));
          const u = this.fin(K.PrefixUnaryExpression, start, 0, um);
          this.t.data[u] = T.Minus;
          this.push(u);
          return this.fin(K.LiteralType, start, 0, m);
        }
        break;
      case T.This: {
        const thisType = this.tokenNode(K.ThisType);
        if (this.tok === T.Is && !this.s.newLine) {
          this.next();
          const m = this.st.length;
          this.push(thisType);
          this.push(this.type());
          return this.fin(K.TypePredicate, start, 0, m);
        }
        return thisType;
      }
      case T.Typeof:
        if (this.lookAhead(() => this.next() === T.Import)) return this.importType();
        return this.typeQuery();
      case T.OpenBrace:
        if (this.lookAhead(() => this.isStartOfMappedType())) return this.mappedType();
        return this.typeLiteral();
      case T.OpenBracket: return this.tupleType();
      case T.OpenParen: {
        this.next();
        const m = this.st.length;
        this.push(this.type());
        this.expect(T.CloseParen);
        return this.fin(K.ParenthesizedType, start, 0, m);
      }
      case T.Import: return this.importType();
      case T.Asserts:
        if (this.lookAhead(() => (this.next(), !this.s.newLine && (this.isIdentOrKeyword())))) {
          this.next();
          const m = this.st.length;
          this.push(this.tok === T.This ? this.tokenNode(K.ThisType) : this.identifier());
          if (this.eat(T.Is)) this.push(this.type());
          return this.fin(K.TypePredicate, start, F.Asserts, m);
        }
        break;
      case T.TemplateHead: return this.templateLiteralType();
    }
    return this.typeReference();
  }

  typeReference(): number {
    const start = this.s.tokenStart;
    const m = this.st.length;
    if (!this.isIdent() && !isKeyword(this.tok)) this.error(`A type expected, found ${this.found()}.`);
    this.push(this.entityName(true));
    if (!this.s.newLine && (this.tok === T.LessThan || this.tok === T.LessThanLessThan)) this.typeArguments();
    return this.fin(K.TypeReference, start, 0, m);
  }

  typeQuery(): number {
    const start = this.s.tokenStart;
    this.next(); // typeof
    const m = this.st.length;
    this.push(this.entityName(true));
    if (!this.s.newLine && this.tok === T.LessThan) this.typeArguments();
    return this.fin(K.TypeQuery, start, 0, m);
  }

  importType(): number {
    const start = this.s.tokenStart;
    let flags = 0;
    if (this.eat(T.Typeof)) flags |= F.TypeOf;
    this.expect(T.Import);
    this.expect(T.OpenParen);
    const m = this.st.length;
    const ls = this.s.tokenStart;
    const lm = this.st.length;
    if (this.tok !== T.StringLiteral) this.error('A module name (a string) expected.');
    this.push(this.tokenNode(K.StringLiteral));
    this.push(this.fin(K.LiteralType, ls, 0, lm));
    if (this.eat(T.Comma)) {
      // import('x', { with: { … } }): attributes; parsed and kept as an object literal is TypeScript's own shape.
      this.error('Import attributes in import types are not supported.');
    }
    this.expect(T.CloseParen);
    if (this.eat(T.Dot)) this.push(this.entityName(true));
    if (!this.s.newLine && this.tok === T.LessThan) this.typeArguments();
    return this.fin(K.ImportType, start, flags, m);
  }

  isStartOfMappedType(): boolean {
    this.next();
    if (this.tok === T.Plus || this.tok === T.Minus) return this.next() === T.Readonly;
    if (this.tok === T.Readonly) this.next();
    return this.tok === T.OpenBracket && (this.next(), this.isIdent()) && this.next() === T.In;
  }

  mappedType(): number {
    const start = this.s.tokenStart;
    this.next(); // {
    let flags = 0;
    if (this.tok === T.Readonly || this.tok === T.Plus || this.tok === T.Minus) {
      flags |= F.MappedReadonly;
      if (this.tok !== T.Readonly) this.next();
      this.expect(T.Readonly);
    }
    this.expect(T.OpenBracket);
    const m = this.st.length;
    const ps = this.s.tokenStart;
    const pm = this.st.length;
    this.push(this.identifier());
    this.expect(T.In);
    this.push(this.type());
    this.push(this.fin(K.TypeParameter, ps, 0, pm));
    if (this.eat(T.As)) this.push(this.type());
    this.expect(T.CloseBracket);
    if (this.tok === T.Question || this.tok === T.Plus || this.tok === T.Minus) {
      flags |= F.MappedQuestion;
      if (this.tok !== T.Question) this.next();
      this.expect(T.Question);
    }
    this.push(this.typeAnnotation());
    this.semicolon();
    if (this.tok !== T.CloseBrace) this.error("A mapped type can't have other members: '}' expected.");
    this.next();
    return this.fin(K.MappedType, start, flags, m);
  }

  typeLiteral(): number {
    const start = this.s.tokenStart;
    const m = this.st.length;
    this.typeMembers();
    return this.fin(K.TypeLiteral, start, 0, m);
  }

  tupleType(): number {
    const start = this.s.tokenStart;
    this.next();
    const m = this.st.length;
    while (this.tok !== T.CloseBracket) {
      this.push(this.tupleElement());
      if (this.tok !== T.CloseBracket) this.expect(T.Comma);
    }
    this.next();
    return this.fin(K.TupleType, start, 0, m);
  }

  tupleElement(): number {
    const start = this.s.tokenStart;
    const named = this.lookAhead(() => {
      if (this.tok === T.DotDotDot) this.next();
      if (!this.isIdentOrKeyword()) return false;
      this.next();
      if (this.tok === T.Question) this.next();
      return this.tok === T.Colon;
    });
    if (named) {
      let flags = 0;
      if (this.eat(T.DotDotDot)) flags |= F.Rest;
      const m = this.st.length;
      this.push(this.identifierName());
      if (this.eat(T.Question)) flags |= F.Optional;
      this.expect(T.Colon);
      this.push(this.tupleElementType());
      return this.fin(K.NamedTupleMember, start, flags, m);
    }
    return this.tupleElementType();
  }

  tupleElementType(): number {
    const start = this.s.tokenStart;
    if (this.eat(T.DotDotDot)) {
      const m = this.st.length;
      this.push(this.type());
      return this.fin(K.RestType, start, 0, m);
    }
    const type = this.type();
    if (this.tok === T.Question && !this.lookAhead(() => (this.next(), this.isStartOfType()))) {
      this.next();
      const m = this.st.length;
      this.push(type);
      return this.fin(K.OptionalType, start, 0, m);
    }
    return type;
  }

  isStartOfType(): boolean {
    switch (this.tok) {
      case T.Any: case T.Unknown: case T.String: case T.Number: case T.Bigint: case T.Boolean: case T.Readonly:
      case T.Symbol: case T.Unique: case T.Void: case T.Undefined: case T.Null: case T.This: case T.Typeof:
      case T.Never: case T.OpenBrace: case T.OpenBracket: case T.LessThan: case T.Bar: case T.Ampersand: case T.New:
      case T.StringLiteral: case T.NumericLiteral: case T.BigIntLiteral: case T.True: case T.False: case T.Object:
      case T.Asterisk: case T.Question: case T.Exclamation: case T.DotDotDot: case T.Infer: case T.Import:
      case T.Asserts: case T.NoSubstitutionTemplateLiteral: case T.TemplateHead:
        return true;
      case T.Function: return false;
      case T.Minus: return this.lookAhead(() => (this.next(), this.tok === T.NumericLiteral || this.tok === T.BigIntLiteral));
      case T.OpenParen: return this.lookAhead(() => (this.next(), this.tok === T.CloseParen || this.isStartOfParameter() || this.isStartOfType()));
    }
    return this.isIdent();
  }

  isStartOfParameter(): boolean {
    return this.tok === T.DotDotDot || this.tok === T.OpenBracket || this.tok === T.OpenBrace || this.tok === T.This ||
      this.isIdent() || !!modifierFlag(this.tok) || this.tok === T.At;
  }

  templateLiteralType(): number {
    const start = this.s.tokenStart;
    const m = this.st.length;
    this.push(this.tokenNode(K.TemplateHead));
    for (;;) {
      const ss = this.s.tokenStart;
      const sm = this.st.length;
      this.push(this.type());
      if (this.tok !== T.CloseBrace) this.error(`'}' expected, found ${this.found()}.`);
      this.tok = this.s.reScanTemplate();
      const tail = this.tok === T.TemplateTail;
      this.push(this.tokenNode(tail ? K.TemplateTail : K.TemplateMiddle));
      this.push(this.fin(K.TemplateLiteralTypeSpan, ss, 0, sm));
      if (tail) break;
    }
    return this.fin(K.TemplateLiteralType, start, 0, m);
  }
}

