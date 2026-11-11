// The corpus the tests and benchmarks run over: TypeScript users write in the apps (smaltui tabs, smaltnb notebooks),
// library code from the smalt repos, syntax edge cases, and generated scripts for scaling.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Group = 'apps' | 'libs' | 'edge' | 'generated';

export interface CorpusFile {
  /** Path relative to corpus/, or `generated/<name>` for a generated script. */
  name: string;
  group: Group;
  /** False for code TypeScript's erasableSyntaxOnly rejects (enum, namespace, parameter properties, import =). */
  erasable: boolean;
  /** False where sucrase rejects code TypeScript accepts: smaltty follows TypeScript. */
  sucrase: boolean;
  text: string;
}

const root = new URL('../corpus/', import.meta.url);

function read(dir: string, group: Group, erasable: boolean): CorpusFile[] {
  const path = new URL(dir + '/', root);
  return readdirSync(path)
    .filter((f) => f.endsWith('.ts'))
    .sort()
    .map((f) => ({ name: join(dir, f), group, erasable, sucrase: !SUCRASE_REJECTS.has(join(dir, f)), text: readFileSync(new URL(f, path), 'utf8') }));
}

/** The files on disk. Library files with parameter properties are not erasable; corpus.test.ts checks this list. */
export function corpusFiles(): CorpusFile[] {
  const libs = read('libs', 'libs', true).map((f) => ({ ...f, erasable: !NOT_ERASABLE_LIBS.has(f.name) }));
  return [
    ...read('apps', 'apps', true),
    ...libs,
    ...read('edge/erasable', 'edge', true),
    ...read('edge/non-erasable', 'edge', false),
  ];
}

/** Files sucrase can't strip although TypeScript parses them. */
export const SUCRASE_REJECTS = new Set(['edge/erasable/sucrase-differs.ts']);

/** Library files that use parameter properties (smaltdf's own source does). */
export const NOT_ERASABLE_LIBS = new Set(['libs/smaltdf-errors.ts', 'libs/smaltdf-expr.ts', 'libs/smaltdf-frame.ts']);

/**
 * A smaltdf-style script of about `bytes` characters, the same for the same size: frames, expressions, interfaces,
 * generics, classes and arrow functions, with names numbered so nothing is declared twice.
 */
export function generatedScript(bytes: number): string {
  const parts: string[] = [
    "import { col, lit, len, table, type LazyFrame } from '@smaltdb/df';\n",
  ];
  let size = parts[0]!.length;
  for (let i = 0; size < bytes; i++) {
    const block = `
/** Block ${i}: an order summary. */
export interface Row${i} {
  id: number;
  region: 'north' | 'south' | 'east' | 'west';
  amount?: number;
  tags: readonly string[];
}

type Keyed${i}<T extends Row${i} = Row${i}> = Record<string, T[]>;

export function group${i}<T extends Row${i}>(rows: T[], key: (r: T) => string): Keyed${i}<T> {
  const out: Keyed${i}<T> = {};
  for (const r of rows) (out[key(r)] ??= []).push(r);
  return out;
}

class Cache${i}<V> {
  #items = new Map<string, V>();
  private hits = 0;
  get(k: string): V | undefined {
    const v = this.#items.get(k);
    if (v !== undefined) this.hits++;
    return v as V | undefined;
  }
  set(k: string, v: V): this {
    this.#items.set(k, v);
    return this;
  }
}

const cache${i} = new Cache${i}<LazyFrame>();
const frame${i}: LazyFrame = table('orders_${i % 7}')
  .filter(col('qty').ge(lit(${i % 5})).and(col('region').ne('west')))
  .withColumns(col('qty').mul(col('price')).alias('revenue_${i}'))
  .groupBy('region')
  .agg(col('revenue_${i}').sum().alias('total'), len().alias('n'))
  .sort('total', { descending: ${i % 2 === 0} });
cache${i}.set('frame', frame${i});
const totals${i} = group${i}<Row${i}>([], (r) => r.region);
export const summary${i} = { frame: frame${i}, totals: totals${i} } satisfies { frame: LazyFrame; totals: unknown };
`;
    parts.push(block);
    size += block.length;
  }
  return parts.join('');
}

/** The generated scripts used for scaling: about 40 KB and 400 KB. */
export function generatedFiles(): CorpusFile[] {
  return [
    { name: 'generated/40k.ts', group: 'generated', erasable: true, sucrase: true, text: generatedScript(40_000) },
    { name: 'generated/400k.ts', group: 'generated', erasable: true, sucrase: true, text: generatedScript(400_000) },
  ];
}

/** A check the checker benchmarks time: one user file (`root`), checked with the library sources it imports. */
export interface CheckWorkload {
  label: string;
  /** The user file and every library file, by path. */
  files: Map<string, string>;
  root: string;
  packages: Record<string, string>;
}

/** Each file of a corpus folder, under `/<prefix>/<name>`. */
function folder(dir: string, prefix: string, keep: (f: string) => boolean = () => true): Map<string, string> {
  const path = new URL(dir + '/', root);
  const out = new Map<string, string>();
  for (const f of readdirSync(path).sort()) if (f.endsWith('.ts') && keep(f)) out.set(`/${prefix}/${f}`, readFileSync(new URL(f, path), 'utf8'));
  return out;
}

/**
 * The checker's workloads: code users write, with the library it calls read from source as the checker reads it. smaltts:
 * each example from its reference and guide, with smaltts's 16 source files. smaltdf: smaltnb's notebooks and a
 * generated 40 KB script, with smaltdf's source (corpus/libs). The notebooks' `smaltnb` import isn't in the corpus, and
 * is unknown to both checkers; smaltui's tabs are left out, as they import nothing (smaltui gives smaltdf as globals).
 */
export function checkWorkloads(): CheckWorkload[] {
  const smaltts = folder('check/smaltts/src', 'src');
  const smaltdf = new Map([...folder('libs', 'df', (f) => f.startsWith('smaltdf-'))].map(([p, t]) => [p.replace('/df/smaltdf-', '/df/'), t]));
  const dfPackages = { '@smaltdb/df': '/df/index.ts' };
  const out: CheckWorkload[] = [];
  for (const [p, text] of folder('check/smaltts/examples', 'examples')) {
    out.push({ label: `smaltts ${p.slice('/examples/'.length)}`, files: new Map([...smaltts, [p, text]]), root: p, packages: {} });
  }
  for (const [p, text] of folder('apps', 'apps', (f) => f.startsWith('smaltnb-'))) {
    out.push({ label: `smaltdf ${p.slice('/apps/'.length)}`, files: new Map([...smaltdf, [p, text]]), root: p, packages: dfPackages });
  }
  out.push({ label: 'smaltdf generated/40k.ts', files: new Map([...smaltdf, ['/gen/40k.ts', generatedScript(40_000)]]), root: '/gen/40k.ts', packages: dfPackages });
  return out;
}
