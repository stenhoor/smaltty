// Compares smaltty's checker with TypeScript on the same files. A smaltty error TypeScript doesn't report (the same
// file, start and code) is a false error, and a bug (CLAUDE.md: "A checker error that tsc doesn't report is a bug").
// TypeScript's errors of the codes smaltty checks that smaltty misses are counted: that count is how far checking has
// come.
//
// The reference is TypeScript 7 (ADR 0029): its `tsc` command (the `typescript7` dev dependency, an npm alias), run on
// the files written to a temporary project, its errors read back from `--pretty false`. TypeScript 7.0 has no
// JavaScript API, so `typescript` 6.0.3 stays for the API this file still needs (`globalsDeclaration`,
// `declarationsOf`), and as a second reference (`reference: 'typescript6'`) to compare the two.
//
// `node test/checking.ts <project> [--package=name=path]` runs it on a project's .ts files (smaltts, smaltdf).
// MSGDIFF=1 prints the errors both report whose messages differ (`messageDiffs`).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { check, K, parse, type Diagnostic } from 'smaltty';

/** The codes smaltty's checker reports. */
export const CHECKED_CODES = new Set([2339, 2551, 2554, 2555, 2353, 2561, 2345, 2322]);

const require = createRequire(import.meta.url);

/** TypeScript 7's `tsc` (the `typescript7` alias; plain `tsc` is 6.0.3's, which builds `dist/`). */
export const TSC7_BIN = join(dirname(require.resolve('typescript7/package.json')), 'bin', 'tsc');
export const TSC7_VERSION: string = require('typescript7/package.json').version;

/**
 * How to run it: the Go binary in the package for this platform, as `bin/tsc` finds it, so a check doesn't pay for
 * starting Node as well; or `bin/tsc` itself, through Node.
 */
export const TSC7_COMMAND: readonly string[] = (() => {
  try {
    const pkg = createRequire(TSC7_BIN).resolve(`@typescript/typescript-${process.platform}-${process.arch}/package.json`);
    const exe = join(dirname(pkg), 'lib', process.platform === 'win32' ? 'tsc.exe' : 'tsc');
    if (statSync(exe, { throwIfNoEntry: false })) return [exe];
  } catch {}
  return [process.execPath, TSC7_BIN];
})();

/** An error a reference checker reports: where (a path rooted at `/`, a UTF-16 offset), its code and its message. */
export interface ReferenceError {
  readonly file: string;
  readonly start: number;
  readonly code: number;
  /** The whole message, its chain on further lines indented as `ts.flattenDiagnosticMessageText(d, '\n')` does. */
  readonly message: string;
}

export interface ReferenceResult {
  /** Every error in the roots, of any code. */
  readonly errors: readonly ReferenceError[];
  /** Wall time of the process that checked them, milliseconds (the last run, with no syntax errors). */
  readonly ms: number;
  /** Its own total (`--extendedDiagnostics`: read, parse, bind and check, without the process's start), ms. */
  readonly totalMs: number;
  /**
   * Files with syntax errors, left out: a command-line `tsc` (6's, 7's or tsrs) reports nothing but syntax errors in a
   * program that has one, so those files are dropped and the rest checked again.
   */
  readonly skipped: readonly string[];
}

/** Which TypeScript the checker is compared with: TypeScript 7's command line (the reference), or 6.0's API. */
export type Reference = 'typescript7' | 'typescript6';

export interface Comparison {
  readonly smaltty: readonly Diagnostic[];
  /** The reference's (TypeScript 7's) errors of the checked codes, in the roots compared. */
  readonly tsc: readonly ReferenceError[];
  /** The reference's errors of every code, in the roots compared. */
  readonly all: readonly ReferenceError[];
  /** Roots left out of the comparison: the reference has a syntax error there (`ReferenceResult.skipped`). */
  readonly skipped: readonly string[];
  /** smaltty errors the reference doesn't report. */
  readonly falseErrors: readonly Diagnostic[];
  /** The reference's errors smaltty also reports. */
  readonly caught: number;
  /** Errors both report whose messages differ: smaltty's, then the reference's. */
  readonly messageDiffs: readonly { file: string; start: number; code: number; smaltty: string; tsc: string }[];
}

export interface CompareOptions {
  roots?: readonly string[];
  packages?: Record<string, string>;
  globals?: readonly string[];
  /** Default `typescript7`. */
  reference?: Reference;
}

/** Run smaltty and the reference on `files` (path to text). Paths are rooted at `/` (`/p/src/a.ts`) so both agree on them. */
export function compareChecks(files: ReadonlyMap<string, string>, options: CompareOptions = {}): Comparison {
  const reference = options.reference === 'typescript6' ? typescript6Checks(files, options) : typescript7Checks(files, options);
  const skippedSet = new Set(reference.skipped);
  const roots = (options.roots ?? [...files.keys()]).filter((f) => !skippedSet.has(f));
  const smaltty = check(files, { roots, ...(options.packages ? { packages: options.packages } : {}), ...(options.globals ? { globals: options.globals } : {}) });
  const tsc = reference.errors.filter((d) => CHECKED_CODES.has(d.code));
  const key = (d: { file: string; start: number; code: number }) => `${d.file}:${d.start}:${d.code}`;
  const tscKeys = new Set(tsc.map(key));
  const falseErrors = smaltty.filter((d) => !tscKeys.has(key(d)));
  const tscMessages = new Map(tsc.map((d) => [key(d), d.message]));
  const messageDiffs = smaltty
    .filter((d) => tscKeys.has(key(d)) && tscMessages.get(key(d)) !== d.message)
    .map((d) => ({ file: d.file, start: d.start, code: d.code, smaltty: d.message, tsc: tscMessages.get(key(d))! }));
  if (process.env.MSGDIFF) for (const m of messageDiffs) console.log(`MSGDIFF ${m.code} S: ${m.smaltty} T: ${m.tsc}`);
  return { smaltty, tsc, all: reference.errors, skipped: reference.skipped, falseErrors, caught: smaltty.length - falseErrors.length, messageDiffs };
}

