// Baseline: what the tools smaltty replaces cost on the corpus, doing the same work smaltty will do. Prints Markdown
// tables for docs/BENCHMARKS.md. `--quick` runs each measure once (CI checks the harness runs; it doesn't time it).
//
//   node bench/baseline.ts            full run (a few minutes)
//   node bench/baseline.ts --quick    one iteration each
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, cpus, platform } from 'node:os';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';
import { transform } from 'sucrase';
import { corpusFiles, generatedFiles, type CorpusFile, type Group } from './corpus.ts';

const quick = process.argv.includes('--quick');
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------- timing

/** Median milliseconds per call of `fn`, after warming up. Runs for about `budgetMs`, at least `minRuns` times. */
function time(fn: () => void, budgetMs = 1500, minRuns = 5): number {
  if (quick) {
    const t = performance.now();
    fn();
    return performance.now() - t;
  }
  const warm = performance.now();
  while (performance.now() - warm < budgetMs / 5) fn();
  const samples: number[] = [];
  const start = performance.now();
  while (samples.length < minRuns || performance.now() - start < budgetMs) {
    const t = performance.now();
    fn();
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  return samples[samples.length >> 1]!;
}

const fmt = (ms: number): string => (ms < 1 ? ms.toFixed(3) : ms < 100 ? ms.toFixed(2) : ms.toFixed(0));
const kb = (n: number): string => (n / 1024).toFixed(n < 10_240 ? 1 : 0);

// ---------------------------------------------------------------- the work, as each tool does it today

/** smaltui: @smaltworks/smaltdb-sucrase's options. */
const sucraseStrip = (text: string) => transform(text, { transforms: ['typescript'], disableESTransforms: true, production: true }).code;

/** smaltnb's runtime.ts options. */
const tsTranspile = (text: string) =>
  ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, isolatedModules: true },
    reportDiagnostics: false,
  }).outputText;

const tsParse = (name: string, text: string) => ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

/**
 * smaltnb's format.ts: parse, a one-file program with no lib and no resolution, and the declaration of every
 * identifier. This is the work smaltty's binder replaces.
 */
function tsResolveNames(name: string, text: string): number {
  const sf = tsParse(name, text);
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
  const checker = ts.createProgram([name], { noLib: true, noResolve: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, host).getTypeChecker();
  let resolved = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && checker.getSymbolAtLocation(node)) resolved++;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return resolved;
}

/**
 * A full strict check with lib.es2022, for phase 1's targets. With `warm`, lib files stay parsed and bound between
 * checks and the previous program is reused, as an editor's language service does.
 */
function tsCheck(name: string, text: string, warm?: { libCache: Map<string, ts.SourceFile>; old?: ts.Program }): number {
  const libCache = warm?.libCache;
  const options: ts.CompilerOptions = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts'], noResolve: true, types: [] };
  const host = ts.createCompilerHost(options);
  const get = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lang, ...rest) => {
    if (f === name) return ts.createSourceFile(f, text, lang, true, ts.ScriptKind.TS);
    const hit = libCache?.get(f);
    if (hit) return hit;
    const sf = get(f, lang, ...rest);
    if (sf) libCache?.set(f, sf);
    return sf;
  };
  host.fileExists = (f) => f === name || ts.sys.fileExists(f);
  const program = ts.createProgram([name], options, host, warm?.old);
  if (warm) warm.old = program;
  return ts.getPreEmitDiagnostics(program).length;
}

// ---------------------------------------------------------------- corpus

const files = [...corpusFiles(), ...generatedFiles()];
const groups: { group: Group | 'generated/40k' | 'generated/400k'; label: string; files: CorpusFile[] }[] = [
  { group: 'apps', label: 'App code (smaltui tabs, smaltnb notebooks)', files: files.filter((f) => f.group === 'apps') },
  { group: 'libs', label: 'Library code (smaltdf, smaltnb, smaltkit, smaltui)', files: files.filter((f) => f.group === 'libs') },
  { group: 'edge', label: 'Syntax edge cases', files: files.filter((f) => f.group === 'edge') },
  { group: 'generated/40k', label: 'Generated script, 40 KB', files: files.filter((f) => f.name === 'generated/40k.ts') },
  { group: 'generated/400k', label: 'Generated script, 400 KB', files: files.filter((f) => f.name === 'generated/400k.ts') },
];

const out: string[] = [];
const line = (s = '') => out.push(s);

