// Compares JavaScript programs: both are parsed (by TypeScript, as JavaScript) and flattened to their nodes, ignoring
// layout and what doesn't change what runs: parentheses, empty statements, and an empty `export {}`.
import ts from 'typescript';

const names = new Map<number, string>();
for (const [name, value] of Object.entries(ts.SyntaxKind)) {
  if (typeof value === 'number' && !/^(First|Last)/.test(name) && !names.has(value)) names.set(value, name);
}

export function programLines(js: string): string[] {
  const sf = ts.createSourceFile('out.js', js, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const errors = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
  if (errors.length) {
    const d = errors[0]!;
    const { line, character } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
    throw new Error(`The JavaScript doesn't parse, line ${line + 1}, column ${character + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
  }
  const out: string[] = [];
  const visit = (node: ts.Node, depth: number): void => {
    const k = node.kind;
    if (k === ts.SyntaxKind.ParenthesizedExpression) {
      ts.forEachChild(node, (c) => visit(c, depth));
      return;
    }
    if (k === ts.SyntaxKind.EmptyStatement || k === ts.SyntaxKind.SemicolonClassElement || k === ts.SyntaxKind.EndOfFileToken) return;
    if (ts.isExportDeclaration(node) && !node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length === 0) return;
    let text = ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isLiteralExpression(node) || ts.isToken(node) ? ` ${node.getText(sf)}` : '';
    // TypeScript's printer drops the separators in bigint literals (1_000n is printed 1000n); the value is the same.
    if (k === ts.SyntaxKind.BigIntLiteral || k === ts.SyntaxKind.NumericLiteral) text = text.replace(/_/g, '');
    out.push(`${'  '.repeat(depth)}${names.get(k)}${text}`);
    ts.forEachChild(node, (c) => visit(c, depth + 1));
  };
  ts.forEachChild(sf, (c) => visit(c, 0));
  return out;
}

/** TypeScript's own type removal: transpileModule with verbatimModuleSyntax, keeping modern syntax. */
export function typescriptStrip(code: string): string {
  return ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true,
      useDefineForClassFields: true,
    },
    reportDiagnostics: false,
  }).outputText;
}

export function firstLineDifference(expected: string[], actual: string[]): string | null {
  const n = Math.max(expected.length, actual.length);
  for (let i = 0; i < n; i++) {
    if (expected[i] !== actual[i]) {
      const ctx = (a: string[]) => a.slice(Math.max(0, i - 4), i + 3).join('\n');
      return `node ${i}:\n--- TypeScript\n${ctx(expected)}\n--- smaltty\n${ctx(actual)}`;
    }
  }
  return null;
}
