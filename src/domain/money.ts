// Sure sends amounts as decimal strings (`amount_decimal`, up to 4 fraction digits) and balances in
// minor units. Converting through floats drifts (1.005 * 100 = 100.49999…), so everything here works
// on strings and BigInt. The scale comes from the caller: Intl's currency digits disagree with Sure's
// own currency table for dozens of currencies.

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Divides and rounds half away from zero, like Sure's `BigDecimal#round` for `balance_cents`. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twice = (remainder < 0n ? -remainder : remainder) * 2n;
  if (twice < denominator) return quotient;
  return numerator < 0n ? quotient - 1n : quotient + 1n;
}

/** `toCents("12.5", 2)` → `1250`. Extra fraction digits are rounded half away from zero. */
export function toCents(decimal: string, scale: number): number {
  const match = DECIMAL.exec(decimal);
  if (!match) throw new RangeError(`Not a decimal string: ${JSON.stringify(decimal)}`);
  const [, sign, int, frac = ""] = match;
  const cents = divRound(
    BigInt(sign + int + frac) * 10n ** BigInt(scale),
    10n ** BigInt(frac.length),
  );
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`Amount out of range: ${decimal}`);
  }
  return Number(cents);
}

/** `fromCents(-5, 2)` → `"-0.05"`. */
export function fromCents(cents: number, scale: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Not a whole number of cents: ${cents}`);
  const digits = Math.abs(cents)
    .toString()
    .padStart(scale + 1, "0");
  const int = digits.slice(0, digits.length - scale);
  const sign = cents < 0 ? "-" : "";
  return scale === 0 ? sign + int : `${sign}${int}.${digits.slice(-scale)}`;
}
