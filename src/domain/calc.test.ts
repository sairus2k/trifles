import { describe, expect, test } from "vitest";
import { evaluateAmount } from "./calc";

function value(input: string, scale = 2) {
  const result = evaluateAmount(input, scale);
  if (!result.ok) throw new Error(`${input}: ${result.error}`);
  return result.value;
}

function error(input: string, scale = 2) {
  const result = evaluateAmount(input, scale);
  if (result.ok) throw new Error(`${input} evaluated to ${result.value}`);
  expect(result.message).not.toBe("");
  return result.error;
}

describe("evaluateAmount", () => {
  test.each([
    ["42", "42.00"],
    ["120+35.5-10", "145.50"],
    ["120−35×2÷7", "110.00"],
    ["120-35*2/7", "110.00"],
  ])("evaluates %s to %s", (input, expected) => {
    expect(value(input)).toBe(expected);
  });

  test.each([
    ["2+3×4", "14.00"],
    ["10−2×3", "4.00"],
    ["8÷2÷2", "2.00"],
    ["10−5−2", "3.00"],
    ["1+6÷3×2−1", "4.00"],
  ])("applies precedence and left associativity: %s = %s", (input, expected) => {
    expect(value(input)).toBe(expected);
  });

  test.each([
    ["12,5+0,5", "13.00"],
    [",5", "0.50"],
    [".5", "0.50"],
    ["12.", "12.00"],
    [" 12 + 3 ", "15.00"],
  ])("accepts decimal point and comma: %j = %s", (input, expected) => {
    expect(value(input)).toBe(expected);
  });

  test("allows a negative intermediate result", () => {
    expect(value("10−20+15")).toBe("5.00");
  });

  test("is exact where floats drift", () => {
    expect(value("1.005")).toBe("1.01");
    expect(value("0.1+0.2")).toBe("0.30");
    expect(value("4.35×100")).toBe("435.00");
  });

  test.each([
    ["100÷3", 2, "33.33"],
    ["2÷3", 2, "0.67"],
    ["100÷3", 0, "33"],
    ["1÷8", 3, "0.125"],
    ["1÷8", 2, "0.13"],
  ])("rounds %s half away from zero at scale %i to %s", (input, scale, expected) => {
    expect(value(input, scale)).toBe(expected);
  });

  test.each(["", "   "])("rejects empty input %j", (input) => {
    expect(error(input)).toBe("empty");
  });

  test.each([
    "abc",
    "1+",
    "+1",
    "-5+10",
    "×3",
    "1++2",
    "1..2",
    "1,2,3",
    "1 2",
    "1e3",
    "(1+2)",
    "5=",
  ])("rejects invalid expression %j", (input) => {
    expect(error(input)).toBe("invalid");
  });

  test.each(["5÷0", "5/0,00", "1+2÷0"])("rejects division by zero in %s", (input) => {
    expect(error(input)).toBe("division-by-zero");
  });

  test.each(["0", "5−5", "5−10", "0.004"])("rejects non-positive result of %s", (input) => {
    expect(error(input)).toBe("not-positive");
  });

  test("rejects a result beyond the safe integer range of cents", () => {
    expect(error("99999999999999999")).toBe("too-large");
  });
});
