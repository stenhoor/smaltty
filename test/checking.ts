// Compares smaltty's checker with tsc on the same files. A smaltty error tsc doesn't report (the same file, start and
// code) is a false error, and a bug (CLAUDE.md: "A checker error that tsc doesn't report is a bug"). tsc's errors of
// the codes smaltty checks that smaltty misses are counted: that count is how far checking has come.
//
// `node test/check-sweep.ts <project> [--package name=path]` runs it on a project's .ts files (smaltts, smaltdf).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { check, K, parse, type Diagnostic } from 'smaltty';

/** The codes smaltty's checker reports. */
export const CHECKED_CODES = new Set([2339, 2551, 2554, 2555, 2353, 2561, 2345, 2322]);

export interface Comparison {
  readonly smaltty: readonly Diagnostic[];
  /** tsc's errors of the checked codes, in the roots. */
  readonly tsc: readonly { file: string; start: number; code: number; message: string }[];
  /** smaltty errors tsc doesn't report. */
  readonly falseErrors: readonly Diagnostic[];
  /** tsc errors smaltty also reports. */
  readonly caught: number;
}

const libDir = dirname(createRequire(import.meta.url).resolve('typescript'));

/** Run both on `files` (path to text). Paths are absolute-looking (`/p/src/a.ts`) so tsc and smaltty agree on them. */
export function compareChecks(files: ReadonlyMap<string, string>, options: { roots?: readonly string[]; packages?: Record<string, string>; globals?: readonly string[] } = {}): Comparison {
  const roots = options.roots ?? [...files.keys()];
  const smaltty = check(files, { roots, ...(options.packages ? { packages: options.packages } : {}), ...(options.globals ? { globals: options.globals } : {}) });

  const resolve = (spec: string, from: string): string | undefined => {
    const pkg = options.packages?.[spec];
    if (pkg !== undefined) return pkg;
    if (!spec.startsWith('.')) return undefined;
    const base = join(dirname(from), spec);
    return [base.replace(/\.js$/, '.ts'), base, `${base}.ts`, `${base}/index.ts`, base.replace(/\.js$/, '.d.ts')].find((f) => files.has(f));
  };
  const host: ts.CompilerHost = {
    getSourceFile: (f, target) => {
      const text = files.get(f) ?? (f.startsWith(libDir) ? readFileSync(f, 'utf8') : undefined);
      return text === undefined ? undefined : ts.createSourceFile(f, text, target, true);
    },
    writeFile: () => {},
    getDefaultLibFileName: (o) => join(libDir, ts.getDefaultLibFileName(o)),
    useCaseSensitiveFileNames: () => true,
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => '/',
    getNewLine: () => '\n',
    fileExists: (f) => files.has(f) || (f.startsWith(libDir) && statSync(f, { throwIfNoEntry: false }) !== undefined),
    readFile: (f) => files.get(f),
    resolveModuleNameLiterals: (lits, containing) =>
      lits.map((l) => {
        const r = resolve(l.text, containing);
        return { resolvedModule: r ? { resolvedFileName: r, extension: r.endsWith('.d.ts') ? ts.Extension.Dts : ts.Extension.Ts } : undefined };
      }),
  };
  const program = ts.createProgram([...files.keys()], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, lib: ['lib.es2023.d.ts'], strict: true, noEmit: true, types: [], skipLibCheck: true }, host);
  const tsc: Comparison['tsc'][number][] = [];
  for (const root of roots) {
    const sf = program.getSourceFile(root);
    if (!sf) continue;
    for (const d of program.getSemanticDiagnostics(sf)) {
      if (!CHECKED_CODES.has(d.code) || d.start === undefined) continue;
      tsc.push({ file: root, start: d.start, code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, '\n') });
    }
  }
  const key = (d: { file: string; start: number; code: number }) => `${d.file}:${d.start}:${d.code}`;
  const tscKeys = new Set(tsc.map(key));
  const falseErrors = smaltty.filter((d) => !tscKeys.has(key(d)));
  return { smaltty, tsc, falseErrors, caught: smaltty.length - falseErrors.length };
}

