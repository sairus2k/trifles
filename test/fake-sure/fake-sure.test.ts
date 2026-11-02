import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  deleteApiV1TransactionsId,
  getApiV1Accounts,
  getApiV1AccountsId,
  getApiV1Categories,
  getApiV1Merchants,
  getApiV1Transactions,
  patchApiV1TransactionsId,
  postApiV1RecurringTransactions,
  postApiV1Transactions,
  type PatchApiV1TransactionsIdBodyTransaction,
  type PostApiV1TransactionsBodyTransaction,
} from "../../src/api/generated/sure";
import { SureError, configureSure } from "../../src/api/http";
import { FAKE_SURE_URL, createFakeSure, type FakeSure } from "./index";

const server = setupServer();
let sure: FakeSure;

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
  sure = createFakeSure();
  server.use(...sure.handlers);
  configureSure({ baseUrl: FAKE_SURE_URL, apiKey: "test-key" });
});
afterEach(() => {
  server.resetHandlers();
  configureSure(undefined);
  vi.useRealTimers();
});
afterAll(() => server.close());

function coffee(
  overrides: Partial<PostApiV1TransactionsBodyTransaction> = {},
): PostApiV1TransactionsBodyTransaction {
  return {
    account_id: "acc-cash",
    date: "2026-11-01",
    amount: 12.5,
    name: "Coffee",
    nature: "expense",
    currency: "EUR",
    external_id: "client-1",
    source: "sure-quick-entry",
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => expect.unreachable("expected a rejection"),
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SureError);
  return error as SureError;
}

function balanceOf(id: string) {
  return sure.accounts.find((a) => a.id === id)!;
}

describe("POST /transactions", () => {
  test("creates a transaction with 201 and a signed amount_decimal", async () => {
    const expense = await postApiV1Transactions({ transaction: coffee() });
    const income = await postApiV1Transactions({
      transaction: coffee({ external_id: "client-2", amount: 100, nature: "income", name: "Gift" }),
    });

    expect(expense.status).toBe(201);
    expect(expense.data).toMatchObject({
      amount_decimal: "12.5",
      currency: "EUR",
      name: "Coffee",
      classification: "expense",
      external_id: "client-1",
      source: "sure-quick-entry",
      account: { id: "acc-cash" },
    });
    expect(income.data).toMatchObject({ amount_decimal: "-100.0", classification: "income" });
    expect(expense.data).not.toHaveProperty("amount_cents");
    expect(sure.transactions).toHaveLength(2);
  });

  test("answers 200 with the existing transaction on a repeated account + external_id + source", async () => {
    const first = await postApiV1Transactions({ transaction: coffee() });
    const repeat = await postApiV1Transactions({ transaction: coffee({ amount: 99 }) });

    expect(first.status).toBe(201);
    expect(repeat.status).toBe(200);
    expect(repeat.data).toEqual(first.data);
    expect(sure.transactions).toHaveLength(1);
    expect(balanceOf("acc-cash").balance_cents).toBe(100_000 - 1250);
  });

  test("scopes external_id to the account and the source", async () => {
    await postApiV1Transactions({ transaction: coffee() });
    const otherAccount = await postApiV1Transactions({
      transaction: coffee({ account_id: "acc-card" }),
    });
    const otherSource = await postApiV1Transactions({ transaction: coffee({ source: "other" }) });

    expect(otherAccount.status).toBe(201);
    expect(otherSource.status).toBe(201);
    expect(sure.transactions).toHaveLength(3);
  });

  test('defaults source to "api" when only external_id is sent', async () => {
    const created = await postApiV1Transactions({ transaction: coffee({ source: undefined }) });
    const repeat = await postApiV1Transactions({ transaction: coffee({ source: "api" }) });

    expect(created.data).toMatchObject({ source: "api" });
    expect(repeat.status).toBe(200);
  });

  test("falls back to the family currency when currency is omitted", async () => {
    const created = await postApiV1Transactions({ transaction: coffee({ currency: undefined }) });

    expect(created.data).toMatchObject({ currency: "USD" });
  });

  test("answers 422 without account_id or with source but no external_id", async () => {
    const noAccount = await postApiV1Transactions({ transaction: coffee({ account_id: "" }) });
    const noExternalId = await postApiV1Transactions({
      transaction: coffee({ external_id: undefined }),
    });

    expect(noAccount).toMatchObject({ status: 422, data: { message: "Account ID is required" } });
    expect(noExternalId).toMatchObject({
      status: 422,
      data: { message: "Source requires external_id" },
    });
    expect(sure.transactions).toHaveLength(0);
  });

  test("answers 500 for an unknown account, like Sure's own rescue in create", async () => {
    const error = await rejection(
      postApiV1Transactions({ transaction: coffee({ account_id: "missing" }) }),
    );

    expect(error).toMatchObject({ kind: "http", status: 500 });
    expect(sure.transactions).toHaveLength(0);
  });

  test("answers 500 for a read-only account, which GET /accounts/{id} still finds", async () => {
    sure.readOnlyAccountIds.push("acc-cash");

    const error = await rejection(postApiV1Transactions({ transaction: coffee() }));

    expect(error).toMatchObject({ kind: "http", status: 500 });
    expect(sure.transactions).toHaveLength(0);
    expect((await getApiV1AccountsId("acc-cash")).status).toBe(200);
  });
});

