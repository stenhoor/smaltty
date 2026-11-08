// Emits code: an enum is an object at run time.
enum Color { Red, Green = 'green' }
const enum Size { Small = 1, Large = Small * 2 }
declare enum Ambient { A }
export { Color, Size, Ambient };
