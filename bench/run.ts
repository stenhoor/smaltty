// The benchmarks: smaltty against the tools it replaces, doing the same work, on the corpus. Prints Markdown tables
// for docs/BENCHMARKS.md. `--quick` runs each measure once (CI checks the harness runs; it doesn't time it).
//
//   node bench/run.ts            full run (a few minutes)
//   node bench/run.ts --quick    one iteration each
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, cpus, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';
import { transform } from 'sucrase';
import { bind, check, checkCache, parse, prepare, strip } from 'smaltty';
import { TSC7_VERSION, typescript7Checks } from '../test/checking.ts';
import { tsrsChecks } from '../test/tsrs.ts';
import { distUrl, entryPoints, moduleGraph, sizeOf } from './entries.ts';
import { checkWorkloads, corpusFiles, editInside, generatedFiles, type CheckWorkload, type CorpusFile, type Group } from './corpus.ts';

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

/** The run with the median wall time, of a command-line checker's runs. */
const median = <T extends { ms: number }>(runs: T[]): T => runs.sort((a, b) => a.ms - b.ms)[runs.length >> 1]!;

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

/**
 * tsc on a checker workload: the same files, imports resolved to them, `strict`, `lib.es2022`, the user file's errors.
 * With `warm`, lib and library files stay parsed and bound between checks and the previous program is reused.
 */
function tscWorkload(w: CheckWorkload, text: string, warm?: { cache: Map<string, ts.SourceFile>; old?: ts.Program }): number {
  const options: ts.CompilerOptions = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, lib: ['lib.es2022.d.ts'], types: [] };
  const host = ts.createCompilerHost(options);
  const get = host.getSourceFile.bind(host);
  const files = new Map(w.files).set(w.root, text);
  host.getSourceFile = (f, lang, ...rest) => {
    if (f === w.root) return ts.createSourceFile(f, text, lang, true, ts.ScriptKind.TS);
    const hit = warm?.cache.get(f);
    if (hit) return hit;
    const own = files.get(f);
    const sf = own !== undefined ? ts.createSourceFile(f, own, lang, true, ts.ScriptKind.TS) : get(f, lang, ...rest);
    if (sf) warm?.cache.set(f, sf);
    return sf;
  };
  host.fileExists = (f) => files.has(f) || ts.sys.fileExists(f);
  host.resolveModuleNameLiterals = (lits, containing) =>
    lits.map((l) => {
      const spec = l.text;
      const base = spec.startsWith('.') ? `${containing.slice(0, containing.lastIndexOf('/'))}/${spec}`.replace(/\/\.\//g, '/') : undefined;
      const norm = base?.split('/').reduce<string[]>((a, p) => (p === '..' ? a.slice(0, -1) : [...a, p]), []).join('/');
      const r = w.packages[spec] ?? (norm ? [norm.replace(/\.js$/, '.ts'), `${norm}.ts`].find((f) => files.has(f)) : undefined);
      return { resolvedModule: r ? { resolvedFileName: r, extension: ts.Extension.Ts } : undefined };
    });
  const program = ts.createProgram([w.root], options, host, warm?.old);
  if (warm) warm.old = program;
  return ts.getPreEmitDiagnostics(program, program.getSourceFile(w.root)).length;
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
  `sucrase ${require('sucrase/package.json').version}, typescript ${ts.version}, TypeScript 7 ${TSC7_VERSION}, tsrs ${require('tsrs/package.json').version}.${quick ? ' **Quick run: one iteration, not a measurement.**' : ''}`);
line();

// ---------------------------------------------------------------- stripping and names, per group

