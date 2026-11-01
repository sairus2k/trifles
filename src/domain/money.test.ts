import { describe, expect, test } from "vitest";
import { formatAmount, fromCents, toCents } from "./money";

describe("toCents", () => {
  test.each([
    ["12.5", 2, 1250],
    ["100.0", 2, 10000],
    ["0", 2, 0],
    ["-3.12", 2, -312],
    ["7", 0, 7],
    ["1.234", 3, 1234],
  ])("%s at scale %i is %i", (decimal, scale, cents) => {
    expect(toCents(decimal, scale)).toBe(cents);
  });

  // Each of these drifts when computed as parseFloat(x) * 100.
  test.each([
    ["1.005", 101],
    ["0.29", 29],
    ["4.35", 435],
    ["1234567.89", 123456789],
  ])("%s is exact: %i", (decimal, cents) => {
    expect(toCents(decimal, 2)).toBe(cents);
  });

  test.each([
    ["-3.1234", 2, -312],
    ["0.005", 2, 1],
    ["-0.005", 2, -1],
    ["0.0049", 2, 0],
    ["2.5", 0, 3],
    ["-2.5", 0, -3],
  ])("%s at scale %i rounds half away from zero to %i", (decimal, scale, cents) => {
    expect(toCents(decimal, scale)).toBe(cents);
  });

  test("never returns negative zero", () => {
    expect(Object.is(toCents("-0.001", 2), 0)).toBe(true);
  });

  test.each(["", "1,5", "1e3", " 1", "1.", ".5", "+1", "--1", "abc", "Infinity"])(
    "rejects %j",
    (decimal) => {
      expect(() => toCents(decimal, 2)).toThrow(RangeError);
    },
  );

  test("rejects amounts beyond the safe integer range", () => {
    expect(() => toCents("90071992547409.92", 2)).toThrow(RangeError);
  });
});

describe("fromCents", () => {
  test.each([
    [1250, 2, "12.50"],
    [-5, 2, "-0.05"],
    [0, 2, "0.00"],
    [12345, 0, "12345"],
    [-1, 3, "-0.001"],
  ])("%i at scale %i is %s", (cents, scale, decimal) => {
    expect(fromCents(cents, scale)).toBe(decimal);
  });

  test.each([1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("rejects %d", (cents) => {
    expect(() => fromCents(cents, 2)).toThrow(RangeError);
  });

  test("round-trips through toCents", () => {
    for (const cents of [0, 1, -1, 99, -100, 123456789]) {
      expect(toCents(fromCents(cents, 2), 2)).toBe(cents);
    }
  });
});

describe("formatAmount", () => {
  test.each([
    ["-3.5", "EUR", "-€3.50"],
    ["1200", "JPY", "¥1,200"],
    ["1.5", "KWD", "KWD\u00a01.500"],
    ["12.3456", "EUR", "€12.35"],
    ["-0", "EUR", "€0.00"],
  ])("%s %s → %s, with the digits Sure uses for the currency", (decimal, currency, expected) => {
    expect(formatAmount(decimal, currency, "en-US")).toBe(expected);
  });
});
