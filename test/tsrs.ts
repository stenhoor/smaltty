// tsrs (Cloudflare and VoidZero's Rust port of TypeScript 7's checker, npm `tsrs`, a dev dependency) as a third checker
// beside tsc and smaltty: the same files, the same options, its errors of the codes smaltty checks. A comparison only;
// nothing here decides smaltty's tests.
//
// `node test/tsrs.ts` compares the three on the checker tests' mutants (smaltts's examples, smaltdf's API in the apps
// and a generated script, smaltui's tabs with smaltdf as globals): which of tsc's errors each reports, what else
// each reports, and how long a check takes.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CHECKED_CODES, compareChecks, DF_PACKAGES, globalsDeclaration, libsCorpus, mutants, smalttsCorpus } from './checking.ts';
import { generatedScript } from '../bench/corpus.ts';

export const TSRS_BIN = join(dirname(createRequire(import.meta.url).resolve('tsrs/package.json')), 'bin', 'tsrs');

export interface TsrsResult {
  /** tsrs's errors of the checked codes, in the roots. */
  readonly errors: readonly { file: string; start: number; code: number; message: string }[];
  /** Wall time of the tsrs process that checked them, milliseconds. */
  readonly ms: number;
  /** tsrs's own total (`--extendedDiagnostics`: read, parse, bind and check, without the process's start), ms. */
  readonly totalMs: number;
  /**
   * Roots with syntax errors, left out: tsrs, like tsc's command line, checks nothing else in a program with one, so
   * they are dropped and the rest checked again.
   */
  readonly skipped: readonly string[];
}

/** Runs tsrs on `files` (paths rooted at `/`), with tsc's options in compareChecks, and reads back its errors. */
export function tsrsChecks(files: ReadonlyMap<string, string>, options: { roots?: readonly string[]; packages?: Record<string, string> } = {}): TsrsResult {
  const roots = new Set(options.roots ?? files.keys());
  const skipped: string[] = [];
  let current = new Map(files);
  for (;;) {
    const { lines, ms, totalMs } = runTsrs(current, options.packages ?? {});
    const syntax = new Set(lines.filter((l) => l.code < 2000 && roots.has(l.file)).map((l) => l.file));
    if (syntax.size) {
      skipped.push(...syntax);
      current = new Map([...current].filter(([f]) => !syntax.has(f)));
      continue;
    }
    const errors = lines.filter((l) => roots.has(l.file) && CHECKED_CODES.has(l.code)).map((l) => {
      const text = files.get(l.file)!.split('\n');
      let start = l.column - 1;
      for (let i = 0; i < l.line - 1; i++) start += text[i]!.length + 1;
      return { file: l.file, start, code: l.code, message: l.message };
    });
    return { errors, ms, totalMs, skipped };
  }
}

