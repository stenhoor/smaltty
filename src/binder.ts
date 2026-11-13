// The binder: which declaration each name refers to. It follows TypeScript's binder and name resolution (scopes,
// hoisting, the separate meanings of a name as a value, a type and a namespace), so that it agrees with TypeScript's
// checker on every name a file declares or reads. It works on one file, with nothing outside it: a name declared
// nowhere in the file (a global, an import's target) is unresolved.
//
// What it is for: knowing, for each identifier, the declaration it means (smaltnb's cells read and define names by
// it), and later the checker's symbol table. Property names (`a.b`'s `b`, members of classes, interfaces and object
// literals) are not names in a scope, and are left alone: what they mean depends on types.
import { F, K, isTypeNode } from './kinds.js';
import type { Tree } from './tree.js';

/** What a name can mean. A declaration has one or more; a reference looks for one. */
export const Meaning = {
  Value: 1,
  Type: 2,
  Namespace: 4,
  /** Imports: their target is outside the file, so they answer to every meaning. */
  Alias: 8,
  All: 15,
} as const;

export interface BindSymbol {
  name: string;
  /** Meaning flags of all its declarations. */
  meaning: number;
  /** The declarations' name nodes (or the declaration node, for one without a name), in source order. */
  declarations: number[];
}

/**
 * A file's top-level names: its own scope's (a module's, or the global scope for a script) and the global scope's,
 * which `declare global` adds to; name to symbol index + 1. The checker keys a statement's results by them.
 */
export interface TopNames {
  readonly file: ReadonlyMap<string, number>;
  readonly global: ReadonlyMap<string, number>;
  readonly module: boolean;
  readonly strict: boolean;
}

/** The binder's answer for a tree. */
export class Bindings {
  readonly tree: Tree;
  readonly symbols: BindSymbol[] = [];
  /** Per node: the symbol index + 1 of an Identifier that declares or refers to a name; 0 for none. */
  readonly symbolOf: Int32Array;
  /** Per node: the meaning an Identifier reference was looked up with (0 for declarations and other nodes). */
  readonly meaningOf: Uint8Array;
  /** Per node: its parent (0 for the root). */
  readonly parent: Int32Array;
  /** The file's top-level names, from bind() (not kept in prepared declarations). */
  top: TopNames | undefined = undefined;

  /** Empty bindings for `tree`, or, with `bound`, bindings already made (prepared declarations read back). */
  constructor(tree: Tree, bound?: { readonly symbols: BindSymbol[]; readonly symbolOf: Int32Array; readonly meaningOf: Uint8Array; readonly parent: Int32Array }) {
    this.tree = tree;
    if (bound) {
      this.symbols = bound.symbols;
      this.symbolOf = bound.symbolOf;
      this.meaningOf = bound.meaningOf;
      this.parent = bound.parent;
      return;
    }
    this.symbolOf = new Int32Array(tree.count);
    this.meaningOf = new Uint8Array(tree.count);
    this.parent = new Int32Array(tree.count);
  }

  /** The symbol an Identifier declares or refers to, or undefined (a property name, or a name declared nowhere). */
  symbol(node: number): BindSymbol | undefined {
    const s = this.symbolOf[node]!;
    return s ? this.symbols[s - 1] : undefined;
  }

  /** The first declaration's name node of the symbol an Identifier declares or refers to, or 0. */
  declaration(node: number): number {
    const s = this.symbolOf[node]!;
    return s ? this.symbols[s - 1]!.declarations[0]! : 0;
  }
}

class Scope {
  readonly names: Map<string, number>;
  readonly parent: Scope | null;
  /** The node that makes the scope (0 for the global scope, and for a function or class expression's own name). */
  readonly node: number;
  /** `names` is shared by `declare global` blocks: their names are global, but they sit in their module's scope. */
  constructor(parent: Scope | null, node: number, names = new Map<string, number>()) {
    this.parent = parent;
    this.node = node;
    this.names = names;
  }
}

/** Binds a tree. */
export function bind(tree: Tree): Bindings {
  return new Binder(tree).run();
}

