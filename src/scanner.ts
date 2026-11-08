// The scanner: turns source text into tokens, one at a time, on demand from the parser. It works on character codes
// and keeps no token objects: the current token is a code and two offsets. Where JavaScript's grammar needs the parser
// to decide (a `/` that starts a regular expression, `>` that may be part of `>>`, `}` that continues a template), the
// parser asks the scanner to scan the token again.
import { KEYWORDS, T } from './tokens.js';

/** A SyntaxError with the 1-based line and column of the problem. */
export class ParseError extends SyntaxError {
  readonly line: number;
  readonly column: number;
  readonly pos: number;
  constructor(message: string, pos: number, line: number, column: number) {
    super(message);
    this.name = 'SyntaxError';
    this.pos = pos;
    this.line = line;
    this.column = column;
  }
}

/** 1-based line and column of an offset. */
export function lineAndColumn(text: string, pos: number): { line: number; column: number } {
  let line = 1;
  let start = 0;
  for (let i = 0; i < pos && i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || c === 0x2028 || c === 0x2029 || (c === 13 && text.charCodeAt(i + 1) !== 10)) {
      line++;
      start = i + 1;
    }
  }
  return { line, column: pos - start + 1 };
}

const ID_START = /[\p{ID_Start}$_]/u;
const ID_CONTINUE = /[\p{ID_Continue}$‌‍]/u;

function isIdStart(c: number): boolean {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 36 || c === 95 || (c > 127 && ID_START.test(String.fromCodePoint(c)));
}
function isIdPart(c: number): boolean {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 36 || c === 95 ||
    (c > 127 && ID_CONTINUE.test(String.fromCodePoint(c)));
}
const isLineBreak = (c: number): boolean => c === 10 || c === 13 || c === 0x2028 || c === 0x2029;
const isDigit = (c: number): boolean => c >= 48 && c <= 57;

export interface ScannerState {
  pos: number;
  token: number;
  tokenStart: number;
  newLine: boolean;
}

export class Scanner {
  readonly text: string;
  readonly fileName: string | undefined;
  /** Offset after the current token. */
  pos = 0;
  /** The current token's code (see T). */
  token: number = T.EOF;
  /** Where the current token starts, after whitespace and comments. */
  tokenStart = 0;
  /** A line break comes between the previous token and this one. */
  newLine = false;

  constructor(text: string, fileName?: string) {
    this.text = text;
    this.fileName = fileName;
    // A hashbang line is skipped like a comment.
    if (text.charCodeAt(0) === 35 && text.charCodeAt(1) === 33) {
      let i = 2;
      while (i < text.length && !isLineBreak(text.charCodeAt(i))) i++;
      this.pos = i;
    }
  }

  error(message: string, pos = this.tokenStart): never {
    const { line, column } = lineAndColumn(this.text, pos);
    const where = `line ${line}, column ${column}`;
    throw new ParseError(`${this.fileName ? `${this.fileName}, ` : ''}${where}: ${message}`, pos, line, column);
  }

  save(): ScannerState {
    return { pos: this.pos, token: this.token, tokenStart: this.tokenStart, newLine: this.newLine };
  }
  restore(s: ScannerState): void {
    this.pos = s.pos;
    this.token = s.token;
    this.tokenStart = s.tokenStart;
    this.newLine = s.newLine;
  }

  /** The current token's text. */
  tokenText(): string {
    return this.text.slice(this.tokenStart, this.pos);
  }

