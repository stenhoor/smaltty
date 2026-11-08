// Node kinds. The names, and the shape of the tree, follow TypeScript's own syntax tree (ts.SyntaxKind), so code that
// knows TypeScript's tree reads this one, and the tests compare the two node for node. The numbers are smaltty's.
// Type nodes are numbered together, so "is this a type" is a range check (isTypeNode).

const KINDS = {
  None: 0,
  SourceFile: 1,

  // Names and literals
  Identifier: 2,
  PrivateIdentifier: 3,
  NumericLiteral: 4,
  BigIntLiteral: 5,
  StringLiteral: 6,
  RegularExpressionLiteral: 7,
  NoSubstitutionTemplateLiteral: 8,
  TemplateHead: 9,
  TemplateMiddle: 10,
  TemplateTail: 11,
  QualifiedName: 12,
  ComputedPropertyName: 13,

  // Keywords that are expressions
  ThisKeyword: 14,
  SuperKeyword: 15,
  NullKeyword: 16,
  TrueKeyword: 17,
  FalseKeyword: 18,
  ImportKeyword: 19,

  // Types (FirstType..LastType)
  AnyKeyword: 30,
  UnknownKeyword: 31,
  NumberKeyword: 32,
  BigIntKeyword: 33,
  ObjectKeyword: 34,
  BooleanKeyword: 35,
  StringKeyword: 36,
  SymbolKeyword: 37,
  VoidKeyword: 38,
  UndefinedKeyword: 39,
  NeverKeyword: 40,
  IntrinsicKeyword: 41,
  TypePredicate: 42,
  TypeReference: 43,
  FunctionType: 44,
  ConstructorType: 45,
  TypeQuery: 46,
  TypeLiteral: 47,
  ArrayType: 48,
  TupleType: 49,
  OptionalType: 50,
  RestType: 51,
  UnionType: 52,
  IntersectionType: 53,
  ConditionalType: 54,
  InferType: 55,
  ParenthesizedType: 56,
  ThisType: 57,
  TypeOperator: 58,
  IndexedAccessType: 59,
  MappedType: 60,
  LiteralType: 61,
  NamedTupleMember: 62,
  TemplateLiteralType: 63,
  TemplateLiteralTypeSpan: 64,
  ImportType: 65,

  // Declarations that are only types
  TypeParameter: 70,
  PropertySignature: 71,
  MethodSignature: 72,
  CallSignature: 73,
  ConstructSignature: 74,
  IndexSignature: 75,
  InterfaceDeclaration: 76,
  TypeAliasDeclaration: 77,

  // Members and parameters
  Parameter: 80,
  PropertyDeclaration: 81,
  MethodDeclaration: 82,
  ClassStaticBlockDeclaration: 83,
  Constructor: 84,
  GetAccessor: 85,
  SetAccessor: 86,
  SemicolonClassElement: 87,
  HeritageClause: 88,
  ExpressionWithTypeArguments: 89,

  // Binding patterns
  ObjectBindingPattern: 90,
  ArrayBindingPattern: 91,
  BindingElement: 92,

  // Expressions
  ArrayLiteralExpression: 100,
  ObjectLiteralExpression: 101,
  PropertyAccessExpression: 102,
  ElementAccessExpression: 103,
  CallExpression: 104,
  NewExpression: 105,
  TaggedTemplateExpression: 106,
  TypeAssertionExpression: 107,
  ParenthesizedExpression: 108,
  FunctionExpression: 109,
  ArrowFunction: 110,
  DeleteExpression: 111,
  TypeOfExpression: 112,
  VoidExpression: 113,
  AwaitExpression: 114,
  PrefixUnaryExpression: 115,
  PostfixUnaryExpression: 116,
  BinaryExpression: 117,
  ConditionalExpression: 118,
  TemplateExpression: 119,
  YieldExpression: 120,
  SpreadElement: 121,
  ClassExpression: 122,
  OmittedExpression: 123,
  AsExpression: 124,
  NonNullExpression: 125,
  MetaProperty: 126,
  SatisfiesExpression: 127,
  TemplateSpan: 128,
  PropertyAssignment: 129,
  ShorthandPropertyAssignment: 130,
  SpreadAssignment: 131,

  // Statements
  Block: 140,
  EmptyStatement: 141,
  VariableStatement: 142,
  ExpressionStatement: 143,
  IfStatement: 144,
  DoStatement: 145,
  WhileStatement: 146,
  ForStatement: 147,
  ForInStatement: 148,
  ForOfStatement: 149,
  ContinueStatement: 150,
  BreakStatement: 151,
  ReturnStatement: 152,
  SwitchStatement: 153,
  LabeledStatement: 154,
  ThrowStatement: 155,
  TryStatement: 156,
  DebuggerStatement: 157,
  VariableDeclaration: 158,
  VariableDeclarationList: 159,
  FunctionDeclaration: 160,
  ClassDeclaration: 161,
  EnumDeclaration: 162,
  ModuleDeclaration: 163,
  ModuleBlock: 164,
  CaseBlock: 165,
  ImportEqualsDeclaration: 166,
  ImportDeclaration: 167,
  ImportClause: 168,
  NamespaceImport: 169,
  NamedImports: 170,
  ImportSpecifier: 171,
  ExportAssignment: 172,
  ExportDeclaration: 173,
  NamedExports: 174,
  NamespaceExport: 175,
  ExportSpecifier: 176,
  ExternalModuleReference: 177,
  ImportAttributes: 178,
  ImportAttribute: 179,
  CaseClause: 180,
  DefaultClause: 181,
  CatchClause: 182,
  EnumMember: 183,
} as const;

