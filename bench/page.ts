// The checkers in a page, as the apps run them: smaltty's checker and tsrs's WebAssembly build (`@tsrs/wasm`), each in
// a fresh page of headless Chromium, on the checking workloads of `npm run bench` (bench/corpus.ts). For each: what the
// page downloads, the time to load it, a cold check of each workload and a check after an edit. Prints a Markdown table
// for docs/BENCHMARKS.md.
//
// Needs Playwright, which isn't a dependency: install it outside the project and point NODE_PATH at it.
//
//   NODE_PATH=$(npm root -g) npm run bench:page
//   NODE_PATH=$(npm root -g) npm run bench:page -- --quick   # one run each: checks the harness, not a measurement
//   NODE_PATH=$(npm root -g) node bench/page.ts --entries --dist=<dir>   # only the entry points' loading, from another
//                                                                         # build of dist/ (a minified one, to compare)
//   NODE_PATH=$(npm root -g) node bench/page.ts --first   # only the first check from the worker's start (milestone 11)
//   ... --app=<label>=<types.json>=<code file>[,<code file>…]   # that table on an app's own types.json too (repeatable)
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { checkWorkloads } from './corpus.ts';
import { entryPoints, moduleGraph } from './entries.ts';
import { firstCheckWorkloads, type FirstCheckWorkload } from './first-check.ts';
import { prepare } from 'smaltty';

const quick = process.argv.includes('--quick');
const entriesOnly = process.argv.includes('--entries');
const firstOnly = process.argv.includes('--first');
const apps = process.argv.filter((a) => a.startsWith('--app=')).map((a) => a.slice('--app='.length));
const distArg = process.argv.find((a) => a.startsWith('--dist='))?.slice('--dist='.length);
const require = createRequire(import.meta.url);
/** As much of Playwright as this uses (it isn't a dependency, so its types aren't here). */
interface Page {
  goto(url: string): Promise<unknown>;
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
  close(): Promise<void>;
}
const { chromium } = require('playwright') as { chromium: { launch(): Promise<{ newPage(): Promise<Page>; version(): string; close(): Promise<void> }> } };
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = distArg ?? join(root, 'dist');
const tsrsDir = dirname(require.resolve('@tsrs/wasm/package.json'));
const tsrsVersion = (JSON.parse(readFileSync(join(tsrsDir, 'package.json'), 'utf8')) as { version: string }).version;

// What each page downloads: smaltty's dist/*.js; tsrs's browser.js, core.js and tsrs.wasm.
const smalttyFiles = readdirSync(dist).filter((f) => f.endsWith('.js')).map((f) => join(dist, f));
const tsrsFiles = ['browser.js', 'core.js', 'tsrs.wasm'].map((f) => join(tsrsDir, f));
const size = (files: string[]) => {
  const raw = files.reduce((n, f) => n + statSync(f).size, 0);
  const gz = files.reduce((n, f) => n + gzipSync(readFileSync(f)).length, 0);
  return `${(raw / 1024).toFixed(0)} KB (${(gz / 1024).toFixed(1)} KB gzipped)`;
};