describe("POST /recurring_transactions (the write probe)", () => {
  function probe(accountId: string) {
    return postApiV1RecurringTransactions({
      recurring_transaction: {
        account_id: accountId,
        name: "Probe",
        amount: 0,
        currency: "EUR",
        expected_day_of_month: 0,
        last_occurrence_date: "",
        next_expected_date: "",
      },
    });
  }

  test("answers 422 for a writable account with blank dates", async () => {
    expect(await probe("acc-cash")).toMatchObject({
      status: 422,
      data: {
        error: "validation_failed",
        errors: ["Last occurrence date can't be blank", "Next expected date can't be blank"],
      },
    });
  });

  test("answers 404 record_not_found for an unknown or read-only account", async () => {
    sure.readOnlyAccountIds.push("acc-cash");

    const notFound = { status: 404, data: { error: "record_not_found" } };
    expect(await probe("acc-cash")).toMatchObject(notFound);
    expect(await probe("missing")).toMatchObject(notFound);
  });
});

describe("PATCH /transactions/{id}", () => {
  test("updates the given fields, signs the amount by nature and moves the balance", async () => {
    const { data: created } = await postApiV1Transactions({ transaction: coffee() });
    const id = (created as { id: string }).id;

    const updated = await patchApiV1TransactionsId(id, {
      transaction: {
        name: "Lunch",
        date: "2026-10-31",
        amount: 20,
        nature: "expense",
        notes: "With Ana",
        category_id: "cat-restaurants",
      },
    });

    expect(updated.status).toBe(200);
    expect(updated.data).toMatchObject({
      id,
      name: "Lunch",
      date: "2026-10-31",
      amount_decimal: "20.0",
      notes: "With Ana",
      category: { id: "cat-restaurants" },
    });
    expect(balanceOf("acc-cash").balance_cents).toBe(100_000 - 2000);
  });

  test("keeps fields sent as null, a blank category or merchant, and ignores currency", async () => {
    const { data: created } = await postApiV1Transactions({
      transaction: coffee({
        notes: "Keep",
        category_id: "cat-restaurants",
        merchant_id: "mer-starbucks",
      }),
    });
    const id = (created as { id: string }).id;

    const updated = await patchApiV1TransactionsId(id, {
      // The spec types these fields as strings; a client may still send null.
      transaction: {
        notes: null,
        category_id: "",
        merchant_id: null,
        currency: "USD",
      } as unknown as PatchApiV1TransactionsIdBodyTransaction,
    });

    expect(updated.data).toMatchObject({
      notes: "Keep",
      currency: "EUR",
      category: { id: "cat-restaurants" },
      merchant: { id: "mer-starbucks" },
    });
  });

  test("clears notes with an empty string", async () => {
    const { data: created } = await postApiV1Transactions({ transaction: coffee({ notes: "x" }) });

    const updated = await patchApiV1TransactionsId((created as { id: string }).id, {
      transaction: { notes: "" },
    });

    expect(updated.data).toMatchObject({ notes: "" });
  });

  test("answers 404 not_found for an unknown transaction", async () => {
    const result = await patchApiV1TransactionsId("missing", { transaction: { name: "x" } });

    expect(result).toMatchObject({ status: 404, data: { error: "not_found" } });
  });
});