class Binder {
  readonly t: Tree;
  readonly b: Bindings;
  readonly global = new Scope(null, 0);
  /** Scope by the node that makes it. */
  readonly scopes = new Map<number, Scope>();
  strict = false;
  /** Scopes shared by every declaration of one symbol: merged classes and interfaces, merged namespaces. */
  readonly symbolScopes = new Map<number, Scope>();
  /** Inside `declare`d code (or a .d.ts file). */
  ambient = false;
  /** Where `infer X` declares X: the conditional type whose extends clause is being declared. */
  inferScope: Scope | null = null;

  constructor(tree: Tree) {
    this.t = tree;
    this.b = new Bindings(tree);
  }

  name(n: number): string {
    return this.t.textOf(n);
  }

  run(): Bindings {
    const t = this.t;
    this.ambient = !!t.fileName?.endsWith('.d.ts');
    // Parents, for the roles of identifiers.
    const parent = this.b.parent;
    const stack = [t.root];
    while (stack.length) {
      const n = stack.pop()!;
      for (let c = t.first[n]!; c; c = t.next[c]!) {
        parent[c] = n;
        stack.push(c);
      }
    }
    const module = isModule(t);
    this.strict = module || hasUseStrict(t, t.root);
    const strict = this.strict;
    const fileScope = module ? new Scope(this.global, t.root) : this.global;
    this.scopes.set(t.root, fileScope);
    this.declareIn(t.root, fileScope, fileScope);
    this.resolveIn(t.root, fileScope);
    this.b.top = { file: fileScope.names, global: this.global.names, module, strict };
    return this.b;
  }

  // ---------------------------------------------------------------- declaring

  /** Adds a declaration to a scope, merging with a symbol of the same name already there. */
  declare(scope: Scope, nameNode: number, meaning: number, name = this.name(nameNode)): void {
    const b = this.b;
    let s = scope.names.get(name);
    if (s === undefined) {
      b.symbols.push({ name, meaning, declarations: [nameNode] });
      s = b.symbols.length;
      scope.names.set(name, s);
    } else {
      const sym = b.symbols[s - 1]!;
      sym.meaning |= meaning;
      sym.declarations.push(nameNode);
    }
    b.symbolOf[nameNode] = s;
  }

  /**
   * Walks `n`'s children, declaring what they declare. `container` takes `var`s and function-scoped declarations,
   * `block` the block-scoped ones (let, const, class, interface …).
   */
  declareIn(n: number, container: Scope, block: Scope): void {
    const t = this.t;
    for (let c = t.first[n]!; c; c = t.next[c]!) this.declareNode(c, container, block);
  }