/** smaltts's source and its reference's examples (corpus/check/smaltts), under /src/ and /examples/. */
export function smalttsCorpus(): Map<string, string> {
  const corpus = new URL('../corpus/check/smaltts/', import.meta.url);
  const files = new Map<string, string>();
  for (const dir of ['src', 'examples']) {
    for (const f of readdirSync(new URL(`${dir}/`, corpus)).sort()) if (f.endsWith('.ts')) files.set(`/${dir}/${f}`, readFileSync(new URL(`${dir}/${f}`, corpus), 'utf8'));
  }
  return files;
}

/** The corpus libraries: smaltdf's source under the paths its imports name (/df/), and the others under /libs/. */
export function libsCorpus(): { smaltdf: Map<string, string>; others: Map<string, string> } {
  const libs = new URL('../corpus/libs/', import.meta.url);
  const smaltdf = new Map<string, string>();
  const others = new Map<string, string>();
  for (const f of readdirSync(libs).sort()) (f.startsWith('smaltdf-') ? smaltdf.set(`/df/${f.slice(8)}`, readFileSync(new URL(f, libs), 'utf8')) : others.set(`/libs/${f}`, readFileSync(new URL(f, libs), 'utf8')));
  return { smaltdf, others };
}

/** How code imports smaltdf, to the corpus's copy. */
export const DF_PACKAGES = { '@smaltdb/df': '/df/index.ts' };

/** Every mutant of an example: one property misspelt, or one call with an argument more or none. */
export function mutants(name: string, text: string): [string, string][] {
  const t = parse(text, { fileName: name });
  const out: [string, string][] = [];
  const edit = (start: number, end: number, insert: string, label: string) => out.push([`${name.slice(0, -3)}.${label}.${out.length}.ts`, text.slice(0, start) + insert + text.slice(end)]);
  t.walk(t.root, (n) => {
    if (t.kind[n] === K.PropertyAccessExpression) {
      const id = t.next[t.first[n]!]!;
      const word = t.textOf(id);
      if (word.length > 2) edit(t.start[id]!, t.end[id]!, word.slice(0, -1), 'short');
      edit(t.start[id]!, t.end[id]!, `${word}Zz`, 'long');
    } else if (t.kind[n] === K.ObjectLiteralExpression) {
      for (const p of t.children(n)) {
        const id = t.first[p]!;
        if (t.kind[p] !== K.PropertyAssignment || t.kind[id] !== K.Identifier) continue;
        const word = t.textOf(id);
        if (word.length > 2) edit(t.start[id]!, t.end[id]!, word.slice(0, -1), 'key');
        edit(t.start[id]!, t.end[id]!, `${word}Zz`, 'keylong');
        // A value of another type.
        const value = t.next[id]!;
        if (t.kind[value] === K.StringLiteral) edit(t.start[value]!, t.end[value]!, '0', 'value');
        else if (t.kind[value] === K.NumericLiteral || t.kind[value] === K.TrueKeyword || t.kind[value] === K.FalseKeyword) edit(t.start[value]!, t.end[value]!, "'x'", 'value');
      }
    } else if (t.kind[n] === K.CallExpression) {
      const args = t.children(n).slice(1);
      // An argument of another type: a string for a number or boolean, a number for a string.
      for (const a of args) {
        const k = t.kind[a];
        if (k === K.StringLiteral) edit(t.start[a]!, t.end[a]!, '0', 'type');
        else if (k === K.NumericLiteral || k === K.TrueKeyword || k === K.FalseKeyword) edit(t.start[a]!, t.end[a]!, "'x'", 'type');
      }
      const close = t.end[n]! - 1;
      edit(close, close, args.length ? ', 0' : '0', 'more');
      if (args.length) edit(t.start[args[0]!]!, t.end[args[args.length - 1]!]!, '', 'none');
    }
  });
  return out;
}