/** TypeScript 7's errors on `files`: its `tsc` command on them, with the options below. */
export function typescript7Checks(files: ReadonlyMap<string, string>, options: CommandLineOptions = {}): ReferenceResult {
  return commandLineChecks(TSC7_COMMAND, files, options);
}

export interface CommandLineOptions {
  roots?: readonly string[];
  packages?: Record<string, string>;
  /** `compilerOptions` over the defaults below (the benchmarks' `lib: ['es2022']`). */
  compilerOptions?: Record<string, unknown>;
}

/**
 * A command-line checker (TypeScript 7's `tsc`, or tsrs) on `files` (paths rooted at `/`), in a temporary project:
 * `strict`, ES2022 with `lib.es2023`, no `types`, `skipLibCheck`; relative imports resolved as a bundler does, and
 * `packages` (a bare specifier to a path) as `paths`. Its errors are read back from `--pretty false`.
 */
export function commandLineChecks(command: readonly string[], files: ReadonlyMap<string, string>, options: CommandLineOptions = {}): ReferenceResult {
  const roots = new Set(options.roots ?? files.keys());
  const skipped: string[] = [];
  let current = new Map(files);
  for (;;) {
    const { lines, ms, totalMs } = runCommand(command, current, options.packages ?? {}, options.compilerOptions ?? {});
    // A program with a syntax error reports only syntax errors (codes under 2000), in any of its files; one with none
    // reports the rest, grammar errors under 2000 among them.
    const syntax = lines.some((l) => l.code >= 2000) ? new Set<string>() : new Set(lines.map((l) => l.file).filter((f) => current.has(f)));
    if (syntax.size) {
      skipped.push(...syntax);
      current = new Map([...current].filter(([f]) => !syntax.has(f)));
      continue;
    }
    const errors = lines.filter((l) => roots.has(l.file)).map((l) => {
      const text = files.get(l.file)!.split('\n');
      let start = l.column - 1;
      for (let i = 0; i < l.line - 1; i++) start += text[i]!.length + 1;
      return { file: l.file, start, code: l.code, message: l.message };
    });
    return { errors, ms, totalMs, skipped };
  }
}

function runCommand(command: readonly string[], files: ReadonlyMap<string, string>, packages: Record<string, string>, compilerOptions: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'smaltty-check-'));
  try {
    for (const [path, text] of files) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    const paths = Object.fromEntries(Object.entries(packages).map(([name, path]) => [name, [`.${path}`]]));
    const tsconfig = {
      compilerOptions: { target: 'es2022', module: 'esnext', moduleResolution: 'bundler', lib: ['es2023'], strict: true, noEmit: true, types: [], skipLibCheck: true, paths, ...compilerOptions },
      files: [...files.keys()].map((f) => `.${f}`),
    };
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(tsconfig));
    const start = performance.now();
    let out = '';
    try {
      out = execFileSync(command[0]!, [...command.slice(1), '-p', '.', '--pretty', 'false', '--extendedDiagnostics'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 });
    } catch (e) {
      out = (e as { stdout?: string }).stdout ?? ''; // exits with 1 or 2 when it finds errors
      if (!out) throw e;
    }
    const ms = performance.now() - start;
    const lines: { file: string; line: number; column: number; code: number; message: string }[] = [];
    let chain = false;
    for (const line of out.replace(/\r/g, '').split('\n')) {
      const m = /^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(line);
      // Paths are relative to the project, where the command runs.
      if (m) lines.push({ file: '/' + m[1]!.replace(/\\/g, '/').replace(/^\.\//, ''), line: Number(m[2]), column: Number(m[3]), code: Number(m[4]), message: m[5]! });
      // The message's chain: the indented lines right after it.
      else if (chain && line.startsWith('  ')) lines[lines.length - 1]!.message += `\n${line}`;
      chain = m !== null || (chain && line.startsWith('  '));
    }
    const total = /^Total time:\s+([\d.]+)s/m.exec(out);
    return { lines, ms, totalMs: total ? Number(total[1]) * 1000 : NaN };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const libDir = dirname(require.resolve('typescript'));

/**
 * TypeScript 6.0's errors on `files`, from its JavaScript API: the same options, its semantic errors in the roots
 * (a syntax error elsewhere in the file doesn't stop them, so nothing is skipped). The reference until milestone 9.
 */
export function typescript6Checks(files: ReadonlyMap<string, string>, options: { roots?: readonly string[]; packages?: Record<string, string> } = {}): ReferenceResult {
  const start = performance.now();
  const roots = options.roots ?? [...files.keys()];
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
  const errors: ReferenceError[] = [];
  for (const root of roots) {
    const sf = program.getSourceFile(root);
    if (!sf) continue;
    for (const d of program.getSemanticDiagnostics(sf)) {
      if (d.start === undefined) continue;
      errors.push({ file: root, start: d.start, code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, '\n') });
    }
  }
  const ms = performance.now() - start;
  return { errors, ms, totalMs: ms, skipped: [] };
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
  console.log(`${files.size} files${r.skipped.length ? ` (${r.skipped.length} with syntax errors left out)` : ''}; smaltty ${r.smaltty.length} errors (${r.falseErrors.length} false), TypeScript ${TSC7_VERSION} ${r.tsc.length} of codes ${[...CHECKED_CODES].join(', ')}, caught ${r.caught}; ${(performance.now() - start).toFixed(0)} ms with TypeScript`);
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
