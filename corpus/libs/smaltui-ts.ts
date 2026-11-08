// TypeScript for the editor's TypeScript mode (smaltdf tabs): a tokenizer for highlighting, and the split of a script
// into its body and its last expression, whose value the tab shows. Not a parser: it knows strings, template
// literals, comments, regular expressions after an operator, and bracket depth, which is what both need.

export type TsTokenType = 'ws' | 'comment' | 'string' | 'template' | 'regex' | 'number' | 'word' | 'punct';

export interface TsToken {
  type: TsTokenType;
  start: number;
  end: number;
  text: string;
}

export const TS_KEYWORDS = new Set(
  'abstract any as async await bigint boolean break case catch class const continue debugger declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let namespace never new null number object of private protected public readonly return satisfies set static string super switch symbol this throw true try type typeof undefined unique unknown var void while with yield'.split(
    ' ',
  ),
);

/** Words after which a `/` starts a regular expression rather than dividing. */
const REGEX_AFTER = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'await', 'yield']);

export function tokenizeTs(text: string): TsToken[] {
  const out: TsToken[] = [];
  const n = text.length;
  let i = 0;
  const push = (type: TsTokenType, start: number, end: number) => out.push({ type, start, end, text: text.slice(start, end) });
  const lastSignificant = () => {
    for (let k = out.length - 1; k >= 0; k--) if (out[k].type !== 'ws' && out[k].type !== 'comment') return out[k];
    return null;
  };
  while (i < n) {
    const c = text[i];
    const s = i;
    if (/\s/.test(c)) {
      while (i < n && /\s/.test(text[i])) i++;
      push('ws', s, i);
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
      push('comment', s, i);
    } else if (c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
      push('comment', s, i);
    } else if (c === "'" || c === '"') {
      i++;
      while (i < n && text[i] !== c && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1;
      i = Math.min(n, i + 1);
      push('string', s, i);
    } else if (c === '`') {
      // Template literals, with ${…} holes skipped by brace depth (nested templates are rare in a query).
      i++;
      let depth = 0;
      while (i < n) {
        if (depth === 0 && text[i] === '`') break;
        if (text[i] === '\\') i += 2;
        else if (text[i] === '$' && text[i + 1] === '{') (depth++, (i += 2));
        else if (depth > 0 && text[i] === '{') (depth++, i++);
        else if (depth > 0 && text[i] === '}') (depth--, i++);
        else i++;
      }
      i = Math.min(n, i + 1);
      push('template', s, i);
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
      while (i < n && /[0-9a-zA-Z_.]/.test(text[i])) i++;
      push('number', s, i);
    } else if (/[A-Za-z_$]/.test(c)) {
      while (i < n && /[\w$]/.test(text[i])) i++;
      push('word', s, i);
    } else if (c === '/') {
      const prev = lastSignificant();
      const regex = !prev || (prev.type === 'punct' && !/[)\]}]/.test(prev.text)) || (prev.type === 'word' && REGEX_AFTER.has(prev.text));
      if (regex) {
        i++;
        let cls = false;
        while (i < n && text[i] !== '\n') {
          if (text[i] === '\\') i += 2;
          else if (text[i] === '[') (cls = true, i++);
          else if (text[i] === ']') (cls = false, i++);
          else if (text[i] === '/' && !cls) break;
          else i++;
        }
        i++;
        while (i < n && /[a-z]/.test(text[i])) i++;
        push('regex', s, Math.min(i, n));
      } else push('punct', s, ++i);
    } else push('punct', s, ++i);
  }
  return out;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Highlighted HTML, with the editor's classes (tk-k keyword, tk-f function, tk-s string, tk-n number, tk-c comment,
 * tk-o punctuation, tk-obj a table or view name in a string). `functions` are the names shown as functions.
 */
export function highlightTs(text: string, names?: Set<string>, functions?: Set<string>): string {
  let html = '';
  const toks = tokenizeTs(text);
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    let cls: string | null = null;
    if (t.type === 'comment') cls = 'c';
    else if (t.type === 'string' || t.type === 'template' || t.type === 'regex') cls = names?.has(t.text.slice(1, -1).toLowerCase()) ? 'obj' : 's';
    else if (t.type === 'number') cls = 'n';
    else if (t.type === 'punct') cls = 'o';
    else if (t.type === 'word') {
      const next = toks[k + 1]?.type === 'ws' ? toks[k + 2] : toks[k + 1];
      const prev = toks[k - 1];
      if (TS_KEYWORDS.has(t.text) && prev?.text !== '.') cls = 'k';
      else if (next?.text === '(' && (prev?.text === '.' || functions?.has(t.text))) cls = 'f';
    }
    html += cls ? `<span class="tk-${cls}">${esc(t.text)}</span>` : esc(t.text);
  }
  return html + '\n';
}