  /** Scans the next token. */
  next(): number {
    const text = this.text;
    const n = text.length;
    let pos = this.pos;
    this.newLine = false;
    // Whitespace and comments.
    for (;;) {
      if (pos >= n) {
        this.pos = this.tokenStart = n;
        return (this.token = T.EOF);
      }
      const c = text.charCodeAt(pos);
      if (c === 32 || c === 9 || c === 11 || c === 12 || c === 0xa0 || c === 0xfeff) pos++;
      else if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) {
        this.newLine = true;
        pos++;
      } else if (c === 47) {
        const d = text.charCodeAt(pos + 1);
        if (d === 47) {
          pos += 2;
          while (pos < n && !isLineBreak(text.charCodeAt(pos))) pos++;
        } else if (d === 42) {
          const end = text.indexOf('*/', pos + 2);
          if (end < 0) this.error('The comment is not closed: */ expected.', pos);
          for (let i = pos + 2; i < end; i++) if (isLineBreak(text.charCodeAt(i))) { this.newLine = true; break; }
          pos = end + 2;
        } else break;
      } else if (c > 127 && c !== 0x2028 && c !== 0x2029 && /\s/.test(text[pos]!)) pos++;
      else break;
    }
    this.tokenStart = pos;
    const c = text.charCodeAt(pos);
    // Identifiers and keywords: the common case first.
    if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 36 || c === 95) {
      let i = pos + 1;
      for (;;) {
        const d = text.charCodeAt(i);
        if ((d >= 97 && d <= 122) || (d >= 65 && d <= 90) || (d >= 48 && d <= 57) || d === 36 || d === 95) i++;
        else break;
      }
      const d = text.charCodeAt(i);
      if (d === 92 || (d > 127 && i < n)) return this.identifierRest(i);
      this.pos = i;
      // Keywords are all lower case, 2 to 11 letters long.
      if (c >= 97 && i - pos >= 2 && i - pos <= 11) {
        const kw = KEYWORDS.get(text.slice(pos, i));
        if (kw !== undefined) return (this.token = kw);
      }
      return (this.token = T.Identifier);
    }
    if (isDigit(c)) return this.number(pos);
    switch (c) {
      case 34: // "
      case 39: // '
        return this.string(pos, c);
      case 96: // `
        return this.template(pos + 1, true);
      case 123: return this.punct(pos + 1, T.OpenBrace);
      case 125: return this.punct(pos + 1, T.CloseBrace);
      case 40: return this.punct(pos + 1, T.OpenParen);
      case 41: return this.punct(pos + 1, T.CloseParen);
      case 91: return this.punct(pos + 1, T.OpenBracket);
      case 93: return this.punct(pos + 1, T.CloseBracket);
      case 59: return this.punct(pos + 1, T.Semicolon);
      case 44: return this.punct(pos + 1, T.Comma);
      case 58: return this.punct(pos + 1, T.Colon);
      case 126: return this.punct(pos + 1, T.Tilde);
      case 64: return this.punct(pos + 1, T.At);
      case 46: { // .
        const d = text.charCodeAt(pos + 1);
        if (isDigit(d)) return this.number(pos);
        if (d === 46 && text.charCodeAt(pos + 2) === 46) return this.punct(pos + 3, T.DotDotDot);
        return this.punct(pos + 1, T.Dot);
      }
      case 63: { // ?
        const d = text.charCodeAt(pos + 1);
        if (d === 46 && !isDigit(text.charCodeAt(pos + 2))) return this.punct(pos + 2, T.QuestionDot);
        if (d === 63) return text.charCodeAt(pos + 2) === 61 ? this.punct(pos + 3, T.QuestionQuestionEquals) : this.punct(pos + 2, T.QuestionQuestion);
        return this.punct(pos + 1, T.Question);
      }
      case 61: { // =
        const d = text.charCodeAt(pos + 1);
        if (d === 61) return text.charCodeAt(pos + 2) === 61 ? this.punct(pos + 3, T.EqualsEqualsEquals) : this.punct(pos + 2, T.EqualsEquals);
        if (d === 62) return this.punct(pos + 2, T.EqualsGreaterThan);
        return this.punct(pos + 1, T.Equals);
      }
      case 33: { // !
        if (text.charCodeAt(pos + 1) === 61) return text.charCodeAt(pos + 2) === 61 ? this.punct(pos + 3, T.ExclamationEqualsEquals) : this.punct(pos + 2, T.ExclamationEquals);
        return this.punct(pos + 1, T.Exclamation);
      }
      case 43: { // +
        const d = text.charCodeAt(pos + 1);
        if (d === 43) return this.punct(pos + 2, T.PlusPlus);
        if (d === 61) return this.punct(pos + 2, T.PlusEquals);
        return this.punct(pos + 1, T.Plus);
      }
      case 45: { // -
        const d = text.charCodeAt(pos + 1);
        if (d === 45) return this.punct(pos + 2, T.MinusMinus);
        if (d === 61) return this.punct(pos + 2, T.MinusEquals);
        return this.punct(pos + 1, T.Minus);
      }
      case 42: { // *
        const d = text.charCodeAt(pos + 1);
        if (d === 42) return text.charCodeAt(pos + 2) === 61 ? this.punct(pos + 3, T.AsteriskAsteriskEquals) : this.punct(pos + 2, T.AsteriskAsterisk);
        if (d === 61) return this.punct(pos + 2, T.AsteriskEquals);
        return this.punct(pos + 1, T.Asterisk);
      }
      case 47: // / (comments were handled above)
        return text.charCodeAt(pos + 1) === 61 ? this.punct(pos + 2, T.SlashEquals) : this.punct(pos + 1, T.Slash);
      case 37: // %
        return text.charCodeAt(pos + 1) === 61 ? this.punct(pos + 2, T.PercentEquals) : this.punct(pos + 1, T.Percent);
      case 60: { // <
        const d = text.charCodeAt(pos + 1);
        if (d === 60) return text.charCodeAt(pos + 2) === 61 ? this.punct(pos + 3, T.LessThanLessThanEquals) : this.punct(pos + 2, T.LessThanLessThan);
        if (d === 61) return this.punct(pos + 2, T.LessThanEquals);
        return this.punct(pos + 1, T.LessThan);
      }
      case 62: // > alone: the parser asks for >=, >> and the rest with reScanGreater.
        return this.punct(pos + 1, T.GreaterThan);
      case 38: { // &
        const d = text.charCodeAt(pos + 1);
        if (d === 38) return text.charCodeAt(pos + 2) === 61 ? this.punct(pos + 3, T.AmpersandAmpersandEquals) : this.punct(pos + 2, T.AmpersandAmpersand);
        if (d === 61) return this.punct(pos + 2, T.AmpersandEquals);
        return this.punct(pos + 1, T.Ampersand);
      }
      case 124: { // |
        const d = text.charCodeAt(pos + 1);
        if (d === 124) return text.charCodeAt(pos + 2) === 61 ? this.punct(pos + 3, T.BarBarEquals) : this.punct(pos + 2, T.BarBar);
        if (d === 61) return this.punct(pos + 2, T.BarEquals);
        return this.punct(pos + 1, T.Bar);
      }
      case 94: // ^
        return text.charCodeAt(pos + 1) === 61 ? this.punct(pos + 2, T.CaretEquals) : this.punct(pos + 1, T.Caret);
      case 35: { // #
        const d = text.codePointAt(pos + 1) ?? 0;
        if (isIdStart(d) || d === 92) {
          this.identifierRest(pos + 1);
          return (this.token = T.PrivateIdentifier);
        }
        return this.punct(pos + 1, T.Hash);
      }
      case 92: // \ starts an escaped identifier
        return this.identifierRest(pos);
    }
    const cp = text.codePointAt(pos)!;
    if (isIdStart(cp)) return this.identifierRest(pos);
    this.error(`Invalid character '${String.fromCodePoint(cp)}'.`);
  }

  private punct(end: number, token: number): number {
    this.pos = end;
    return (this.token = token);
  }

  /** The rest of an identifier from `i`, with Unicode letters and \u escapes. */
  private identifierRest(i: number): number {
    const text = this.text;
    let escaped = false;
    for (;;) {
      const c = text.codePointAt(i);
      if (c === undefined) break;
      if (c === 92) {
        if (text.charCodeAt(i + 1) !== 117) this.error('Invalid character in an identifier.', i);
        escaped = true;
        if (text.charCodeAt(i + 2) === 123) {
          const close = text.indexOf('}', i + 3);
          if (close < 0) this.error('Invalid Unicode escape.', i);
          i = close + 1;
        } else i += 6;
      } else if (isIdPart(c)) i += c > 0xffff ? 2 : 1;
      else break;
    }
    this.pos = i;
    if (!escaped) {
      const kw = KEYWORDS.get(text.slice(this.tokenStart, i));
      if (kw !== undefined) return (this.token = kw);
    }
    return (this.token = T.Identifier);
  }

  private number(pos: number): number {
    const text = this.text;
    let i = pos;
    const c = text.charCodeAt(i);
    const d = text.charCodeAt(i + 1) | 32;
    if (c === 48 && (d === 120 || d === 111 || d === 98)) { // 0x 0o 0b
      i += 2;
      for (;;) {
        const e = text.charCodeAt(i);
        if (isDigit(e) || ((e | 32) >= 97 && (e | 32) <= 102) || e === 95) i++;
        else break;
      }
    } else {
      while (isDigit(text.charCodeAt(i)) || text.charCodeAt(i) === 95) i++;
      if (text.charCodeAt(i) === 46) {
        i++;
        while (isDigit(text.charCodeAt(i)) || text.charCodeAt(i) === 95) i++;
      }
      if ((text.charCodeAt(i) | 32) === 101) { // e
        const s = text.charCodeAt(i + 1);
        const j = s === 43 || s === 45 ? i + 2 : i + 1;
        if (isDigit(text.charCodeAt(j))) {
          i = j;
          while (isDigit(text.charCodeAt(i)) || text.charCodeAt(i) === 95) i++;
        }
      }
    }
    if (text.charCodeAt(i) === 110) { // n
      this.pos = i + 1;
      return (this.token = T.BigIntLiteral);
    }
    this.pos = i;
    if (isIdStart(text.codePointAt(i) ?? 0)) this.error('An identifier cannot follow a number directly.', i);
    return (this.token = T.NumericLiteral);
  }

  private string(pos: number, quote: number): number {
    const text = this.text;
    const n = text.length;
    let i = pos + 1;
    for (;;) {
      if (i >= n) this.error('The string is not closed.', pos);
      const c = text.charCodeAt(i);
      if (c === quote) break;
      if (c === 92) i += text.charCodeAt(i + 1) === 13 && text.charCodeAt(i + 2) === 10 ? 3 : 2;
      else if (c === 10 || c === 13) this.error('The string is not closed.', pos);
      else i++;
    }
    this.pos = i + 1;
    return (this.token = T.StringLiteral);
  }

  /** A template part from `i` (after ` or }): up to the closing ` or the next ${. */
  private template(i: number, head: boolean): number {
    const text = this.text;
    const n = text.length;
    for (;;) {
      if (i >= n) this.error('The template literal is not closed.', this.tokenStart);
      const c = text.charCodeAt(i);
      if (c === 96) {
        this.pos = i + 1;
        return (this.token = head ? T.NoSubstitutionTemplateLiteral : T.TemplateTail);
      }
      if (c === 36 && text.charCodeAt(i + 1) === 123) {
        this.pos = i + 2;
        return (this.token = head ? T.TemplateHead : T.TemplateMiddle);
      }
      i += c === 92 ? 2 : 1;
    }
  }

  /** At `}` that closes a template substitution: scans the template's next part. */
  reScanTemplate(): number {
    this.pos = this.tokenStart;
    return this.template(this.tokenStart + 1, false);
  }

  /** At `/` or `/=` where an expression starts: scans a regular expression literal. */
  reScanSlash(): number {
    const text = this.text;
    const n = text.length;
    let i = this.tokenStart + 1;
    let inClass = false;
    for (;;) {
      if (i >= n || isLineBreak(text.charCodeAt(i))) this.error('The regular expression is not closed.');
      const c = text.charCodeAt(i);
      if (c === 92) i += 2;
      else if (c === 91) (inClass = true), i++;
      else if (c === 93) (inClass = false), i++;
      else if (c === 47 && !inClass) break;
      else i++;
    }
    i++;
    while (i < n && isIdPart(text.charCodeAt(i))) i++;
    this.pos = i;
    return (this.token = T.RegularExpressionLiteral);
  }

  /** At `>` where an operator is expected: scans `>=`, `>>`, `>>=`, `>>>` or `>>>=`. */
  reScanGreater(): number {
    const text = this.text;
    let i = this.tokenStart + 1;
    if (text.charCodeAt(i) === 62) {
      if (text.charCodeAt(i + 1) === 62) {
        if (text.charCodeAt(i + 2) === 61) return this.punct(i + 3, T.GreaterThanGreaterThanGreaterThanEquals);
        return this.punct(i + 2, T.GreaterThanGreaterThanGreaterThan);
      }
      if (text.charCodeAt(i + 1) === 61) return this.punct(i + 2, T.GreaterThanGreaterThanEquals);
      return this.punct(i + 1, T.GreaterThanGreaterThan);
    }
    if (text.charCodeAt(i) === 61) return this.punct(i + 1, T.GreaterThanEquals);
    return this.token;
  }

  /** At `<<` where type parameters or arguments start: takes only the first `<`. */
  reScanLessThan(): number {
    if (this.token === T.LessThanLessThan || this.token === T.LessThanLessThanEquals || this.token === T.LessThanEquals) {
      return this.punct(this.tokenStart + 1, T.LessThan);
    }
    return this.token;
  }
}