const TYPES: Record<string, string> = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };
/** Data the first-check pages fetch before they time anything: each workload's prepared buffer and text, by URL. */
const data = new Map<string, Uint8Array>();
const server = createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === '/check-worker.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(CHECK_WORKER);
  if (data.has(url)) return res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(data.get(url));
  const file = url === '/' ? null : url.startsWith('/smaltty/') ? join(dist, url.slice(9)) : url.startsWith('/tsrs/') ? join(tsrsDir, url.slice(6)) : null;
  if (url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>checkers</title>');
  try {
    res.writeHead(200, { 'content-type': TYPES[extname(file!)] ?? 'application/octet-stream' }).end(readFileSync(file!));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((r) => server.listen(0, r));
const base = `http://localhost:${(server.address() as { port: number }).port}`;

/** A workload as the page gets it: plain data. */
interface Workload {
  label: string;
  root: string;
  packages: Record<string, string>;
  files: Record<string, string>;
}
const workloads: Workload[] = checkWorkloads().map((w) => ({ label: w.label, root: w.root, packages: w.packages, files: Object.fromEntries(w.files) }));
const runs = quick ? 1 : 5;
const browser = await chromium.launch();

/** smaltty in a fresh page: load, then per workload a cold check and the median of checks after an edit (a cache kept). */
async function smalttyPage() {
  const page = await browser.newPage();
  await page.goto(base);
  return page.evaluate(
    async ({ workloads, runs }: { workloads: Workload[]; runs: number }) => {
      const t = performance.now();
      const m = (await import('/smaltty/' + 'index.js')) as typeof import('smaltty');
      const load = performance.now() - t;
      const out: { label: string; cold: number; edit: number; errors: number }[] = [];
      for (const w of workloads) {
        const files = new Map(Object.entries(w.files));
        const opts = { roots: [w.root], packages: w.packages };
        let s = performance.now();
        const errors = m.check(files, opts).length;
        const cold = performance.now() - s;
        const cache = m.checkCache();
        m.check(files, { ...opts, cache });
        const edits: number[] = [];
        for (let i = 0; i < Math.max(runs, 5); i++) {
          files.set(w.root, `${w.files[w.root]}\n// edit ${i}`);
          s = performance.now();
          m.check(files, { ...opts, cache });
          edits.push(performance.now() - s);
        }
        edits.sort((a, b) => a - b);
        out.push({ label: w.label, cold, edit: edits[edits.length >> 1]!, errors });
      }
      return { load, out };
    },
    { workloads, runs },
  ).finally(() => page.close());
}

/** tsrs's WebAssembly build in a fresh page: fetch and compile the module, then per workload the first check and the median of the next (each a fresh instance). */
async function tsrsPage() {
  const page = await browser.newPage();
  await page.goto(base);
  return page.evaluate(
    async ({ workloads, runs }: { workloads: Workload[]; runs: number }) => {
      const t = performance.now();
      const m = (await import('/tsrs/' + 'browser.js')) as typeof import('@tsrs/wasm');
      const module = await m.loadModule('/tsrs/tsrs.wasm');
      const load = performance.now() - t;
      const CHECKED = new Set([2339, 2551, 2554, 2555, 2353, 2561, 2345, 2322]);
      const out: { label: string; cold: number; edit: number; errors: number }[] = [];
      for (const w of workloads) {
        const paths = Object.fromEntries(Object.entries(w.packages).map(([k, v]) => [k, [v]]));
        const tsconfig = { compilerOptions: { target: 'es2022', module: 'esnext', moduleResolution: 'bundler', lib: ['es2023'], strict: true, noEmit: true, types: [], skipLibCheck: true, paths }, files: Object.keys(w.files) };
        const once = async (text: string) => {
          const s = performance.now();
          const r = await m.tsc(['-p', '/'], { cwd: '/', files: { ...w.files, [w.root]: text, '/tsconfig.json': JSON.stringify(tsconfig) }, diagnostics: 'json', module });
          const ms = performance.now() - s;
          return { ms, errors: (r.diagnostics ?? []).filter((d) => d.fileName === w.root && CHECKED.has(d.code)).length };
        };
        const first = await once(w.files[w.root]);
        const edits: number[] = [];
        for (let i = 0; i < runs; i++) edits.push((await once(`${w.files[w.root]}\n// edit ${i}`)).ms);
        edits.sort((a, b) => a - b);
        out.push({ label: w.label, cold: first.ms, edit: edits[edits.length >> 1]!, errors: first.errors });
      }
      return { load, out };
    },
    { workloads, runs },
  ).finally(() => page.close());
}

/**
 * Each entry point in fresh pages: from the first import to its first use (a line stripped; a line parsed and bound; a
 * one-line check), the median of runs. The module graph is fetched over the local server, so without network time.
 */
async function entryPage(file: string, runs: number): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const page = await browser.newPage();
    await page.goto(base);
    samples.push(
      await page
        .evaluate(async (file: string) => {
          const t = performance.now();
          const m = (await import('/smaltty/' + file)) as Record<string, any>;
          if (m.strip) m.strip('let a: number = 1');
          else if (m.check) m.check(new Map([['/a.ts', 'let a: number = 1;']]));
          else m.bind?.((await import('/smaltty/' + 'entry-strip.js')).parse('let a = 1;'));
          return performance.now() - t;
        }, file)
        .finally(() => page.close()),
    );
  }
  samples.sort((a, b) => a - b);
  return samples[samples.length >> 1]!;
}
const entryLoads: { name: string; files: string[]; ms: number }[] = [];
for (const e of entryPoints()) {
  if (e.name === 'smaltty/bind') continue; // it parses nothing: measured with smaltty/strip, in its graph
  entryLoads.push({ name: e.name, files: moduleGraph(e.file).map((f) => join(dist, f)), ms: await entryPage(e.file, quick ? 1 : 15) });
}

/**
 * The checker's worker as an app runs it (smaltkit's typecheck worker, reduced to what is timed): smaltty/check loaded
 * when the worker starts; a setup (the libraries as text, or prepared); then checks, each answered with its time inside
 * the worker. The warm-up is a check of `''` with the prepared files read (PreparedFiles.readAll()).
 */
