// The built-in types (src/builtins.ts) checked against TypeScript's latest lib: our table is our own (the owner's
// decision, 2026-11-11), and this test keeps it true to TypeScript's. For each interface, the same members (symbol-keyed
// ones aside), properties where TypeScript has properties, and each method's argument count as TypeScript's across its
// overloads, unless ours is declared `(...args: any[])`, which the checker doesn't count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { BUILTINS } from '../src/builtins.ts';

interface Member { readonly method: boolean; readonly min: number; readonly max: number; readonly loose: boolean }

/** The argument counts a list of parameter declarations takes. */
function arity(params: readonly ts.ParameterDeclaration[]): { min: number; max: number } {
  const ps = params.filter((p) => !(ts.isIdentifier(p.name) && p.name.text === 'this'));
  let min = 0;
  let max = 0;
  for (const p of ps) {
    if (p.dotDotDotToken) return { min, max: Infinity };
    max++;
    if (!p.questionToken && !p.initializer) min = max;
  }
  return { min, max };
}

/** Ours: each interface's members, from the declaration text. */
function ours(): Map<string, Map<string, Member>> {
  const sf = ts.createSourceFile('/builtins.d.ts', BUILTINS, ts.ScriptTarget.ESNext, true);
  const out = new Map<string, Map<string, Member>>();
  for (const s of sf.statements) {
    if (!ts.isInterfaceDeclaration(s)) continue;
    const members = new Map<string, Member>();
    for (const m of s.members) {
      const name = m.name && ts.isIdentifier(m.name) ? m.name.text : undefined;
      assert.ok(name, `${s.name.text}: a member without a plain name`);
      assert.ok(!members.has(name), `${s.name.text}.${name} is declared twice: a method with overloads is (...args: any[])`);
      if (ts.isMethodSignature(m)) {
        const loose = m.parameters.length === 1 && !!m.parameters[0]!.dotDotDotToken && m.parameters[0]!.type?.getText() === 'any[]';
        members.set(name, { method: true, loose, ...arity(m.parameters) });
      } else members.set(name, { method: false, loose: false, min: 0, max: 0 });
    }
    out.set(s.name.text, members);
  }
  return out;
}

/** TypeScript's: the same interfaces' members, merged across the lib files, with every overload's counts. */
function typescripts(names: readonly string[]): Map<string, Map<string, Member>> {
  const libDir = dirname(createRequire(import.meta.url).resolve('typescript'));
  const files = new Map<string, string>([['/probe.ts', 'export {};']]);
  const host: ts.CompilerHost = {
    getSourceFile: (f, target) => {
      const text = files.get(f) ?? readFileSync(f, 'utf8');
      return ts.createSourceFile(f, text, target, true);
    },
    writeFile: () => {},
    getDefaultLibFileName: (o) => join(libDir, ts.getDefaultLibFileName(o)),
    useCaseSensitiveFileNames: () => true,
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => '/',
    getNewLine: () => '\n',
    fileExists: (f) => files.has(f) || (f.startsWith(libDir) && existsSync(f)),
    readFile: (f) => files.get(f) ?? (existsSync(f) ? readFileSync(f, 'utf8') : undefined),
  };
  const program = ts.createProgram(['/probe.ts'], { lib: ['lib.esnext.d.ts'], noEmit: true, types: [] }, host);
  const out = new Map<string, Map<string, Member>>();
  for (const name of names) {
    const members = new Map<string, Member>();
    for (const sf of program.getSourceFiles()) {
      if (!sf.fileName.startsWith(libDir)) continue;
      for (const s of sf.statements) {
        if (!ts.isInterfaceDeclaration(s) || s.name.text !== name) continue;
        for (const m of s.members) {
          if (!m.name || !ts.isIdentifier(m.name)) continue; // symbol-keyed and index signatures
          const key = m.name.text;
          const prev = members.get(key);
          if (ts.isMethodSignature(m)) {
            const a = arity(m.parameters);
            members.set(key, prev ? { method: true, loose: false, min: Math.min(prev.min, a.min), max: Math.max(prev.max, a.max) } : { method: true, loose: false, ...a });
          } else members.set(key, { method: false, loose: false, min: 0, max: 0 });
        }
      }
    }
    out.set(name, members);
  }
  return out;
}

const mine = ours();
const theirs = typescripts([...mine.keys()]);

test('every interface is one TypeScript has', () => {
  for (const [name, members] of theirs) assert.ok(members.size > 0, `TypeScript has no interface ${name}`);
});

for (const [name, members] of mine) {
  test(`${name}: TypeScript's members, kinds and argument counts`, () => {
    const lib = theirs.get(name)!;
    assert.deepEqual([...members.keys()].sort(), [...lib.keys()].sort());
    for (const [key, m] of members) {
      const t = lib.get(key)!;
      assert.equal(m.method, t.method, `${name}.${key}: a ${t.method ? 'method' : 'property'} in TypeScript's lib`);
      if (m.method && !m.loose) assert.deepEqual({ min: m.min, max: m.max }, { min: t.min, max: t.max }, `${name}.${key}'s argument counts`);
    }
  });
}