/** One tsrs run on `files` (paths rooted at `/`) in a temporary project, with compareChecks's options for tsc. */
function runTsrs(files: ReadonlyMap<string, string>, packages: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'smaltty-tsrs-'));
  try {
    for (const [path, text] of files) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    const paths = Object.fromEntries(Object.entries(packages).map(([name, path]) => [name, [`.${path}`]]));
    const tsconfig = {
      compilerOptions: { target: 'es2022', module: 'esnext', moduleResolution: 'bundler', lib: ['es2023'], strict: true, noEmit: true, types: [], skipLibCheck: true, paths },
      files: [...files.keys()].map((f) => `.${f}`),
    };
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(tsconfig));
    const start = performance.now();
    let out = '';
    try {
      out = execFileSync(TSRS_BIN, ['-p', '.', '--pretty', 'false', '--extendedDiagnostics'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 });
    } catch (e) {
      out = (e as { stdout?: string }).stdout ?? ''; // tsrs exits with 2 when it finds errors
    }
    const ms = performance.now() - start;
    const lines: { file: string; line: number; column: number; code: number; message: string }[] = [];
    for (const line of out.split('\n')) {
      const m = /^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(line);
      // Paths are relative to the project, where tsrs runs.
      if (m) lines.push({ file: '/' + m[1]!.replace(/\\/g, '/').replace(/^\.\//, ''), line: Number(m[2]), column: Number(m[3]), code: Number(m[4]), message: m[5]! });
    }
    const total = /^Total time:\s+([\d.]+)s/m.exec(out);
    return { lines, ms, totalMs: total ? Number(total[1]) * 1000 : NaN };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The three checkers on one set of files: tsc's errors each reports, and each one's errors tsc doesn't report. */
export function compareThree(files: ReadonlyMap<string, string>, options: { roots: readonly string[]; packages?: Record<string, string>; globals?: readonly string[] }) {
  const t = tsrsChecks(files, options);
  // Only the files all three checked: tsrs leaves out those with syntax errors.
  const skipped = new Set(t.skipped);
  const r = compareChecks(files, { ...options, roots: options.roots.filter((f) => !skipped.has(f)) });
  const key = (d: { file: string; start: number; code: number }) => `${d.file}:${d.start}:${d.code}`;
  const tscKeys = new Set(r.tsc.map(key));
  const tsrsKeys = new Set(t.errors.map(key));
  // First lines only: tsrs prints a message's first line; tsc's can go on with what led to it.
  const tscMessages = new Map(r.tsc.map((d) => [key(d), d.message.split('\n')[0]]));
  return {
    checked: options.roots.length - skipped.size,
    tsc: r.tsc.length,
    tsrs: { agree: t.errors.filter((d) => tscKeys.has(key(d))).length, extra: t.errors.filter((d) => !tscKeys.has(key(d))), missing: r.tsc.filter((d) => !tsrsKeys.has(key(d))), sameMessage: t.errors.filter((d) => tscMessages.get(key(d)) === d.message).length, ms: t.ms },
    smaltty: { agree: r.caught, extra: r.falseErrors.length, sameMessage: r.smaltty.filter((d) => tscMessages.get(key(d)) === d.message.split('\n')[0]).length },
  };
}

/** The checker tests' mutant sets. */
export function mutantSets(): { label: string; files: Map<string, string>; roots: string[]; packages?: Record<string, string>; globals?: string[] }[] {
  const sets: ReturnType<typeof mutantSets> = [];
  const smaltts = smalttsCorpus();
  {
    const files = new Map([...smaltts].filter(([f]) => f.startsWith('/src/')));
    const roots: string[] = [];
    for (const f of [...smaltts.keys()].filter((p) => p.startsWith('/examples/'))) for (const [n, t] of mutants(f, smaltts.get(f)!)) (files.set(n, t), roots.push(n));
    sets.push({ label: "smaltts's examples, mutated", files, roots });
  }
  const { smaltdf } = libsCorpus();
  const apps = new URL('../corpus/apps/', import.meta.url);
  const read = (f: string) => execFileSync('cat', [new URL(f, apps).pathname], { encoding: 'utf8' });
  {
    const files = new Map(smaltdf);
    const roots: string[] = [];
    for (const [name, text] of [['/gen/small.ts', generatedScript(6_000)]] as const) for (const [n, t] of mutants(name, text)) (files.set(n, t), roots.push(n));
    sets.push({ label: "smaltdf's API in a generated script, mutated", files, roots, packages: DF_PACKAGES });
  }
  {
    const files = new Map(smaltdf);
    files.set('/globals.d.ts', globalsDeclaration(smaltdf, '@smaltdb/df', '/df/index.ts'));
    const roots: string[] = [];
    for (const f of ['smaltui-demo-frames.ts', 'smaltui-starter.ts']) for (const [n, t] of mutants(`/tabs/${f}`, read(f))) (files.set(n, t), roots.push(n));
    sets.push({ label: "smaltui's tabs (smaltdf as globals), mutated", files, roots, packages: DF_PACKAGES, globals: ['@smaltdb/df'] });
  }
  return sets;
}

if (import.meta.main) {
  console.log('| Mutants | tsc 5.9 errors | tsrs: same as tsc | tsrs: other | smaltty: same as tsc | smaltty: other | same message: tsrs, smaltty | tsrs process (ms) |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const s of mutantSets()) {
    const c = compareThree(s.files, s);
    console.log(`| ${s.label} (${c.checked} of ${s.roots.length}) | ${c.tsc} | ${c.tsrs.agree} | ${c.tsrs.extra.length} | ${c.smaltty.agree} | ${c.smaltty.extra} | ${c.tsrs.sameMessage}, ${c.smaltty.sameMessage} | ${c.tsrs.ms.toFixed(0)} |`);
    if (process.argv.includes('--details')) {
      for (const d of c.tsrs.extra.slice(0, 8)) console.log(`  tsrs only: ${d.file}:${d.start} ${d.code} ${d.message}`);
      for (const d of c.tsrs.missing.slice(0, 8)) console.log(`  tsc only:  ${d.file}:${d.start} ${d.code} ${d.message}`);
    }
  }
}
