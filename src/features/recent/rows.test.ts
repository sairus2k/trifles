import { describe, expect, test } from "vitest";
import type {
  AccountRecord,
  EntryPayload,
  OutboxRecord,
  TransactionRecord,
  TransferPayload,
} from "../../db/schema";
import {
  FAILED_TRANSFER_ERROR,
  SENDING_REASON,
  UNPULLED_REASON,
  ofKind,
  recentDays,
  rowKind,
  type RecentData,
} from "./rows";

function account(id: string, name: string): AccountRecord {
  return {
    id,
    name,
    currency: "EUR",
    classification: "asset",
    balanceCents: 0,
    status: "active",
    updatedAt: 0,
  };
}

const accounts = [account("acc-cash", "Cash"), account("acc-card", "Card")];
const categories = [{ id: "cat-food", name: "Food", color: "#000", icon: "utensils" }];

function tx(id: string, overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    id,
    accountId: "acc-cash",
    date: "2026-11-01",
    name: `Server ${id}`,
    amountDecimal: "3.5",
    currency: "EUR",
    categoryId: null,
    merchantId: null,
    notes: null,
    externalId: null,
    createdAt: 1_000,
    transferId: null,
    ...overrides,
  };
}

const coffee: EntryPayload = {
  accountId: "acc-cash",
  date: "2026-11-01",
  amount: "3.50",
  nature: "expense",
  currency: "EUR",
  name: "Coffee",
  notes: null,
  categoryId: "cat-food",
  merchantId: null,
};

const withdrawal: TransferPayload = {
  fromAccountId: "acc-card",
  toAccountId: "acc-cash",
  date: "2026-11-01",
  amount: "100",
  currency: "EUR",
  name: "Card → Cash",
  notes: null,
};

const queued = { status: "pending", attempts: 0, nextAttemptAt: 0, lastError: null } as const;

function create(clientId: string, state: Partial<OutboxRecord> = {}, payload = coffee) {
  return { clientId, op: "create", payload, ...queued, createdAt: 2_000, ...state } as OutboxRecord;
}

function transfer(clientId: string, state: Partial<OutboxRecord> = {}) {
  return {
    clientId,
    op: "transfer",
    payload: withdrawal,
    ...queued,
    createdAt: 2_000,
    ...state,
  } as OutboxRecord;
}

function update(
  clientId: string,
  transactionId: string,
  changes: Partial<EntryPayload>,
  state: Partial<OutboxRecord> = {},
) {
  const { accountId: _, ...values } = { ...coffee, ...changes };
  return {
    clientId,
    op: "update",
    payload: { transactionId, changes: values },
    ...queued,
    createdAt: 2_000,
    ...state,
  } as OutboxRecord;
}

function remove(clientId: string, transactionId: string, state: Partial<OutboxRecord> = {}) {
  return {
    clientId,
    op: "delete",
    payload: { transactionId },
    ...queued,
    createdAt: 2_000,
    ...state,
  } as OutboxRecord;
}

function days(data: Partial<RecentData>) {
  return recentDays({ transactions: [], outbox: [], accounts, categories, ...data });
}

function rows(data: Partial<RecentData>) {
  return days(data).flatMap((day) => day.rows);
}

describe("grouping", () => {
  test("server and pending rows share days, newest day first and newest first within a day", () => {
    const result = days({
      transactions: [
        tx("tx-old", { date: "2026-10-30" }),
        tx("tx-early", { createdAt: 1_000 }),
        tx("tx-late", { createdAt: 3_000 }),
      ],
      outbox: [
        create("c-today", { createdAt: 2_000 }),
        create("c-yesterday", { createdAt: 5_000 }, { ...coffee, date: "2026-10-31" }),
      ],
    });

    expect(result.map((day) => [day.date, day.rows.map((r) => r.key)])).toEqual([
      ["2026-11-01", ["tx-late", "c-today", "tx-early"]],
      ["2026-10-31", ["c-yesterday"]],
      ["2026-10-30", ["tx-old"]],
    ]);
  });

  test("an entry shows its account and category, and its amount signed by direction", () => {
    const [expense, income] = rows({
      transactions: [
        tx("tx-in", { amountDecimal: "-1200.0", categoryId: "cat-food", createdAt: 1 }),
      ],
      outbox: [create("c-1")],
    });

    expect(expense).toMatchObject({ name: "Coffee", detail: "Food · Cash", amount: "-3.50" });
    expect(income).toMatchObject({ detail: "Food · Cash", amount: "1200.0", transfer: false });
  });
});