/** What a word at the cursor is: a member after `.`, a name in a `table('…')` / `col('…')` string, or a plain word. */
export interface TsWordContext {
  word: string;
  start: number;
  /** 'member' after a dot; 'table' or 'column' inside the string argument of table() / col(); else 'global'. */
  kind: 'member' | 'table' | 'column' | 'global';
}

export function tsWordBefore(text: string, pos: number): TsWordContext {
  let start = pos;
  while (start > 0 && /[\w$]/.test(text[start - 1])) start--;
  const word = text.slice(start, pos);
  const before = text.slice(0, start);
  const str = /\b(table|col|frame|update|deleteFrom|refreshView)\(\s*['"]$/.exec(before);
  if (str) return { word, start, kind: str[1] === 'col' ? 'column' : 'table' };
  if (/\.\s*$/.test(before) && !/[0-9]\.\s*$/.test(before)) return { word, start, kind: 'member' };
  return { word, start, kind: 'global' };
}

/**
 * Split compiled JavaScript into a body and its last expression, so the tab can show that expression's value:
 * `const a = table('t'); a.head(5)` → body `const a = table('t');`, expression `a.head(5)`. Top-level statements
 * end at `;` or at a newline after a complete statement; the last one is an expression unless it starts with a
 * keyword that makes it a declaration or control statement.
 */
export function splitLastExpression(js: string): { body: string; expr: string | null } {
  const toks = tokenizeTs(js);
  let depth = 0;
  let lastEnd = 0; // where the last top-level statement starts
  let prevEnd = 0; // and the one before it
  let lastWasSemicolon = false;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.type !== 'punct') continue;
    if ('([{'.includes(t.text)) depth++;
    else if (')]}'.includes(t.text)) depth = Math.max(0, depth - 1);
    if (depth === 0 && (t.text === ';' || (t.text === '}' && endsBlockStatement(toks, k)))) {
      prevEnd = lastEnd;
      lastEnd = t.end;
      lastWasSemicolon = t.text === ';';
    }
  }
  // Code that ends with `;`: the last statement is the one that semicolon ends.
  if (!js.slice(lastEnd).trim() && lastWasSemicolon) lastEnd = prevEnd;
  let tail = js.slice(lastEnd);
  let body = js.slice(0, lastEnd);
  // A statement on its own line after an expression without a semicolon: split at the last top-level line break
  // that follows a complete line (bracket depth 0, not ending in an operator or a dot).
  const lines = splitTopLevelLines(tail);
  if (lines.length > 1) {
    const last = lines[lines.length - 1];
    body += tail.slice(0, last.start);
    tail = tail.slice(last.start);
  }
  const expr = tail.trim().replace(/;\s*$/, '');
  if (!expr || /^(const|let|var|function|class|if|for|while|do|switch|try|return|throw|import|export|type|interface|enum|declare|async\s+function)\b/.test(expr)) return { body: js, expr: null };
  return { body, expr };
}

/** A `}` at depth 0 that closes a block statement (function, if, for, class …), not an object literal. */
function endsBlockStatement(toks: TsToken[], k: number): boolean {
  let next = k + 1;
  while (toks[next]?.type === 'ws' || toks[next]?.type === 'comment') next++;
  const after = toks[next];
  // `}` followed by `.`, `)`, `,` or an operator continues an expression.
  return !after || !(after.type === 'punct' && /^[.),?:+\-*/%&|=<>[]$/.test(after.text));
}

function splitTopLevelLines(text: string): { start: number }[] {
  const toks = tokenizeTs(text);
  const out: { start: number }[] = [];
  let depth = 0;
  let lineStart = 0;
  let lastSig: TsToken | null = null;
  let started = false;
  for (const t of toks) {
    if (t.type === 'ws' && t.text.includes('\n') && depth === 0 && started) {
      const continues = lastSig && lastSig.type === 'punct' && /^[.,(=+\-*/%&|?:<>![{]$/.test(lastSig.text);
      if (!continues) {
        out.push({ start: lineStart });
        started = false;
        lineStart = t.end;
      }
      continue;
    }
    if (t.type === 'ws' || t.type === 'comment') {
      if (!started) lineStart = t.end;
      continue;
    }
    // A line that starts with `.` continues the previous one (method chains).
    if (!started && t.type === 'punct' && t.text === '.' && out.length) {
      lineStart = out.pop()!.start;
    }
    started = true;
    if (t.type === 'punct') {
      if ('([{'.includes(t.text)) depth++;
      else if (')]}'.includes(t.text)) depth = Math.max(0, depth - 1);
    }
    lastSig = t;
  }
  if (started) out.push({ start: lineStart });
  return out;
}
