// Compares smaltty's binder with TypeScript's checker, the way smaltnb used the checker: one file, no lib, no module
// resolution. For every identifier smaltty binds (a declaration or a reference), both must name the same declaration:
// the position of the first declaration's name, or none.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { bind, parse, K, type Bindings, type Tree } from 'smaltty';

export interface BindingResult {
  compared: number;
  /** Identifiers smaltty leaves alone (property names, labels …), by their parent's kind. */
  skipped: Map<string, number>;
  differences: string[];
}

function checkerFor(name: string, sf: ts.SourceFile): ts.TypeChecker {
  const host: ts.CompilerHost = {
    getSourceFile: (f) => (f === name ? sf : undefined),
    writeFile: () => {},
    getDefaultLibFileName: () => 'lib.d.ts',
    useCaseSensitiveFileNames: () => true,
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => '/',
    getNewLine: () => '\n',
    fileExists: (f) => f === name,
    readFile: () => undefined,
  };
  return ts.createProgram([name], { noLib: true, noResolve: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, host).getTypeChecker();
}

/** Where TypeScript says an identifier's symbol is declared: the first declaration's name, or -1. */
function typescriptDeclaration(checker: ts.TypeChecker, sf: ts.SourceFile, id: ts.Identifier): number {
  let sym: ts.Symbol | undefined;
  const p = id.parent;
  try {
    if (ts.isShorthandPropertyAssignment(p) && p.name === id) sym = checker.getShorthandAssignmentValueSymbol(p);
    else if (ts.isExportSpecifier(p) && (p.propertyName ?? p.name) === id && !p.parent.parent.moduleSpecifier) sym = checker.getExportSpecifierLocalTargetSymbol(p);
    else sym = checker.getSymbolAtLocation(id);
  } catch {
    return -2; // TypeScript's checker fails here (it can, without its lib): not compared
  }
  const decl = sym?.declarations?.[0];
  if (!decl) return -1;
  return (ts.getNameOfDeclaration(decl) ?? decl).getStart(sf);
}

export function compareBindings(file: string, text: string): BindingResult {
  // A .js file is compared as TypeScript: the program only takes it under a .ts name.
  const name = file.replace(/\.([mc]?)js$/, '.$1ts');
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const checker = checkerFor(name, sf);
  const tree: Tree = parse(text, { fileName: file });
  const b: Bindings = bind(tree);
  const byStart = new Map<number, number>();
  for (let n = 1; n < tree.count; n++) if (tree.kind[n] === K.Identifier) byStart.set(tree.start[n]!, n);
  const result: BindingResult = { compared: 0, skipped: new Map(), differences: [] };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const start = node.getStart(sf);
      const n = byStart.get(start);
      if (n === undefined) result.differences.push(`${where(sf, start)}: no identifier in smaltty's tree`);
      else if (!b.symbolOf[n] && !b.meaningOf[n]) {
        const k = ts.SyntaxKind[node.parent.kind];
        result.skipped.set(k, (result.skipped.get(k) ?? 0) + 1);
      } else {
        result.compared++;
        const expected = typescriptDeclaration(checker, sf, node);
        if (expected === -2) {
          result.compared--;
          result.skipped.set('(TypeScript failed)', (result.skipped.get('(TypeScript failed)') ?? 0) + 1);
          ts.forEachChild(node, visit);
          return;
        }
        const d = b.declaration(n);
        const actual = d ? tree.start[d]! : -1;
        if (expected !== actual) {
          const show = (pos: number) => (pos < 0 ? 'nothing' : `${where(sf, pos)} (${text.slice(pos, pos + 20).split('\n')[0]})`);
          result.differences.push(`${where(sf, start)} '${node.text}' in ${ts.SyntaxKind[node.parent.kind]}: TypeScript ${show(expected)}, smaltty ${show(actual)}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return result;
}

function where(sf: ts.SourceFile, pos: number): string {
  const { line, character } = sf.getLineAndCharacterOfPosition(pos);
  return `${line + 1}:${character + 1}`;
}

/** Every .ts file under the paths (no .d.ts), compared. */
export function bindingSweep(paths: string[]): { files: number; compared: number; skipped: Map<string, number>; failures: { file: string; differences: string[] }[] } {
  const files: string[] = [];
  const walk = (p: string): void => {
    if (!statSync(p).isDirectory()) return void files.push(p);
    for (const f of readdirSync(p).sort()) {
      const q = join(p, f);
      if (statSync(q).isDirectory()) walk(q);
      else if (/\.[mc]?[tj]s$/.test(f)) files.push(q);
    }
  };
  paths.forEach(walk);
  const out = { files: 0, compared: 0, skipped: new Map<string, number>(), failures: [] as { file: string; differences: string[] }[] };
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    if ((sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) continue;
    out.files++;
    const r = compareBindings(file, text);
    out.compared += r.compared;
    for (const [k, v] of r.skipped) out.skipped.set(k, (out.skipped.get(k) ?? 0) + v);
    if (r.differences.length) out.failures.push({ file, differences: r.differences });
  }
  return out;
}

if (import.meta.main) {
  const r = bindingSweep(process.argv.slice(2));
  for (const f of r.failures.slice(0, 12)) console.log(`${f.file} (${f.differences.length})\n  ${f.differences.slice(0, 6).join('\n  ')}\n`);
  console.log(`skipped: ${[...r.skipped].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`${r.files} files, ${r.compared} names compared, ${r.failures.length} files differ (${r.failures.reduce((n, f) => n + f.differences.length, 0)} names)`);
  process.exitCode = r.failures.length ? 1 : 0;
}
