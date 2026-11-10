// The checker (milestone 7, the checker trial): types for the calls user code makes into the libraries it imports
// (smaltts and smaltdf first), read from those libraries' declarations, and the errors tsc would report on them.
//
// The gradual guarantee (DESIGN.md, "Model: ty"): anything the checker doesn't model is unknown, and unknown is never
// an error. A type is modelled only where the declarations say exactly what it is: a class, an interface or a type
// literal whose members are all known (no index signature, no base it can't read), or a function with one signature.
// Everything else (unions, generics' arguments, mapped and conditional types, the built-in types) is unknown for now.
//
// What it reports, by tsc's codes, so the tests compare the two diagnostic for diagnostic:
// - 2339: a property that does not exist on a known type, and 2551 when tsc would suggest a member's name;
// - 2554 and 2555: a call or `new` with an argument count no parameter list accepts.
import { F, K, isTypeNode } from './kinds.js';
import { bind, type Bindings } from './binder.js';
import { parse } from './parser.js';
import type { Tree } from './tree.js';

export interface Diagnostic {
  readonly file: string;
  /** Offset and length of the text it is about, as tsc gives them. */
  readonly start: number;
  readonly length: number;
  /** tsc's code for the same error. */
  readonly code: number;
  readonly message: string;
}

export interface CheckOptions {
  /** The files to check (default: all of `files`); the others are read for their declarations only. */
  readonly roots?: readonly string[];
  /** Bare module specifiers to files: `{ '@smaltworks/smaltts': 'smaltts/src/index.ts' }`. */
  readonly packages?: Readonly<Record<string, string>>;
}