  declareNode(n: number, container: Scope, block: Scope): void {
    const t = this.t;
    const kind = t.kind[n]!;
    const flags = t.flags[n]!;
    switch (kind) {
      case K.VariableDeclarationList: {
        const scoped = flags & (F.Let | F.Const | F.Using) ? block : container;
        for (let d = t.first[n]!; d; d = t.next[d]!) {
          this.declareBindingName(t.first[d]!, scoped);
          // The initializer and the type are not declarations, but may hold function expressions with scopes.
          for (let c = t.next[t.first[d]!]!; c; c = t.next[c]!) this.declareNode(c, container, block);
        }
        return;
      }
      case K.FunctionDeclaration: {
        const name = this.firstIdentifier(n);
        if (name) this.declare(this.strict ? block : container, name, Meaning.Value);
        this.declareFunction(n);
        return;
      }
      case K.ClassDeclaration: case K.ClassExpression: {
        const name = this.firstIdentifier(n);
        if (name && kind === K.ClassDeclaration) this.declare(block, name, Meaning.Value | Meaning.Type);
        this.declareClass(n);
        return;
      }
      case K.InterfaceDeclaration: case K.TypeAliasDeclaration: {
        this.declare(block, t.first[n]!, Meaning.Type);
        this.declareTypeParameterHost(n);
        return;
      }
      case K.EnumDeclaration: {
        this.declare(block, t.first[n]!, Meaning.Value | Meaning.Type | Meaning.Namespace);
        const scope = new Scope(block, n); // its members are names in its initializers
        this.scopes.set(n, scope);
        for (let m = t.next[t.first[n]!]!; m; m = t.next[m]!) {
          const name = t.first[m]!;
          if (t.kind[name] === K.Identifier || t.kind[name] === K.StringLiteral) this.declare(scope, name, Meaning.Value, this.propertyNameText(name));
          for (let c = t.next[name]!; c; c = t.next[c]!) this.declareNode(c, container, block);
        }
        return;
      }
      case K.ModuleDeclaration: {
        const name = t.first[n]!;
        const isGlobal = !!(flags & F.Global);
        if (!isGlobal && t.kind[name] === K.Identifier) {
          const instantiated = this.isInstantiated(n);
          this.declare(container, name, Meaning.Namespace | (instantiated ? Meaning.Value : 0));
        }
        if (isGlobal) this.declare(new Scope(null, 0), name, Meaning.Namespace); // `global` names itself
        const ambient = this.ambient;
        if (flags & F.Declare) this.ambient = true;
        // A namespace's exports are shared by all its blocks (merged declarations); the rest is the block's own. In
        // ambient code with no export statements, everything is exported (TypeScript's export context).
        // Lexically, a namespace sits in the scope around it (not in the exports it is declared into).
        const lexical = this.enclosingScopeOf(n);
        let exports: Scope;
        if (isGlobal) exports = new Scope(lexical, n, this.global.names);
        else if (t.kind[name] === K.Identifier) exports = this.sharedScope(n, lexical);
        else exports = new Scope(lexical, n);
        const scope = isGlobal ? exports : new Scope(exports, n);
        this.scopes.set(n, scope);
        for (let c = t.next[name]!; c; c = t.next[c]!) {
          if (t.kind[c] !== K.ModuleBlock) {
            this.declareNode(c, exports, exports); // nested A.B: B is an export of A
            continue;
          }
          const exportContext = this.ambient && !this.hasExportStatement(c);
          for (let st = t.first[c]!; st; st = t.next[st]!) {
            const target = exportContext || t.flags[st]! & F.Export ? exports : scope;
            this.declareNode(st, target, target);
          }
        }
        this.ambient = ambient;
        return;
      }
      case K.ImportDeclaration: {
        for (let c = t.first[n]!; c; c = t.next[c]!) {
          if (t.kind[c] !== K.ImportClause) continue;
          for (let d = t.first[c]!; d; d = t.next[d]!) {
            if (t.kind[d] === K.Identifier) this.declare(container, d, Meaning.Alias);
            else if (t.kind[d] === K.NamespaceImport) this.declare(container, t.first[d]!, Meaning.Alias);
            else if (t.kind[d] === K.NamedImports) {
              for (let s = t.first[d]!; s; s = t.next[s]!) this.declare(container, this.lastChild(s), Meaning.Alias);
            }
          }
        }
        return;
      }
      case K.ImportEqualsDeclaration:
        this.declare(container, t.first[n]!, Meaning.Alias);
        return;
      case K.ExportDeclaration: {
        // Exported names are names of the module's exports, not of a scope: each names itself. (`export { a as b }`:
        // `b`; and `a` too when it comes `from` another module. A local `a` is a reference, resolved later.)
        const from = this.hasChild(n, K.StringLiteral);
        for (let c = t.first[n]!; c; c = t.next[c]!) {
          if (t.kind[c] === K.NamespaceExport) this.declare(new Scope(null, 0), t.first[c]!, Meaning.Alias);
          if (t.kind[c] !== K.NamedExports) continue;
          for (let e = t.first[c]!; e; e = t.next[e]!) {
            const first = t.first[e]!;
            const last = this.lastChild(e);
            if (last !== first) this.declare(new Scope(null, 0), last, Meaning.Alias);
            else if (from) this.declare(new Scope(null, 0), first, Meaning.Alias);
            // With `from`, `x` in `x as y` is a name in the other module: left alone (see referenceMeaning).
          }
        }
        return;
      }
      case K.CatchClause: {
        const scope = new Scope(block, n);
        this.scopes.set(n, scope);
        for (let c = t.first[n]!; c; c = t.next[c]!) {
          if (t.kind[c] === K.VariableDeclaration) {
            this.declareBindingName(t.first[c]!, scope);
            for (let d = t.next[t.first[c]!]!; d; d = t.next[d]!) this.declareNode(d, container, scope);
          } else this.declareIn(c, container, scope); // the block shares the catch clause's scope
        }
        return;
      }
      case K.Block: case K.ForStatement: case K.ForInStatement: case K.ForOfStatement: case K.CaseBlock: {
        const scope = new Scope(block, n);
        this.scopes.set(n, scope);
        this.declareIn(n, container, scope);
        return;
      }
      case K.FunctionExpression: case K.ArrowFunction: case K.MethodDeclaration: case K.Constructor:
      case K.GetAccessor: case K.SetAccessor: case K.ClassStaticBlockDeclaration: case K.MethodSignature:
      case K.CallSignature: case K.ConstructSignature: case K.FunctionType: case K.ConstructorType: case K.IndexSignature:
        this.declareFunction(n);
        return;
      case K.MappedType:
        this.declareTypeParameterHost(n);
        return;
      case K.ConditionalType:
        this.declareConditional(n, container, block);
        return;
      case K.InferType: {
        const p = t.first[n]!;
        if (this.inferScope) this.declare(this.inferScope, t.first[p]!, Meaning.Type);
        for (let c = t.next[t.first[p]!]!; c; c = t.next[c]!) this.declareNode(c, container, block);
        return;
      }
    }
    if (t.first[n]) this.declareIn(n, container, block);
  }

