// The checker (milestone 7, the checker trial): types for the calls user code makes into the libraries it imports
// (smaltts and smaltdf first), read from those libraries' declarations, and the errors tsc would report on them.
//
// The gradual guarantee (DESIGN.md, "Model: ty"): anything the checker doesn't model is unknown, and unknown is never
// an error. A type is modelled only where the declarations say exactly what it is: a class, an interface or a type
// literal whose members are all known (no index signature, no base it can't read), with its type arguments; an
// object literal; a mapped type over known keys; an intersection of those; or a function. Type arguments are inferred
// from a call's arguments, and arrow functions' parameters are typed by where they are passed, so a row callback's
// columns (smaltts's `Cols<Row>`) are known. Everything else (unions other than of string literals, conditional types,
// the built-in types) is unknown for now.
//
// What it reports, by tsc's codes, so the tests compare the two diagnostic for diagnostic:
// - 2339: a property that does not exist on a known type, and 2551 when tsc would suggest a member's name;
// - 2554 and 2555: a call or `new` with an argument count no parameter list accepts;
// - 2353, and 2561 with a suggestion: an object literal's property that the parameter's type doesn't have;
// - 2345: an argument whose type certainly can't be assigned to the parameter's, and 2322 for an object literal's
//   property whose value can't be assigned to the parameter type's property.
import { F, K, isTypeNode } from './kinds.js';
import { bind, type Bindings } from './binder.js';
import { parse } from './parser.js';
import type { Tree } from './tree.js';
import { BUILTINS, BUILTINS_PATH } from './builtins.js';
import { BUILTINS_PREPARED } from './builtins-prepared.js';
import { readPrepared, type PreparedFiles } from './prepared.js';

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
  /**
   * Modules whose exports are in scope everywhere, as globals (paths or `packages` names): what a page gives code it
   * runs, as `table` and `col` are in a tab that runs smaltdf. A name declared in a file comes first.
   */
  readonly globals?: readonly string[];
  /** False: keep the errors `// @ts-expect-error` and `// @ts-ignore` would silence (default true). */
  readonly suppress?: boolean;
  /**
   * Files parsed by earlier checks, kept for the next (from `checkCache()`): a re-check after an edit parses only the
   * files whose text changed. An editor keeps one per page.
   */
  readonly cache?: CheckCache;
  /**
   * Prepared declarations (prepare()'s buffer, or the files readPrepared() gives for it), read in place of parsing
   * those files' text: they are files of the check as `files` are, and the same path in `files` with other text is
   * read from its text. A buffer this smaltty can't read (another format or version, or one cut short) is ignored:
   * pass the files' text too where that can happen, or check with readPrepared() first.
   */
  readonly prepared?: PreparedFiles | ArrayBuffer | ArrayBufferView;
}

/** Parsed files kept between checks: a file's tree and names, by path, while its text is the same. */
export interface CheckCache {
  readonly files: Map<string, { readonly text: string; readonly info: SourceInfo | null }>;
  /** Whether a file's text has a module augmentation, by path, while its text is the same. */
  readonly augments: Map<string, { readonly text: string; readonly has: boolean }>;
}

/** A cache for `check()` and `expectations()` to keep parsed files in between calls. */
export function checkCache(): CheckCache {
  return { files: new Map(), augments: new Map() };
}

/** A `// @ts-expect-error` comment, and whether the checker finds an error on the line it covers. */
export interface Expectation {
  readonly file: string;
  /** The line (from 1) the comment covers. */
  readonly line: number;
  readonly found: boolean;
}