/** Node kinds, typed as plain numbers so that comparisons don't narrow. */
export const K: { readonly [Name in keyof typeof KINDS]: number } = KINDS;

export const FirstType = KINDS.AnyKeyword;
export const LastType = KINDS.ImportType;

/** A node that is a type (a keyword type, a reference, a literal type …). */
export const isTypeNode = (kind: number): boolean => kind >= FirstType && kind <= LastType;

/** Kind names by number, as TypeScript names them. */
export const KIND_NAMES: readonly string[] = (() => {
  const names: string[] = [];
  for (const [name, value] of Object.entries(K)) names[value] = name;
  return names;
})();

// Flags: modifiers, and per-kind facts. A node's flags are in Tree.flags.
export const F = {
  Export: 1 << 0,
  Default: 1 << 1,
  Declare: 1 << 2,
  Abstract: 1 << 3,
  Public: 1 << 4,
  Private: 1 << 5,
  Protected: 1 << 6,
  Readonly: 1 << 7,
  Static: 1 << 8,
  Override: 1 << 9,
  Async: 1 << 10,
  Const: 1 << 11, // const modifier on a type parameter; const declarations (VariableDeclarationList)
  Accessor: 1 << 12,
  In: 1 << 13,
  Out: 1 << 14,
  /** Any modifier above. */
  Modifiers: (1 << 15) - 1,

  Let: 1 << 15, // VariableDeclarationList
  Using: 1 << 16, // VariableDeclarationList (using / await using)
  Optional: 1 << 17, // `?` on a name, a property access or call (`?.`), a tuple member
  Exclamation: 1 << 18, // definite assignment `!`
  Rest: 1 << 19, // `...` on a parameter, binding element or tuple member
  Generator: 1 << 20, // `*`
  TypeOnly: 1 << 21, // import type / export type / `type` on a specifier
  TypeOf: 1 << 22, // `typeof import(…)`
  ExportEquals: 1 << 23, // export = (ExportAssignment)
  Await: 1 << 24, // for await, await using
  Asserts: 1 << 25, // asserts on a TypePredicate
  Namespace: 1 << 26, // ModuleDeclaration written with `namespace`, not `module` or `global`
  Global: 1 << 27, // declare global
  /** A BindingElement with a property name: `{ a: b }`, whose first child is the property and second the name. */
  PropertyName: 1 << 28,
  /** `+` or `-` on a mapped type's readonly (ReadonlyPlus/Minus) and ? (QuestionPlus/Minus). */
  MappedReadonly: 1 << 29,
  MappedQuestion: 1 << 30,
} as const;