  /** The names in a binding name (an identifier, or a pattern), declared in `scope`. */
  declareBindingName(n: number, scope: Scope): void {
    const t = this.t;
    const kind = t.kind[n]!;
    if (kind === K.Identifier) {
      this.declare(scope, n, Meaning.Value);
      return;
    }
    if (kind !== K.ObjectBindingPattern && kind !== K.ArrayBindingPattern) return;
    for (let e = t.first[n]!; e; e = t.next[e]!) {
      if (t.kind[e] !== K.BindingElement) continue;
      let name = t.first[e]!;
      if (t.flags[e]! & F.PropertyName) {
        this.declareNode(name, scope, scope); // a computed property name may hold a function
        name = t.next[name]!;
      }
      this.declareBindingName(name, scope);
      for (let c = t.next[name]!; c; c = t.next[c]!) this.declareNode(c, scope, scope);
    }
  }

  /** A function-like node: its own scope, with its type parameters, parameters and body. */
  declareFunction(n: number): void {
    const t = this.t;
    const outer = this.ownNameScope(n, Meaning.Value);
    const scope = new Scope(outer, n);
    this.scopes.set(n, scope);
    const strict = this.strict;
    for (let c = t.first[n]!; c; c = t.next[c]!) {
      const k = t.kind[c]!;
      if (k === K.TypeParameter) this.declareTypeParameter(c, scope);
      else if (k === K.Parameter) {
        this.declareBindingName(t.first[c]!, scope);
        for (let d = t.next[t.first[c]!]!; d; d = t.next[d]!) this.declareNode(d, scope, scope);
      } else if (k === K.Block) {
        // The body shares the function's scope (TypeScript's binder): its lets and consts go there too.
        if (!this.strict && hasUseStrict(t, c)) this.strict = true;
        this.declareIn(c, scope, scope);
      } else if (c !== t.first[n] || k !== K.Identifier) this.declareNode(c, scope, scope);
    }
    this.strict = strict;
  }

  /**
   * The scope of a class or interface declaration, shared with the other declarations of the same symbol: merged
   * declarations share their type parameters (TypeScript keeps them in the symbol's members).
   */
  sharedScope(n: number, outer: Scope): Scope {
    const name = this.firstIdentifier(n);
    const sym = name ? this.b.symbolOf[name]! : 0;
    if (!sym) return new Scope(outer, n);
    let scope = this.symbolScopes.get(sym);
    if (!scope) {
      scope = new Scope(outer, n);
      this.symbolScopes.set(sym, scope);
    }
    return scope;
  }

