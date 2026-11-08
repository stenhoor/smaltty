// Code TypeScript accepts and sucrase rejects. smaltty follows TypeScript here.
const a = 1;
// TypeScript reads `(a as number) < 2`; sucrase reads `number<` as the start of type arguments.
const v = a as number < 2;
export { v };