line('### Stripping and name analysis');
line();
line('Median milliseconds to process the whole group once, on the files every tool accepts: sucrase rejects one edge case, smaltty refuses the non-erasable files (three of smaltdf\'s, and the non-erasable edge cases).');
line();
line('| Corpus | Files | Size (KB) | sucrase strip | `transpileModule` | smaltty strip | TypeScript parse | smaltty parse | Parse + resolve names (smaltnb) | smaltty parse + bind |');
line('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const g of groups) {
  // The files every tool accepts: sucrase rejects one edge case, smaltty refuses the non-erasable ones.
  const files = g.files.filter((f) => f.sucrase && f.erasable);
  const bytes = files.reduce((n, f) => n + f.text.length, 0);
  const sucrased = time(() => { for (const f of files) sucraseStrip(f.text); });
  const transpile = time(() => { for (const f of files) tsTranspile(f.text); });
  const stripped = time(() => { for (const f of files) strip(f.text); });
  const tsParsed = time(() => { for (const f of files) tsParse(f.name, f.text); });
  const parsed = time(() => { for (const f of files) parse(f.text); });
  const names = time(() => { for (const f of files) tsResolveNames(f.name, f.text); });
  const bound = time(() => { for (const f of files) bind(parse(f.text)); });
  line(`| ${g.label} | ${files.length} | ${kb(bytes)} | ${fmt(sucrased)} | ${fmt(transpile)} | **${fmt(stripped)}** | ${fmt(tsParsed)} | **${fmt(parsed)}** | ${fmt(names)} | **${fmt(bound)}** |`);
}
line();

// ---------------------------------------------------------------- per-file, app code

line('### App code, per file');
line();
line('| File | Size (bytes) | sucrase strip | `transpileModule` | smaltty strip | smaltty parse | Parse + resolve names | smaltty parse + bind |');
line('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const f of groups[0]!.files) {
  line(`| \`${f.name}\` | ${f.text.length} | ${fmt(time(() => sucraseStrip(f.text), 500))} | ${fmt(time(() => tsTranspile(f.text), 500))} | **${fmt(time(() => strip(f.text), 500))}** | **${fmt(time(() => parse(f.text), 500))}** | ${fmt(time(() => tsResolveNames(f.name, f.text), 500))} | **${fmt(time(() => bind(parse(f.text)), 500))}** |`);
}

line();

// ---------------------------------------------------------------- full checks (phase 1 reference)

line('### Full type check (reference for phase 1)');
line();
line(`\`strict\`, \`lib.es2022\`, \`skipLibCheck\`, one file. tsc ${ts.version} through its API: cold reads, parses and binds the lib files every time; warm keeps them and reuses the previous program, as an editor does between edits. TypeScript 7 (${TSC7_VERSION}, the Go compiler): its \`tsc\` command on the same file, a fresh process each time (it has no API that keeps a program), median of runs; in brackets its own total time (\`--extendedDiagnostics\`), without the process's start.`);
line();
line('| File | tsc cold | tsc warm | TypeScript 7: process (own time) |');
line('| --- | ---: | ---: | ---: |');
for (const f of [...groups[0]!.files, ...groups[3]!.files]) {
  const warm = { libCache: new Map<string, ts.SourceFile>() };
  tsCheck(f.name, f.text, warm);
  const seven = median(Array.from({ length: quick ? 1 : 5 }, () => typescript7Checks(new Map([[`/${f.name}`, f.text]]), { compilerOptions: { lib: ['es2022'], noResolve: true } })));
  line(`| \`${f.name}\` | ${fmt(time(() => tsCheck(f.name, f.text), 3000, 3))} | ${fmt(time(() => tsCheck(f.name, f.text, warm), 1500))} | ${fmt(seven.ms)} (${fmt(seven.totalMs)}) |`);
}
line();

// ---------------------------------------------------------------- the checker (milestone 7)

line('### Checking');
line();
line("One user file checked with the library it calls, read from source (smaltts's 16 files, 184 KB; smaltdf's 9, 85 KB): " +
  "smaltty's `check()` against tsc (`strict`, `lib.es2022`) on the same files. **First check:** a fresh process, smaltty's modules " +
  'loaded, the first `check()` (median of runs); **prepared:** the same, with the library read from `prepare()`\'s buffer (milestone 11). **Cold:** in a warmed-up process, nothing kept from the previous check. ' +
  '**After an edit:** a one-line edit inside the user file\'s middle statement, the rest kept (smaltty: `checkCache()`, which keeps each statement\'s results ' +
  '(milestone 12); **whole file:** `checkCache({ statements: false })`, the parsed files kept and the user file checked whole, as before 0.13.0; tsc: files kept and its previous program ' +
  'reused, as an editor does). **tsrs:** tsrs (a Rust port of TypeScript 7\'s checker, `npm i tsrs`) on the same files, a fresh ' +
  'process each time, as it has no API that keeps a program between checks; in brackets its own total time (`--extendedDiagnostics`), ' +
  'without the process\'s start. **TypeScript 7:** its `tsc` command (the Go compiler) the same way, with `lib.es2022`. ' +
  'Milliseconds; the smaltts row is the median of its 14 examples, with the slowest in brackets.');
