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
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { checkWorkloads } from './corpus.ts';
import { entryPoints, moduleGraph } from './entries.ts';

const quick = process.argv.includes('--quick');
const entriesOnly = process.argv.includes('--entries');
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
const server = createServer((req, res) => {
  const url = req.url ?? '/';
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

const sm = entriesOnly ? null : await smalttyPage();
const ts = entriesOnly ? null : await tsrsPage();
await browser.close();
server.close();

const fmt = (ms: number): string => (ms < 1 ? ms.toFixed(3) : ms < 100 ? ms.toFixed(2) : ms.toFixed(0));
console.log(`Chromium ${browser.version()}.${quick ? ' **Quick run: one iteration, not a measurement.**' : ''}`);
console.log();
console.log('| Entry point | Modules | Downloads | Load and first use (ms) |');
console.log('| --- | ---: | ---: | ---: |');
for (const e of entryLoads) console.log(`| \`${e.name}\` | ${e.files.length} | ${size(e.files)} | ${fmt(e.ms)} |`);
console.log();
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
