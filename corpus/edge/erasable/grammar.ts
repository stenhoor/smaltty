// Grammar corners: contextual keywords as names, ASI, regular expressions, arrows, classes, generators, labels.
let type = 1;
type = 2;
let as = 3, satisfies = 4, of = 5, get = 6, set = 7, declare = 8, readonly = 9, keyof = 10, infer = 11, is = 12;
let async = (x: number) => x;
async(1);
const namespace = 1;
namespace;
let module = { exports: {} };
module.exports = {};
declare;
abstract;
const global = globalThis;
if (type) /re/.test('x');
const div = (type / 2) / as;
const re = [/[/]/g, /\//, /a/ig];
const obj = {
  get, set, async, type, declare,
  get value(): number { return 1; },
  set value(v: number) {},
  async method() { await null; },
  *gen() { yield 1; yield* [2]; },
  async *agen() { for await (const x of []) yield x; },
  [`computed${1}`]: 1,
  'quoted': 2,
  123: 3,
  0x10n: 4,
  async: 5,
  get: 6,
};
const conditional = type ? (x: number): number => x : (y: number) => y;
const nested = type ? type ? 1 : 2 : 3;
const arrows = [() => {}, async () => {}, async (x: number) => x, async x => x, (x, y) => x + y, ({ a }: { a: 1 }) => a, ([b]: [2]) => b];
const generic = <T extends object = {}>(x: T): T => x;
const call = generic<{ a: 1 }>({ a: 1 });
const optional = obj?.value?.toFixed?.(2) ?? obj?.['quoted'];
const tagged = String.raw`a${1}b${`c${2}`}d`;
const chained = obj.gen().next().value!.toString();
const postfix = type++ + ++type - type-- - --type;
const exponent = (-2) ** 2 ** 3;
const bigint = 10n ** 2n;
const numbers = [1_000_000, 0b1010, 0o17, 0xff, 1e-3, .5, 5., 1.5e+10];
const strings = ['\'', "\"", '\u{1F600}', '\x41', 'line\
continued'];
const comma = (type, as, 3);
const assign = { a: 0, b: 0 };
assign.a += assign.b -= 1;
assign.a ||= 1;
assign.b &&= 2;
assign.a ??= 3;
let [first, , ...rest] = [1, 2, 3];
({ a: first, ...rest } = { a: 1, b: 2 } as never);
outer: for (const i of [1]) {
  inner: for (const j in {}) {
    if (i) continue outer;
    else break inner;
  }
}
do type++; while (type < 10)
switch (type) {
  case 1:
  case 2: { break; }
  default:
    type = 0;
}
try { throw new Error('x'); } catch { } finally { }
try { } catch (e: unknown) { void e; }
function* generator(): Generator<number> { const x = yield 1; void x; }
async function asyncFn(): Promise<void> { await Promise.resolve(); for await (const x of [] as AsyncIterable<number>[]) void x; }
function meta() { return new.target; }
const importMeta = import.meta.url;
const dynamic = import('./types.js');
class Fields { static #count = 0; static { Fields.#count++; } #x = 1; has(o: object) { return #x in o; } }
class implements {}
const instance = new Fields;
const newCall = new (class { m() { return 1; } })().m();
const regexAfterParen = (1) / 2;
const typeofCheck = typeof type === 'number' && typeof obj.value !== 'undefined';
const inCheck = 'a' in obj;
const instanceOf = instance instanceof Fields;
const voided = void 0;
const deleted = delete (obj as Record<string, unknown>).quoted;
const spread = [...re, ...'ab'];
const templateTypes = <T,>(x: `a${string}`) => x;
label: { break label; }
;;;
export { div, re, conditional, nested, arrows, call, optional, tagged, chained, postfix, exponent, bigint, numbers, strings, comma, first, rest, generator, asyncFn, meta, importMeta, dynamic, newCall, regexAfterParen, typeofCheck, inCheck, instanceOf, voided, deleted, spread, templateTypes, global };
