import { expect, test } from "vitest";
import { amountScale } from "./currency";

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
