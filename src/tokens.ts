// Token codes for the scanner. Reserved words come before contextual keywords, so "can this be an identifier" is one
// comparison: t === T.Identifier || t >= T.FirstContextual.

const TOKENS = {
  EOF: 1,
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

  // Punctuation
  OpenBrace: 20, // {
  CloseBrace: 21, // }
  OpenParen: 22, // (
  CloseParen: 23, // )
  OpenBracket: 24, // [
  CloseBracket: 25, // ]
  Dot: 26, // .
  DotDotDot: 27, // ...
  Semicolon: 28, // ;
  Comma: 29, // ,
  QuestionDot: 30, // ?.
  LessThan: 31, // <
  LessThanSlash: 32, // </ (unused: no JSX)
  GreaterThan: 33, // >
  LessThanEquals: 34, // <=
  GreaterThanEquals: 35, // >=
  EqualsEquals: 36, // ==
  ExclamationEquals: 37, // !=
  EqualsEqualsEquals: 38, // ===
  ExclamationEqualsEquals: 39, // !==
  EqualsGreaterThan: 40, // =>
  Plus: 41, // +
  Minus: 42, // -
  Asterisk: 43, // *
  AsteriskAsterisk: 44, // **
  Slash: 45, // /
  Percent: 46, // %
  PlusPlus: 47, // ++
  MinusMinus: 48, // --
  LessThanLessThan: 49, // <<
  GreaterThanGreaterThan: 50, // >>
  GreaterThanGreaterThanGreaterThan: 51, // >>>
  Ampersand: 52, // &
  Bar: 53, // |
  Caret: 54, // ^
  Exclamation: 55, // !
  Tilde: 56, // ~
  AmpersandAmpersand: 57, // &&
  BarBar: 58, // ||
  Question: 59, // ?
  Colon: 60, // :
  At: 61, // @
  QuestionQuestion: 62, // ??
  Hash: 63, // # (alone)
  // Assignments
  Equals: 64, // =
  PlusEquals: 65,
  MinusEquals: 66,
  AsteriskEquals: 67,
  AsteriskAsteriskEquals: 68,
  SlashEquals: 69,
  PercentEquals: 70,
  LessThanLessThanEquals: 71,
  GreaterThanGreaterThanEquals: 72,
  GreaterThanGreaterThanGreaterThanEquals: 73,
  AmpersandEquals: 74,
  BarEquals: 75,
  CaretEquals: 76,
  BarBarEquals: 77,
  AmpersandAmpersandEquals: 78,
  QuestionQuestionEquals: 79,

  // Reserved words
  Break: 100,
  Case: 101,
  Catch: 102,
  Class: 103,
  Const: 104,
  Continue: 105,
  Debugger: 106,
  Default: 107,
  Delete: 108,
  Do: 109,
  Else: 110,
  Enum: 111,
  Export: 112,
  Extends: 113,
  False: 114,
  Finally: 115,
  For: 116,
  Function: 117,
  If: 118,
  Import: 119,
  In: 120,
  Instanceof: 121,
  New: 122,
  Null: 123,
  Return: 124,
  Super: 125,
  Switch: 126,
  This: 127,
  Throw: 128,
  True: 129,
  Try: 130,
  Typeof: 131,
  Var: 132,
  Void: 133,
  While: 134,
  With: 135,

  // Contextual keywords: identifiers except where the grammar says otherwise
  FirstContextual: 150,
  Abstract: 150,
  Accessor: 151,
  Any: 152,
  As: 153,
  Asserts: 154,
  Assert: 155,
  Async: 156,
  Await: 157,
  Bigint: 158,
  Boolean: 159,
  Constructor: 160,
  Declare: 161,
  Get: 162,
  Global: 163,
  Implements: 164,
  Infer: 165,
  Interface: 166,
  Intrinsic: 167,
  Is: 168,
  Keyof: 169,
  Let: 170,
  Module: 171,
  Namespace: 172,
  Never: 173,
  Number: 174,
  Object: 175,
  Of: 176,
  Out: 177,
  Override: 178,
  Package: 179,
  Private: 180,
  Protected: 181,
  Public: 182,
  Readonly: 183,
  Require: 184,
  Satisfies: 185,
  Set: 186,
  Static: 187,
  String: 188,
  Symbol: 189,
  Type: 190,
  Undefined: 191,
  Unique: 192,
  Unknown: 193,
  Using: 194,
  Yield: 195,
  From: 196,
  LastContextual: 196,
} as const;

/** Token codes, typed as plain numbers so that comparisons don't narrow. */
export const T: { readonly [Name in keyof typeof TOKENS]: number } = TOKENS;

