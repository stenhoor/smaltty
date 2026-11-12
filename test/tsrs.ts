// TypeScript 7 (its `tsc` command, the reference since milestone 9), tsrs (Cloudflare and VoidZero's Rust port of
// TypeScript 7's checker, which follows TypeScript's next version, 7.1 beta now: the early warning of what it changes),
// TypeScript 6.0 (its API, the reference before) and smaltty, on the same files with the same options. A comparison
// only; nothing here decides smaltty's tests.
//
// `node test/tsrs.ts` compares them on the checker tests' mutants (smaltts's examples, smaltdf's API in a generated
// script, smaltui's tabs with smaltdf as globals): which of TypeScript 7's errors each reports, what else each
// reports, and how many messages are the same. `--misses` adds the errors smaltty misses, by code, of every code
// TypeScript 7 reports (the order of milestone 14's coverage work); `--details` the differences between the others.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { CHECKED_CODES, commandLineChecks, type CommandLineOptions, compareChecks, DF_PACKAGES, globalsDeclaration, libsCorpus, mutants, smalttsCorpus, TSC7_VERSION, typescript6Checks, typescript7Checks, type ReferenceError, type ReferenceResult } from './checking.ts';
import { generatedScript } from '../bench/corpus.ts';

const require = createRequire(import.meta.url);
export const TSRS_BIN = join(dirname(require.resolve('tsrs/package.json')), 'bin', 'tsrs');
const TS6_VERSION: string = require('typescript/package.json').version;

/** Runs tsrs on `files` (paths rooted at `/`), with compareChecks's options, and reads back its errors (every code). */
export function tsrsChecks(files: ReadonlyMap<string, string>, options: CommandLineOptions = {}): ReferenceResult {
  return commandLineChecks([TSRS_BIN], files, options);
}

const key = (d: { file: string; start: number; code: number }) => `${d.file}:${d.start}:${d.code}`;

/** How one checker's errors (of the checked codes) compare with TypeScript 7's. */
function against(reference: readonly ReferenceError[], errors: readonly { file: string; start: number; code: number; message: string }[]) {
  const keys = new Set(reference.map(key));
  const messages = new Map(reference.map((d) => [key(d), d.message]));
  const own = new Set(errors.map(key));
  return {
    agree: errors.filter((d) => keys.has(key(d))).length,
    extra: errors.filter((d) => !keys.has(key(d))),
    missing: reference.filter((d) => !own.has(key(d))),
    sameMessage: errors.filter((d) => messages.get(key(d)) === d.message).length,
  };
}

/** The four checkers on one set of files, against TypeScript 7: the roots none skipped, the codes smaltty checks. */
export function compareAll(files: ReadonlyMap<string, string>, options: { roots: readonly string[]; originals?: ReadonlyMap<string, string>; packages?: Record<string, string>; globals?: readonly string[] }) {
  const t = tsrsChecks(files, options);
  // Only the files every command line checked: they leave out those with syntax errors.
  const r = compareChecks(files, { ...options, roots: options.roots.filter((f) => !t.skipped.includes(f)) });
  const roots = new Set(options.roots.filter((f) => !t.skipped.includes(f) && !r.skipped.includes(f)));
  const inRoots = <T extends { file: string; code: number }>(xs: readonly T[]) => xs.filter((d) => roots.has(d.file) && CHECKED_CODES.has(d.code));
  const tsc = inRoots(r.tsc);
  const six = typescript6Checks(files, { roots: [...roots], ...(options.packages ? { packages: options.packages } : {}) });
  // Every code: what smaltty misses of TypeScript 7's errors, by code. Of a mutant's errors, those its original has
  // too (the same code and message: an unknown module, `console` without the DOM's lib) aren't counted.
  const before = new Map<string, Map<string, number>>();
  if (options.originals) {
    const originalFiles = new Map([...files].filter(([f]) => !options.roots.includes(f)));
    for (const [f, text] of options.originals) originalFiles.set(f, text);
    for (const d of typescript7Checks(originalFiles, { roots: [...options.originals.keys()], ...(options.packages ? { packages: options.packages } : {}) }).errors) {
      const m = before.get(d.file) ?? new Map<string, number>();
      m.set(`${d.code} ${d.message}`, (m.get(`${d.code} ${d.message}`) ?? 0) + 1);
      before.set(d.file, m);
    }
  }
  const caught = new Set(r.smaltty.map(key));
  const misses = new Map<number, number>();
  const seen = new Map<string, Map<string, number>>();
  for (const d of r.all) {
    // 2451 (a block-scoped name declared again): the tabs are scripts, and their mutants share one program's globals.
    if (!roots.has(d.file) || caught.has(key(d)) || d.code === 2451) continue;
    const original = d.file.replace(/\.[a-z]+\.\d+\.ts$/, '.ts');
    const s = seen.get(d.file) ?? new Map<string, number>();
    const n = (s.get(`${d.code} ${d.message}`) ?? 0) + 1;
    s.set(`${d.code} ${d.message}`, n);
    seen.set(d.file, s);
    if (n <= (before.get(original)?.get(`${d.code} ${d.message}`) ?? 0)) continue;
    misses.set(d.code, (misses.get(d.code) ?? 0) + 1);
  }
  return {
    checked: roots.size,
    tsc: tsc.length,
    all: r.all.filter((d) => roots.has(d.file)).length,
    tsrs: { ...against(tsc, inRoots(t.errors)), ms: t.ms },
    typescript6: against(tsc, inRoots(six.errors)),
    smaltty: { ...against(tsc, inRoots(r.smaltty.map((d) => ({ ...d })))), messageDiffs: r.messageDiffs.filter((d) => roots.has(d.file)).length },
    misses,
  };
}