describe("one row per entry", () => {
  test("a sent create and its pulled transaction show once, as the transaction", () => {
    const result = rows({
      transactions: [tx("tx-1", { externalId: "c-1" })],
      outbox: [create("c-1", { status: "done", attempts: 1 })],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ key: "tx-1", target: { kind: "transaction" } });
    expect(result[0]!.status).toBeUndefined();
  });

  test("a create retried after a lost response shows once, as the outbox record", () => {
    const result = rows({
      transactions: [tx("tx-1", { externalId: "c-1" })],
      outbox: [create("c-1", { attempts: 1, lastError: "Network error" })],
    });

    expect(result).toEqual([
      expect.objectContaining({
        key: "c-1",
        status: "retrying",
        error: "Network error",
        target: { kind: "locked", reason: SENDING_REASON },
      }),
    ]);
  });

  test("a sent create not pulled yet stays on screen but cannot change", () => {
    expect(rows({ outbox: [create("c-1", { status: "done", attempts: 1 })] })).toEqual([
      expect.objectContaining({ key: "c-1", target: { kind: "locked", reason: UNPULLED_REASON } }),
    ]);
  });
});

describe("transfers", () => {
  test("a pending transfer is one row from one account to the other", () => {
    expect(rows({ outbox: [transfer("t-1")] })).toEqual([
      expect.objectContaining({
        name: "Card → Cash",
        detail: "Card → Cash",
        transfer: true,
        amount: "100",
        status: "pending",
        target: expect.objectContaining({ kind: "pending", clientId: "t-1" }),
      }),
    ]);
  });

  test("legs Sure paired show as one transfer row", () => {
    const result = rows({
      transactions: [
        tx("leg-in", { accountId: "acc-cash", amountDecimal: "-100.0", transferId: "trf-1" }),
        tx("leg-out", { accountId: "acc-card", amountDecimal: "100.0", transferId: "trf-1" }),
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        key: "trf-1",
        detail: "Card → Cash",
        amount: "100.0",
        transfer: true,
        target: { kind: "transfer", transactionIds: ["leg-in", "leg-out"] },
      }),
    ]);
  });

  test("our legs show as one row before Sure pairs them, replacing the sent transfer", () => {
    const result = rows({
      transactions: [
        tx("leg-out", { accountId: "acc-card", amountDecimal: "100.0", externalId: "t-1:out" }),
        tx("leg-in", { accountId: "acc-cash", amountDecimal: "-100.0", externalId: "t-1:in" }),
      ],
      outbox: [transfer("t-1", { status: "done", attempts: 1 })],
    });

    expect(result).toEqual([
      expect.objectContaining({
        key: "t-1",
        target: { kind: "transfer", transactionIds: ["leg-out", "leg-in"] },
      }),
    ]);
  });

  test("a failed transfer can only be dismissed, warning that a leg may be in Sure", () => {
    const result = rows({
      transactions: [tx("leg-out", { amountDecimal: "100.0", externalId: "t-1:out" })],
      outbox: [transfer("t-1", { status: "failed", attempts: 1, lastError: "Account is closed" })],
    });

    expect(result).toEqual([
      expect.objectContaining({
        key: "t-1",
        status: "failed",
        error: `Account is closed ${FAILED_TRANSFER_ERROR}`,
        target: { kind: "failedTransfer", clientId: "t-1" },
      }),
    ]);
  });

  test("deleting either leg hides the transfer", () => {
    const transactions = [
      tx("leg-out", { amountDecimal: "100.0", transferId: "trf-1" }),
      tx("leg-in", { amountDecimal: "-100.0", transferId: "trf-1" }),
    ];

    expect(rows({ transactions, outbox: [remove("d-1", "leg-in")] })).toEqual([]);
  });
});

describe("status", () => {
  test.each([
    ["queued", {}, { status: "pending" }, "pending"],
    ["paused", { lastError: "HTTP 401" }, { status: "pending" }, "pending"],
    ["sending", { status: "sending" }, { status: "sending" }, "locked"],
    [
      "retrying",
      { attempts: 2, lastError: "HTTP 500" },
      { status: "retrying", error: "HTTP 500" },
      "locked",
    ],
    [
      "rejected",
      { status: "failed", attempts: 1, lastError: "Amount is invalid" },
      { status: "failed", error: "Amount is invalid" },
      "pending",
    ],
  ] as const)("a %s create", (_, state, shown, target) => {
    const [row] = rows({ outbox: [create("c-1", state)] });

    expect(row).toMatchObject(shown);
    expect(row!.error).toBe("error" in shown ? shown.error : undefined);
    expect(row!.target.kind).toBe(target);
  });
});

