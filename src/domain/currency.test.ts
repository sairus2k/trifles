import { expect, test } from "vitest";
import { amountScale, minorUnitConversion } from "./currency";

test.each([
  ["USD", 100n],
  ["USDC", 100n],
  ["JPY", 1n],
  ["KWD", 1000n],
  ["CLF", 10_000n],
  // Not a power of 10: one minor unit is a fifth of the major one.
  ["MGA", 5n],
  ["BTC", 100_000_000n],
  ["ETH", 1_000_000_000_000_000_000n],
  ["XYZ", 100n],
])("%s balances are in units of 1/%i", (currency, conversion) => {
  expect(minorUnitConversion(currency)).toBe(conversion);
});

test.each([
  ["USD", 2],
  ["EUR", 2],
  ["JPY", 0],
  ["KRW", 0],
  ["KWD", 3],
  ["MGA", 1],
  ["CLF", 4],
  // Sure shows 8 digits but stores amounts with 4.
  ["BTC", 4],
  ["ETH", 4],
  ["XYZ", 2],
])("%s takes %i fraction digits", (currency, scale) => {
  expect(amountScale(currency)).toBe(scale);
});