/** Keywords by their text. */
export const KEYWORDS: ReadonlyMap<string, number> = new Map<string, number>([
  ['break', T.Break], ['case', T.Case], ['catch', T.Catch], ['class', T.Class], ['const', T.Const],
  ['continue', T.Continue], ['debugger', T.Debugger], ['default', T.Default], ['delete', T.Delete], ['do', T.Do],
  ['else', T.Else], ['enum', T.Enum], ['export', T.Export], ['extends', T.Extends], ['false', T.False],
  ['finally', T.Finally], ['for', T.For], ['function', T.Function], ['if', T.If], ['import', T.Import], ['in', T.In],
  ['instanceof', T.Instanceof], ['new', T.New], ['null', T.Null], ['return', T.Return], ['super', T.Super],
  ['switch', T.Switch], ['this', T.This], ['throw', T.Throw], ['true', T.True], ['try', T.Try], ['typeof', T.Typeof],
  ['var', T.Var], ['void', T.Void], ['while', T.While], ['with', T.With],
  ['abstract', T.Abstract], ['accessor', T.Accessor], ['any', T.Any], ['as', T.As], ['asserts', T.Asserts],
  ['assert', T.Assert], ['async', T.Async], ['await', T.Await], ['bigint', T.Bigint], ['boolean', T.Boolean],
  ['constructor', T.Constructor], ['declare', T.Declare], ['get', T.Get], ['global', T.Global],
  ['implements', T.Implements], ['infer', T.Infer], ['interface', T.Interface], ['intrinsic', T.Intrinsic],
  ['is', T.Is], ['keyof', T.Keyof], ['let', T.Let], ['module', T.Module], ['namespace', T.Namespace],
  ['never', T.Never], ['number', T.Number], ['object', T.Object], ['of', T.Of], ['out', T.Out],
  ['override', T.Override], ['package', T.Package], ['private', T.Private], ['protected', T.Protected],
  ['public', T.Public], ['readonly', T.Readonly], ['require', T.Require], ['satisfies', T.Satisfies], ['set', T.Set],
  ['static', T.Static], ['string', T.String], ['symbol', T.Symbol], ['type', T.Type], ['undefined', T.Undefined],
  ['unique', T.Unique], ['unknown', T.Unknown], ['using', T.Using], ['yield', T.Yield], ['from', T.From],
]);

/** Text for a punctuation token, for error messages. */
export const PUNCTUATION: Readonly<Record<number, string>> = {
  [T.OpenBrace]: '{', [T.CloseBrace]: '}', [T.OpenParen]: '(', [T.CloseParen]: ')', [T.OpenBracket]: '[',
  [T.CloseBracket]: ']', [T.Dot]: '.', [T.DotDotDot]: '...', [T.Semicolon]: ';', [T.Comma]: ',', [T.QuestionDot]: '?.',
  [T.LessThan]: '<', [T.GreaterThan]: '>', [T.LessThanEquals]: '<=', [T.GreaterThanEquals]: '>=', [T.EqualsEquals]: '==',
  [T.ExclamationEquals]: '!=', [T.EqualsEqualsEquals]: '===', [T.ExclamationEqualsEquals]: '!==',
  [T.EqualsGreaterThan]: '=>', [T.Plus]: '+', [T.Minus]: '-', [T.Asterisk]: '*', [T.AsteriskAsterisk]: '**',
  [T.Slash]: '/', [T.Percent]: '%', [T.PlusPlus]: '++', [T.MinusMinus]: '--', [T.LessThanLessThan]: '<<',
  [T.GreaterThanGreaterThan]: '>>', [T.GreaterThanGreaterThanGreaterThan]: '>>>', [T.Ampersand]: '&', [T.Bar]: '|',
  [T.Caret]: '^', [T.Exclamation]: '!', [T.Tilde]: '~', [T.AmpersandAmpersand]: '&&', [T.BarBar]: '||',
  [T.Question]: '?', [T.Colon]: ':', [T.At]: '@', [T.QuestionQuestion]: '??', [T.Hash]: '#', [T.Equals]: '=',
  [T.PlusEquals]: '+=', [T.MinusEquals]: '-=', [T.AsteriskEquals]: '*=', [T.AsteriskAsteriskEquals]: '**=',
  [T.SlashEquals]: '/=', [T.PercentEquals]: '%=', [T.LessThanLessThanEquals]: '<<=',
  [T.GreaterThanGreaterThanEquals]: '>>=', [T.GreaterThanGreaterThanGreaterThanEquals]: '>>>=', [T.AmpersandEquals]: '&=',
  [T.BarEquals]: '|=', [T.CaretEquals]: '^=', [T.BarBarEquals]: '||=', [T.AmpersandAmpersandEquals]: '&&=',
  [T.QuestionQuestionEquals]: '??=', [T.EOF]: 'end of file',
};

export const isAssignment = (t: number): boolean => t >= T.Equals && t <= T.QuestionQuestionEquals;
export const isIdentifierToken = (t: number): boolean => t === T.Identifier || t >= T.FirstContextual;
export const isKeyword = (t: number): boolean => t >= T.Break;