describe("updates and deletes", () => {
  test("a queued update shows its values on the transaction, the newest one winning", () => {
    const result = rows({
      transactions: [tx("tx-1")],
      outbox: [
        update("u-old", "tx-1", { name: "Old edit" }, { status: "done", createdAt: 2_000 }),
        update(
          "u-new",
          "tx-1",
          { name: "Lunch", amount: "12", nature: "income" },
          {
            createdAt: 3_000,
          },
        ),
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        key: "tx-1",
        name: "Lunch",
        amount: "12",
        status: "pending",
        target: {
          kind: "transaction",
          transactionId: "tx-1",
          values: { ...coffee, name: "Lunch", amount: "12", nature: "income" },
        },
      }),
    ]);
  });

  test("a sent update keeps its values until it is cleaned up, so they never flip back", () => {
    const [row] = rows({
      transactions: [tx("tx-1")],
      outbox: [update("u-1", "tx-1", { name: "Lunch" }, { status: "done", attempts: 1 })],
    });

    expect(row).toMatchObject({ name: "Lunch" });
    expect(row!.status).toBeUndefined();
  });

  test("a synced transaction without changes is edited from its own values", () => {
    const [row] = rows({
      transactions: [
        tx("tx-1", {
          amountDecimal: "-20.0",
          notes: "Gift",
          merchantId: "mer-1",
          categoryId: "cat-food",
        }),
      ],
    });

    expect(row!.target).toEqual({
      kind: "transaction",
      transactionId: "tx-1",
      values: {
        accountId: "acc-cash",
        date: "2026-11-01",
        amount: "20.0",
        nature: "income",
        currency: "EUR",
        name: "Server tx-1",
        notes: "Gift",
        categoryId: "cat-food",
        merchantId: "mer-1",
      },
    });
  });

  test.each(["pending", "sending", "done"] as const)("a %s delete hides the row", (status) => {
    expect(
      rows({ transactions: [tx("tx-1")], outbox: [remove("d-1", "tx-1", { status })] }),
    ).toEqual([]);
  });

  test.each([
    ["delete", remove("d-1", "tx-1", { status: "failed", lastError: "Forbidden" })],
    ["update", update("d-1", "tx-1", {}, { status: "failed", lastError: "Forbidden" })],
  ])("a failed %s shows the row with the error and can be discarded", (_, record) => {
    expect(rows({ transactions: [tx("tx-1")], outbox: [record] })).toEqual([
      expect.objectContaining({
        key: "tx-1",
        status: "failed",
        error: "Forbidden",
        discard: ["d-1"],
      }),
    ]);
  });

  test("a change to a transaction outside the cache shows nothing", () => {
    expect(rows({ outbox: [update("u-1", "tx-gone", {}), remove("d-1", "tx-other")] })).toEqual([]);
  });
});

describe("filtering by the form tab", () => {
  test("a row is classified the way it is displayed", () => {
    const result = rows({
      transactions: [
        tx("tx-expense"),
        tx("tx-income", { amountDecimal: "-1200.0" }),
        tx("tx-now-income"),
        tx("tx-now-expense", { amountDecimal: "-50.0" }),
        tx("leg-in", { accountId: "acc-cash", amountDecimal: "-100.0", transferId: "trf-1" }),
        tx("leg-out", { accountId: "acc-card", amountDecimal: "100.0", transferId: "trf-1" }),
      ],
      outbox: [
        create("c-expense"),
        create("c-income", {}, { ...coffee, nature: "income" }),
        transfer("t-pending"),
        transfer("t-failed", { status: "failed", lastError: "Forbidden" }),
        update("u-1", "tx-now-income", { nature: "income" }),
        update("u-2", "tx-now-expense", { nature: "expense" }),
      ],
    });

    expect(Object.fromEntries(result.map((row) => [row.key, rowKind(row)]))).toEqual({
      "tx-expense": "expense",
      "tx-income": "income",
      "tx-now-income": "income",
      "tx-now-expense": "expense",
      "trf-1": "transfer",
      "c-expense": "expense",
      "c-income": "income",
      "t-pending": "transfer",
      "t-failed": "transfer",
    });
  });

  test("only rows of the kind are kept, and days left without rows are dropped", () => {
    const all = days({
      transactions: [
        tx("tx-salary", { date: "2026-10-31", amountDecimal: "-1200.0" }),
        tx("tx-lunch"),
      ],
      outbox: [create("c-coffee"), transfer("t-1", { createdAt: 3_000 })],
    });

    const keys = (kind: "expense" | "income" | "transfer") =>
      ofKind(all, kind).map((day) => [day.date, day.rows.map((r) => r.key)]);
    expect(keys("expense")).toEqual([["2026-11-01", ["c-coffee", "tx-lunch"]]]);
    expect(keys("income")).toEqual([["2026-10-31", ["tx-salary"]]]);
    expect(keys("transfer")).toEqual([["2026-11-01", ["t-1"]]]);
  });
});
