// Class members whose modifiers and types are erasable (no parameter properties).
abstract class Base<T> implements Iterable<T> {
  abstract size: number;
  protected abstract item(i: number): T;
  declare readonly brand: 'base';
  private static count = 0;
  public readonly name?: string;
  #secret!: number;
  override toString(): string { return 'Base'; }
  *[Symbol.iterator](): Iterator<T> { for (let i = 0; i < this.size; i++) yield this.item(i); }
  static create<U>(this: new () => U): U { return new this(); }
  accessor tagged = 1;
  get value(): T | undefined { return undefined; }
  set value(_: T | undefined) {}
  method(this: Base<T>, x?: number): asserts x {}
  overloaded(a: string): string;
  overloaded(a: number): number;
  overloaded(a: string | number): string | number { return a; }
}
class Derived extends Base<number> implements Base<number> {
  size = 0;
  protected item(i: number): number { return i; }
}
const Anon = class<T> extends Base<T> { size = 1; protected item(): T { return undefined!; } };
export { Base, Derived, Anon };
