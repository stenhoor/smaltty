// Compares smaltty's tree with TypeScript's: both are flattened to the nodes they share (no punctuation, modifiers or
// other tokens), in order, as `Kind start-end` lines.
import ts from 'typescript';
import type { Tree } from 'smaltty';

/** TypeScript's kind names, without the First…/Last… aliases. */
const tsNames = new Map<number, string>();
for (const [name, value] of Object.entries(ts.SyntaxKind)) {
  if (typeof value === 'number' && !/^(First|Last)/.test(name) && !tsNames.has(value)) tsNames.set(value, name);
}

/** Keyword nodes that stand for something (expressions and types); other keywords are modifiers or operators. */
const KEYWORD_NODES = new Set([
  'ThisKeyword', 'SuperKeyword', 'NullKeyword', 'TrueKeyword', 'FalseKeyword', 'ImportKeyword', 'AnyKeyword',
  'UnknownKeyword', 'NumberKeyword', 'BigIntKeyword', 'ObjectKeyword', 'BooleanKeyword', 'StringKeyword',
  'SymbolKeyword', 'VoidKeyword', 'UndefinedKeyword', 'NeverKeyword', 'IntrinsicKeyword',
]);

function kept(kind: ts.SyntaxKind): boolean {
  if (kind === ts.SyntaxKind.EndOfFileToken) return false;
  if (kind >= ts.SyntaxKind.FirstPunctuation && kind <= ts.SyntaxKind.LastPunctuation) return false;
  if (kind >= ts.SyntaxKind.FirstKeyword && kind <= ts.SyntaxKind.LastKeyword) return KEYWORD_NODES.has(tsNames.get(kind)!);
  return true;
}

export function typescriptLines(name: string, text: string): string[] {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node, depth: number): void => {
    if (!kept(node.kind)) return;
    out.push(`${'  '.repeat(depth)}${tsNames.get(node.kind)} ${node.getStart(sf)}-${node.end}`);
    ts.forEachChild(node, (c) => visit(c, depth + 1));
  };
  ts.forEachChild(sf, (c) => visit(c, 0));
  return out;
}

export function smalttyLines(tree: Tree): string[] {
  const out: string[] = [];
  tree.walk(tree.root, (n, depth) => out.push(`${'  '.repeat(depth)}${tree.kindName(n)} ${tree.start[n]}-${tree.end[n]}`));
  return out;
}

/** The first difference between two line lists, with context, or null. */
export function firstDifference(expected: string[], actual: string[], text: string): string | null {
  const n = Math.max(expected.length, actual.length);
  for (let i = 0; i < n; i++) {
    if (expected[i] !== actual[i]) {
      const m = /(\d+)-(\d+)/.exec(expected[i] ?? actual[i] ?? '');
      const at = m ? Number(m[1]) : 0;
      const line = text.slice(0, at).split('\n').length;
      const ctx = (a: string[]) => a.slice(Math.max(0, i - 3), i + 3).join('\n');
      return `line ${line} of the source, node ${i}:\n--- TypeScript\n${ctx(expected)}\n--- smaltty\n${ctx(actual)}`;
    }
  }
  return null;
}