/** Every .ts file of a project (not node_modules, not .d.ts), under paths rooted at `/`. */
export function projectFiles(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (p: string): void => {
    for (const f of readdirSync(p).sort()) {
      if (f === 'node_modules' || f.startsWith('.') || f === 'dist') continue;
      const q = join(p, f);
      if (statSync(q).isDirectory()) walk(q);
      else if (/\.ts$/.test(f) && !f.endsWith('.d.ts')) files.set(`/${relative(dir, q)}`, readFileSync(q, 'utf8'));
    }
  };
  walk(dir);
  return files;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'))!;
  const packages: Record<string, string> = {};
  for (const a of args) if (a.startsWith('--package=')) {
    const [name, path] = a.slice('--package='.length).split('=');
    packages[name!] = path!;
  }
  const files = projectFiles(dir);
  const start = performance.now();
  const r = compareChecks(files, { packages });
  for (const d of r.falseErrors.slice(0, 20)) console.log(`FALSE ERROR ${d.file}:${d.start} ${d.code} ${d.message}`);
  console.log(`${files.size} files; smaltty ${r.smaltty.length} errors (${r.falseErrors.length} false), tsc ${r.tsc.length} of codes ${[...CHECKED_CODES].join(', ')}, caught ${r.caught}; ${(performance.now() - start).toFixed(0)} ms with tsc`);
  process.exitCode = r.falseErrors.length ? 1 : 0;
}

/**
 * For tsc, a `.d.ts` that makes a module's exported values globals (`declare global`), as `globals` does for smaltty.
 * `files` holds the module; `spec` is how it is imported.
 */
export function globalsDeclaration(files: ReadonlyMap<string, string>, spec: string, path: string): string {
  const host = ts.createCompilerHost({});
  host.getSourceFile = (f, target) => {
    const text = files.get(f) ?? (f.startsWith(libDir) ? readFileSync(f, 'utf8') : undefined);
    return text === undefined ? undefined : ts.createSourceFile(f, text, target, true);
  };
  host.fileExists = (f) => files.has(f);
  host.readFile = (f) => files.get(f);
  host.resolveModuleNameLiterals = (lits, containing) =>
    lits.map((l) => {
      const base = join(dirname(containing), l.text);
      const r = [base.replace(/\.js$/, '.ts'), `${base}.ts`, base.replace(/\.js$/, '.d.ts')].find((f) => files.has(f));
      return { resolvedModule: r ? { resolvedFileName: r, extension: r.endsWith('.d.ts') ? ts.Extension.Dts : ts.Extension.Ts } : undefined };
    });
  const program = ts.createProgram([path], { noLib: true, types: [] }, host);
  const checker = program.getTypeChecker();
  const module = checker.getSymbolAtLocation(program.getSourceFile(path)!)!;
  const values = checker.getExportsOfModule(module).filter((x) => (ts.SymbolFlags.Value & (x.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(x).flags : x.flags)) !== 0);
  return `import * as g from '${spec}';\ndeclare global {\n${values.map((v) => `  const ${v.name}: typeof g.${v.name};`).join('\n')}\n}\nexport {};\n`;
}

/** tsc's declarations (`.d.ts`) for a library's source files, under the same paths with `.d.ts`: what a page reads. */
export function declarationsOf(files: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  const host = ts.createCompilerHost({});
  host.getSourceFile = (f, target) => (files.has(f) ? ts.createSourceFile(f, files.get(f)!, target, true) : undefined);
  host.fileExists = (f) => files.has(f);
  host.readFile = (f) => files.get(f);
  host.writeFile = (f, text) => out.set(f, text);
  ts.createProgram([...files.keys()], { declaration: true, emitDeclarationOnly: true, noLib: true, types: [] }, host).emit();
  return out;
}
