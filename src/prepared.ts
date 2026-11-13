// Prepared declarations (milestone 11): files parsed and bound once, written as one buffer, so that a page's first
// check reads them in place of parsing their text. The tree is already flat typed arrays (tree.ts), and so are the
// binder's answers (binder.ts): the buffer holds those arrays as they are, the files' text (the tree's nodes are
// offsets into it), the binder's symbols and what the checker would otherwise find out about each file on its first
// check (whether it may hold a module augmentation).
//
// The buffer is persisted outside smaltty's process (an app's build writes it, a browser may keep it from an earlier
// deploy), so it says what wrote it (ADR 0030, decision 3): a format version, smaltty's version and a fingerprint of
// the node kinds, flags and meanings it was written with. A buffer that differs in any of them, or whose checksum or
// layout is wrong, is not read: readPrepared() gives undefined, and check() ignores it and reads the text it is given.
//
// The layout, little-endian (the typed arrays' own byte order on every platform smaltty runs on; a buffer read on
// another fails the magic number and is ignored):
//
//   header        8 words: magic, format, fingerprint, byte length, checksum, version length, file table offset,
//                 file count; then smaltty's version (UTF-8), padded to a word
//   file table    FILE_WORDS words per file (see the `W` offsets below)
//   per file      its path and text (UTF-8); then, if it parsed, its columns (start, end, first, next as
//                 differences: start from the row before's, end from start, first and next from the row; flags and
//                 symbolOf as Int32; data as Int16; kind, meaningOf as Uint8), its symbols (4 words each:
//                 meaning, name offset, name length, first declaration) and their declarations (Int32), and the
//                 symbols' names (UTF-8) that aren't their first declaration's text (length -1)
//
// Every section starts on a word, so the columns not rebuilt are read as views of the buffer, not copied.
import { Bindings, Meaning, bind, type BindSymbol } from './binder.js';
import { F, KIND_NAMES } from './kinds.js';
import { parse } from './parser.js';
import { Tree } from './tree.js';
import { VERSION } from './version.js';

// TextEncoder and TextDecoder are in every page, worker and Node; the build's lib (es2023) doesn't declare them.
declare const TextEncoder: { new (): { encode(text: string): Uint8Array } };
declare const TextDecoder: { new (label?: string, options?: { fatal?: boolean }): { decode(bytes: Uint8Array): string } };

/** The buffer's format. A buffer of another format is not read. */
export const PREPARED_FORMAT = 1;

const MAGIC = 0x59544d53; // 'SMTY', little-endian
const HEADER_WORDS = 8;
const H = { magic: 0, format: 1, fingerprint: 2, length: 3, checksum: 4, versionLength: 5, table: 6, count: 7 } as const;
/** Per file in the file table: byte offsets and lengths, counts. */
const W = {
  pathOffset: 0,
  pathLength: 1,
  textOffset: 2,
  textLength: 3,
  flags: 4,
  count: 5,
  root: 6,
  columns: 7,
  symbols: 8,
  symbolCount: 9,
  declarations: 10,
  declarationCount: 11,
  names: 12,
  namesLength: 13,
} as const;
const FILE_WORDS = 14;
/** File flags: it parsed (a file that doesn't declares nothing the checker can use); its text may augment a module. */
const PARSED = 1;
const AUGMENTS = 2;

/** A file read from a prepared buffer: its tree and names, as the checker reads any file's. */
export interface PreparedSource {
  readonly path: string;
  readonly tree: Tree;
  readonly bindings: Bindings;
}

/**
 * Prepared declarations, read from a buffer (readPrepared()): the files' trees and names, each made when the checker
 * first asks for it and then kept, so checks that share one read each file once.
 */
export class PreparedFiles {
  /** The smaltty version that wrote the buffer (always this one's: another isn't read). */
  readonly version: string;
  /** The files, in the order they were prepared. */
  readonly paths: readonly string[];
  /** @internal */
  readonly entries: ReadonlyMap<string, PreparedEntry>;

  /** @internal */
  constructor(version: string, entries: Map<string, PreparedEntry>) {
    this.version = version;
    this.entries = entries;
    this.paths = [...entries.keys()];
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  /** A file's text. */
  text(path: string): string | undefined {
    return this.entries.get(path)?.text();
  }

  /**
   * Reads every file now (each is otherwise read when a check first asks for it), for a worker that warms itself
   * while the page is idle.
   */
  readAll(): this {
    for (const entry of this.entries.values()) entry.source();
    return this;
  }
}

/** @internal One file of a buffer: its text and tree, read when first asked for. */
export class PreparedEntry {
  private readonly bytes: Uint8Array;
  private readonly words: Int32Array;
  private readonly at: number;
  private textCache: string | undefined;
  private sourceCache: PreparedSource | null | undefined;
  readonly path: string;
  /** Whether its text may hold a module augmentation (`declare module`), as the checker's text search finds. */
  readonly augments: boolean;