line(`Node ${process.version}, ${platform()} ${arch()}, ${cpus()[0]?.model ?? 'unknown CPU'} (${cpus().length} threads). ` +
  `sucrase ${require('sucrase/package.json').version}, typescript ${ts.version}.${quick ? ' **Quick run: one iteration, not a measurement.**' : ''}`);
line();

// ---------------------------------------------------------------- stripping and names, per group

line('### Stripping and name analysis');
line();
line('Median milliseconds to process the whole group once. Stripping covers the files sucrase accepts.');
line();
line('| Corpus | Files | Size (KB) | sucrase strip | `transpileModule` | Parse (`createSourceFile`) | Parse + resolve names (smaltnb) |');
line('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const g of groups) {
  const strippable = g.files.filter((f) => f.sucrase);
  const bytes = g.files.reduce((n, f) => n + f.text.length, 0);
  const strip = time(() => { for (const f of strippable) sucraseStrip(f.text); });
  const transpile = time(() => { for (const f of strippable) tsTranspile(f.text); });
  const parse = time(() => { for (const f of g.files) tsParse(f.name, f.text); });
  const names = time(() => { for (const f of g.files) tsResolveNames(f.name, f.text); });
  line(`| ${g.label} | ${g.files.length} | ${kb(bytes)} | ${fmt(strip)} | ${fmt(transpile)} | ${fmt(parse)} | ${fmt(names)} |`);
}
line();

// ---------------------------------------------------------------- per-file, app code

line('### App code, per file');
line();
line('| File | Size (bytes) | sucrase strip | `transpileModule` | Parse + resolve names |');
line('| --- | ---: | ---: | ---: | ---: |');
for (const f of groups[0]!.files) {
  line(`| \`${f.name}\` | ${f.text.length} | ${fmt(time(() => sucraseStrip(f.text), 500))} | ${fmt(time(() => tsTranspile(f.text), 500))} | ${fmt(time(() => tsResolveNames(f.name, f.text), 500))} |`);
}
line();

// ---------------------------------------------------------------- full checks (phase 1 reference)

line('### Full type check (reference for phase 1)');
line();
line('`strict`, `lib.es2022`, `skipLibCheck`, one file. Cold reads, parses and binds the lib files every time; warm keeps them and reuses the previous program, as an editor does between edits.');
line();
line('| File | Cold | Warm |');
line('| --- | ---: | ---: |');
for (const f of [...groups[0]!.files, ...groups[3]!.files]) {
  const warm = { libCache: new Map<string, ts.SourceFile>() };
  tsCheck(f.name, f.text, warm);
  line(`| \`${f.name}\` | ${fmt(time(() => tsCheck(f.name, f.text), 3000, 3))} | ${fmt(time(() => tsCheck(f.name, f.text, warm), 1500))} |`);
}
line();

// ---------------------------------------------------------------- loading and size

/** Milliseconds a fresh Node process takes to run `code`, as reported by the code itself (median of runs). */
function fresh(code: string, runs = quick ? 1 : 7): number {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const ms = Number(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }).trim());
    samples.push(ms);
  }
  samples.sort((a, b) => a - b);
  return samples[samples.length >> 1]!;
}

const tsPath = require.resolve('typescript/lib/typescript.js');
const tsText = readFileSync(tsPath);
const loadSucrase = fresh(`const t = performance.now(); const { transform } = await import('sucrase'); transform('let a: number = 1', { transforms: ['typescript'] }); console.log(performance.now() - t);`);
const loadTs = fresh(`import { readFileSync } from 'node:fs'; const text = readFileSync(${JSON.stringify(tsPath)}, 'utf8'); const t = performance.now(); const ts = new Function(text + '\\nreturn ts;')(); ts.transpileModule('let a: number = 1', {}); console.log(performance.now() - t);`);

line('### Loading and size');
line();
line('Loading: a fresh process, from first use to the first stripped line (median of runs). smaltnb evaluates `lib/typescript.js` with `new Function`, as here.');
line();
line('| Tool | Load (ms) | Size | Gzipped |');
line('| --- | ---: | ---: | ---: |');
line(`| sucrase (as \`@smaltworks/smaltdb-sucrase\` bundles it) | ${fmt(loadSucrase)} | ~200 KB | ~48 KB |`);
line(`| TypeScript compiler (\`lib/typescript.js\`) | ${fmt(loadTs)} | ${kb(tsText.length)} KB | ${kb(gzipSync(tsText).length)} KB |`);
line();
line("sucrase's bundled size is from smaltdb-sucrase's README (an esbuild bundle of sucrase and its dependencies); smaltty doesn't bundle sucrase to measure it.");

console.log(out.join('\n'));
