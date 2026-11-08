// Compares smaltty's tree with TypeScript's over every .ts/.js file under the given paths, and reports the files that
// differ. A file both parsers reject counts as agreeing. Used by test/sweep.test.ts, and by hand on other code:
//
//   node test/sweep.ts ../smaltdb/src node_modules/typescript/lib/typescript.js
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { parse } from 'smaltty';
import { firstDifference, smalttyLines, typescriptLines } from './compare.ts';

export interface SweepResult {
  files: number;
  nodes: number;
  /** Files where the trees differ, or one parser rejects what the other accepts, with the first difference. */
  failures: { file: string; problem: string }[];
}

const SOURCE = /\.(d\.)?[mc]?[tj]s$/;

export function sweep(paths: string[]): SweepResult {
  const files: string[] = [];
  const walk = (p: string): void => {
    if (!statSync(p).isDirectory()) {
      files.push(p);
      return;
    }
    for (const f of readdirSync(p).sort()) {
      const q = join(p, f);
      if (statSync(q).isDirectory()) walk(q);
      else if (SOURCE.test(f)) files.push(q);
    }
  };
  paths.forEach(walk);
  const result: SweepResult = { files: files.length, nodes: 0, failures: [] };
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const tsRejects = (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length > 0;
    let lines: string[] | null = null;
    let error = '';
    try {
      lines = smalttyLines(parse(text, { fileName: file }));
    } catch (e) {
      error = (e as Error).message;
    }
    if (tsRejects) {
      if (lines) result.failures.push({ file, problem: 'TypeScript reports a syntax error; smaltty accepts the file.' });
      continue;
    }
    if (!lines) {
      result.failures.push({ file, problem: `smaltty rejects a file TypeScript accepts: ${error}` });
      continue;
    }
    const expected = typescriptLines(file, text);
    result.nodes += expected.length;
    const diff = firstDifference(expected, lines, text);
    if (diff) result.failures.push({ file, problem: diff });
  }
  return result;
}

if (import.meta.main) {
  const r = sweep(process.argv.slice(2));
  for (const f of r.failures.slice(0, 20)) console.log(`${f.file}\n${f.problem}\n`);
  console.log(`${r.files} files, ${r.nodes} nodes compared, ${r.failures.length} differ`);
  process.exitCode = r.failures.length ? 1 : 0;
}
