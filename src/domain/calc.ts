import { divRound, fromCents } from "./money";

// A hand-written parser: the amount field is user input, so eval and new Function are off limits.
// Grammar: expr = term (("+" | "-") term)*, term = number (("*" | "/") number)*. No parentheses or
// unary minus: the on-screen operator row has neither.

export type CalcError = "empty" | "invalid" | "division-by-zero" | "not-positive" | "too-large";

export type CalcResult =
  | { ok: true; value: string }
  | { ok: false; error: CalcError; message: string };

const MESSAGES: Record<CalcError, string> = {
  empty: "Enter an amount",
  invalid: "Not a valid amount",
  "division-by-zero": "Cannot divide by zero",
  "not-positive": "The amount must be greater than zero",
  "too-large": "The amount is too large",
};

type Operator = "+" | "-" | "*" | "/";
type Token = { kind: "number"; value: Fraction } | { kind: "operator"; operator: Operator };

/** Exact rational number, `d > 0`. */
interface Fraction {
  n: bigint;
  d: bigint;
}

const OPERATORS: Record<string, Operator> = {
  "+": "+",
  "-": "-",
  "−": "-",
  "*": "*",
  "×": "*",
  "/": "/",
  "÷": "/",
};

const TOKEN = /\s*(?:(\d+(?:[.,]\d*)?|[.,]\d+)|([-+*/−×÷]))/y;

class Failure extends Error {
  constructor(readonly error: CalcError) {
    super(error);
  }
}

/** `evaluateAmount("120+35.5-10", 2)` → `{ ok: true, value: "145.50" }`, rounded half away from zero. */
export function evaluateAmount(input: string, scale: number): CalcResult {
  try {
    const result = evaluate(tokenize(input));
    const cents = divRound(result.n * 10n ** BigInt(scale), result.d);
    if (cents <= 0n) throw new Failure("not-positive");
    if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Failure("too-large");
    return { ok: true, value: fromCents(Number(cents), scale) };
  } catch (e) {
    if (!(e instanceof Failure)) throw e;
    return { ok: false, error: e.error, message: MESSAGES[e.error] };
  }
}

function tokenize(input: string): Token[] {
  const source = input.trim();
  if (source === "") throw new Failure("empty");
  const tokens: Token[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.length) {
    const match = TOKEN.exec(source);
    if (!match) throw new Failure("invalid");
    const [, number, operator] = match;
    tokens.push(
      number === undefined
        ? { kind: "operator", operator: OPERATORS[operator] }
        : { kind: "number", value: parseNumber(number) },
    );
  }
  return tokens;
}

function parseNumber(text: string): Fraction {
  const [int, frac = ""] = text.replace(",", ".").split(".");
  return { n: BigInt((int || "0") + frac), d: 10n ** BigInt(frac.length) };
}

function evaluate(tokens: Token[]): Fraction {
  let i = 0;

  const number = (): Fraction => {
    const token = tokens[i++];
    if (token?.kind !== "number") throw new Failure("invalid");
    return token.value;
  };

  const term = (): Fraction => {
    let acc = number();
    for (
      let t = tokens[i];
      t?.kind === "operator" && (t.operator === "*" || t.operator === "/");
      t = tokens[i]
    ) {
      i++;
      const rhs = number();
      if (t.operator === "*") {
        acc = { n: acc.n * rhs.n, d: acc.d * rhs.d };
      } else {
        if (rhs.n === 0n) throw new Failure("division-by-zero");
        acc = { n: acc.n * rhs.d, d: acc.d * rhs.n };
      }
    }
    return acc;
  };

  let acc = term();
  while (i < tokens.length) {
    const token = tokens[i++];
    if (token.kind !== "operator") throw new Failure("invalid");
    const rhs = term();
    const sign = token.operator === "+" ? 1n : -1n;
    acc = { n: acc.n * rhs.d + sign * rhs.n * acc.d, d: acc.d * rhs.d };
  }
  return acc;
}