/** Each `// @ts-expect-error` in the roots, and whether the checker reports the error it expects. */
export function expectations(files: ReadonlyMap<string, string>, options: CheckOptions = {}): Expectation[] {
  const all = check(files, { ...options, suppress: false });
  const out: Expectation[] = [];
  for (const path of options.roots ?? [...files.keys()]) {
    const text = files.get(path) ?? '';
    const lines = text.split('\n');
    lines.forEach((l, i) => {
      if (!/^\s*\/\/\s*@ts-expect-error\b/.test(l)) return;
      out.push({ file: path, line: i + 2, found: all.some((d) => d.file === path && lineOf(text, d.start) === i + 1) });
    });
  }
  return out;
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

/** Type arguments: a type parameter (by `file:node`) to its type. */
type Env = ReadonlyMap<string, Type>;
const NO_ENV: Env = new Map();

/** A signature: a declaration with parameters, and the type arguments of the type it belongs to. */
interface Sig {
  readonly decl: Decl;
  readonly env: Env;
}

type Type =
  | { readonly k: 'unknown' }
  /** A primitive (its members are the built-in types', not modelled yet), of a kind when known. */
  | { readonly k: 'primitive'; readonly kind?: 'string' | 'number' | 'boolean' | 'bigint' | 'symbol' | 'null' | 'undefined' }
  /** `true` or `false`. */
  | { readonly k: 'bool'; readonly value: boolean }
  /** A union (not only of string literals); `never` is the union of nothing. */
  | { readonly k: 'union'; readonly parts: readonly Type[] }
  | { readonly k: 'array'; readonly element: Type }
  /** String literals: one (`'a'`) or a union of them (`'a' | 'b'`, `keyof T`). */
  | { readonly k: 'keys'; readonly names: ReadonlySet<string> }
  /** An object: a class instance, an interface or a type literal, with its type arguments. */
  | { readonly k: 'object'; readonly decls: readonly Decl[]; readonly name: string; readonly env: Env }
  /** Known properties: an object literal, or a mapped type evaluated. */
  | { readonly k: 'record'; readonly props: ReadonlyMap<string, () => Type>; readonly name: string }
  | { readonly k: 'intersection'; readonly parts: readonly Type[]; readonly name: string }
  /** A class as a value: what `new` makes, and its static members. */
  | { readonly k: 'class'; readonly decl: Decl }
  /** A function's signatures (more than one: overloads). */
  | { readonly k: 'function'; readonly signatures: readonly Sig[] }
  /** `import * as ns`: a module's exports. */
  | { readonly k: 'namespace'; readonly file: SourceInfo };

const UNKNOWN: Type = { k: 'unknown' };
const PRIMITIVE: Type = { k: 'primitive' };
const prim = (kind: NonNullable<Extract<Type, { k: 'primitive' }>['kind']>): Type => ({ k: 'primitive', kind });
const PRIMITIVE_OF: ReadonlyMap<number, Type> = new Map([
  [K.StringKeyword, prim('string')],
  [K.NumberKeyword, prim('number')],
  [K.BooleanKeyword, prim('boolean')],
  [K.BigIntKeyword, prim('bigint')],
  [K.SymbolKeyword, prim('symbol')],
  [K.UndefinedKeyword, prim('undefined')],
]);
/** Members a primitive has through its wrapper (String, Number, Boolean): an object type needing only these may take one. */
const PRIMITIVE_MEMBERS = new Set(['length', 'toString', 'toLocaleString', 'valueOf', 'toFixed', 'toExponential', 'toPrecision', 'charAt', 'charCodeAt', 'codePointAt', 'concat', 'includes', 'endsWith', 'indexOf', 'lastIndexOf', 'localeCompare', 'match', 'matchAll', 'normalize', 'padEnd', 'padStart', 'repeat', 'replace', 'replaceAll', 'search', 'slice', 'split', 'startsWith', 'substring', 'substr', 'toLowerCase', 'toUpperCase', 'toLocaleLowerCase', 'toLocaleUpperCase', 'trim', 'trimStart', 'trimEnd', 'at', 'isWellFormed', 'toWellFormed', 'anchor', 'big', 'blink', 'bold', 'fixed', 'fontcolor', 'fontsize', 'italics', 'link', 'small', 'strike', 'sub', 'sup', 'trimLeft', 'trimRight']);
const keys = (names: Iterable<string>): Type => ({ k: 'keys', names: new Set(names) });

/** What every object has from Object.prototype. */
const OBJECT_MEMBERS = new Set(['constructor', 'toString', 'toLocaleString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable']);

const PRIMITIVE_KINDS = new Set([K.StringKeyword, K.NumberKeyword, K.BooleanKeyword, K.BigIntKeyword, K.SymbolKeyword]);

/** A literal's type widened, as an array literal's elements are: `'a'` is a string, `true` a boolean. */
function widen(type: Type): Type {
  if (type.k === 'keys') return { k: 'primitive', kind: 'string' };
  if (type.k === 'bool') return { k: 'primitive', kind: 'boolean' };
  return type;
}

/** The same primitive kind (other types are never taken as the same). */
function sameType(a: Type, b: Type): boolean {
  return a.k === 'primitive' && b.k === 'primitive' && a.kind === b.kind && a.kind !== undefined;
}

/** A union, flattened; all string literals stay a set of keys. */
function union(parts: readonly Type[]): Type {
  const flat = parts.flatMap((p) => (p.k === 'union' ? p.parts : [p]));
  if (flat.length && flat.every((p) => p.k === 'keys')) return keys(flat.flatMap((p) => [...(p as Extract<Type, { k: 'keys' }>).names]));
  return flat.length === 1 ? flat[0]! : { k: 'union', parts: flat };
}

interface Members {
  /** Member name to its declarations. */
  readonly byName: Map<string, Decl[]>;
  /** Members can't all be known: an index signature, a computed name, a base the checker can't read. */
  open: boolean;
}

/** A type's properties, each typed on demand; `open` when they can't all be known. */
interface Props {
  readonly names: ReadonlyMap<string, () => Type>;
  readonly open: boolean;
}

interface SourceInfo {
  readonly path: string;
  readonly tree: Tree;
  readonly bindings: Bindings;
}

/** A call resolved: its signature, the type arguments inferred, and its type. */
interface Resolved {
  readonly sig: Sig | undefined;
  readonly env: Env;
  readonly type: Type;
}

const keyOf = (d: Decl): string => `${d.file.path}:${d.node}`;

// atob is in every page, worker and Node, and Uint8Array.fromBase64 in newer ones; the build's lib (es2023) declares
// neither.
declare const atob: (data: string) => string;
const fromBase64 = (Uint8Array as unknown as { fromBase64?: (data: string) => Uint8Array }).fromBase64;

/**
 * The built-in types, read once: their text never changes. From the buffer the build prepared for them where there is
 * one this smaltty reads (always, in a build), else parsed from their text.
 */
let builtinsInfo: SourceInfo | undefined;
function builtins(): SourceInfo {
  if (builtinsInfo) return builtinsInfo;
  if (BUILTINS_PREPARED !== undefined) {
    let bytes: Uint8Array;
    if (fromBase64) bytes = fromBase64(BUILTINS_PREPARED);
    else {
      const chars = atob(BUILTINS_PREPARED);
      bytes = new Uint8Array(chars.length);
      for (let i = 0; i < chars.length; i++) bytes[i] = chars.charCodeAt(i);
    }
    const entry = readPrepared(bytes)?.entries.get(BUILTINS_PATH);
    const info = entry !== undefined && entry.text() === BUILTINS ? entry.source() : null;
    if (info) return (builtinsInfo = info);
  }
  const tree = parse(BUILTINS, { fileName: BUILTINS_PATH });
  return (builtinsInfo = { path: BUILTINS_PATH, tree, bindings: bind(tree) });
}

class Checker {
  private readonly files: ReadonlyMap<string, string>;
  private readonly options: CheckOptions;
  private readonly sources = new Map<string, SourceInfo | null>();
  private readonly members = new Map<string, Members>();
  private readonly typing = new Set<string>();
  private readonly exprTypes = new Map<string, Type>();
  private readonly calls = new Map<string, Resolved>();
  /** Parameters of arrow functions typed by where they are passed (`file:node` to type). */
  private readonly contextual = new Map<string, Type>();
  private depth = 0;
  /** Module augmentations (`declare module './x.js' { interface X { … } }`): target file to its interfaces. */
  private augmentations: Map<string, Decl[]> | undefined;

  /** Prepared declarations, when given and readable. */
  private readonly prepared: PreparedFiles | undefined;

  constructor(files: ReadonlyMap<string, string>, options: CheckOptions) {
    this.files = files;
    this.options = options;
    this.prepared = options.prepared === undefined ? undefined : readPrepared(options.prepared);
  }

  /** A prepared file to read for `path`: one whose text, if `files` has the path too, is that text. */
  private preparedEntry(path: string) {
    const entry = this.prepared?.entries.get(path);
    if (entry === undefined) return undefined;
    const text = this.files.get(path);
    return text === undefined || text === entry.text() ? entry : undefined;
  }

  private source(path: string): SourceInfo | undefined {
    if (!this.sources.has(path)) {
      if (path === BUILTINS_PATH) {
        this.sources.set(path, builtins());
        return this.sources.get(path) ?? undefined;
      }
      const entry = this.preparedEntry(path);
      if (entry !== undefined) {
        this.sources.set(path, entry.source());
        return this.sources.get(path) ?? undefined;
      }
      const text = this.files.get(path);
      let info: SourceInfo | null = null;
      const cached = this.options.cache?.files.get(path);
      if (cached !== undefined && cached.text === text) info = cached.info;
      else if (text !== undefined) {
        try {
          const tree = parse(text, { fileName: path });
          info = { path, tree, bindings: bind(tree) };
        } catch {
          info = null; // a file that doesn't parse declares nothing the checker can use
        }
        this.options.cache?.files.set(path, { text, info });
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
    if (/^\s*\/\/\s*@ts-nocheck/m.test(t.text.slice(0, firstStatement(t)))) return out;
    t.walk(t.root, (n) => {
      const kind = t.kind[n]!;
      if (kind === K.PropertyAccessExpression) this.checkProperty(f, n, out);
      else if (kind === K.CallExpression || kind === K.NewExpression) this.checkCall(f, n, out);
    });
    // As tsc: `// @ts-expect-error` and `// @ts-ignore` silence the errors on the line after them.
    if (this.options.suppress === false) return out;
    const silenced = suppressedLines(t.text);
    return silenced.size ? out.filter((d) => !silenced.has(lineOf(t.text, d.start))) : out;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Checks.

  private checkProperty(f: SourceInfo, n: number, out: Diagnostic[]): void {
    const t = f.tree;
    const object = t.first[n]!;
    const name = t.next[object]!;
    if (t.kind[name] !== K.Identifier && t.kind[name] !== K.PrivateIdentifier) return;
    const type = this.typeOfExpr(f, object);
    const props = this.propsOf(type);
    if (!props || props.open) return;
    const key = t.textOf(name);
    if (props.names.has(key) || OBJECT_MEMBERS.has(key)) return;
    const start = t.start[name]!;
    const length = t.end[name]! - start;
    const shown = this.show(type);
    const suggestion = spellingSuggestion(key, [...props.names.keys()]);
    if (suggestion !== undefined) {
      out.push({ file: f.path, start, length, code: 2551, message: `Property '${key}' does not exist on type '${shown}'. Did you mean '${suggestion}'?` });
    } else {
      out.push({ file: f.path, start, length, code: 2339, message: `Property '${key}' does not exist on type '${shown}'.` });
    }
  }

  private checkCall(f: SourceInfo, n: number, out: Diagnostic[]): void {
    const t = f.tree;
    const callee = t.first[n]!;
    const args = this.argumentsOf(t, n);
    if (args === undefined) return;
    let signatures: readonly Sig[];
    if (t.kind[n] === K.NewExpression) {
      const type = this.typeOfExpr(f, callee);
      if (type.k !== 'class') return;
      const ctors = this.constructorsOf(type.decl);
      if (ctors === undefined) return;
      signatures = ctors.map((decl) => ({ decl, env: NO_ENV }));
    } else {
      const type = this.typeOfExpr(f, callee);
      if (type.k !== 'function') return;
      signatures = type.signatures;
    }
    if (signatures.length !== 1) return; // overloads: tsc's errors there are about overload resolution
    const arity = this.arityOf(signatures[0]!.decl);
    if (!arity) return;
    const got = args.length;
    if (got >= arity.min && (arity.max === null || got <= arity.max)) {
      const env = t.kind[n] === K.CallExpression ? this.resolveCall(f, n).env : NO_ENV;
      this.checkArguments(signatures[0]!, env, f, args, out);
      return;
    }
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

  /** A signature's parameters (not `this`). */
  private paramsOf(sig: Decl): number[] {
    const t = sig.file.tree;
    return this.childrenOf(t, sig.node).filter((c) => t.kind[c] === K.Parameter && !(t.kind[t.first[c]!] === K.Identifier && t.textOf(t.first[c]!) === 'this'));
  }

  /** A parameter's (or property's) type annotation. */
  private annotationOf(t: Tree, n: number): number | undefined {
    return this.childrenOf(t, n).slice(1).find((c) => isTypeNode(t.kind[c]!));
  }

  /**
   * Each argument against its parameter, in order, as tsc does, reporting the first that fails: an object literal's
   * excess property (2353, or 2561 with a suggestion), or an argument whose type can't be assigned to the parameter's
   * (2345). Only a certain failure is reported; arrow functions are not checked yet.
   */
  private checkArguments(sig: Sig, env: Env, f: SourceInfo, args: readonly number[], out: Diagnostic[]): void {
    const st = sig.decl.file.tree;
    const t = f.tree;
    const params = this.paramsOf(sig.decl);
    const own = this.typeParamsOf(sig.decl);
    for (const [i, arg] of args.entries()) {
      const param = params[Math.min(i, params.length - 1)];
      if (param === undefined) return;
      const rest = (st.flags[param]! & F.Rest) !== 0;
      if (!rest && i >= params.length) return;
      const typeNode = this.annotationOf(st, param);
      if (typeNode === undefined) continue;
      // A parameter typed by the signature's own type parameter takes the argument's type.
      if (st.kind[typeNode] === K.TypeReference) {
        const d = this.declarationOf(sig.decl.file, st.first[typeNode]!);
        if (d && own.has(keyOf(d))) continue;
      }
      let target = this.typeOfNode(sig.decl.file, typeNode, env);
      if (rest) {
        if (target.k !== 'array') return;
        target = target.element;
      }
      const kind = t.kind[arg]!;
      if (kind === K.ArrowFunction || kind === K.FunctionExpression) continue;
      if (kind === K.ObjectLiteralExpression) {
        // Values whose types come from the signature's own type parameters depend on inference the checker may not
        // follow all the way: only the keys are checked there.
        const d = this.excessProperty(f, arg, target, !this.mentions(sig.decl.file, typeNode, own));
        if (d) {
          out.push(d);
          return;
        }
        continue;
      }
      const type = this.typeOfExpr(f, arg);
      if (this.assignable(type, target) === 'no') {
        const start = t.start[arg]!;
        // The parameter's type as written (tsc keeps aliases: `Arg<number>`), or its type when written as a type
        // parameter the call has a type for (`K` of a `Map<string, number>` is `string`).
        const written = st.textOf(typeNode);
        const param = st.kind[typeNode] === K.TypeReference ? this.declarationOf(sig.decl.file, st.first[typeNode]!) : undefined;
        const shown = rest || (param && st.kind[param.node] === K.TypeParameter && this.plain(target)) ? this.show(target) : written;
        // As tsc: a literal argument is written widened (`string`) unless the parameter's type has literals itself.
        const literal = (x: Type): boolean => x.k === 'keys' || x.k === 'bool' || (x.k === 'union' && x.parts.some(literal));
        const argument = literal(target) ? type : widen(type);
        out.push({ file: f.path, start, length: t.end[arg]! - start, code: 2345, message: `Argument of type '${this.show(argument)}' is not assignable to parameter of type '${shown}'.` });
        return;
      }
    }
  }

  /**
   * Whether a value of type `from` can be assigned to `to`: 'no' only when it certainly can't (the error tsc
   * reports), 'maybe' where the checker doesn't know enough to say.
   */
  private assignable(from: Type, to: Type, nested = false): 'yes' | 'no' | 'maybe' {
    if (from.k === 'unknown' || to.k === 'unknown') return 'maybe';
    if (from.k === 'union') {
      const each = from.parts.map((p) => this.assignable(p, to, nested));
      if (each.every((e) => e === 'yes')) return 'yes';
      // A value of a union type may be narrowed where it is read (`typeof v === 'string'`), which the checker doesn't
      // follow, so there it can't tell. A union inside a type argument isn't narrowed: one member that fails is enough.
      return nested && each.includes('no') ? 'no' : 'maybe';
    }
    if (to.k === 'union') {
      // `boolean` is `true | false`.
      if (from.k === 'primitive' && from.kind === 'boolean' && to.parts.some((p) => p.k === 'bool' && p.value) && to.parts.some((p) => p.k === 'bool' && !p.value)) return 'yes';
      const each = to.parts.map((p) => this.assignable(from, p, nested));
      return each.includes('yes') ? 'yes' : each.every((e) => e === 'no') ? 'no' : 'maybe';
    }
    const scalar = from.k === 'primitive' || from.k === 'keys' || from.k === 'bool';
    if (scalar) {
      const fromKind = from.k === 'keys' ? 'string' : from.k === 'bool' ? 'boolean' : from.kind;
      if (fromKind === undefined) return 'maybe';
      switch (to.k) {
        case 'primitive':
          if (to.kind === undefined) return 'maybe';
          return to.kind === fromKind ? 'yes' : 'no';
        case 'keys':
          if (from.k === 'keys') return [...from.names].every((n) => to.names.has(n)) ? 'yes' : 'no';
          return 'no';
        case 'bool':
          if (from.k === 'bool') return from.value === to.value ? 'yes' : 'no';
          return 'no';
        case 'array':
        case 'function':
          return 'no';
        case 'object': {
          // A primitive fits an object type only through its wrapper's members.
          if (fromKind === 'null' || fromKind === 'undefined') return 'no';
          const props = this.propsOf(to);
          if (!props || props.open || !to.decls.every((d) => d.file.tree.kind[d.node] === K.ClassDeclaration)) return 'maybe';
          return [...props.names.keys()].some((n) => !PRIMITIVE_MEMBERS.has(n)) ? 'no' : 'maybe';
        }
        default:
          return 'maybe';
      }
    }
    // Two instances of one class or interface: compared by their type arguments, where a type parameter is a
    // property's whole type (so it is at least covariant, as tsc measures variance).
    if (from.k === 'object' && to.k === 'object') {
      const d = to.decls[0]!;
      if (!from.decls.some((x) => x.file === d.file && x.node === d.node)) return 'maybe';
      const t = d.file.tree;
      let result: 'yes' | 'no' | 'maybe' = 'yes';
      for (const tp of this.childrenOf(t, d.node).filter((c) => t.kind[c] === K.TypeParameter)) {
        const key = `${d.file.path}:${tp}`;
        const r = this.assignable(from.env.get(key) ?? UNKNOWN, to.env.get(key) ?? UNKNOWN, true);
        if (r === 'yes') continue;
        if (r === 'no' && this.covariant(d, tp)) return 'no';
        result = 'maybe';
      }
      return result;
    }
    if (from.k === 'array' && to.k === 'array') return this.assignable(from.element, to.element, true);
    // An object, array or function where a primitive is wanted.
    if ((from.k === 'object' || from.k === 'record' || from.k === 'array' || from.k === 'function') && (to.k === 'keys' || to.k === 'bool' || (to.k === 'primitive' && to.kind !== undefined))) return 'no';
    return 'maybe';
  }

  /** Whether a type node refers to any of the type parameters `own` (by key). */
  private mentions(f: SourceInfo, node: number, own: ReadonlySet<string>): boolean {
    if (!own.size) return false;
    const t = f.tree;
    let found = false;
    const visit = (n: number) => {
      if (found) return;
      if (t.kind[n] === K.TypeReference && t.kind[t.first[n]!] === K.Identifier) {
        const d = this.declarationOf(f, t.first[n]!);
        if (d && own.has(keyOf(d))) found = true;
      }
    };
    visit(node);
    t.walk(node, visit);
    return found;
  }

  /** Whether a class's or interface's type parameter is some property's whole type (`$type: T`). */
  private covariant(d: Decl, tp: number): boolean {
    const t = d.file.tree;
    const name = t.textOf(t.first[tp]!);
    return this.childrenOf(t, d.node).some((m) => {
      const kind = t.kind[m];
      if (kind !== K.PropertyDeclaration && kind !== K.PropertySignature) return false;
      const type = this.annotationOf(t, m);
      return type !== undefined && t.kind[type] === K.TypeReference && this.childrenOf(t, type).length === 1 && t.textOf(type) === name;
    });
  }

  /** A type as tsc would write it, as far as the checker can. */
  private show(type: Type): string {
    switch (type.k) {
      case 'keys':
        return [...type.names].map((n) => JSON.stringify(n)).join(' | ');
      case 'bool':
        return String(type.value);
      case 'primitive':
        return type.kind ?? 'unknown';
      case 'union':
        return type.parts.map((p) => this.show(p)).join(' | ') || 'never';
      case 'array': {
        const element = this.show(type.element);
        return type.element.k === 'union' ? `(${element})[]` : `${element}[]`;
      }
      case 'object': {
        // A generic class or interface with its type arguments, as tsc writes them (`Map<string, number>`), where each
        // can be written plainly; otherwise its name alone.
        const d = type.decls[0];
        if (!d) return type.name;
        const t = d.file.tree;
        const params = this.childrenOf(t, d.node).filter((c) => t.kind[c] === K.TypeParameter);
        if (!params.length) return type.name;
        const args = params.map((p) => type.env.get(`${d.file.path}:${p}`));
        if (args.some((a) => a === undefined || !this.plain(a))) return type.name;
        return `${type.name}<${args.map((a) => this.show(a!)).join(', ')}>`;
      }
      default:
        return this.nameOf(type);
    }
  }

  /** A type `show` writes as tsc does: primitives, literals, arrays and unions of them, and plain generic instances. */
  private plain(type: Type, depth = 0): boolean {
    if (depth > 4) return false;
    switch (type.k) {
      case 'keys':
      case 'bool':
        return true;
      case 'primitive':
        return type.kind !== undefined;
      case 'array':
        return this.plain(type.element, depth + 1);
      case 'union':
        return type.parts.length > 0 && type.parts.every((p) => this.plain(p, depth + 1));
      case 'object': {
        const d = type.decls[0];
        if (!d) return false;
        const t = d.file.tree;
        const params = this.childrenOf(t, d.node).filter((c) => t.kind[c] === K.TypeParameter);
        return params.every((p) => {
          const a = type.env.get(`${d.file.path}:${p}`);
          return a !== undefined && this.plain(a, depth + 1);
        });
      }
      default:
        return false;
    }
  }

  /**
   * A conditional type, where it can be decided: distributed over a union when the checked type is a type parameter,
   * with `infer` binding a class's or interface's type arguments.
   */
  private conditional(f: SourceInfo, n: number, env: Env): Type {
    const t = f.tree;
    const [check, ext, yes, no] = this.childrenOf(t, n);
    const checked = this.typeOfNode(f, check!, env);
    const checkDecl = t.kind[check!] === K.TypeReference ? this.declarationOf(f, t.first[check!]!) : undefined;
    const naked = checkDecl !== undefined && t.kind[checkDecl.node] === K.TypeParameter;
    const decide = (type: Type): Type => {
      const infers = new Map<string, Type>();
      const m = this.matches(f, type, ext!, env, infers);
      if (m === 'maybe') return UNKNOWN;
      const branchEnv = new Map(env);
      for (const [k, v] of infers) branchEnv.set(k, v);
      return this.typeOfNode(f, m === 'yes' ? yes! : no!, naked ? branchEnv.set(keyOf(checkDecl), type) : branchEnv);
    };
    if (naked && checked.k === 'union') {
      const parts = checked.parts.map(decide);
      return parts.some((p) => p.k === 'unknown') ? UNKNOWN : union(parts);
    }
    if (naked && checked.k === 'keys' && checked.names.size > 1) {
      const parts = [...checked.names].map((name) => decide(keys([name])));
      return parts.some((p) => p.k === 'unknown') ? UNKNOWN : union(parts);
    }
    return decide(checked);
  }

  /** Whether `type` extends the type node `ext`, binding the `infer` names in it. */
  private matches(f: SourceInfo, type: Type, ext: number, env: Env, infers: Map<string, Type>): 'yes' | 'no' | 'maybe' {
    const t = f.tree;
    if (type.k === 'unknown') return 'maybe';
    if (t.kind[ext] === K.InferType) {
      infers.set(`${f.path}:${t.first[ext]!}`, type);
      return 'yes';
    }
    if (t.kind[ext] === K.TypeReference && t.kind[t.first[ext]!] === K.Identifier) {
      const argNodes = this.childrenOf(t, ext).slice(1);
      if (argNodes.some((a) => t.kind[a] === K.InferType)) {
        const d = this.declarationOf(f, t.first[ext]!);
        const target = d ? this.targetOf(d) : undefined;
        if (!target) return 'maybe';
        const tt = target.file.tree;
        if (type.k !== 'object') return type.k === 'primitive' || type.k === 'keys' || type.k === 'bool' ? 'no' : 'maybe';
        if (!type.decls.some((x) => x.file === target.file && x.node === target.node)) return 'maybe';
        const params = this.childrenOf(tt, target.node).filter((c) => tt.kind[c] === K.TypeParameter);
        let result: 'yes' | 'no' | 'maybe' = 'yes';
        params.forEach((p, i) => {
          const a = argNodes[i];
          const actual = type.env.get(`${target.file.path}:${p}`) ?? UNKNOWN;
          if (a === undefined) return;
          if (t.kind[a] === K.InferType) {
            infers.set(`${f.path}:${t.first[a]!}`, actual);
            return;
          }
          const r = this.assignable(actual, this.typeOfNode(f, a, env));
          if (r === 'no') result = 'no';
          else if (r === 'maybe' && result === 'yes') result = 'maybe';
        });
        return result;
      }
    }
    return this.assignable(type, this.typeOfNode(f, ext, env));
  }

  /** The first property of an object literal that `target` doesn't have, nested literals included. */
  private excessProperty(f: SourceInfo, literal: number, target: Type, values = true): Diagnostic | undefined {
    if (target.k !== 'object' && target.k !== 'record' && target.k !== 'intersection') return undefined;
    const t = f.tree;
    const props = this.propsOf(target);
    if (!props || props.open) return undefined;
    const children = this.childrenOf(t, literal);
    // A spread or a computed name: which properties the literal has isn't known here.
    if (children.some((p) => t.kind[p] === K.SpreadAssignment || t.kind[t.first[p]!] === K.ComputedPropertyName)) return undefined;
    const nested: [number, Type][] = [];
    for (const p of children) {
      const name = t.first[p]!;
      const nameKind = t.kind[name]!;
      if (nameKind !== K.Identifier && nameKind !== K.StringLiteral) return undefined;
      const key = nameKind === K.StringLiteral ? t.textOf(name).slice(1, -1) : t.textOf(name);
      const member = props.names.get(key);
      if (!member) {
        if (OBJECT_MEMBERS.has(key)) return undefined;
        const start = t.start[name]!;
        const length = t.end[name]! - start;
        const shown = this.show(target);
        const suggestion = spellingSuggestion(key, [...props.names.keys()]);
        return suggestion !== undefined
          ? { file: f.path, start, length, code: 2561, message: `Object literal may only specify known properties, but '${key}' does not exist in type '${shown}'. Did you mean to write '${suggestion}'?` }
          : { file: f.path, start, length, code: 2353, message: `Object literal may only specify known properties, and '${key}' does not exist in type '${shown}'.` };
      }
      if (t.kind[p] === K.PropertyAssignment) {
        const value = t.next[name]!;
        if (t.kind[value] === K.ObjectLiteralExpression) nested.push([value, member()]);
      }
    }
    for (const [value, type] of nested) {
      const d = this.excessProperty(f, value, type, values);
      if (d) return d;
    }
    if (!values) return undefined;
    // No excess property: each property's value against the target's, in the target's order, as tsc compares them
    // (2322 at the property). Nested literals were compared above.
    const byName = new Map<string, number>();
    for (const p of children) if (t.kind[p] === K.PropertyAssignment) byName.set(t.textOf(t.first[p]!).replace(/^['"]|['"]$/g, ''), p);
    for (const [key, member] of props.names) {
      const p = byName.get(key);
      if (p === undefined) continue;
      const value = t.next[t.first[p]!]!;
      if (t.kind[value] === K.ObjectLiteralExpression || t.kind[value] === K.ArrowFunction || t.kind[value] === K.FunctionExpression) continue;
      const from = this.typeOfExpr(f, value);
      const to = member();
      if (this.assignable(from, to) === 'no') {
        const name = t.first[p]!;
        const start = t.start[name]!;
        return { file: f.path, start, length: t.end[name]! - start, code: 2322, message: `Type '${this.show(from)}' is not assignable to type '${this.show(to)}'.` };
      }
    }
    return undefined;
  }

  /** How many arguments a signature takes, or undefined when it can't be told. */
  private arityOf(sig: Decl): { min: number; max: number | null } | undefined {
    const t = sig.file.tree;
    let min = 0;
    let max: number | null = 0;
    let optional = false;
    for (const c of this.paramsOf(sig)) {
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
    const key = `${f.path}:${n}`;
    const known = this.exprTypes.get(key);
    if (known) return known;
    if (this.typing.has(key)) return UNKNOWN;
    this.typing.add(key);
    try {
      const type = this.typeOfExprInner(f, n);
      this.exprTypes.set(key, type);
      return type;
    } finally {
      this.typing.delete(key);
    }
  }

  private typeOfExprInner(f: SourceInfo, n: number): Type {
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
        return type ? this.typeOfNode(f, type, NO_ENV) : UNKNOWN;
      }
      case K.CallExpression:
        return this.resolveCall(f, n).type;
      case K.ThisKeyword:
        return this.typeOfThis(f, n);
      case K.NewExpression: {
        const callee = t.first[n]!;
        // A built-in class (`new Map<string, number>()`), with its explicit type arguments.
        if (t.kind[callee] === K.Identifier && !this.declarationOf(f, callee)) {
          const args = this.childrenOf(t, n).slice(1).filter((c) => isTypeNode(t.kind[c]!)).map((c) => this.typeOfNode(f, c, NO_ENV));
          const name = t.textOf(callee);
          return name === 'Array' ? { k: 'array', element: args[0] ?? UNKNOWN } : this.builtinDecl(name) ? this.builtin(name, args) : UNKNOWN;
        }
        const type = this.typeOfExpr(f, callee);
        return type.k === 'class' ? this.instanceOf(type.decl, []) : UNKNOWN;
      }
      case K.ArrayLiteralExpression: {
        // As tsc: the elements' types, widened (a string literal is a string), or unknown with a spread or none.
        const elements = this.childrenOf(t, n);
        if (!elements.length || elements.some((e) => t.kind[e] === K.SpreadElement || t.kind[e] === K.OmittedExpression)) return { k: 'array', element: UNKNOWN };
        // tsc keeps literal types where the array has a contextual type (an argument, a property value, an annotated
        // variable), and widens them where it hasn't (a plain variable, a method's receiver).
        const parent = f.bindings.parent[n]!;
        const pk = t.kind[parent];
        const free = (pk === K.VariableDeclaration && !this.annotationOf(t, parent)) || (pk === K.PropertyAccessExpression && t.first[parent] === n);
        const types = elements.map((e) => (free ? widen(this.typeOfExpr(f, e)) : this.typeOfExpr(f, e)));
        const distinct = types.filter((x, i) => types.findIndex((y) => sameType(x, y)) === i);
        return { k: 'array', element: distinct.length === 1 ? distinct[0]! : union(distinct) };

      }
      case K.AwaitExpression: {
        const type = this.typeOfExpr(f, t.first[n]!);
        if (type.k === 'object' && type.decls.some((d) => d.file.path === BUILTINS_PATH && d.file.tree.textOf(d.file.tree.first[d.node]!) === 'Promise')) {
          const p = this.builtinDecl('Promise')!;
          const tp = this.childrenOf(p.file.tree, p.node).find((c) => p.file.tree.kind[c] === K.TypeParameter)!;
          return type.env.get(`${p.file.path}:${tp}`) ?? UNKNOWN;
        }
        return type.k === 'primitive' || type.k === 'keys' || type.k === 'bool' || type.k === 'array' || type.k === 'record' ? type : UNKNOWN;
      }
      case K.PropertyAccessExpression: {
        const object = this.typeOfExpr(f, t.first[n]!);
        const name = t.next[t.first[n]!]!;
        if (t.kind[name] !== K.Identifier && t.kind[name] !== K.PrivateIdentifier) return UNKNOWN;
        return this.memberType(object, t.textOf(name));
      }
      case K.ArrowFunction:
      case K.FunctionExpression:
        // Its own node is its signature: parameters, then the return annotation, if any.
        return { k: 'function', signatures: [{ decl: { file: f, node: n }, env: NO_ENV }] };
      case K.ObjectLiteralExpression:
        return this.objectLiteral(f, n);
      case K.StringLiteral:
      case K.NoSubstitutionTemplateLiteral:
        return keys([t.textOf(n).slice(1, -1)]);
      case K.NumericLiteral:
        return prim('number');
      case K.TemplateExpression:
        return prim('string');
      case K.BigIntLiteral:
        return prim('bigint');
      case K.TrueKeyword:
        return { k: 'bool', value: true };
      case K.FalseKeyword:
        return { k: 'bool', value: false };
      case K.NullKeyword:
        return prim('null');
      default:
        return UNKNOWN;
    }
  }

  /**
   * `this`: a class's instance in its methods, constructor, property initializers and accessors (arrow functions keep
   * it); unknown in other functions, static members and object literals' methods.
   */
  private typeOfThis(f: SourceInfo, n: number): Type {
    const t = f.tree;
    const b = f.bindings;
    for (let p = b.parent[n]!; p; p = b.parent[p]!) {
      const kind = t.kind[p]!;
      if (kind === K.FunctionExpression || kind === K.FunctionDeclaration) return UNKNOWN;
      const member = kind === K.MethodDeclaration || kind === K.Constructor || kind === K.PropertyDeclaration || kind === K.GetAccessor || kind === K.SetAccessor;
      if (!member) continue;
      const owner = b.parent[p]!;
      if (t.kind[owner] !== K.ClassDeclaration || t.flags[p]! & F.Static) return UNKNOWN;
      const type = this.instanceOf({ file: f, node: owner }, []);
      // Its own type parameters stand for themselves: unknown inside the class.
      return type;
    }
    return UNKNOWN;
  }

  /** An object literal's properties, or unknown with a spread or a computed name. */
  private objectLiteral(f: SourceInfo, n: number): Type {
    const t = f.tree;
    const props = new Map<string, () => Type>();
    for (const p of this.childrenOf(t, n)) {
      const name = t.first[p]!;
      const kind = t.kind[p]!;
      if (kind === K.SpreadAssignment || t.kind[name] === K.ComputedPropertyName) return UNKNOWN;
      const key = t.kind[name] === K.StringLiteral ? t.textOf(name).slice(1, -1) : t.textOf(name);
      if (kind === K.PropertyAssignment) props.set(key, () => this.typeOfExpr(f, t.next[name]!));
      else if (kind === K.ShorthandPropertyAssignment) props.set(key, () => this.valueOfName(f, name));
      else if (kind === K.MethodDeclaration) props.set(key, () => ({ k: 'function', signatures: [{ decl: { file: f, node: p }, env: NO_ENV }] }));
      else props.set(key, () => UNKNOWN); // accessors
    }
    return { k: 'record', props, name: t.textOf(n).replace(/\s+/g, ' ') };
  }

  /** The type of a value a name refers to. */
  private valueOfName(f: SourceInfo, name: number): Type {
    const decl = this.declarationOf(f, name);
    if (decl) return this.valueOfDecl(decl);
    if (f.path === BUILTINS_PATH) return UNKNOWN;
    const global = this.globalDecl(f.tree.textOf(name));
    return global ? this.valueOfDecl(global) : this.builtinValue(f.tree.textOf(name));
  }

  /** A name the `globals` modules export, by name: its declaration, re-exports followed. */
  private globalDecl(name: string): Decl | undefined {
    for (const spec of this.options.globals ?? []) {
      const path = this.options.packages?.[spec] ?? spec;
      const g = this.source(path);
      const found = g ? this.exportOf(g, name, new Set()) : undefined;
      if (found) return this.targetOf(found);
    }
    return undefined;
  }

  /** The declaration node an Identifier refers to, in its own file. */
  private declarationOf(f: SourceInfo, name: number): Decl | undefined {
    const at = f.bindings.declaration(name);
    if (!at) return undefined;
    const node = f.bindings.parent[at]!;
    return { file: f, node: node || at };
  }

  private valueOfDecl(d: Decl): Type {
    const key = `value:${keyOf(d)}`;
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
        return { k: 'function', signatures: this.overloads(d).map((decl) => ({ decl, env: NO_ENV })) };
      case K.VariableDeclaration:
      case K.Parameter: {
        const parts = this.childrenOf(t, d.node);
        if (t.kind[parts[0]!] !== K.Identifier) return UNKNOWN; // a destructuring pattern
        const type = parts.slice(1).find((c) => isTypeNode(t.kind[c]!));
        if (type) return this.typeOfNode(d.file, type, NO_ENV);
        if (t.kind[d.node] === K.Parameter) return this.contextualParameter(d);
        // A `const` takes its initializer's type; `let` and `var` would widen literals (primitives here anyway).
        const init = parts.slice(1).find((c) => !isTypeNode(t.kind[c]!));
        return init ? this.typeOfExpr(d.file, init) : UNKNOWN;
      }
      case K.ImportSpecifier:
      case K.ImportClause:
      case K.NamespaceImport:
        return this.imported(d, 'value', []);
      default:
        return UNKNOWN;
    }
  }

  /**
   * An arrow function's parameter without an annotation, typed by where the function is passed: the parameter type
   * of the call it is an argument of (resolving that call records it).
   */
  private contextualParameter(d: Decl): Type {
    const key = keyOf(d);
    const known = this.contextual.get(key);
    if (known) return known;
    const b = d.file.bindings;
    const t = d.file.tree;
    const fn = b.parent[d.node]!;
    if (t.kind[fn] !== K.ArrowFunction && t.kind[fn] !== K.FunctionExpression) return UNKNOWN;
    let at = fn;
    let call = b.parent[at]!;
    while (t.kind[call] === K.ParenthesizedExpression) {
      at = call;
      call = b.parent[call]!;
    }
    if (t.kind[call] !== K.CallExpression || t.first[call] === at) return UNKNOWN;
    this.resolveCall(d.file, call);
    return this.contextual.get(key) ?? UNKNOWN;
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
  // Calls: the signature, the type arguments inferred from the arguments, and the arrow functions' parameters typed.

  private resolveCall(f: SourceInfo, call: number): Resolved {
    const key = `${f.path}:${call}`;
    const known = this.calls.get(key);
    if (known) return known;
    const none: Resolved = { sig: undefined, env: NO_ENV, type: UNKNOWN };
    if (this.typing.has(`call:${key}`)) return none;
    this.typing.add(`call:${key}`);
    try {
      const r = this.resolveCallInner(f, call) ?? none;
      this.calls.set(key, r);
      return r;
    } finally {
      this.typing.delete(`call:${key}`);
    }
  }

  private resolveCallInner(f: SourceInfo, call: number): Resolved | undefined {
    const t = f.tree;
    const callee = this.typeOfExpr(f, t.first[call]!);
    if (callee.k !== 'function') return undefined;
    const args = this.argumentsOf(t, call);
    if (!args) return undefined;
    const sig = callee.signatures.length === 1 ? callee.signatures[0]! : this.chooseOverload(f, callee.signatures, args);
    if (!sig) return undefined;
    const st = sig.decl.file.tree;
    const params = this.paramsOf(sig.decl);
    const vars = this.typeParamsOf(sig.decl);
    const inferred = new Map<string, Type>();
    const isFunction = (a: number) => t.kind[a] === K.ArrowFunction || t.kind[a] === K.FunctionExpression;
    // Arguments that aren't functions first, then functions, as tsc infers from context-sensitive arguments last.
    for (const [i, arg] of args.entries()) {
      const param = params[i];
      if (param === undefined || st.flags[param]! & F.Rest || isFunction(arg)) continue;
      const node = this.annotationOf(st, param);
      if (node !== undefined) this.unify(sig.decl.file, node, this.typeOfExpr(f, arg), vars, inferred);
    }
    let env = this.withInferred(sig, vars, inferred);
    for (const [i, arg] of args.entries()) {
      const param = params[i];
      if (param === undefined || st.flags[param]! & F.Rest || !isFunction(arg)) continue;
      let node = this.annotationOf(st, param);
      while (node !== undefined && st.kind[node] === K.ParenthesizedType) node = st.first[node]!;
      if (node === undefined || st.kind[node] !== K.FunctionType) continue;
      const expected = this.paramsOf({ file: sig.decl.file, node });
      for (const [j, p] of this.paramsOf({ file: f, node: arg }).entries()) {
        const e = expected[j];
        if (e === undefined || this.annotationOf(t, p) !== undefined || t.kind[t.first[p]!] !== K.Identifier) continue;
        const type = this.annotationOf(st, e);
        if (type !== undefined) this.contextual.set(`${f.path}:${p}`, this.typeOfNode(sig.decl.file, type, env));
      }
      // The return type: an expression body's type, unified with the expected function's return type.
      const body = t.children(arg).at(-1)!;
      const ret = this.returnNodeOf({ file: sig.decl.file, node });
      if (ret !== undefined && t.kind[body] !== K.Block && !isTypeNode(t.kind[body]!)) {
        this.unify(sig.decl.file, ret, this.typeOfExpr(f, body), vars, inferred);
        env = this.withInferred(sig, vars, inferred);
      }
    }
    return { sig, env, type: this.returnOf({ decl: sig.decl, env }) };
  }

  /** The signature's env with its own type parameters: inferred, else their defaults, else unknown. */
  private withInferred(sig: Sig, vars: ReadonlySet<string>, inferred: ReadonlyMap<string, Type>): Env {
    const env = new Map(sig.env);
    const t = sig.decl.file.tree;
    for (const tp of this.childrenOf(t, sig.decl.node).filter((c) => t.kind[c] === K.TypeParameter)) {
      const key = `${sig.decl.file.path}:${tp}`;
      if (!vars.has(key)) continue;
      const def = this.defaultOf(t, tp);
      env.set(key, inferred.get(key) ?? (def !== undefined ? this.typeOfNode(sig.decl.file, def, env) : UNKNOWN));
    }
    return env;
  }

  /** A signature's (or class's, alias's) own type parameters, by key. */
  private typeParamsOf(d: Decl): Set<string> {
    const t = d.file.tree;
    return new Set(this.childrenOf(t, d.node).filter((c) => t.kind[c] === K.TypeParameter).map((c) => `${d.file.path}:${c}`));
  }

  /** A type parameter's default (`T = X`), or undefined. */
  private defaultOf(t: Tree, tp: number): number | undefined {
    const types = this.childrenOf(t, tp).slice(1);
    if (!types.length) return undefined;
    // A constraint and a default; or one of them, told apart by the `=` before it.
    if (types.length === 2) return types[1];
    const before = t.text.slice(t.end[t.first[tp]!]!, t.start[types[0]!]!);
    return before.includes('=') ? types[0] : undefined;
  }

  /** The first overload whose parameters could take the arguments, when it is the only one. */
  private chooseOverload(f: SourceInfo, sigs: readonly Sig[], args: readonly number[]): Sig | undefined {
    const fits = sigs.filter((sig) => {
      const arity = this.arityOf(sig.decl);
      if (!arity || args.length < arity.min || (arity.max !== null && args.length > arity.max)) return false;
      const st = sig.decl.file.tree;
      const params = this.paramsOf(sig.decl);
      return args.every((arg, i) => {
        const p = params[i];
        const node = p === undefined ? undefined : this.annotationOf(st, p);
        if (node === undefined) return true;
        const a = this.typeOfExpr(f, arg);
        const objectLike = a.k === 'object' || a.k === 'record' || a.k === 'intersection' || a.k === 'function';
        if (PRIMITIVE_KINDS.has(st.kind[node]!)) return !objectLike;
        if (st.kind[node] === K.TypeReference) {
          const d = this.declarationOf(sig.decl.file, st.first[node]!);
          const target = d ? this.targetOf(d) : undefined;
          const declares = target && (target.file.tree.kind[target.node] === K.ClassDeclaration || target.file.tree.kind[target.node] === K.InterfaceDeclaration);
          if (declares) return a.k !== 'primitive' && a.k !== 'keys';
        }
        return true;
      });
    });
    return fits.length === 1 ? fits[0] : undefined;
  }

  /**
   * Infer the type parameters in `vars` from a parameter type (`node`, in `file`) and an argument's type: a type
   * parameter takes the argument's type; a class or interface takes its type arguments from the same class's.
   */
  private unify(file: SourceInfo, node: number, arg: Type, vars: ReadonlySet<string>, inferred: Map<string, Type>, depth = 0): void {
    if (arg.k === 'unknown' || depth > 8) return;
    const t = file.tree;
    if (t.kind[node] === K.ParenthesizedType) return this.unify(file, t.first[node]!, arg, vars, inferred, depth + 1);
    // A type literal from an object literal: member by member (`{ position?: Pos }` from `{ position: 'pos' }`).
    if (t.kind[node] === K.TypeLiteral && arg.k === 'record') {
      for (const m of this.childrenOf(t, node)) {
        if (t.kind[m] !== K.PropertySignature) continue;
        const prop = arg.props.get(t.textOf(t.first[m]!));
        const mt = this.annotationOf(t, m);
        if (prop && mt !== undefined) this.unify(file, mt, prop(), vars, inferred, depth + 1);
      }
      return;
    }
    if (t.kind[node] !== K.TypeReference || t.kind[t.first[node]!] !== K.Identifier) return;
    const d = this.declarationOf(file, t.first[node]!);
    if (!d) return;
    const key = keyOf(d);
    if (t.kind[d.node] === K.TypeParameter) {
      if (vars.has(key) && !inferred.has(key)) inferred.set(key, arg);
      return;
    }
    const target = this.targetOf(d);
    if (!target) return;
    const tt = target.file.tree;
    const argNodes = this.childrenOf(t, node).slice(1);
    if (!argNodes.length) return;
    const params = this.childrenOf(tt, target.node).filter((c) => tt.kind[c] === K.TypeParameter);
    const candidates = arg.k === 'intersection' ? arg.parts : [arg];
    for (const c of candidates) {
      if (c.k === 'object' && c.decls.some((x) => x.file === target.file && x.node === target.node)) {
        params.forEach((p, i) => argNodes[i] !== undefined && this.unify(file, argNodes[i]!, c.env.get(`${target.file.path}:${p}`) ?? UNKNOWN, vars, inferred, depth + 1));
        return;
      }
    }
    // An interface or type literal from an object literal: each member's type, with the interface's type
    // parameters standing for the reference's type arguments (`JoinOptions<Px>` from `{ prefix: 'c_' }`).
    if (arg.k === 'record' && tt.kind[target.node] === K.InterfaceDeclaration) {
      const aliases = new Map<string, number | undefined>(params.map((p, i) => [`${target.file.path}:${p}`, argNodes[i]]));
      for (const m of this.childrenOf(tt, target.node)) {
        if (tt.kind[m] !== K.PropertySignature) continue;
        const prop = arg.props.get(tt.textOf(tt.first[m]!));
        const mt = this.annotationOf(tt, m);
        if (!prop || mt === undefined || tt.kind[mt] !== K.TypeReference) continue;
        const md = this.declarationOf(target.file, tt.first[mt]!);
        const argNode = md ? aliases.get(keyOf(md)) : undefined;
        if (argNode !== undefined) this.unify(file, argNode, prop(), vars, inferred, depth + 1);
      }
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Imports and exports.

  /** What an import declaration's name is, in the module it comes from. */
  private imported(d: Decl, meaning: 'value' | 'type', args: readonly Type[]): Type {
    const t = d.file.tree;
    if (t.kind[d.node] === K.NamespaceImport) {
      const file = this.importedFile(d);
      return file && meaning === 'value' ? { k: 'namespace', file } : UNKNOWN;
    }
    if (t.kind[d.node] === K.ImportClause) return UNKNOWN; // a default import: not modelled
    const exported = this.targetOf(d);
    if (!exported) return UNKNOWN;
    return meaning === 'value' ? this.valueOfDecl(exported) : this.typeOfDecl(exported, args, NO_ENV);
  }

  /** The module an import declaration reads. */
  private importedFile(d: Decl): SourceInfo | undefined {
    const t = d.file.tree;
    let declaration = d.node;
    while (declaration && t.kind[declaration] !== K.ImportDeclaration) declaration = d.file.bindings.parent[declaration]!;
    if (!declaration) return undefined;
    const spec = this.childrenOf(t, declaration).find((c) => t.kind[c] === K.StringLiteral);
    const target = spec ? this.resolve(t.textOf(spec).slice(1, -1), d.file.path) : undefined;
    return target ? this.source(target) : undefined;
  }

  /** The declaration an import specifier names, in its module (following re-exports); others as they are. */
  private targetOf(d: Decl): Decl | undefined {
    const t = d.file.tree;
    if (t.kind[d.node] !== K.ImportSpecifier) return d;
    const file = this.importedFile(d);
    if (!file) return undefined;
    const ids = this.childrenOf(t, d.node);
    const found = this.exportOf(file, t.textOf(ids[0]!), new Set());
    return found ? this.targetOf(found) : undefined;
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
      if (this.files.has(candidate) || this.prepared?.has(candidate)) return candidate;
    }
    return undefined;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Types from declarations.

  /** A type node's type, with `env` giving the type parameters in scope their arguments. */
  private typeOfNode(f: SourceInfo, n: number, env: Env): Type {
    if (this.depth > 60) return UNKNOWN; // a recursive type: not modelled
    this.depth++;
    try {
      return this.typeOfNodeInner(f, n, env);
    } finally {
      this.depth--;
    }
  }

  private typeOfNodeInner(f: SourceInfo, n: number, env: Env): Type {
    const t = f.tree;
    const kind = t.kind[n]!;
    const p = PRIMITIVE_OF.get(kind);
    if (p) return p;
    switch (kind) {
      case K.NeverKeyword:
        return { k: 'union', parts: [] };
      case K.LiteralType: {
        const lit = t.first[n]!;
        switch (t.kind[lit]) {
          case K.StringLiteral:
          case K.NoSubstitutionTemplateLiteral:
            return keys([t.textOf(lit).slice(1, -1)]);
          case K.TrueKeyword:
            return { k: 'bool', value: true };
          case K.FalseKeyword:
            return { k: 'bool', value: false };
          case K.NullKeyword:
            return prim('null');
          case K.NumericLiteral:
            return prim('number');
          default:
            return PRIMITIVE;
        }
      }
      case K.ArrayType:
        return { k: 'array', element: this.typeOfNode(f, t.first[n]!, env) };
      case K.IndexedAccessType: {
        const [object, index] = this.childrenOf(t, n);
        const key = this.typeOfNode(f, index!, env);
        if (key.k !== 'keys' || key.names.size !== 1) return UNKNOWN;
        return this.propsOf(this.typeOfNode(f, object!, env))?.names.get([...key.names][0]!)?.() ?? UNKNOWN;
      }
      case K.ConditionalType:
        return this.conditional(f, n, env);
      case K.ParenthesizedType:
        return this.typeOfNode(f, t.first[n]!, env);
      case K.TypeLiteral:
        return { k: 'object', decls: [{ file: f, node: n }], name: t.textOf(n), env };
      case K.FunctionType:
        return { k: 'function', signatures: [{ decl: { file: f, node: n }, env }] };
      case K.TypeReference: {
        const name = t.first[n]!;
        if (t.kind[name] !== K.Identifier) return UNKNOWN; // a qualified name: not modelled
        const args = this.childrenOf(t, n).slice(1).map((a) => this.typeOfNode(f, a, env));
        const decl = this.declarationOf(f, name);
        if (decl) return this.typeOfDecl(decl, args, env);
        const global = f.path === BUILTINS_PATH ? undefined : this.globalDecl(t.textOf(name));
        return global ? this.typeOfDecl(global, args, env) : this.builtin(t.textOf(name), args);
      }
      case K.UnionType:
        return union(this.childrenOf(t, n).map((c) => this.typeOfNode(f, c, env)));
      case K.IntersectionType: {
        const parts = this.childrenOf(t, n).map((c) => this.typeOfNode(f, c, env));
        // `keyof T & string`: the keys (names are strings already).
        const named = parts.filter((p) => p.k === 'keys');
        if (named.length === 1 && parts.every((p) => p.k === 'keys' || (p.k === 'primitive' && p.kind === 'string'))) return named[0]!;
        return { k: 'intersection', parts, name: t.textOf(n) };
      }
      case K.TypeOperator: {
        const text = t.textOf(n);
        if (text.startsWith('readonly')) return this.typeOfNode(f, t.first[n]!, env);
        if (!text.startsWith('keyof')) return UNKNOWN; // unique: not modelled
        const names = this.keysOf(this.typeOfNode(f, t.first[n]!, env));
        return names ? keys(names) : UNKNOWN;
      }
      case K.MappedType:
        return this.mapped(f, n, env);
      case K.TemplateLiteralType:
        return this.template(f, n, env);
      default:
        return UNKNOWN;
    }
  }

  /** The type a declaration declares (a class's instances, an interface, a type alias's type), for `args`. */
  private typeOfDecl(d: Decl, args: readonly Type[], env: Env): Type {
    const t = d.file.tree;
    switch (t.kind[d.node]) {
      case K.TypeParameter:
        return env.get(keyOf(d)) ?? UNKNOWN;
      case K.ClassDeclaration:
      case K.InterfaceDeclaration:
        return this.instanceOf(d, args);
      case K.TypeAliasDeclaration: {
        const parts = this.childrenOf(t, d.node);
        const aliasEnv = this.envFor(d, args);
        const type = parts.slice(1).reverse().find((c) => isTypeNode(t.kind[c]!) && t.kind[c] !== K.TypeParameter);
        return type !== undefined ? this.typeOfNode(d.file, type, aliasEnv) : UNKNOWN;
      }
      case K.ImportSpecifier:
        return this.imported(d, 'type', args);
      default:
        return UNKNOWN;
    }
  }

  /** The env a generic declaration's type parameters get from `args` (and their defaults). */
  private envFor(d: Decl, args: readonly Type[]): Env {
    const t = d.file.tree;
    const env = new Map<string, Type>();
    this.childrenOf(t, d.node)
      .filter((c) => t.kind[c] === K.TypeParameter)
      .forEach((tp, i) => {
        const def = this.defaultOf(t, tp);
        env.set(`${d.file.path}:${tp}`, args[i] ?? (def !== undefined ? this.typeOfNode(d.file, def, env) : UNKNOWN));
      });
    return env;
  }

  /** A built-in interface (builtins.ts), by name. */
  private builtinDecl(name: string): Decl | undefined {
    const f = this.source(BUILTINS_PATH);
    if (!f) return undefined;
    const t = f.tree;
    for (let s = t.first[t.root]!; s; s = t.next[s]!) {
      if (t.kind[s] === K.InterfaceDeclaration && t.textOf(t.first[s]!) === name) return { file: f, node: s };
    }
    return undefined;
  }

  /** A built-in value (`Math`, `JSON`), by name. */
  private builtinValue(name: string): Type {
    const f = this.source(BUILTINS_PATH);
    if (!f) return UNKNOWN;
    const t = f.tree;
    for (let s = t.first[t.root]!; s; s = t.next[s]!) {
      if (t.kind[s] !== K.VariableStatement) continue;
      for (const list of this.childrenOf(t, s)) for (const v of this.childrenOf(t, list)) if (t.textOf(t.first[v]!) === name) return this.valueOfDecl({ file: f, node: v });
    }
    return UNKNOWN;
  }

  /** The built-in types by name: arrays, the interfaces of builtins.ts, and the generics that only rearrange keys. */
  private builtin(name: string, args: readonly Type[]): Type {
    const [a, b] = args;
    if (name === 'Array' || name === 'ReadonlyArray') return { k: 'array', element: a ?? UNKNOWN };
    const decl = this.builtinDecl(name);
    if (decl) return this.instanceOf(decl, args);
    switch (name) {
      case 'Readonly':
      case 'Partial':
      case 'Required':
        return a ?? UNKNOWN;
      case 'Omit':
      case 'Pick': {
        const props = a ? this.propsOf(a) : undefined;
        if (!props || props.open || b?.k !== 'keys') return UNKNOWN;
        const kept = [...props.names].filter(([k]) => b.names.has(k) === (name === 'Pick'));
        return { k: 'record', props: new Map(kept), name: `${name}<…>` };
      }
      case 'Record':
        return a?.k === 'keys' ? { k: 'record', props: new Map([...a.names].map((k) => [k, () => b ?? UNKNOWN])), name: 'Record<…>' } : UNKNOWN;
      default:
        return UNKNOWN;
    }
  }

  /** A mapped type over known keys: `{ [K in keyof T]: … }`, renamed by an `as` clause. */
  private mapped(f: SourceInfo, n: number, env: Env): Type {
    const t = f.tree;
    const [tp, ...types] = this.childrenOf(t, n);
    const constraint = this.childrenOf(t, tp!)[1];
    if (constraint === undefined || !types.length) return UNKNOWN;
    const over = this.typeOfNode(f, constraint, env);
    if (over.k !== 'keys') return UNKNOWN;
    const as = types.length === 2 ? types[0] : undefined;
    const value = types[types.length - 1]!;
    const props = new Map<string, () => Type>();
    const k = `${f.path}:${tp}`;
    for (const name of over.names) {
      const keyEnv = new Map(env).set(k, keys([name]));
      let key = name;
      if (as !== undefined) {
        const renamed = this.typeOfNode(f, as, keyEnv);
        if (renamed.k !== 'keys' || renamed.names.size !== 1) return UNKNOWN;
        key = [...renamed.names][0]!;
      }
      props.set(key, () => this.typeOfNode(f, value, keyEnv));
    }
    return { k: 'record', props, name: t.textOf(n) };
  }

  /** A template literal type whose holes are single string literals. */
  private template(f: SourceInfo, n: number, env: Env): Type {
    const t = f.tree;
    const [head, ...spans] = this.childrenOf(t, n);
    let texts = [t.textOf(head!).slice(1, -2)];
    for (const span of spans) {
      const [type, literal] = this.childrenOf(t, span);
      const part = this.typeOfNode(f, type!, env);
      if (part.k !== 'keys' || texts.length * part.names.size > 10_000) return UNKNOWN;
      const lit = t.textOf(literal!);
      const after = lit.endsWith('`') ? lit.slice(1, -1) : lit.slice(1, -2);
      texts = texts.flatMap((x) => [...part.names].map((name) => x + name + after));
    }
    return keys(texts);
  }

  /**
   * A class's or interface's instance type, for `args`, with every declaration of its name: interfaces merge, also
   * from module augmentations in other files.
   */
  private instanceOf(d: Decl, args: readonly Type[]): Type {
    const t = d.file.tree;
    const name = t.first[d.node]!;
    const symbol = d.file.bindings.symbol(name);
    const kinds = new Set([K.ClassDeclaration, K.InterfaceDeclaration]);
    const decls = (symbol?.declarations ?? [name]).map((x) => d.file.bindings.parent[x]!).filter((x) => kinds.has(t.kind[x]!));
    const all = (decls.length ? decls : [d.node]).map((node) => ({ file: d.file, node }));
    const text = t.textOf(name);
    for (const a of this.augmentationsOf(d.file.path)) if (a.file.tree.textOf(a.file.tree.first[a.node]!) === text) all.push(a);
    return { k: 'object', decls: all, name: text, env: this.envFor(d, args) };
  }

  /** The interfaces other files add to a module with `declare module '…'`. */
  /** Whether a file's text may hold a module augmentation (a cheap text search, kept in the cache). */
  private mayAugment(path: string, text: string): boolean {
    const cache = this.options.cache?.augments;
    const hit = cache?.get(path);
    if (hit !== undefined && hit.text === text) return hit.has;
    const has = text.includes('declare module');
    cache?.set(path, { text, has });
    return has;
  }

  private augmentationsOf(path: string): readonly Decl[] {
    if (!this.augmentations) {
      this.augmentations = new Map();
      // Prepared files first, in the order they were prepared, then the others: as a page gives them, the libraries
      // before the code.
      const files: [string, boolean][] = [];
      for (const path of this.prepared?.paths ?? []) {
        const entry = this.preparedEntry(path);
        if (entry !== undefined) files.push([path, entry.augments]);
      }
      for (const [path, text] of this.files) if (this.preparedEntry(path) === undefined) files.push([path, this.mayAugment(path, text)]);
      for (const [file, augments] of files) {
        if (!augments) continue;
        const f = this.source(file);
        if (!f) continue;
        const t = f.tree;
        for (let s = t.first[t.root]!; s; s = t.next[s]!) {
          if (t.kind[s] !== K.ModuleDeclaration) continue;
          const [spec, block] = this.childrenOf(t, s);
          if (spec === undefined || t.kind[spec] !== K.StringLiteral || block === undefined) continue;
          const target = this.resolve(t.textOf(spec).slice(1, -1), file);
          if (!target) continue;
          const list = this.augmentations.get(target) ?? [];
          for (const c of this.childrenOf(t, block)) if (t.kind[c] === K.InterfaceDeclaration) list.push({ file: f, node: c });
          this.augmentations.set(target, list);
        }
      }
    }
    return this.augmentations.get(path) ?? [];
  }

  /** A type's properties, or undefined when it has none the checker knows (unknown, primitives, functions). */
  private propsOf(type: Type): Props | undefined {
    switch (type.k) {
      case 'object': {
        const m = this.membersOf(type);
        const names = new Map([...m.byName].map(([k, decls]) => [k, () => this.memberOfDecls(decls, type.env)] as const));
        return { names, open: m.open };
      }
      case 'record':
        return { names: type.props, open: false };
      case 'array': {
        const decl = this.builtinDecl('Array');
        return decl ? this.propsOf(this.instanceOf(decl, [type.element])) : undefined;
      }
      case 'primitive':
      case 'keys':
      case 'bool': {
        // A primitive's members are its wrapper's.
        const kind = type.k === 'keys' ? 'string' : type.k === 'bool' ? 'boolean' : type.kind;
        const wrapper = kind === 'string' ? 'String' : kind === 'number' ? 'Number' : kind === 'boolean' ? 'Boolean' : undefined;
        const decl = wrapper ? this.builtinDecl(wrapper) : undefined;
        return decl ? this.propsOf(this.instanceOf(decl, [])) : undefined;
      }
      case 'intersection': {
        const names = new Map<string, () => Type>();
        let open = false;
        for (const p of type.parts) {
          const props = this.propsOf(p);
          if (!props) {
            open = true;
            continue;
          }
          open ||= props.open;
          for (const [k, v] of props.names) if (!names.has(k)) names.set(k, v);
        }
        return { names, open };
      }
      default:
        return undefined;
    }
  }

  /** The names `keyof` a type gives, when they are all known. */
  private keysOf(type: Type): string[] | undefined {
    if (type.k !== 'object' && type.k !== 'record' && type.k !== 'intersection') return undefined;
    const props = this.propsOf(type);
    return props && !props.open ? [...props.names.keys()] : undefined;
  }

  private nameOf(type: Type): string {
    return type.k === 'object' || type.k === 'record' || type.k === 'intersection' ? type.name : '?';
  }

  private membersOf(type: Extract<Type, { k: 'object' }>): Members {
    const key = type.decls.map((d) => keyOf(d)).join('|');
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
      if (kind === K.Constructor) {
        // Parameter properties (`constructor(readonly node: Node)`) are members too.
        for (const p of this.childrenOf(t, c)) {
          if (t.kind[p] !== K.Parameter || !(t.flags[p]! & (F.Public | F.Private | F.Protected | F.Readonly))) continue;
          const id = t.first[p]!;
          if (t.kind[id] !== K.Identifier) continue;
          const list = m.byName.get(t.textOf(id)) ?? [];
          list.push({ file: d.file, node: p });
          m.byName.set(t.textOf(id), list);
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
      else if (nameKind === K.PrivateIdentifier) key = t.textOf(name);
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
    return this.typeOfDecl(decl, [], NO_ENV);
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
      return statics.length ? this.memberOfDecls(statics.map((node) => ({ file: object.decl.file, node })), NO_ENV) : UNKNOWN;
    }
    return this.propsOf(object)?.names.get(name)?.() ?? UNKNOWN;
  }

  private memberOfDecls(decls: readonly Decl[], env: Env): Type {
    const first = decls[0]!;
    const t = first.file.tree;
    const kind = t.kind[first.node]!;
    if (kind === K.MethodDeclaration || kind === K.MethodSignature) {
      // Overload signatures are the ones without a body (in a class); an interface's are all signatures.
      const sigs = decls.filter((d) => !this.childrenOf(d.file.tree, d.node).some((c) => d.file.tree.kind[c] === K.Block));
      return { k: 'function', signatures: (sigs.length ? sigs : decls).map((decl) => ({ decl, env })) };
    }
    if (kind === K.PropertyDeclaration || kind === K.PropertySignature || kind === K.Parameter) {
      if (decls.length !== 1) return UNKNOWN;
      const type = this.annotationOf(t, first.node);
      if (type !== undefined) return this.typeOfNode(first.file, type, env);
      // A class property without an annotation takes its initializer's type, widened as tsc does.
      const init = kind === K.PropertyDeclaration ? this.childrenOf(t, first.node).slice(1).find((c) => !isTypeNode(t.kind[c]!)) : undefined;
      return init !== undefined ? widen(this.typeOfExpr(first.file, init)) : UNKNOWN;
    }
    return UNKNOWN; // accessors: not modelled yet
  }

  /** A signature's return annotation, or undefined. */
  private returnNodeOf(sig: Decl): number | undefined {
    const t = sig.file.tree;
    // The return type is the last child that is a type (parameters' types are inside them; a body is a Block).
    return this.childrenOf(t, sig.node).reverse().find((c) => t.kind[c] !== K.Block && t.kind[c] !== K.TypeParameter && isTypeNode(t.kind[c]!));
  }

  /** A signature's return type, from its annotation. */
  private returnOf(sig: Sig): Type {
    const t = sig.decl.file.tree;
    const type = this.returnNodeOf(sig.decl);
    if (type === undefined) return UNKNOWN;
    return this.typeOfNode(sig.decl.file, type, sig.env);
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

/** The lines (from 0) that a `// @ts-expect-error` or `// @ts-ignore` comment on the line before silences. */
export function suppressedLines(text: string): Set<number> {
  const out = new Set<number>();
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (/^\s*\/\/\s*@ts-(expect-error|ignore)\b/.test(line)) out.add(i + 1);
  });
  return out;
}

function lineOf(text: string, offset: number): number {
  let n = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

/** Where the first statement starts: `@ts-nocheck` counts only before it. */
function firstStatement(t: Tree): number {
  const s = t.first[t.root]!;
  return s ? t.start[s]! : t.text.length;
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