  declareClass(n: number): void {
    const t = this.t;
    const outer = this.ownNameScope(n, Meaning.Value | Meaning.Type);
    const scope = t.kind[n] === K.ClassDeclaration ? this.sharedScope(n, outer) : new Scope(outer, n);
    this.scopes.set(n, scope);
    const strict = this.strict;
    this.strict = true; // class bodies are strict
    for (let c = t.first[n]!; c; c = t.next[c]!) {
      const k = t.kind[c]!;
      if (k === K.TypeParameter) this.declareTypeParameter(c, scope);
      else if (c !== t.first[n] || k !== K.Identifier) this.declareNode(c, scope, scope);
    }
    this.strict = strict;
  }

  /**
   * The scope a function or class nests in. A function or class expression's name is visible only inside it, after its
   * own parameters and locals: it gets a scope of its own between the two.
   */
  ownNameScope(n: number, meaning: number): Scope {
    const outer = this.enclosingScopeOf(n);
    const k = this.t.kind[n]!;
    const name = this.firstIdentifier(n);
    if ((k !== K.FunctionExpression && k !== K.ClassExpression) || !name) return outer;
    const scope = new Scope(outer, 0);
    this.declare(scope, name, meaning);
    return scope;
  }

  /** Interfaces, type aliases and mapped types: their type parameters live on them. */
  declareTypeParameterHost(n: number): void {
    const t = this.t;
    const outer = this.enclosingScopeOf(n);
    const scope = t.kind[n] === K.InterfaceDeclaration ? this.sharedScope(n, outer) : new Scope(outer, n);
    this.scopes.set(n, scope);
    for (let c = t.first[n]!; c; c = t.next[c]!) {
      if (t.kind[c] === K.TypeParameter) this.declareTypeParameter(c, scope);
      else if (c !== t.first[n] || t.kind[c] !== K.Identifier) this.declareNode(c, scope, scope);
    }
  }

  declareTypeParameter(n: number, scope: Scope): void {
    const t = this.t;
    this.declare(scope, t.first[n]!, Meaning.Type);
    for (let c = t.next[t.first[n]!]!; c; c = t.next[c]!) this.declareNode(c, scope, scope);
  }

  /** `A extends B ? C : D`: the `infer X` anywhere in B are names in C (TypeScript's getInferTypeContainer). */
  declareConditional(n: number, container: Scope, block: Scope): void {
    const t = this.t;
    const scope = new Scope(this.enclosingScopeOf(n), n);
    this.scopes.set(n, scope);
    const extendsType = t.next[t.first[n]!]!;
    const saved = this.inferScope;
    for (let c = t.first[n]!; c; c = t.next[c]!) {
      this.inferScope = c === extendsType ? scope : saved;
      this.declareNode(c, container, block);
    }
    this.inferScope = saved;
  }

  /** The scope a new scope node nests in: the nearest enclosing node with a scope. */
  enclosingScopeOf(n: number): Scope {
    const parent = this.b.parent;
    for (let p = parent[n]!; ; p = parent[p]!) {
      const s = this.scopes.get(p);
      if (s && this.t.kind[p] !== K.EnumDeclaration) return s;
      if (p === 0) return this.global;
    }
  }

  hasExportStatement(block: number): boolean {
    for (let st = this.t.first[block]!; st; st = this.t.next[st]!) {
      const k = this.t.kind[st]!;
      if (k === K.ExportDeclaration || k === K.ExportAssignment) return true;
    }
    return false;
  }

  hasChild(n: number, kind: number): boolean {
    for (let c = this.t.first[n]!; c; c = this.t.next[c]!) if (this.t.kind[c] === kind) return true;
    return false;
  }

  firstIdentifier(n: number): number {
    const f = this.t.first[n]!;
    return f && this.t.kind[f] === K.Identifier ? f : 0;
  }

