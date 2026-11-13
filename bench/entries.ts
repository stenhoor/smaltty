// smaltty's entry points (package.json `exports`) and the modules each loads, read from dist/: what a page downloads
// when it imports one. Sizes are per module, each gzipped on its own, as a server sends them.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const root = new URL('../', import.meta.url);
const distDir = new URL('dist/', root);

/** Each entry point by its import name (`smaltty`, `smaltty/strip`, …), with its file in dist/. */
export function entryPoints(): { name: string; file: string }[] {
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { exports: Record<string, string | { default: string }> };
  return Object.entries(pkg.exports)
    .filter(([sub, target]) => typeof target === 'object' && target.default.startsWith('./dist/') && sub !== './package.json')
    .map(([sub, target]) => ({ name: sub === '.' ? 'smaltty' : `smaltty/${sub.slice(2)}`, file: (target as { default: string }).default.slice('./dist/'.length) }));
}

/** The dist/ files that loading `file` loads, itself included: its static imports, followed (tsc writes them as `from './x.js'`). */
export function moduleGraph(file: string): string[] {
  const seen = new Set<string>();
  const visit = (f: string) => {
    if (seen.has(f)) return;
    seen.add(f);
    const text = readFileSync(new URL(f, distDir), 'utf8');
    for (const m of text.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s*'\.\/([^']+)'|^import\s*'\.\/([^']+)'/gm)) visit((m[1] ?? m[2])!);
  };
  visit(file);
  return [...seen].sort();
}

/** Bytes, raw and gzipped (each file on its own), of `files` in dist/. */
export function sizeOf(files: string[]): { raw: number; gzipped: number } {
  let raw = 0;
  let gzipped = 0;
  for (const f of files) {
    const bytes = readFileSync(new URL(f, distDir));
    raw += bytes.length;
    gzipped += gzipSync(bytes).length;
  }
  return { raw, gzipped };
}

/** The URL of a file in dist/. */
export const distUrl = (file: string): string => new URL(file, distDir).href;
