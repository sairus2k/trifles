// Sure sends amounts as decimal strings (`amount_decimal`, up to 4 fraction digits) and balances in
// minor units. Converting through floats drifts (1.005 * 100 = 100.49999…), so everything here works
// on strings and BigInt. The scale comes from the caller: Intl's currency digits disagree with Sure's
// own currency table for dozens of currencies.

import { amountScale } from "./currency";

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Divides and rounds half away from zero, like Sure's `BigDecimal#round` for `balance_cents`. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twice = (remainder < 0n ? -remainder : remainder) * 2n;
  if (twice < denominator) return quotient;
  return numerator < 0n ? quotient - 1n : quotient + 1n;
}

/** `"-1.25"` → `[-125n, 2]`. */
function parseDecimal(decimal: string): [units: bigint, scale: number] {
  const match = DECIMAL.exec(decimal);
  if (!match) throw new RangeError(`Not a decimal string: ${JSON.stringify(decimal)}`);
  const [, sign, int, frac = ""] = match;
  return [BigInt(sign + int + frac), frac.length];
}

/** `[-125n, 2]` → `"-1.25"`. */
function formatDecimal(units: bigint, scale: number): string {
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, "0");
  const int = digits.slice(0, digits.length - scale);
  const sign = units < 0n ? "-" : "";
  return scale === 0 ? sign + int : `${sign}${int}.${digits.slice(-scale)}`;
}

/** `toCents("12.5", 2)` → `1250`. Extra fraction digits are rounded half away from zero. */
export function toCents(decimal: string, scale: number): number {
  const [units, fromScale] = parseDecimal(decimal);
  const cents = divRound(units * 10n ** BigInt(scale), 10n ** BigInt(fromScale));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`Amount out of range: ${decimal}`);
  }
  return Number(cents);
}

/** `fromCents(-5, 2)` → `"-0.05"`. */
export function fromCents(cents: number, scale: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Not a whole number of cents: ${cents}`);
  return formatDecimal(BigInt(cents), scale);
}

/**
 * Sure's `balance_cents` as an exact decimal string: `fromMinorUnits(7, 5n)` → `"1.4"`. An ETH
 * balance past 2^53 minor units already lost digits in JSON.parse, so it is display-grade only.
 */
export function fromMinorUnits(cents: number, conversion: bigint): string {
  // The smallest power of 10 the conversion divides gives an exact decimal: 5 → one digit.
  let scale = 0;
  let unit = 1n;
  while (unit % conversion !== 0n) {
    unit *= 10n;
    scale++;
  }
  return formatDecimal(BigInt(cents) * (unit / conversion), scale);
}

/** Exact sum at the larger of the two scales: `addDecimals("1200.00", "-3.5000")` → `"1196.5000"`. */
export function addDecimals(a: string, b: string): string {
  const [unitsA, scaleA] = parseDecimal(a);
  const [unitsB, scaleB] = parseDecimal(b);
  const scale = Math.max(scaleA, scaleB);
  const sum = unitsA * 10n ** BigInt(scale - scaleA) + unitsB * 10n ** BigInt(scale - scaleB);
  return formatDecimal(sum, scale);
}

/**
 * A display amount, rounded to the digits Sure uses for the currency; only a negative one is signed.
 * Display only: the float is never stored or sent.
 */
export function formatAmount(decimal: string, currency: string, locale?: string): string {
  const digits = amountScale(currency);
  // Intl accepts only three-letter codes and throws a RangeError on Sure's DOGE, USDC and USDT.
  const iso = /^[A-Za-z]{3}$/.test(currency);
  const text = new Intl.NumberFormat(locale, {
    ...(iso ? { style: "currency", currency } : {}),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    // `|| 0` turns "-0" into 0, which Intl would print as "-€0.00".
  }).format(Number(decimal) || 0);
  return iso ? text : `${text} ${currency}`;
}
