// The syntax tree, stored flat: one row per node in typed arrays, children linked first-child / next-sibling. Building
// it allocates no object per node, and the parser can take back nodes it built while trying an alternative by resetting
// the count.
import { KIND_NAMES } from './kinds.js';

/** A built tree's columns, as Tree keeps them: `count` rows, row 0 "no node". */
export interface TreeColumns {
  readonly count: number;
  readonly root: number;
  readonly kind: Uint8Array;
  readonly start: Int32Array;
  readonly end: Int32Array;
  readonly first: Int32Array;
  readonly next: Int32Array;
  readonly flags: Int32Array;
  readonly data: Int16Array;
}

export class Tree {
  readonly text: string;
  readonly fileName: string | undefined;
  /** Number of rows used; row 0 is "no node". */
  count = 1;
  /** The SourceFile node. */
  root = 0;
  kind: Uint8Array;
  start: Int32Array;
  end: Int32Array;
  first: Int32Array;
  next: Int32Array;
  flags: Int32Array;
  /** Per-kind data: the operator token of a unary, binary or type operator expression. */
  data: Int16Array;

  /**
   * An empty tree for `text`, or, with `columns`, a tree already built (prepared declarations read back: the columns
   * are views of the buffer, and nothing is added to them).
   */
  constructor(text: string, fileName?: string, columns?: TreeColumns) {
    this.text = text;
    this.fileName = fileName;
    if (columns) {
      this.count = columns.count;
      this.root = columns.root;
      this.kind = columns.kind;
      this.start = columns.start;
      this.end = columns.end;
      this.first = columns.first;
      this.next = columns.next;
      this.flags = columns.flags;
      this.data = columns.data;
      return;
    }
    // About one node per 4 characters of source.
    const size = (text.length >> 2) + 32;
    this.start = this.end = this.first = this.next = this.flags = new Int32Array(0);
    this.data = new Int16Array(0);
    this.kind = new Uint8Array(0);
    this.allocate(size);
  }

  /**
   * Gives every column `size` rows, in one ArrayBuffer: one allocation instead of seven matters for small trees, where
   * allocating is most of the cost. Existing rows are copied.
   */
  private allocate(size: number): void {
    // Int32 columns first (4-byte aligned), then the Int16 column, then the Uint8 column.
    const buffer = new ArrayBuffer(size * (5 * 4 + 2 + 1));
    const int32 = (i: number, old: Int32Array): Int32Array => {
      const a = new Int32Array(buffer, i * size * 4, size);
      a.set(old);
      return a;
    };
    this.start = int32(0, this.start);
    this.end = int32(1, this.end);
    this.first = int32(2, this.first);
    this.next = int32(3, this.next);
    this.flags = int32(4, this.flags);
    const data = new Int16Array(buffer, size * 20, size);
    data.set(this.data);
    this.data = data;
    const kind = new Uint8Array(buffer, size * 22, size);
    kind.set(this.kind);
    this.kind = kind;
  }

  /** @internal Adds a node with no children yet. */
  add(kind: number, start: number, end: number, flags: number): number {
    const n = this.count;
    if (n === this.kind.length) this.allocate(n * 2);
    this.count = n + 1;
    this.kind[n] = kind;
    this.start[n] = start;
    this.end[n] = end;
    this.first[n] = 0;
    this.next[n] = 0;
    this.flags[n] = flags;
    this.data[n] = 0;
    return n;
  }

  kindName(n: number): string {
    return KIND_NAMES[this.kind[n]!] ?? `Kind ${this.kind[n]}`;
  }

  /** The node's source text. */
  textOf(n: number): string {
    return this.text.slice(this.start[n], this.end[n]);
  }

  /** The node's children, in source order. */
  children(n: number): number[] {
    const out: number[] = [];
    for (let c = this.first[n]!; c; c = this.next[c]!) out.push(c);
    return out;
  }

  /** Calls `visit` for each node under `n` (not `n` itself), parents before children. */
  walk(n: number, visit: (node: number, depth: number) => void, depth = 0): void {
    for (let c = this.first[n]!; c; c = this.next[c]!) {
      visit(c, depth);
      this.walk(c, visit, depth + 1);
    }
  }
}
