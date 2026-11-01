import { expect, test } from "vitest";
import type { AccountRecord } from "../../db/schema";
import { balanceGroups } from "./rows";

function account(id: string, overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id,
    name: id,
    currency: "EUR",
    classification: "asset",
    balanceCents: 0,
    status: "active",
    updatedAt: 0,
    ...overrides,
  };
}

const names = (rows: { name: string }[]) => rows.map((row) => row.name);

test("accounts split into assets and liabilities, each sorted by name", () => {
  const { assets, liabilities } = balanceGroups(
    [
      account("Wallet"),
      account("Mortgage", { classification: "liability" }),
      account("Bank"),
      account("Card", { classification: "liability" }),
    ],
    new Map(),
  );
  expect(names(assets)).toEqual(["Bank", "Wallet"]);
  expect(names(liabilities)).toEqual(["Card", "Mortgage"]);
});

test("only active accounts are listed", () => {
  const { assets } = balanceGroups(
    [
      account("Active"),
      account("Draft", { status: "draft" }),
      account("Disabled", { status: "disabled" }),
      account("Leaving", { status: "pending_deletion" }),
    ],
    new Map(),
  );
  expect(names(assets)).toEqual(["Active"]);
});

test.each([
  ["EUR", 123456, "1234.56"],
  ["JPY", 1200, "1200"],
  ["MGA", 7, "1.4"],
  ["BTC", 150_000_000, "1.50000000"],
])("a %s balance of %i minor units is %s", (currency, balanceCents, balance) => {
  const { assets } = balanceGroups([account("A", { currency, balanceCents })], new Map());
  expect(assets[0]).toEqual({ id: "A", name: "A", currency, balance });
});

test("a liability keeps Sure's sign: positive while owed", () => {
  const { liabilities } = balanceGroups(
    [account("Card", { classification: "liability", balanceCents: 35000 })],
    new Map(),
  );
  expect(liabilities[0]!.balance).toBe("350.00");
});

test.each([
  ["EUR", 120000, "-12.0000", "1188.0000"],
  ["MGA", 7, "0.1000", "1.5000"],
  ["BTC", 150_000_000, "-0.0001", "1.49990000"],
])(
  "a %s account with a pending delta projects its balance",
  (currency, cents, delta, projected) => {
    const { assets } = balanceGroups(
      [account("A", { currency, balanceCents: cents })],
      new Map([["A", delta]]),
    );
    expect(assets[0]!.pending).toEqual({ delta, projected });
  },
);

test("an account without a delta has no pending part", () => {
  const { assets, liabilities } = balanceGroups(
    [account("Cash"), account("Card", { classification: "liability", balanceCents: 500 })],
    new Map([["Card", "3.5000"]]),
  );
  expect(assets[0]!.pending).toBeUndefined();
  expect(liabilities[0]!.pending).toEqual({ delta: "3.5000", projected: "8.5000" });
});