describe("DELETE /transactions/{id}", () => {
  test("removes the transaction and restores the balance, then answers 404", async () => {
    const { data: created } = await postApiV1Transactions({ transaction: coffee() });
    const id = (created as { id: string }).id;

    const deleted = await deleteApiV1TransactionsId(id);
    const again = await deleteApiV1TransactionsId(id);

    expect(deleted).toMatchObject({
      status: 200,
      data: { message: "Transaction deleted successfully" },
    });
    expect(again).toMatchObject({ status: 404, data: { error: "not_found" } });
    expect(sure.transactions).toHaveLength(0);
    expect(balanceOf("acc-cash").balance_cents).toBe(100_000);
  });
});

describe("failNext", () => {
  test.each([401, 500, 503])("answers %i without applying the write", async (status) => {
    sure.failNext("POST /api/v1/transactions", { status });

    const error = await rejection(postApiV1Transactions({ transaction: coffee() }));

    expect(error).toMatchObject({ kind: "http", status });
    expect(sure.transactions).toHaveLength(0);
    expect((await postApiV1Transactions({ transaction: coffee() })).status).toBe(201);
  });

  test("answers 422 with a server message without applying the write", async () => {
    sure.failNext("POST /api/v1/transactions", {
      status: 422,
      body: { error: "validation_failed", message: "Date is invalid" },
    });

    const result = await postApiV1Transactions({ transaction: coffee() });

    expect(result).toMatchObject({ status: 422, data: { message: "Date is invalid" } });
    expect(sure.transactions).toHaveLength(0);
  });

  test("drop: the connection fails before the server applies the write", async () => {
    sure.failNext("POST /api/v1/transactions", "drop");

    const error = await rejection(postApiV1Transactions({ transaction: coffee() }));

    expect(error.kind).toBe("network");
    expect(sure.transactions).toHaveLength(0);
  });

  test("lose-response: the server applies the write, the retry gets 200 and no duplicate", async () => {
    sure.failNext("POST /api/v1/transactions", "lose-response");

    const error = await rejection(postApiV1Transactions({ transaction: coffee() }));
    expect(error.kind).toBe("network");
    expect(sure.transactions).toHaveLength(1);

    const retry = await postApiV1Transactions({ transaction: coffee() });
    expect(retry.status).toBe(200);
    expect(sure.transactions).toHaveLength(1);
  });

  test("hang: the server never answers, so only a client timeout ends the request", async () => {
    sure.failNext("POST /api/v1/transactions", "hang");

    const error = await rejection(
      postApiV1Transactions({ transaction: coffee() }, { signal: AbortSignal.timeout(20) }),
    );

    expect(error.kind).toBe("network");
    expect(sure.requests).toHaveLength(1);
    expect(sure.transactions).toHaveLength(0);
  });

  test("faults queue per route and are used once each", async () => {
    sure.failNext("POST /api/v1/transactions", { status: 500 });
    sure.failNext("POST /api/v1/transactions", "drop");

    expect((await getApiV1Accounts()).status).toBe(200);
    expect((await rejection(postApiV1Transactions({ transaction: coffee() }))).status).toBe(500);
    expect((await rejection(postApiV1Transactions({ transaction: coffee() }))).kind).toBe(
      "network",
    );
    expect((await postApiV1Transactions({ transaction: coffee() })).status).toBe(201);
  });
});

describe("reference data", () => {
  test("accounts, categories and merchants return the seed in Sure's shapes", async () => {
    const accounts = await getApiV1Accounts();
    const categories = await getApiV1Categories();
    const merchants = await getApiV1Merchants();

    expect(accounts.data.accounts.map((a) => a.name)).toEqual(["Cash", "Checking", "Credit card"]);
    expect(accounts.data.pagination).toEqual({
      page: 1,
      per_page: 25,
      total_count: 3,
      total_pages: 1,
    });
    expect(categories.data.categories.map((c) => c.name)).toEqual([
      "Groceries",
      "Restaurants",
      "Salary",
    ]);
    expect(merchants.data.map((m) => m.name)).toEqual(["Lidl", "Starbucks"]);
  });

  test("GET /accounts/{id} returns the account, or 404 not_found once it is gone", async () => {
    const found = await getApiV1AccountsId("acc-cash");
    sure.accounts.splice(sure.accounts.indexOf(balanceOf("acc-cash")), 1);
    const gone = await getApiV1AccountsId("acc-cash");

    expect(found).toMatchObject({ status: 200, data: { id: "acc-cash", currency: "EUR" } });
    expect(gone).toMatchObject({
      status: 404,
      data: { error: "not_found", message: "Account not found" },
    });
  });

  test("a seed replaces the defaults", async () => {
    const [cash] = createFakeSure().accounts;
    const custom = createFakeSure({ accounts: [{ ...cash!, name: "Wallet" }], merchants: [] });
    server.use(...custom.handlers);

    expect((await getApiV1Accounts()).data.accounts.map((a) => a.name)).toEqual(["Wallet"]);
    expect((await getApiV1Merchants()).data).toEqual([]);
  });
});

