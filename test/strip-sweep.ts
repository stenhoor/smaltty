// Strips every .ts file under the given paths and compares with TypeScript's own type removal (verbatimModuleSyntax):
// the same program, the same length and line breaks. Files TypeScript calls non-erasable (erasableSyntaxOnly) must be
// refused instead. Used by hand on other code:
//
//   node test/strip-sweep.ts ../smaltdb/src ../smaltdf/src
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { strip, ParseError } from 'smaltty';
import { firstLineDifference, programLines, typescriptStrip } from './js.ts';

export interface StripSweepResult {
  files: number;
  stripped: number;
  refused: number;
  failures: { file: string; problem: string }[];
}

/** TypeScript's verdict: does erasableSyntaxOnly reject anything in the file? */
export function typescriptErasable(file: string, text: string): boolean {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const host = ts.createCompilerHost({});
  host.getSourceFile = (f) => (f === file ? sf : undefined);
  host.fileExists = (f) => f === file;
  const program = ts.createProgram([file], { noLib: true, noResolve: true, types: [], erasableSyntaxOnly: true, noEmit: true }, host);
  return !program.getSemanticDiagnostics(sf).some((d) => d.code === 1294);
}

const lineBreaks = (s: string): string => [...s.matchAll(/\r\n?|\n|\u2028|\u2029/g)].map((m) => m.index).join(',');

export function stripSweep(paths: string[]): StripSweepResult {
  const files: string[] = [];
  const walk = (p: string): void => {
    if (!statSync(p).isDirectory()) return void files.push(p);
    for (const f of readdirSync(p).sort()) {
      const q = join(p, f);
      if (statSync(q).isDirectory()) walk(q);
      else if (/\.[mc]?ts$/.test(f) && !/\.d\.[mc]?ts$/.test(f)) files.push(q);
    }
  };
  paths.forEach(walk);
  const r: StripSweepResult = { files: files.length, stripped: 0, refused: 0, failures: [] };
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    if ((sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) continue; // not valid TypeScript
    const erasable = typescriptErasable(file, text);
    let js: string | null = null;
    let error = '';
    try {
      js = strip(text, { fileName: file });
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      error = e.message;
    }
    if (!erasable) {
      if (js !== null) r.failures.push({ file, problem: 'TypeScript calls it non-erasable; smaltty stripped it.' });
      else r.refused++;
      continue;
    }
    if (js === null) {
      r.failures.push({ file, problem: `smaltty refused an erasable file: ${error}` });
      continue;
    }
    if (js.length !== text.length || lineBreaks(js) !== lineBreaks(text)) {
      r.failures.push({ file, problem: 'Positions moved: the length or the line breaks differ.' });
      continue;
    }
    let diff: string | null;
    try {
      diff = firstLineDifference(programLines(typescriptStrip(text)), programLines(js));
    } catch (e) {
      diff = (e as Error).message;
    }
    if (diff) r.failures.push({ file, problem: diff });
    else r.stripped++;
  }
  return r;
}

if (import.meta.main) {
  const r = stripSweep(process.argv.slice(2));
  for (const f of r.failures.slice(0, 15)) console.log(`${f.file}\n${f.problem}\n`);
  console.log(`${r.files} files: ${r.stripped} stripped to TypeScript's program, ${r.refused} refused as non-erasable, ${r.failures.length} differ`);
  process.exitCode = r.failures.length ? 1 : 0;
}