line();
line('| Workload | smaltty first check | smaltty first check, prepared | smaltty cold | tsc cold | TypeScript 7: process (own time) | tsrs: process (own time) | smaltty after an edit | smaltty after an edit, whole file | tsc after an edit |');
line('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
{
  const workloads = checkWorkloads();
  const rows: { label: string; v: number[] }[] = [];
  workloads.forEach((w, i) => {
    const first = fresh('', quick ? 1 : 5, [new URL('check-cold.ts', import.meta.url).pathname, String(i)]);
    const preparedFile = join(mkdtempSync(join(tmpdir(), 'smaltty-prepared-')), 'libs.bin');
    writeFileSync(preparedFile, prepare(new Map([...w.files].filter(([f]) => f !== w.root))));
    const firstPrepared = fresh('', quick ? 1 : 5, [new URL('check-cold.ts', import.meta.url).pathname, String(i), preparedFile]);
    const opts = { roots: [w.root], packages: w.packages };
    const cold = time(() => check(w.files, opts), 600);
    const tscCold = time(() => tscWorkload(w, w.files.get(w.root)!), 1500, 3);
    let n = 0;
    // A one-line edit inside the middle statement (milestone 12): the cache keeps the other statements' results; with
    // `statements: false` it keeps the parsed files only, as before 0.13.0, and the whole file is checked.
    const texts = [0, 1, 2].map((k) => editInside(w.files.get(w.root)!, k));
    const edited = () => texts[n++ % texts.length]!;
    const cache = checkCache();
    const editedFiles = new Map(w.files);
    const smEdit = time(() => { editedFiles.set(w.root, edited()); check(editedFiles, { ...opts, cache }); }, 600);
    const wholeCache = checkCache({ statements: false });
    const smEditWhole = time(() => { editedFiles.set(w.root, edited()); check(editedFiles, { ...opts, cache: wholeCache }); }, 600);
    const warm = { cache: new Map<string, ts.SourceFile>() };
    tscWorkload(w, edited(), warm);
    const tscEdit = time(() => tscWorkload(w, edited(), warm), 1500);
    // tsrs (a Rust port of TypeScript 7's checker) runs as a process: no API to keep a program between checks.
    const tsrsRuns = Array.from({ length: quick ? 1 : 5 }, () => tsrsChecks(w.files, { roots: [w.root], packages: w.packages, compilerOptions: { lib: ['es2022'] } })).sort((a, b) => a.ms - b.ms);
    const tsrsRun = tsrsRuns[tsrsRuns.length >> 1]!;
    const sevenRun = median(Array.from({ length: quick ? 1 : 5 }, () => typescript7Checks(w.files, { roots: [w.root], packages: w.packages, compilerOptions: { lib: ['es2022'] } })));
    rows.push({ label: w.label, v: [first, cold, tscCold, sevenRun.ms, tsrsRun.ms, smEdit, tscEdit, sevenRun.totalMs, tsrsRun.totalMs, firstPrepared, smEditWhole] });
  });
  const smaltts = rows.filter((r) => r.label.startsWith('smaltts '));
  const mid = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;
  const cell = (j: number) => `${fmt(mid(smaltts.map((r) => r.v[j]!)))} (${fmt(Math.max(...smaltts.map((r) => r.v[j]!)))})`;
  line(`| smaltts's reference and guide examples (${smaltts.length}) | ${cell(0)} | **${cell(9)}** | **${cell(1)}** | ${cell(2)} | ${cell(3)} (${fmt(mid(smaltts.map((r) => r.v[7]!)))}) | ${cell(4)} (${fmt(mid(smaltts.map((r) => r.v[8]!)))}) | **${cell(5)}** | ${cell(10)} | ${cell(6)} |`);
  for (const r of rows.filter((r) => !r.label.startsWith('smaltts '))) {
    const [first, cold, tscCold, seven, tsrs, smEdit, tscEdit, sevenOwn, tsrsOwn, firstPrepared, smEditWhole] = r.v.map(fmt);
    line(`| ${r.label.replace(/^smaltdf (.*)$/, 'smaltdf: `$1`')} | ${first} | **${firstPrepared}** | **${cold}** | ${tscCold} | ${seven} (${sevenOwn}) | ${tsrs} (${tsrsOwn}) | **${smEdit}** | ${smEditWhole} | ${tscEdit} |`);
  }
}
line();

// ---------------------------------------------------------------- loading and size

/** Milliseconds a fresh Node process takes to run `code`, as reported by the code itself (median of runs). */
function fresh(code: string, runs = quick ? 1 : 7, args: string[] = ['--input-type=module', '-e', code]): number {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const ms = Number(execFileSync(process.execPath, args, { encoding: 'utf8' }).trim());
    samples.push(ms);
  }
  samples.sort((a, b) => a - b);
  return samples[samples.length >> 1]!;
}