/** The checker tests' mutant sets. */
export function mutantSets(): { label: string; files: Map<string, string>; roots: string[]; originals: Map<string, string>; packages?: Record<string, string>; globals?: string[] }[] {
  const sets: ReturnType<typeof mutantSets> = [];
  const smaltts = smalttsCorpus();
  {
    const files = new Map([...smaltts].filter(([f]) => f.startsWith('/src/')));
    const roots: string[] = [];
    const originals = new Map([...smaltts].filter(([f]) => f.startsWith('/examples/')));
    for (const [f, text] of originals) for (const [n, t] of mutants(f, text)) (files.set(n, t), roots.push(n));
    sets.push({ label: "smaltts's examples, mutated", files, roots, originals });
  }
  const { smaltdf } = libsCorpus();
  const apps = new URL('../corpus/apps/', import.meta.url);
  const read = (f: string) => execFileSync('cat', [new URL(f, apps).pathname], { encoding: 'utf8' });
  {
    const files = new Map(smaltdf);
    const roots: string[] = [];
    const originals = new Map([['/gen/small.ts', generatedScript(6_000)]]);
    for (const [name, text] of originals) for (const [n, t] of mutants(name, text)) (files.set(n, t), roots.push(n));
    sets.push({ label: "smaltdf's API in a generated script, mutated", files, roots, originals, packages: DF_PACKAGES });
  }
  {
    const files = new Map(smaltdf);
    files.set('/globals.d.ts', globalsDeclaration(smaltdf, '@smaltdb/df', '/df/index.ts'));
    const roots: string[] = [];
    const originals = new Map(['smaltui-demo-frames.ts', 'smaltui-starter.ts'].map((f) => [`/tabs/${f}`, read(f)]));
    for (const [f, text] of originals) for (const [n, t] of mutants(f, text)) (files.set(n, t), roots.push(n));
    sets.push({ label: "smaltui's tabs (smaltdf as globals), mutated", files, roots, originals, packages: DF_PACKAGES, globals: ['@smaltdb/df'] });
  }
  return sets;
}

if (import.meta.main) {
  const misses = new Map<number, number>();
  console.log(`| Mutants | TypeScript ${TSC7_VERSION} errors | smaltty: same as 7 | smaltty: other | smaltty: message differs | tsrs: same as 7 | tsrs: other | TypeScript ${TS6_VERSION}: same as 7 | ${TS6_VERSION}: other | same message: smaltty, tsrs, ${TS6_VERSION} | tsrs process (ms) |`);
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  const details: string[] = [];
  for (const s of mutantSets()) {
    const c = compareAll(s.files, s);
    console.log(`| ${s.label} (${c.checked} of ${s.roots.length}) | ${c.tsc} | ${c.smaltty.agree} | ${c.smaltty.extra.length} | ${c.smaltty.messageDiffs} | ${c.tsrs.agree} | ${c.tsrs.extra.length} | ${c.typescript6.agree} | ${c.typescript6.extra.length} | ${c.smaltty.sameMessage}, ${c.tsrs.sameMessage}, ${c.typescript6.sameMessage} | ${c.tsrs.ms.toFixed(0)} |`);
    for (const [code, n] of c.misses) misses.set(code, (misses.get(code) ?? 0) + n);
    if (process.argv.includes('--details')) {
      details.push(`${s.label}:`);
      for (const [who, x] of [['tsrs', c.tsrs], [TS6_VERSION, c.typescript6], ['smaltty', c.smaltty]] as const) {
        for (const d of x.extra.slice(0, 8)) details.push(`  ${who} only: ${d.file}:${d.start} ${d.code} ${d.message.split('\n')[0]}`);
        if (who !== 'smaltty') for (const d of x.missing.slice(0, 8)) details.push(`  7 only (not ${who}): ${d.file}:${d.start} ${d.code} ${d.message.split('\n')[0]}`);
      }
    }
  }
  if (details.length) console.log(`\n${details.join('\n')}`);
  if (process.argv.includes('--misses')) {
    const total = [...misses.values()].reduce((a, b) => a + b, 0);
    console.log(`\nTypeScript ${TSC7_VERSION}'s errors smaltty misses, every code, all three sets, not counting those the unmutated file has (${total}):\n`);
    console.log('| Code | Missed | Checked by smaltty |');
    console.log('| ---: | ---: | --- |');
    for (const [code, n] of [...misses].sort((a, b) => b[1] - a[1] || a[0] - b[0])) console.log(`| ${code} | ${n} | ${CHECKED_CODES.has(code) ? 'yes' : 'no'} |`);
  }
}