describe("account balances", () => {
  test("a write changes the balance and updated_at, to the second", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T10:00:00.700Z"));

    await postApiV1Transactions({ transaction: coffee() });
    await postApiV1Transactions({
      transaction: coffee({ account_id: "acc-card", currency: "EUR" }),
    });

    const accounts = (await getApiV1Accounts()).data.accounts;
    const cash = accounts.find((a) => a.id === "acc-cash")!;
    const card = accounts.find((a) => a.id === "acc-card")!;
    // An expense lowers an asset and raises a liability (the debt).
    expect(cash).toMatchObject({ balance_cents: 100_000 - 1250, cash_balance_cents: 98_750 });
    expect(card).toMatchObject({ balance_cents: 20_000 + 1250 });
    expect(cash.updated_at).toBe("2026-11-01T10:00:00Z");
    expect(balanceOf("acc-checking").updated_at).toBe("2026-10-01T09:00:00Z");
  });

  test("pauseAccountSync keeps balances stale until resumeAccountSync", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
    sure.pauseAccountSync();

    await postApiV1Transactions({ transaction: coffee() });
    expect(balanceOf("acc-cash")).toMatchObject({
      balance_cents: 100_000,
      updated_at: "2026-10-01T09:00:00Z",
    });

    vi.setSystemTime(new Date("2026-11-01T10:00:05Z"));
    sure.resumeAccountSync();
    expect(balanceOf("acc-cash")).toMatchObject({
      balance_cents: 98_750,
      updated_at: "2026-11-01T10:00:05Z",
    });

    await postApiV1Transactions({ transaction: coffee({ external_id: "client-2" }) });
    expect(balanceOf("acc-cash").balance_cents).toBe(97_500);
  });
});

describe("GET /transactions", () => {
  test("lists newest first and caps per_page at 100", async () => {
    await postApiV1Transactions({ transaction: coffee({ date: "2026-10-30" }) });
    await postApiV1Transactions({ transaction: coffee({ external_id: "client-2" }) });
    await postApiV1Transactions({ transaction: coffee({ external_id: "client-3" }) });

    const page = await getApiV1Transactions({ per_page: 500 });

    expect(page.data.transactions.map((t) => t.external_id)).toEqual([
      "client-3",
      "client-2",
      "client-1",
    ]);
    expect(page.data.pagination).toEqual({
      page: 1,
      per_page: 100,
      total_count: 3,
      total_pages: 1,
    });
  });

  test("pages with page and per_page", async () => {
    for (const id of ["a", "b", "c"]) {
      await postApiV1Transactions({ transaction: coffee({ external_id: id }) });
    }

    const second = await getApiV1Transactions({ page: 2, per_page: 2 });

    expect(second.data.transactions.map((t) => t.external_id)).toEqual(["a"]);
    expect(second.data.pagination).toMatchObject({ page: 2, total_pages: 2 });
  });
});

test("records every request it receives, dropped ones included", async () => {
  sure.failNext("POST /api/v1/transactions", "drop");
  await rejection(postApiV1Transactions({ transaction: coffee() }));
  await postApiV1Transactions({ transaction: coffee() });
  await getApiV1Transactions({ per_page: 100 });

  expect(sure.requests).toEqual([
    { method: "POST", path: "/api/v1/transactions", body: { transaction: coffee() } },
    { method: "POST", path: "/api/v1/transactions", body: { transaction: coffee() } },
    { method: "GET", path: "/api/v1/transactions?per_page=100", body: undefined },
  ]);
});