  lastChild(n: number): number {
    let last = 0;
    for (let c = this.t.first[n]!; c; c = this.t.next[c]!) last = c;
    return last;
  }

  propertyNameText(n: number): string {
    const text = this.name(n);
    return this.t.kind[n] === K.StringLiteral ? text.slice(1, -1) : text;
  }

  /** TypeScript's module instance state: does a namespace declare any values? */
  isInstantiated(n: number): boolean {
    const t = this.t;
    for (let c = t.first[n]!; c; c = t.next[c]!) {
      const k = t.kind[c]!;
      if (k === K.ModuleDeclaration) return this.isInstantiated(c);
      if (k !== K.ModuleBlock) continue;
      for (let s = t.first[c]!; s; s = t.next[s]!) {
        const sk = t.kind[s]!;
        if (sk === K.InterfaceDeclaration || sk === K.TypeAliasDeclaration) continue;
        if (sk === K.ModuleDeclaration && !this.isInstantiated(s)) continue;
        if (sk === K.ImportDeclaration || sk === K.ImportEqualsDeclaration) continue;
        if (sk === K.ExportDeclaration && t.flags[s]! & F.TypeOnly) continue;
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- resolving

  /** Walks `n`'s subtree, resolving every identifier that is a reference, in `scope`. */
  resolveIn(n: number, scope: Scope): void {
    const t = this.t;
    for (let c = t.first[n]!; c; c = t.next[c]!) {
      const kind = t.kind[c]!;
      if (kind === K.Identifier) this.resolveIdentifier(c, n, scope);
      else if (kind === K.ConditionalType) this.resolveConditional(c, scope);
      else {
        const own = this.scopes.get(c);
        if (own) this.resolveIn(c, own);
        else if (t.first[c]) this.resolveIn(c, scope);
      }
    }
  }

  /** `A extends B ? C : D`: C sees the `infer` names of B, then what A, B and D see. */
  resolveConditional(n: number, scope: Scope): void {
    const t = this.t;
    const infers = this.scopes.get(n)!;
    const trueScope = new Scope(scope, n);
    for (const [k, v] of infers.names) trueScope.names.set(k, v);
    const extendsType = t.next[t.first[n]!]!;
    const trueType = t.next[extendsType]!;
    for (let c = t.first[n]!; c; c = t.next[c]!) {
      const s = c === trueType ? trueScope : scope;
      if (t.kind[c] === K.Identifier) this.resolveIdentifier(c, n, s);
      else if (t.kind[c] === K.ConditionalType) this.resolveConditional(c, s);
      else {
        this.resolveIn(c, this.scopes.get(c) ?? s);
      }
    }
  }

  resolveIdentifier(id: number, parentNode: number, scope: Scope): void {
    if (this.b.symbolOf[id]) return; // a declaration
    const meaning = this.referenceMeaning(id, parentNode);
    if (!meaning) return;
    const sym = this.lookup(scope, this.name(id), meaning);
    this.b.meaningOf[id] = meaning;
    if (sym) this.b.symbolOf[id] = sym;
  }

  /** The symbol `name` means in `scope`, looking outwards for one with the meaning; 0 if none. */
  lookup(scope: Scope | null, name: string, meaning: number): number {
    for (let s = scope; s; s = s.parent) {
      const found = s.names.get(name);
      if (found !== undefined && this.b.symbols[found - 1]!.meaning & (meaning | Meaning.Alias)) return found;
    }
    return 0;
  }

  /** The meaning an identifier is looked up with, or 0 if it isn't a name in a scope (a property name, a label …). */
  referenceMeaning(id: number, p: number): number {
    const t = this.t;
    const pk = t.kind[p]!;
    const first = t.first[p] === id;
    switch (pk) {
      case K.PropertyAccessExpression: case K.QualifiedName: {
        if (!first) return 0;
        // `import("x").a.b`: the names belong to the other module.
        let top = p;
        while (t.kind[this.b.parent[top]!] === K.QualifiedName) top = this.b.parent[top]!;
        if (t.kind[this.b.parent[top]!] === K.ImportType) return 0;
        break;
      }
      case K.MetaProperty: case K.LabeledStatement: case K.BreakStatement: case K.ContinueStatement:
      case K.PropertyDeclaration: case K.MethodDeclaration: case K.GetAccessor: case K.SetAccessor:
      case K.PropertySignature: case K.MethodSignature: case K.PropertyAssignment: case K.NamedTupleMember:
      case K.ImportAttribute: case K.ImportSpecifier: case K.ImportType: case K.EnumMember:
        if (pk === K.PropertyAssignment && !first) break;
        if ((pk === K.PropertyDeclaration || pk === K.MethodDeclaration || pk === K.GetAccessor || pk === K.SetAccessor ||
          pk === K.PropertySignature || pk === K.MethodSignature) && !first) break;
        return 0;
      case K.BindingElement:
        // `{ a: b }`: `a` is a property name.
        if (first && t.flags[p]! & F.PropertyName) return 0;
        break;
      case K.ExportSpecifier: {
        // `export { a as b }` and `export { a }`: the local name is the first; with `from`, nothing is local.
        if (!first) return 0;
        if (this.b.symbolOf[id]) return 0;
        const decl = this.b.parent[this.b.parent[p]!]!;
        for (let c = t.first[decl]!; c; c = t.next[c]!) if (t.kind[c] === K.StringLiteral) return 0;
        return Meaning.All;
      }
      case K.ExportAssignment:
        return Meaning.All;
    }
    return this.meaningAt(id, p);
  }

  /** Value, type or namespace, from where the identifier is. */
  meaningAt(id: number, p: number): number {
    const t = this.t;
    const parent = this.b.parent;
    // Climb through qualified names and property accesses (`A.B.C` in a type: A is a namespace).
    let node = id;
    let up = p;
    let qualified = false;
    while ((t.kind[up] === K.QualifiedName || t.kind[up] === K.PropertyAccessExpression) && t.first[up] === node) {
      qualified = true;
      node = up;
      up = parent[up]!;
    }
    const uk = t.kind[up]!;
    if (uk === K.TypeReference) return qualified ? Meaning.Namespace : Meaning.Type;
    if (uk === K.TypeQuery) return Meaning.Value;
    if (uk === K.ExpressionWithTypeArguments) {
      const clause = parent[up]!;
      if (t.kind[clause] === K.HeritageClause) {
        const isExtends = t.text.startsWith('extends', t.start[clause]!);
        const owner = parent[clause]!;
        const isClass = t.kind[owner] === K.ClassDeclaration || t.kind[owner] === K.ClassExpression;
        if (!(isExtends && isClass)) return qualified ? Meaning.Namespace : Meaning.Type;
      }
      return Meaning.Value;
    }
    if (uk === K.TypePredicate) return Meaning.Value;
    if (uk === K.ImportEqualsDeclaration) return qualified ? Meaning.Namespace : Meaning.Namespace;
    return Meaning.Value;
  }
}

/** TypeScript's isFileProbablyExternalModule. */
function isModule(t: Tree): boolean {
  for (let n = t.first[t.root]!; n; n = t.next[n]!) {
    const k = t.kind[n]!;
    if (k === K.ImportDeclaration || k === K.ExportDeclaration || k === K.ExportAssignment) return true;
    if (k === K.ImportEqualsDeclaration) {
      for (let c = t.first[n]!; c; c = t.next[c]!) if (t.kind[c] === K.ExternalModuleReference) return true;
    }
    if (t.flags[n]! & F.Export) return true;
  }
  return /\bimport\s*\.\s*meta\b/.test(t.text);
}

/** A "use strict" directive at the start of a file or function body. */
function hasUseStrict(t: Tree, n: number): boolean {
  for (let s = t.first[n]!; s; s = t.next[s]!) {
    if (t.kind[s] !== K.ExpressionStatement) return false;
    const e = t.first[s]!;
    if (t.kind[e] !== K.StringLiteral) return false;
    if (t.textOf(e).slice(1, -1) === 'use strict') return true;
  }
  return false;
}
