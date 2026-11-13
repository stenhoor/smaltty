// The first check's workloads (milestone 11), as the apps set the checker up: the libraries a page checks against are
// declarations (.d.ts) given as text or prepared, beside one file of user code. From the corpus: smaltui's tabs
// (smaltdf's declarations, its exports as globals), smaltnb's notebooks (smaltdf's declarations; smaltnb's own aren't in
// the corpus, so its import is unknown, as in the checking table) and one of smaltts's examples (smaltts read from
// source, as in the checking table). An app's own types.json can be added (`--app=<label>=<types.json>=<code>,…`), as
// smaltui's and smaltnb's builds write it.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { declarationsOf, DF_PACKAGES, libsCorpus, smalttsCorpus } from '../test/checking.ts';

export interface FirstCheckWorkload {
  label: string;
  /** The libraries, path to text. */
  libs: Record<string, string>;
  packages: Record<string, string>;
  globals: string[];
  /** The user code's path (smaltkit's, `/__code__.ts`, as the apps check it; an example's own, for its relative imports). */
  path: string;
  code: string;
}

const apps = new URL('../corpus/apps/', import.meta.url);

export function firstCheckWorkloads(appArgs: readonly string[] = []): FirstCheckWorkload[] {
  const out: FirstCheckWorkload[] = [];
  const dfDts = Object.fromEntries(declarationsOf(libsCorpus().smaltdf));
  const dfPackages = { '@smaltdb/df': DF_PACKAGES['@smaltdb/df'].replace(/\.ts$/, '.d.ts') };
  out.push({ label: "smaltui's tab: `smaltui-demo-frames.ts`", libs: dfDts, packages: dfPackages, globals: ['@smaltdb/df'], path: '/__code__.ts', code: readFileSync(new URL('smaltui-demo-frames.ts', apps), 'utf8') });
  out.push({ label: "smaltnb's notebook: `smaltnb-shop.nb.ts`", libs: dfDts, packages: dfPackages, globals: [], path: '/__code__.ts', code: readFileSync(new URL('smaltnb-shop.nb.ts', apps), 'utf8') });
  const smaltts = smalttsCorpus();
  // The example whose first check is the slowest in Node (getting-started-14.ts, 76 ms; the median is about 55 ms).
  out.push({ label: "smaltts's example: `getting-started-14.ts`", libs: Object.fromEntries([...smaltts].filter(([f]) => f.startsWith('/src/'))), packages: {}, globals: [], path: '/examples/getting-started-14.ts', code: smaltts.get('/examples/getting-started-14.ts')! });
  for (const arg of appArgs) {
    const [label, types, codes] = arg.split('=') as [string, string, string];
    const setup = JSON.parse(readFileSync(types, 'utf8')) as { files: Record<string, string>; packages?: Record<string, string>; globals?: string[] };
    for (const code of codes.split(',')) {
      out.push({ label: `${label}: \`${basename(code)}\``, libs: setup.files, packages: setup.packages ?? {}, globals: setup.globals ?? [], path: '/__code__.ts', code: readFileSync(code, 'utf8') });
    }
  }
  return out;
}
