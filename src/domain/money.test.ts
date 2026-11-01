import { describe, expect, test } from "vitest";
import { addDecimals, formatAmount, fromCents, fromMinorUnits, toCents } from "./money";

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

describe("fromMinorUnits", () => {
  test.each([
    [123456, 100n, "1234.56"],
    [-5, 100n, "-0.05"],
    [0, 100n, "0.00"],
    [1200, 1n, "1200"],
    [-1500, 1000n, "-1.500"],
    [7, 5n, "1.4"],
    [10, 5n, "2.0"],
    [-3, 5n, "-0.6"],
    [150_000_000, 10n ** 8n, "1.50000000"],
    [1.5e18, 10n ** 18n, "1.500000000000000000"],
  ])("%d at 1/%i is %s", (cents, conversion, decimal) => {
    expect(fromMinorUnits(cents, conversion)).toBe(decimal);
  });
});

describe("addDecimals", () => {
  test.each([
    ["1200.00", "-3.5000", "1196.5000"],
    ["1.4", "0.1000", "1.5000"],
    ["-0.05", "0.0500", "0.0000"],
    ["0.10", "-0.2500", "-0.1500"],
    ["1.50000000", "-0.0001", "1.49990000"],
    ["12", "-0.5", "11.5"],
  ])("%s + %s = %s", (a, b, sum) => {
    expect(addDecimals(a, b)).toBe(sum);
  });

  test.each([
    ["1,5", "1"],
    ["1", ""],
  ])("rejects %j + %j", (a, b) => {
    expect(() => addDecimals(a, b)).toThrow(RangeError);
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

  test.each([
    ["1.5", "USDC", "1.50 USDC"],
    ["-1234.5", "USDT", "-1,234.50 USDT"],
    ["0.12345", "DOGE", "0.1235 DOGE"],
  ])("%s %s → %s, with the code after the number Intl rejects", (decimal, currency, expected) => {
    expect(formatAmount(decimal, currency, "en-US")).toBe(expected);
  });
});
