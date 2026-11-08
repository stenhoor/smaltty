// Emits code: constructor parameters with modifiers become assignments.
class Point {
  constructor(public x: number, private readonly y: number, protected z = 0, override readonly w?: string) {}
}
export { Point };