const tsPath = require.resolve('typescript/lib/typescript.js');
const tsText = readFileSync(tsPath);
/** First use of each entry point: a line stripped, a line parsed and bound, a one-line check. */
const firstUse: Record<string, string> = {
  smaltty: `m.strip('let a: number = 1');`,
  'smaltty/strip': `m.strip('let a: number = 1');`,
  'smaltty/bind': `m.bind((await import(${JSON.stringify(distUrl('entry-strip.js'))})).parse('let a = 1;'));`,
  'smaltty/check': `m.check(new Map([['/a.ts', 'let a: number = 1;']]));`,
};
const entries = entryPoints().map((e) => {
  const files = moduleGraph(e.file);
  const ms = fresh(`const t = performance.now(); const m = await import(${JSON.stringify(distUrl(e.file))}); ${firstUse[e.name] ?? ''} console.log(performance.now() - t);`);
  return { ...e, files, ms, ...sizeOf(files) };
});
const loadSucrase = fresh(`const t = performance.now(); const { transform } = await import('sucrase'); transform('let a: number = 1', { transforms: ['typescript'] }); console.log(performance.now() - t);`);
const loadTs = fresh(`import { readdirSync, readFileSync } from 'node:fs'; const text = readFileSync(${JSON.stringify(tsPath)}, 'utf8'); const t = performance.now(); const ts = new Function(text + '\\nreturn ts;')(); ts.transpileModule('let a: number = 1', {}); console.log(performance.now() - t);`);

line('### Loading and size');
line();
line('Loading: a fresh process, from first use to the first stripped line, median of runs. smaltnb evaluates `lib/typescript.js` with `new Function`, as here. smaltty: each entry point, the modules it loads (its module graph in `dist/`, comments removed, not minified); gzipped is each module on its own, as a server sends them; for `smaltty/bind` and `smaltty/check` the first use is a line parsed and bound, a one-line check.');
line();
line('| Tool | Load (ms) | Size | Gzipped |');
line('| --- | ---: | ---: | ---: |');
line(`| sucrase (as \`@smaltworks/smaltdb-sucrase\` bundles it) | ${fmt(loadSucrase)} | ~200 KB | ~48 KB |`);
line(`| TypeScript compiler (\`lib/typescript.js\`) | ${fmt(loadTs)} | ${kb(tsText.length)} KB | ${kb(gzipSync(tsText).length)} KB |`);
for (const e of entries) line(`| \`${e.name}\` (${e.files.length} modules) | ${fmt(e.ms)} | ${kb(e.raw)} KB | ${(e.gzipped / 1024).toFixed(1)} KB |`);
line();
line("sucrase's bundled size is from smaltdb-sucrase's README (an esbuild bundle of sucrase and its dependencies); smaltty doesn't bundle sucrase to measure it.");

console.log(out.join('\n'));