  constructor(bytes: Uint8Array, words: Int32Array, at: number, path: string) {
    this.bytes = bytes;
    this.words = words;
    this.at = at;
    this.path = path;
    this.augments = (words[at + W.flags]! & AUGMENTS) !== 0;
  }

  text(): string {
    const w = this.words;
    return (this.textCache ??= decode(this.bytes, w[this.at + W.textOffset]!, w[this.at + W.textLength]!));
  }

  /** Its tree and bindings, or null for a file that didn't parse. */
  source(): PreparedSource | null {
    if (this.sourceCache !== undefined) return this.sourceCache;
    const w = this.words;
    const at = this.at;
    if (!(w[at + W.flags]! & PARSED)) return (this.sourceCache = null);
    const buffer = this.bytes.buffer;
    const base = this.bytes.byteOffset;
    const n = w[at + W.count]!;
    let c = base + w[at + W.columns]!;
    const view = () => {
      const a = new Int32Array(buffer, c, n);
      c += n * 4;
      return a;
    };
    // start, end, first and next are written as differences (they compress far better), so they are rebuilt; the
    // parents, which the binder finds from first and next, are found again here.
    const columns = new ArrayBuffer(n * 20);
    const start = new Int32Array(columns, 0, n);
    const end = new Int32Array(columns, n * 4, n);
    const first = new Int32Array(columns, n * 8, n);
    const next = new Int32Array(columns, n * 12, n);
    const parent = new Int32Array(columns, n * 16, n);
    const dStart = view();
    const dEnd = view();
    const dFirst = view();
    const dNext = view();
    let s0 = 0;
    for (let i = 0; i < n; i++) {
      s0 += dStart[i]!;
      start[i] = s0;
      end[i] = s0 + dEnd[i]!;
      const f = dFirst[i]!;
      first[i] = f === 0 ? 0 : i + f;
      const x = dNext[i]!;
      next[i] = x === 0 ? 0 : i + x;
    }
    for (let i = 0; i < n; i++) for (let k = first[i]!; k; k = next[k]!) parent[k] = i;
    const flags = view();
    const symbolOf = view();
    const data = new Int16Array(buffer, c, n);
    c += pad(n * 2);
    const kind = new Uint8Array(buffer, c, n);
    c += pad(n);
    const meaningOf = new Uint8Array(buffer, c, n);
    const tree = new Tree(this.text(), this.path, { count: n, root: w[at + W.root]!, kind, start, end, first, next, flags, data });
    // The symbols: their names are one string, sliced.
    const names = decode(this.bytes, w[at + W.names]!, w[at + W.namesLength]!);
    const symbolCount = w[at + W.symbolCount]!;
    const s = (base + w[at + W.symbols]!) >> 2;
    const d = (base + w[at + W.declarations]!) >> 2;
    const all = new Int32Array(buffer);
    const declarationCount = w[at + W.declarationCount]!;
    const symbols: BindSymbol[] = new Array(symbolCount);
    for (let i = 0; i < symbolCount; i++) {
      const r = s + i * 4;
      const from = all[r + 3]!;
      const to = i + 1 < symbolCount ? all[r + 7]! : declarationCount;
      const declarations: number[] = new Array(to - from);
      for (let j = from; j < to; j++) declarations[j - from] = all[d + j]!;
      // A name length of -1: the name is its first declaration's text, as most are.
      const length = all[r + 2]!;
      const name = length < 0 ? tree.textOf(declarations[0]!) : names.slice(all[r + 1]!, all[r + 1]! + length);
      symbols[i] = { name, meaning: all[r]!, declarations };
    }
    const bindings = new Bindings(tree, { symbols, symbolOf, meaningOf, parent });
    return (this.sourceCache = { path: this.path, tree, bindings });
  }
}

const pad = (n: number): number => (n + 3) & ~3;

let utf8: { decode(bytes: Uint8Array): string } | undefined;
function decode(bytes: Uint8Array, offset: number, length: number): string {
  return (utf8 ??= new TextDecoder('utf-8', { fatal: true })).decode(bytes.subarray(offset, offset + length));
}

let fingerprintValue: number | undefined;
/** A hash of what a buffer's numbers mean: the node kinds' names by number, the flags and the meanings. */
function fingerprint(): number {
  if (fingerprintValue !== undefined) return fingerprintValue;
  const text = `${KIND_NAMES.join(',')}|${JSON.stringify(F)}|${JSON.stringify(Meaning)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (fingerprintValue = h | 0);
}

/** A checksum of the buffer's words, all but the checksum's own (Fletcher's, on words: cheap, and order matters). */
function checksum(words: Int32Array): number {
  let a = words.length | 0;
  let b = 0;
  for (let i = 0; i < words.length; i++) {
    a = (a + (i === H.checksum ? 0 : words[i]!)) | 0;
    b = (b + a) | 0;
  }
  return (a ^ Math.imul(b, 0x9e3779b1)) | 0;
}

/**
 * Prepares files (path to text: a library's declarations, `.d.ts`, or any TypeScript the checker reads for its
 * declarations) for check(): each file parsed and bound, as check() would on its first look at it, and written with
 * its text as one buffer. Give the buffer to check() as `prepared` (or read it first with readPrepared()), beside the
 * same files' text where the buffer may come from another smaltty: a buffer this smaltty can't read is ignored, and
 * the text read instead.
 */
export function prepare(files: ReadonlyMap<string, string> | Readonly<Record<string, string>>): Uint8Array {
  const list: [string, string][] = files instanceof Map ? [...(files as ReadonlyMap<string, string>)] : Object.entries(files);
  const encoder = new TextEncoder();
  const version = encoder.encode(VERSION);
  interface Part {
    path: Uint8Array;
    text: Uint8Array;
    flags: number;
    tree?: Tree;
    bindings?: Bindings;
    names?: Uint8Array;
    nameAt?: Int32Array;
    declarationCount?: number;
  }
  const parts: Part[] = list.map(([path, text]) => {
    const part: Part = { path: encoder.encode(path), text: encoder.encode(text), flags: text.includes('declare module') ? AUGMENTS : 0 };
    let tree: Tree;
    try {
      tree = parse(text, { fileName: path });
    } catch {
      return part; // declares nothing, as check() takes it
    }
    const bindings = bind(tree);
    // The names as one string, each by its offset and length in UTF-16 units (what slice() takes).
    const nameAt = new Int32Array(bindings.symbols.length * 2);
    let joined = '';
    bindings.symbols.forEach((s, i) => {
      if (s.declarations.length && tree.textOf(s.declarations[0]!) === s.name) {
        nameAt[i * 2 + 1] = -1; // read back from the tree
        return;
      }
      nameAt[i * 2] = joined.length;
      nameAt[i * 2 + 1] = s.name.length;
      joined += s.name;
    });
    part.flags |= PARSED;
    part.tree = tree;
    part.bindings = bindings;
    part.names = encoder.encode(joined);
    part.nameAt = nameAt;
    part.declarationCount = bindings.symbols.reduce((n, s) => n + s.declarations.length, 0);
    return part;
  });
  // Sizes first, then one buffer.
  let size = (HEADER_WORDS << 2) + pad(version.length);
  const table = size;
  size += parts.length * FILE_WORDS * 4;
  const at: number[][] = [];
  for (const p of parts) {
    const o: number[] = [];
    o[W.pathOffset] = size;
    size += pad(p.path.length);
    o[W.textOffset] = size;
    size += pad(p.text.length);
    if (p.tree) {
      const n = p.tree.count;
      o[W.columns] = size;
      size += 6 * n * 4 + pad(n * 2) + pad(n) + pad(n);
      o[W.symbols] = size;
      size += p.bindings!.symbols.length * 16;
      o[W.declarations] = size;
      size += p.declarationCount! * 4;
      o[W.names] = size;
      size += pad(p.names!.length);
    }
    at.push(o);
  }
  const buffer = new ArrayBuffer(size);
  const bytes = new Uint8Array(buffer);
  const words = new Int32Array(buffer);
  words[H.magic] = MAGIC;
  words[H.format] = PREPARED_FORMAT;
  words[H.fingerprint] = fingerprint();
  words[H.length] = size;
  words[H.versionLength] = version.length;
  words[H.table] = table;
  words[H.count] = parts.length;
  bytes.set(version, HEADER_WORDS << 2);
  parts.forEach((p, i) => {
    const o = at[i]!;
    const row = (table >> 2) + i * FILE_WORDS;
    bytes.set(p.path, o[W.pathOffset]!);
    bytes.set(p.text, o[W.textOffset]!);
    words[row + W.pathOffset] = o[W.pathOffset]!;
    words[row + W.pathLength] = p.path.length;
    words[row + W.textOffset] = o[W.textOffset]!;
    words[row + W.textLength] = p.text.length;
    words[row + W.flags] = p.flags;
    if (!p.tree) return;
    const t = p.tree;
    const b = p.bindings!;
    const n = t.count;
    words[row + W.count] = n;
    words[row + W.root] = t.root;
    let c = o[W.columns]!;
    const column = () => {
      const a = new Int32Array(buffer, c, n);
      c += n * 4;
      return a;
    };
    const dStart = column();
    const dEnd = column();
    const dFirst = column();
    const dNext = column();
    for (let i = 0; i < n; i++) {
      dStart[i] = t.start[i]! - (i ? t.start[i - 1]! : 0);
      dEnd[i] = t.end[i]! - t.start[i]!;
      dFirst[i] = t.first[i] ? t.first[i]! - i : 0;
      dNext[i] = t.next[i] ? t.next[i]! - i : 0;
    }
    column().set(t.flags.subarray(0, n));
    column().set(b.symbolOf.subarray(0, n));
    new Int16Array(buffer, c, n).set(t.data.subarray(0, n));
    c += pad(n * 2);
    bytes.set(t.kind.subarray(0, n), c);
    c += pad(n);
    bytes.set(b.meaningOf.subarray(0, n), c);
    words[row + W.columns] = o[W.columns]!;
    words[row + W.symbols] = o[W.symbols]!;
    words[row + W.symbolCount] = b.symbols.length;
    words[row + W.declarations] = o[W.declarations]!;
    words[row + W.declarationCount] = p.declarationCount!;
    words[row + W.names] = o[W.names]!;
    words[row + W.namesLength] = p.names!.length;
    let s = o[W.symbols]! >> 2;
    let d = 0;
    const decls = o[W.declarations]! >> 2;
    b.symbols.forEach((sym, k) => {
      words[s] = sym.meaning;
      words[s + 1] = p.nameAt![k * 2]!;
      words[s + 2] = p.nameAt![k * 2 + 1]!;
      words[s + 3] = d;
      s += 4;
      for (const x of sym.declarations) words[decls + d++] = x;
    });
    bytes.set(p.names!, o[W.names]!);
  });
  words[H.checksum] = checksum(words);
  return bytes;
}

const read = new WeakMap<object, PreparedFiles | null>();

/**
 * Reads a buffer prepare() wrote, or gives undefined when this smaltty can't: another format or smaltty version
 * (a buffer kept from an earlier deploy), or a buffer cut short or changed. Then read the text instead. A buffer is
 * read once: reading it again gives the same files.
 */
export function readPrepared(buffer: ArrayBuffer | ArrayBufferView | PreparedFiles): PreparedFiles | undefined {
  if (buffer instanceof PreparedFiles) return buffer;
  const known = read.get(buffer);
  if (known !== undefined) return known ?? undefined;
  let files: PreparedFiles | null;
  try {
    files = readBuffer(buffer);
  } catch {
    files = null; // a layout this smaltty can't follow
  }
  read.set(buffer, files);
  return files ?? undefined;
}

function readBuffer(buffer: ArrayBuffer | ArrayBufferView): PreparedFiles | null {
  const bytes = ArrayBuffer.isView(buffer) ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) : new Uint8Array(buffer);
  if (bytes.byteLength < HEADER_WORDS * 4 || bytes.byteLength % 4 !== 0) return null;
  // Word views need a word-aligned start: a buffer that isn't is copied once.
  const aligned = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
  const words = new Int32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength >> 2);
  if (words[H.magic] !== MAGIC || words[H.format] !== PREPARED_FORMAT || words[H.fingerprint] !== fingerprint()) return null;
  if (words[H.length] !== aligned.byteLength || words[H.checksum] !== checksum(words)) return null;
  const version = decode(aligned, HEADER_WORDS << 2, words[H.versionLength]!);
  if (version !== VERSION) return null;
  const table = words[H.table]! >> 2;
  const count = words[H.count]!;
  if (table + count * FILE_WORDS > words.length) return null;
  const entries = new Map<string, PreparedEntry>();
  for (let i = 0; i < count; i++) {
    const row = table + i * FILE_WORDS;
    const path = decode(aligned, words[row + W.pathOffset]!, words[row + W.pathLength]!);
    if (!entries.has(path)) entries.set(path, new PreparedEntry(aligned, words, row, path));
  }
  return new PreparedFiles(version, entries);
}