/** Check `files` (path to text) and return the errors found in the roots. */
export function check(files: ReadonlyMap<string, string>, options: CheckOptions = {}): Diagnostic[] {
  const c = new Checker(files, options);
  const out: Diagnostic[] = [];
  for (const path of options.roots ?? [...files.keys()]) out.push(...c.checkFile(path));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Types.

/** A declaration: a node in a file. */
interface Decl {
  readonly file: SourceInfo;
  readonly node: number;
}

type Type =
  | { readonly k: 'unknown' }
  /** A primitive (its members are the built-in types', not modelled yet). */
  | { readonly k: 'primitive' }
  /** An object: a class instance, an interface or a type literal. */
  | { readonly k: 'object'; readonly decls: readonly Decl[]; readonly name: string }
  /** A class as a value: what `new` makes, and its static members. */
  | { readonly k: 'class'; readonly decl: Decl }
  /** A function's signatures (more than one: overloads). */
  | { readonly k: 'function'; readonly signatures: readonly Decl[] }
  /** `import * as ns`: a module's exports. */
  | { readonly k: 'namespace'; readonly file: SourceInfo };

const UNKNOWN: Type = { k: 'unknown' };
const PRIMITIVE: Type = { k: 'primitive' };

/** What every object has from Object.prototype. */
const OBJECT_MEMBERS = new Set(['constructor', 'toString', 'toLocaleString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable']);

const PRIMITIVE_KINDS = new Set([K.StringKeyword, K.NumberKeyword, K.BooleanKeyword, K.BigIntKeyword, K.SymbolKeyword, K.LiteralType]);

interface Members {
  /** Member name to its declarations. */
  readonly byName: Map<string, Decl[]>;
  /** Members can't all be known: an index signature, a computed name, a base the checker can't read. */
  open: boolean;
}

interface SourceInfo {
  readonly path: string;
  readonly tree: Tree;
  readonly bindings: Bindings;
}

class Checker {
  private readonly files: ReadonlyMap<string, string>;
  private readonly options: CheckOptions;
  private readonly sources = new Map<string, SourceInfo | null>();
  private readonly members = new Map<string, Members>();
  private readonly typing = new Set<string>();

  constructor(files: ReadonlyMap<string, string>, options: CheckOptions) {
    this.files = files;
    this.options = options;
  }

  private source(path: string): SourceInfo | undefined {
    if (!this.sources.has(path)) {
      const text = this.files.get(path);
      let info: SourceInfo | null = null;
      if (text !== undefined) {
        try {
          const tree = parse(text, { fileName: path });
          info = { path, tree, bindings: bind(tree) };
        } catch {
          info = null; // a file that doesn't parse declares nothing the checker can use
        }
      }
      this.sources.set(path, info);
    }
    return this.sources.get(path) ?? undefined;
  }

  checkFile(path: string): Diagnostic[] {
    const f = this.source(path);
    if (!f) return [];
    const out: Diagnostic[] = [];
    const t = f.tree;
    t.walk(t.root, (n) => {
      const kind = t.kind[n]!;
      if (kind === K.PropertyAccessExpression) this.checkProperty(f, n, out);
      else if (kind === K.CallExpression || kind === K.NewExpression) this.checkCall(f, n, out);
    });
    return out;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Checks.

  private checkProperty(f: SourceInfo, n: number, out: Diagnostic[]): void {
    const t = f.tree;
    const object = t.first[n]!;
    const name = t.next[object]!;
    if (t.kind[name] !== K.Identifier) return;
    const type = this.typeOfExpr(f, object);
    if (type.k !== 'object') return;
    const key = t.textOf(name);
    const m = this.membersOf(type);
    if (m.open || m.byName.has(key) || OBJECT_MEMBERS.has(key)) return;
    const start = t.start[name]!;
    const length = t.end[name]! - start;
    const suggestion = spellingSuggestion(key, [...m.byName.keys()]);
    if (suggestion !== undefined) {
      out.push({ file: f.path, start, length, code: 2551, message: `Property '${key}' does not exist on type '${type.name}'. Did you mean '${suggestion}'?` });
    } else {
      out.push({ file: f.path, start, length, code: 2339, message: `Property '${key}' does not exist on type '${type.name}'.` });
    }
  }

  private checkCall(f: SourceInfo, n: number, out: Diagnostic[]): void {
    const t = f.tree;
    const callee = t.first[n]!;
    const args = this.argumentsOf(t, n);
    if (args === undefined) return;
    let signatures: readonly Decl[];
    if (t.kind[n] === K.NewExpression) {
      const type = this.typeOfExpr(f, callee);
      if (type.k !== 'class') return;
      const ctors = this.constructorsOf(type.decl);
      if (ctors === undefined) return;
      signatures = ctors;
    } else {
      const type = this.typeOfExpr(f, callee);
      if (type.k !== 'function') return;
      signatures = type.signatures;
    }
    if (signatures.length !== 1) return; // overloads: not modelled yet
    const arity = this.arityOf(signatures[0]!);
    if (!arity) return;
    const got = args.length;
    if (got >= arity.min && (arity.max === null || got <= arity.max)) return;
    // tsc's spans: excess arguments from the first one too many; too few at the callee's name.
    let start: number;
    let end: number;
    if (arity.max !== null && got > arity.max) {
      start = t.start[args[arity.max]!]!;
      end = t.end[args[got - 1]!]!;
    } else {
      const at = t.kind[callee] === K.PropertyAccessExpression ? t.next[t.first[callee]!]! : callee;
      start = t.start[at]!;
      end = t.end[at]!;
    }
    const expected = arity.max === null ? `at least ${arity.min}` : arity.min === arity.max ? `${arity.min}` : `${arity.min}-${arity.max}`;
    const code = arity.max === null ? 2555 : 2554;
    out.push({ file: f.path, start, length: end - start, code, message: `Expected ${expected} arguments, but got ${got}.` });
  }

  /** A call's argument nodes, or undefined when one is spread (its count isn't known). */
  private argumentsOf(t: Tree, call: number): number[] | undefined {
    const out: number[] = [];
    let c = t.next[t.first[call]!]!;
    for (; c; c = t.next[c]!) {
      if (isTypeNode(t.kind[c]!)) continue; // type arguments
      if (t.kind[c] === K.SpreadElement) return undefined;
      out.push(c);
    }
    return out;
  }

  /** How many arguments a signature takes, or undefined when it can't be told. */
  private arityOf(sig: Decl): { min: number; max: number | null } | undefined {
    const t = sig.file.tree;
    let min = 0;
    let max: number | null = 0;
    let optional = false;
    for (let c = t.first[sig.node]!; c; c = t.next[c]!) {
      if (t.kind[c] !== K.Parameter) continue;
      const name = t.first[c]!;
      if (t.kind[name] === K.Identifier && t.textOf(name) === 'this') continue;
      if (t.flags[c]! & F.Rest) {
        max = null;
        continue;
      }
      const hasDefault = this.childrenOf(t, c).some((x, i) => i > 0 && !isTypeNode(t.kind[x]!));
      if (t.flags[c]! & F.Optional || hasDefault) optional = true;
      else if (optional) return undefined; // a required parameter after an optional one: tsc's rules differ
      else min++;
      if (max !== null) max++;
    }
    return { min, max };
  }

  // -------------------------------------------------------------------------------------------------------------
  // Expressions.

  private typeOfExpr(f: SourceInfo, n: number): Type {
    const t = f.tree;
    switch (t.kind[n]) {
      case K.Identifier:
        return this.valueOfName(f, n);
      case K.ParenthesizedExpression:
      case K.NonNullExpression:
      case K.SatisfiesExpression:
        return this.typeOfExpr(f, t.first[n]!);
      case K.AsExpression:
      case K.TypeAssertionExpression: {
        const type = this.childrenOf(t, n).find((c) => isTypeNode(t.kind[c]!));
        return type ? this.typeOfNode(f, type) : UNKNOWN;
      }
      case K.CallExpression: {
        const callee = this.typeOfExpr(f, t.first[n]!);
        if (callee.k !== 'function') return UNKNOWN;
        // Overloads: the call has their type when they all return the same class or interface.
        const results = callee.signatures.map((s) => this.returnOf(s));
        const first = results[0]!;
        if (first.k !== 'object') return results.length === 1 ? first : UNKNOWN;
        const key = (r: Type) => (r.k === 'object' ? r.decls.map((d) => `${d.file.path}:${d.node}`).join('|') : '');
        return results.every((r) => key(r) === key(first)) ? first : UNKNOWN;
      }
      case K.NewExpression: {
        const callee = this.typeOfExpr(f, t.first[n]!);
        return callee.k === 'class' ? this.instanceOf(callee.decl) : UNKNOWN;
      }
      case K.PropertyAccessExpression: {
        const object = this.typeOfExpr(f, t.first[n]!);
        const name = t.next[t.first[n]!]!;
        if (t.kind[name] !== K.Identifier) return UNKNOWN;
        return this.memberType(object, t.textOf(name));
      }
      case K.ArrowFunction:
      case K.FunctionExpression:
        // Its own node is its signature: parameters, then the return annotation, if any.
        return { k: 'function', signatures: [{ file: f, node: n }] };
      case K.StringLiteral:
      case K.NumericLiteral:
      case K.NoSubstitutionTemplateLiteral:
      case K.TemplateExpression:
      case K.TrueKeyword:
      case K.FalseKeyword:
      case K.BigIntLiteral:
        return PRIMITIVE;
      default:
        return UNKNOWN;
    }
  }

  /** The type of a value a name refers to. */
  private valueOfName(f: SourceInfo, name: number): Type {
    const decl = this.declarationOf(f, name);
    return decl ? this.valueOfDecl(decl) : UNKNOWN;
  }

  /** The declaration node an Identifier refers to, in its own file. */
  private declarationOf(f: SourceInfo, name: number): Decl | undefined {
    const at = f.bindings.declaration(name);
    if (!at) return undefined;
    const node = f.bindings.parent[at]!;
    return { file: f, node: node || at };
  }

  private valueOfDecl(d: Decl): Type {
    const key = `${d.file.path}:${d.node}`;
    if (this.typing.has(key)) return UNKNOWN; // a cycle: `const a = b; const b = a;`
    this.typing.add(key);
    try {
      return this.valueOfDeclInner(d);
    } finally {
      this.typing.delete(key);
    }
  }

  private valueOfDeclInner(d: Decl): Type {
    const t = d.file.tree;
    switch (t.kind[d.node]) {
      case K.ClassDeclaration:
        return { k: 'class', decl: d };
      case K.FunctionDeclaration:
        return { k: 'function', signatures: this.overloads(d) };
      case K.VariableDeclaration:
      case K.Parameter: {
        const parts = this.childrenOf(t, d.node);
        if (t.kind[parts[0]!] !== K.Identifier) return UNKNOWN; // a destructuring pattern
        const type = parts.slice(1).find((c) => isTypeNode(t.kind[c]!));
        if (type) return this.typeOfNode(d.file, type);
        // A `const` takes its initializer's type; `let` and `var` would widen literals (primitives here anyway).
        const init = parts.slice(1).find((c) => !isTypeNode(t.kind[c]!));
        return init && t.kind[d.node] === K.VariableDeclaration ? this.typeOfExpr(d.file, init) : UNKNOWN;
      }
      case K.ImportSpecifier:
      case K.ImportClause:
      case K.NamespaceImport:
        return this.imported(d, 'value');
      default:
        return UNKNOWN;
    }
  }

  /** The declarations a function's name has that callers can call: its overloads, or the one with a body. */
  private overloads(d: Decl): Decl[] {
    const t = d.file.tree;
    const name = t.first[d.node]!;
    const symbol = d.file.bindings.symbol(name);
    const decls = (symbol?.declarations ?? [name]).map((n) => d.file.bindings.parent[n]!).filter((n) => t.kind[n] === K.FunctionDeclaration);
    const signatures = decls.filter((n) => !this.childrenOf(t, n).some((c) => t.kind[c] === K.Block));
    return (signatures.length ? signatures : decls).map((node) => ({ file: d.file, node }));
  }

  // -------------------------------------------------------------------------------------------------------------
  // Imports and exports.

  /** What an import declaration's name is, in the module it comes from. */
  private imported(d: Decl, meaning: 'value' | 'type'): Type {
    const t = d.file.tree;
    let declaration = d.node;
    while (declaration && t.kind[declaration] !== K.ImportDeclaration) declaration = d.file.bindings.parent[declaration]!;
    if (!declaration) return UNKNOWN;
    const spec = this.childrenOf(t, declaration).find((c) => t.kind[c] === K.StringLiteral);
    const target = spec ? this.resolve(t.textOf(spec).slice(1, -1), d.file.path) : undefined;
    const file = target ? this.source(target) : undefined;
    if (!file) return UNKNOWN;
    if (t.kind[d.node] === K.NamespaceImport) return meaning === 'value' ? { k: 'namespace', file } : UNKNOWN;
    if (t.kind[d.node] === K.ImportClause) return UNKNOWN; // a default import: not modelled
    const ids = this.childrenOf(t, d.node);
    const exported = this.exportOf(file, t.textOf(ids[0]!), new Set());
    if (!exported) return UNKNOWN;
    return meaning === 'value' ? this.valueOfDecl(exported) : this.typeOfDecl(exported);
  }

  /** The declaration a module exports under `name`, following re-exports. */
  private exportOf(f: SourceInfo, name: string, seen: Set<string>): Decl | undefined {
    if (seen.has(f.path)) return undefined;
    seen.add(f.path);
    const t = f.tree;
    const stars: number[] = [];
    for (let s = t.first[t.root]!; s; s = t.next[s]!) {
      const kind = t.kind[s]!;
      if (kind === K.ExportDeclaration) {
        const parts = this.childrenOf(t, s);
        const spec = parts.find((c) => t.kind[c] === K.StringLiteral);
        const named = parts.find((c) => t.kind[c] === K.NamedExports);
        if (!named) {
          if (spec) stars.push(spec);
          continue;
        }
        for (const e of this.childrenOf(t, named)) {
          const ids = this.childrenOf(t, e);
          const local = ids[0]!;
          if (t.textOf(ids[ids.length - 1]!) !== name) continue;
          if (spec) {
            const target = this.resolve(t.textOf(spec).slice(1, -1), f.path);
            const file = target ? this.source(target) : undefined;
            return file ? this.exportOf(file, t.textOf(local), new Set(seen)) : undefined;
          }
          return this.localDeclaration(f, t.textOf(local));
        }
        continue;
      }
      if (!(t.flags[s]! & F.Export)) continue;
      if (kind === K.VariableStatement) {
        for (const list of this.childrenOf(t, s)) {
          for (const v of this.childrenOf(t, list)) if (t.kind[t.first[v]!] === K.Identifier && t.textOf(t.first[v]!) === name) return { file: f, node: v };
        }
      } else if ((kind === K.ClassDeclaration || kind === K.FunctionDeclaration || kind === K.InterfaceDeclaration || kind === K.TypeAliasDeclaration) && t.textOf(t.first[s]!) === name) {
        return { file: f, node: s };
      }
    }
    for (const spec of stars) {
      const target = this.resolve(t.textOf(spec).slice(1, -1), f.path);
      const file = target ? this.source(target) : undefined;
      const found = file && this.exportOf(file, name, seen);
      if (found) return found;
    }
    return undefined;
  }

  /** A top-level declaration of `name` in a file (for `export { name }`). */
  private localDeclaration(f: SourceInfo, name: string): Decl | undefined {
    const t = f.tree;
    for (let s = t.first[t.root]!; s; s = t.next[s]!) {
      const kind = t.kind[s]!;
      if (kind === K.VariableStatement) {
        for (const list of this.childrenOf(t, s)) for (const v of this.childrenOf(t, list)) if (t.textOf(t.first[v]!) === name) return { file: f, node: v };
      } else if ((kind === K.ClassDeclaration || kind === K.FunctionDeclaration || kind === K.InterfaceDeclaration || kind === K.TypeAliasDeclaration) && t.textOf(t.first[s]!) === name) {
        return { file: f, node: s };
      } else if (kind === K.ImportDeclaration) {
        let found: Decl | undefined;
        t.walk(s, (n) => {
          if (!found && t.kind[n] === K.ImportSpecifier) {
            const ids = this.childrenOf(t, n);
            if (t.textOf(ids[ids.length - 1]!) === name) found = { file: f, node: n };
          }
        });
        if (found) return found;
      }
    }
    return undefined;
  }

  /** A module specifier to a file path: relative paths (`.js` read as `.ts`) and the packages option. */
  private resolve(spec: string, from: string): string | undefined {
    const pkg = this.options.packages?.[spec];
    if (pkg !== undefined) return pkg;
    if (!spec.startsWith('.')) return undefined;
    const parts = from.split('/').slice(0, -1);
    for (const p of spec.split('/')) {
      if (p === '..') parts.pop();
      else if (p !== '.') parts.push(p);
    }
    const base = parts.join('/');
    for (const candidate of [base.replace(/\.js$/, '.ts'), base, `${base}.ts`, `${base}/index.ts`, base.replace(/\.js$/, '.d.ts')]) {
      if (this.files.has(candidate)) return candidate;
    }
    return undefined;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Types from declarations.

  /** A type node's type. */
  private typeOfNode(f: SourceInfo, n: number): Type {
    const t = f.tree;
    const kind = t.kind[n]!;
    if (PRIMITIVE_KINDS.has(kind)) return PRIMITIVE;
    switch (kind) {
      case K.ParenthesizedType:
        return this.typeOfNode(f, t.first[n]!);
      case K.TypeLiteral:
        return { k: 'object', decls: [{ file: f, node: n }], name: t.textOf(n) };
      case K.FunctionType:
        return { k: 'function', signatures: [{ file: f, node: n }] };
      case K.TypeReference: {
        const name = t.first[n]!;
        if (t.kind[name] !== K.Identifier) return UNKNOWN; // a qualified name: not modelled
        const decl = this.declarationOf(f, name);
        return decl ? this.typeOfDecl(decl) : UNKNOWN;
      }
      default:
        return UNKNOWN;
    }
  }

  /** The type a declaration declares (a class's instances, an interface, a type alias's type). */
  private typeOfDecl(d: Decl): Type {
    const t = d.file.tree;
    switch (t.kind[d.node]) {
      case K.ClassDeclaration:
      case K.InterfaceDeclaration:
        return this.instanceOf(d);
      case K.TypeAliasDeclaration: {
        const parts = this.childrenOf(t, d.node);
        if (parts.some((c) => t.kind[c] === K.TypeParameter)) return UNKNOWN; // a generic alias: its arguments matter
        const type = parts.slice(1).find((c) => isTypeNode(t.kind[c]!));
        return type ? this.typeOfNode(d.file, type) : UNKNOWN;
      }
      case K.ImportSpecifier:
        return this.imported(d, 'type');
      default:
        return UNKNOWN; // a type parameter, or anything else
    }
  }

  /** A class's or interface's instance type, with every declaration of its name (interfaces merge). */
  private instanceOf(d: Decl): Type {
    const t = d.file.tree;
    const name = t.first[d.node]!;
    const symbol = d.file.bindings.symbol(name);
    const kinds = new Set([K.ClassDeclaration, K.InterfaceDeclaration]);
    const decls = (symbol?.declarations ?? [name]).map((x) => d.file.bindings.parent[x]!).filter((x) => kinds.has(t.kind[x]!));
    return { k: 'object', decls: (decls.length ? decls : [d.node]).map((node) => ({ file: d.file, node })), name: t.textOf(name) };
  }

  private membersOf(type: Extract<Type, { k: 'object' }>): Members {
    const key = type.decls.map((d) => `${d.file.path}:${d.node}`).join('|');
    let m = this.members.get(key);
    if (m) return m;
    m = { byName: new Map(), open: false };
    this.members.set(key, m); // before reading bases, so a cycle ends here
    for (const d of type.decls) this.collectMembers(d, m);
    return m;
  }

  private collectMembers(d: Decl, m: Members): void {
    const t = d.file.tree;
    for (const c of this.childrenOf(t, d.node)) {
      const kind = t.kind[c]!;
      if (kind === K.HeritageClause) {
        // `extends` adds the base's members; `implements` adds none.
        if (!t.textOf(c).startsWith('extends')) continue;
        for (const base of this.childrenOf(t, c)) {
          const expr = t.first[base]!;
          const type = t.kind[expr] === K.Identifier ? this.typeOfBase(d.file, expr) : UNKNOWN;
          if (type.k !== 'object') {
            m.open = true;
            continue;
          }
          const inherited = this.membersOf(type);
          if (inherited.open) m.open = true;
          for (const [name, decls] of inherited.byName) if (!m.byName.has(name)) m.byName.set(name, decls);
        }
        continue;
      }
      if (kind === K.IndexSignature || kind === K.CallSignature || kind === K.ConstructSignature) {
        if (kind === K.IndexSignature) m.open = true;
        continue;
      }
      const isMember = kind === K.PropertyDeclaration || kind === K.PropertySignature || kind === K.MethodDeclaration || kind === K.MethodSignature || kind === K.GetAccessor || kind === K.SetAccessor;
      if (!isMember || t.flags[c]! & F.Static) continue;
      const name = t.first[c]!;
      const nameKind = t.kind[name]!;
      let key: string;
      if (nameKind === K.Identifier) key = t.textOf(name);
      else if (nameKind === K.StringLiteral) key = t.textOf(name).slice(1, -1);
      else if (nameKind === K.PrivateIdentifier) continue;
      else {
        m.open = true; // a computed name: can't be known here
        continue;
      }
      const list = m.byName.get(key) ?? [];
      list.push({ file: d.file, node: c });
      m.byName.set(key, list);
    }
  }

  /** A heritage clause's base, by name: a class's or interface's instance type. */
  private typeOfBase(f: SourceInfo, name: number): Type {
    const decl = this.declarationOf(f, name);
    if (!decl) return UNKNOWN;
    return this.typeOfDecl(decl);
  }

  /** A member's type as read through `object.name`. */
  private memberType(object: Type, name: string): Type {
    if (object.k === 'namespace') {
      const d = this.exportOf(object.file, name, new Set());
      return d ? this.valueOfDecl(d) : UNKNOWN;
    }
    if (object.k === 'class') {
      // Static members.
      const t = object.decl.file.tree;
      const statics = this.childrenOf(t, object.decl.node).filter((c) => t.flags[c]! & F.Static && t.kind[t.first[c]!] === K.Identifier && t.textOf(t.first[c]!) === name);
      return statics.length ? this.memberOfDecls(statics.map((node) => ({ file: object.decl.file, node }))) : UNKNOWN;
    }
    if (object.k !== 'object') return UNKNOWN;
    const decls = this.membersOf(object).byName.get(name);
    return decls ? this.memberOfDecls(decls) : UNKNOWN;
  }

  private memberOfDecls(decls: readonly Decl[]): Type {
    const first = decls[0]!;
    const t = first.file.tree;
    const kind = t.kind[first.node]!;
    if (kind === K.MethodDeclaration || kind === K.MethodSignature) {
      // Overload signatures are the ones without a body (in a class); an interface's are all signatures.
      const sigs = decls.filter((d) => !this.childrenOf(d.file.tree, d.node).some((c) => d.file.tree.kind[c] === K.Block));
      return { k: 'function', signatures: sigs.length ? sigs : decls };
    }
    if (kind === K.PropertyDeclaration || kind === K.PropertySignature) {
      if (decls.length !== 1) return UNKNOWN;
      const type = this.childrenOf(t, first.node).slice(1).find((c) => isTypeNode(t.kind[c]!));
      return type ? this.typeOfNode(first.file, type) : UNKNOWN;
    }
    return UNKNOWN; // accessors: not modelled yet
  }

  /** A signature's return type, from its annotation. */
  private returnOf(sig: Decl): Type {
    const t = sig.file.tree;
    // The return type is the last child that is a type (parameters' types are inside them; a body is a Block).
    const type = this.childrenOf(t, sig.node).reverse().find((c) => t.kind[c] !== K.Block && t.kind[c] !== K.TypeParameter && isTypeNode(t.kind[c]!));
    if (!type) return UNKNOWN;
    if (t.flags[sig.node]! & F.Async) return UNKNOWN; // a Promise: the built-in types aren't modelled yet
    return this.typeOfNode(sig.file, type);
  }

  /** A class's constructor signatures, or undefined when they can't be known (an inherited constructor). */
  private constructorsOf(d: Decl): Decl[] | undefined {
    const t = d.file.tree;
    const parts = this.childrenOf(t, d.node);
    const ctors = parts.filter((c) => t.kind[c] === K.Constructor);
    if (!ctors.length) return parts.some((c) => t.kind[c] === K.HeritageClause && t.textOf(c).startsWith('extends')) ? undefined : [{ file: d.file, node: d.node }];
    const sigs = ctors.filter((c) => !this.childrenOf(t, c).some((x) => t.kind[x] === K.Block));
    return (sigs.length ? sigs : ctors).map((node) => ({ file: d.file, node }));
  }

  private childrenOf(t: Tree, n: number): number[] {
    return t.children(n);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Spelling suggestions, as tsc makes them (its `getSpellingSuggestion`): it reports 2551 with the closest member
// instead of 2339 when one is close enough.

/** The member tsc would suggest for a misspelt `name`, or undefined. */
export function spellingSuggestion(name: string, candidates: readonly string[]): string | undefined {
  const maxLengthDifference = Math.max(2, Math.floor(name.length * 0.34));
  let bestDistance = Math.floor(name.length * 0.4) + 1;
  let best: string | undefined;
  for (const candidate of candidates) {
    if (Math.abs(candidate.length - name.length) > maxLengthDifference || candidate === name) continue;
    // Candidates under 3 characters only when they differ by case alone.
    if (candidate.length < 3 && candidate.toLowerCase() !== name.toLowerCase()) continue;
    const distance = levenshteinWithMax(name, candidate, bestDistance - 0.1);
    if (distance === undefined) continue;
    bestDistance = distance;
    best = candidate;
  }
  return best;
}

function levenshteinWithMax(s1: string, s2: string, max: number): number | undefined {
  let previous: number[] = new Array(s2.length + 1);
  let current: number[] = new Array(s2.length + 1);
  const big = max + 0.01;
  for (let i = 0; i <= s2.length; i++) previous[i] = i;
  for (let i = 1; i <= s1.length; i++) {
    const c1 = s1.charCodeAt(i - 1);
    const minJ = Math.ceil(i > max ? i - max : 1);
    const maxJ = Math.floor(s2.length > max + i ? max + i : s2.length);
    current[0] = i;
    let colMin = i;
    for (let j = 1; j < minJ; j++) current[j] = big;
    for (let j = minJ; j <= maxJ; j++) {
      // A substitution that only changes case costs 0.1; any other, 2.
      const substitution = s1[i - 1]!.toLowerCase() === s2[j - 1]!.toLowerCase() ? previous[j - 1]! + 0.1 : previous[j - 1]! + 2;
      const dist = c1 === s2.charCodeAt(j - 1) ? previous[j - 1]! : Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution);
      current[j] = dist;
      colMin = Math.min(colMin, dist);
    }
    for (let j = maxJ + 1; j <= s2.length; j++) current[j] = big;
    if (colMin > max) return undefined;
    const temp = previous;
    previous = current;
    current = temp;
  }
  const res = previous[s2.length]!;
  return res > max ? undefined : res;
}