const CHECK_WORKER = `
const loading = import('/smaltty/entry-check.js');
let m, files, options, cache, path;
onmessage = async (e) => {
  m ??= await loading;
  const d = e.data;
  if (d.kind === 'setup') {
    files = new Map(Object.entries(d.files));
    cache = m.checkCache();
    path = d.path;
    options = { roots: [path], packages: d.packages, globals: d.globals, cache, ...(d.prepared ? { prepared: d.prepared } : {}) };
    return;
  }
  if (d.warm && options.prepared) m.readPrepared(options.prepared)?.readAll();
  files.set(path, d.code);
  const s = performance.now();
  const found = m.check(files, d.cold ? { ...options, cache: undefined } : options);
  postMessage({ id: d.id, ms: performance.now() - s, errors: found.map((x) => x.start + ' ' + x.code + ' ' + x.message) });
};`;

interface FirstCheck {
  label: string;
  mode: 'text' | 'prepared';
  /** From `new Worker` to the first check's answer: loading, setup and the check. */
  fromStart: number;
  /** The first check() call alone, inside the worker. */
  firstCall: number;
  /** The worker started and warmed (a check of nothing) while the page was idle, then the first check: asked to answered. */
  warmed: number;
  /** A check with nothing kept from the one before (prepared files are the page's, and stay read). */
  cold: number;
  /** After an edit, a cache kept. */
  edit: number;
  errors: string[];
}

/** One workload in one mode: two fresh pages, one started cold and one warmed while idle. */
async function firstCheckPage(w: FirstCheckWorkload, index: number, mode: 'text' | 'prepared'): Promise<FirstCheck> {
  const run = async (warm: boolean) => {
    const page = await browser.newPage();
    await page.goto(base);
    return page
      .evaluate(
        async ({ w, index, mode, warm, runs }: { w: FirstCheckWorkload; index: number; mode: string; warm: boolean; runs: number }) => {
          // The setup as the app has it before the worker starts: fetched, so no network time is counted.
          const prepared = mode === 'prepared' ? new Uint8Array(await (await fetch('/data/' + index + '.prep')).arrayBuffer()) : undefined;
          const files = mode === 'prepared' ? {} : w.libs;
          let id = 0;
          const replies = new Map<number, (r: { ms: number; errors: string[] }) => void>();
          const t0 = performance.now();
          // A page's Worker (this file's types are Node's, which has none by that name).
          type PageWorker = { onmessage: (e: { data: { id: number; ms: number; errors: string[] } }) => void; postMessage(m: unknown, transfer?: unknown[]): void; terminate(): void };
          const Worker = (globalThis as unknown as { Worker: new (url: string, options: { type: string }) => PageWorker }).Worker;
          const worker = new Worker('/check-worker.js', { type: 'module' });
          worker.onmessage = (e) => replies.get(e.data.id)!(e.data);
          const ask = (code: string, cold = false, warm = false) =>
            new Promise<{ ms: number; errors: string[]; at: number }>((resolve) => {
              const n = ++id;
              replies.set(n, (r) => resolve({ ...r, at: performance.now() }));
              worker.postMessage({ kind: 'check', id: n, code, cold, warm });
            });
          worker.postMessage({ kind: 'setup', path: w.path, files, packages: w.packages, globals: w.globals, prepared }, prepared ? [prepared.buffer] : []);
          let warmed = 0;
          if (warm) {
            await ask('', false, true); // a check of nothing, the prepared files read
            await new Promise((r) => setTimeout(r, 300)); // the page idle
            const s = performance.now();
            await ask(w.code);
            warmed = performance.now() - s;
          }
          const first = warm ? undefined : await ask(w.code);
          const colds: number[] = [];
          const edits: number[] = [];
          for (let i = 0; i < Math.max(runs, 5); i++) colds.push((await ask(w.code + '\n// cold ' + i, true)).ms);
          await ask(w.code);
          for (let i = 0; i < Math.max(runs, 5); i++) edits.push((await ask(w.code + '\n// edit ' + i)).ms);
          worker.terminate();
          const median = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1]!;
          return { fromStart: first ? first.at - t0 : 0, firstCall: first?.ms ?? 0, warmed, cold: median(colds), edit: median(edits), errors: first?.errors ?? [] };
        },
        { w, index, mode, warm, runs },
      )
      .finally(() => page.close());
  };
  const samples: Awaited<ReturnType<typeof run>>[] = [];
  const warms: number[] = [];
  for (let i = 0; i < (quick ? 1 : 7); i++) {
    samples.push(await run(false));
    warms.push((await run(true)).warmed);
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;
  return {
    label: w.label,
    mode,
    fromStart: median(samples.map((s) => s.fromStart)),
    firstCall: median(samples.map((s) => s.firstCall)),
    warmed: median(warms),
    cold: median(samples.map((s) => s.cold)),
    edit: median(samples.map((s) => s.edit)),
    errors: samples[0]!.errors,
  };
}

const firstWorkloads = entriesOnly ? [] : firstCheckWorkloads(apps);
const firsts: FirstCheck[] = [];
const sizes: { label: string; text: number; textGz: number; prep: number; prepGz: number }[] = [];
for (const [i, w] of firstWorkloads.entries()) {
  const text = Buffer.from(JSON.stringify({ files: w.libs, packages: w.packages, globals: w.globals }));
  const prep = prepare(new Map(Object.entries(w.libs)));
  data.set(`/data/${i}.prep`, prep);
  sizes.push({ label: w.label, text: text.length, textGz: gzipSync(text).length, prep: prep.length, prepGz: gzipSync(prep).length });
  for (const mode of ['text', 'prepared'] as const) firsts.push(await firstCheckPage(w, i, mode));
}

const sm = entriesOnly || firstOnly ? null : await smalttyPage();
const ts = entriesOnly || firstOnly ? null : await tsrsPage();
await browser.close();
server.close();

const fmt = (ms: number): string => (ms < 1 ? ms.toFixed(3) : ms < 100 ? ms.toFixed(2) : ms.toFixed(0));
console.log(`Chromium ${browser.version()}.${quick ? ' **Quick run: one iteration, not a measurement.**' : ''}`);
console.log();
console.log('| Entry point | Modules | Downloads | Load and first use (ms) |');
console.log('| --- | ---: | ---: | ---: |');
for (const e of entryLoads) console.log(`| \`${e.name}\` | ${e.files.length} | ${size(e.files)} | ${fmt(e.ms)} |`);
console.log();
if (firsts.length) {
  console.log("The first check from the worker's start (milestone 11): each workload's libraries as text, or prepared.");
  console.log();
  console.log("| Workload | Setup | From the worker's start | First check() | Warmed while idle, then the first check | Cold | After an edit | Same errors |");
  console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |');
  for (let i = 0; i < firsts.length; i += 2) {
    const [t, p] = [firsts[i]!, firsts[i + 1]!];
    const same = JSON.stringify(t.errors) === JSON.stringify(p.errors) ? `yes (${t.errors.length})` : 'NO';
    for (const r of [t, p]) console.log(`| ${r.label} | ${r.mode} | ${r.mode === 'prepared' ? '**' + fmt(r.fromStart) + '**' : fmt(r.fromStart)} | ${fmt(r.firstCall)} | ${fmt(r.warmed)} | ${fmt(r.cold)} | ${fmt(r.edit)} | ${same} |`);
  }
  console.log();
  console.log('| Workload | Text (types.json) | Prepared |');
  console.log('| --- | ---: | ---: |');
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  for (const z of sizes) console.log(`| ${z.label} | ${kb(z.text)} (${kb(z.textGz)} gzipped) | ${kb(z.prep)} (${kb(z.prepGz)} gzipped) |`);
  console.log();
}
if (!sm || !ts) process.exit(0);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;
console.log(`@tsrs/wasm ${tsrsVersion}.`);
console.log();
console.log(`| | Downloads | Load (ms) |`);
console.log('| --- | ---: | ---: |');
console.log(`| smaltty (\`dist/*.js\`) | ${size(smalttyFiles)} | ${fmt(sm.load)} |`);
console.log(`| tsrs (\`@tsrs/wasm\`: browser.js, core.js, tsrs.wasm) | ${size(tsrsFiles)} | ${fmt(ts.load)} |`);
console.log();
console.log('| Workload | smaltty cold | tsrs first check | smaltty after an edit | tsrs after an edit |');
console.log('| --- | ---: | ---: | ---: | ---: |');
const rows = sm.out.map((s, i) => ({ s, t: ts.out[i]! }));
const smaltts = rows.filter((r) => r.s.label.startsWith('smaltts '));
const cell = (f: (r: (typeof rows)[number]) => number) => `${fmt(median(smaltts.map(f)))} (${fmt(Math.max(...smaltts.map(f)))})`;
console.log(`| smaltts's examples (${smaltts.length}) | **${cell((r) => r.s.cold)}** | ${cell((r) => r.t.cold)} | **${cell((r) => r.s.edit)}** | ${cell((r) => r.t.edit)} |`);
for (const r of rows.filter((r) => !r.s.label.startsWith('smaltts '))) {
  console.log(`| ${r.s.label.replace(/^smaltdf (.*)$/, 'smaltdf: `$1`')} | **${fmt(r.s.cold)}** | ${fmt(r.t.cold)} | **${fmt(r.s.edit)}** | ${fmt(r.t.edit)} |`);
}
console.log();
console.log(`Errors of the checked codes found (all workloads as written): smaltty ${sm.out.reduce((n, r) => n + r.errors, 0)}, tsrs ${ts.out.reduce((n, r) => n + r.errors, 0)}.`);
