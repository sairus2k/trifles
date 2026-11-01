import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { FAKE_SURE_URL, createFakeSure, defaultSeed, type FakeSure } from "../../test/fake-sure";
import { postApiV1Transactions, type PostApiV1TransactionsBody } from "../api/generated/sure";
import { SureError, configureSure } from "../api/http";
import { db, type EntryPayload } from "../db/schema";
import { enqueue, pendingDeltas } from "./outbox";
import { pullRecent, pullReference } from "./pull";
import { push } from "./push";

const NOW = new Date("2026-11-01T10:00:00Z").getTime();
const SEEDED_AT = Date.parse("2026-10-01T09:00:00Z");

const server = setupServer();
let sure: FakeSure;

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  sure = createFakeSure();
  server.use(...sure.handlers);
  configureSure({ baseUrl: FAKE_SURE_URL, apiKey: "test-key" });
  await Promise.all(db.tables.map((table) => table.clear()));
});
afterEach(() => {
  server.resetHandlers();
  configureSure(undefined);
  vi.useRealTimers();
});
afterAll(() => server.close());

// Writes straight to the fake, as another client of Sure would.
async function serverTransaction(
  overrides: Partial<PostApiV1TransactionsBody["transaction"]> = {},
) {
  const reply = await postApiV1Transactions({
    transaction: {
      account_id: "acc-cash",
      date: "2026-11-01",
      amount: 3.5,
      nature: "expense",
      currency: "EUR",
      name: "Coffee",
      ...overrides,
    },
  });
  if (reply.status === 422) throw new Error("rejected");
  return reply.data;
}

async function cacheStaleReference() {
  await db.accounts.put({
    id: "acc-closed",
    name: "Closed",
    currency: "EUR",
    classification: "asset",
    balanceCents: 0,
    status: "active",
    updatedAt: 0,
  });
  await db.categories.put({ id: "cat-gone", name: "Gone", color: "#000000", icon: "x" });
  await db.merchants.put({ id: "mer-gone", name: "Gone" });
}

describe("pullReference", () => {
  test("replaces the cached accounts, categories and merchants", async () => {
    await cacheStaleReference();

    await pullReference();

    expect(await db.accounts.orderBy("id").toArray()).toEqual([
      {
        id: "acc-card",
        name: "Credit card",
        currency: "EUR",
        classification: "liability",
        balanceCents: 20_000,
        status: "active",
        updatedAt: SEEDED_AT,
      },
      expect.objectContaining({ id: "acc-cash", classification: "asset", balanceCents: 100_000 }),
      expect.objectContaining({ id: "acc-checking", currency: "USD", balanceCents: 250_000 }),
    ]);
    expect(await db.categories.orderBy("id").toArray()).toEqual([
      { id: "cat-groceries", name: "Groceries", color: "#22c55e", icon: "shopping-cart" },
      expect.objectContaining({ id: "cat-restaurants" }),
      expect.objectContaining({ id: "cat-salary" }),
    ]);
    expect(await db.merchants.orderBy("id").toArray()).toEqual([
      { id: "mer-lidl", name: "Lidl" },
      { id: "mer-starbucks", name: "Starbucks" },
    ]);
  });

  test("reads every page at Sure's maximum page size", async () => {
    const [template] = defaultSeed().accounts;
    const accounts = Array.from({ length: 150 }, (_, i) => ({
      ...template!,
      id: `acc-${i}`,
      name: `Account ${String(i).padStart(3, "0")}`,
    }));
    sure = createFakeSure({ accounts });
    server.resetHandlers(...sure.handlers);

    await pullReference();

    expect(await db.accounts.count()).toBe(150);
    expect(sure.requests.map((r) => r.path)).toEqual(
      expect.arrayContaining([
        "/api/v1/accounts?page=1&per_page=100",
        "/api/v1/accounts?page=2&per_page=100",
        "/api/v1/categories?page=1&per_page=100",
        "/api/v1/merchants",
      ]),
    );
    expect(sure.requests).toHaveLength(4);
  });

  test("a failed request leaves the whole cache as it was", async () => {
    await cacheStaleReference();
    sure.failNext("GET /api/v1/merchants", { status: 500 });

    await expect(pullReference()).rejects.toBeInstanceOf(SureError);

    expect((await db.accounts.toArray()).map((a) => a.id)).toEqual(["acc-closed"]);
    expect((await db.categories.toArray()).map((c) => c.id)).toEqual(["cat-gone"]);
  });

  test("a JSON error the spec does not declare is thrown, not cached", async () => {
    sure.failNext("GET /api/v1/accounts", { status: 403, body: { error: "insufficient_scope" } });

    await expect(pullReference()).rejects.toMatchObject({ kind: "http", status: 403 });
    expect(await db.accounts.count()).toBe(0);
  });
});

describe("pullRecent", () => {
  test("replaces the cached transactions with the latest 100", async () => {
    await db.transactions.put({
      id: "tx-gone",
      accountId: "acc-cash",
      date: "2026-01-01",
      name: "Deleted on the server",
      amountDecimal: "1.0",
      currency: "EUR",
      categoryId: null,
      merchantId: null,
      notes: null,
      externalId: null,
    });
    for (let day = 1; day <= 105; day++) {
      const date = new Date(Date.UTC(2026, 6, day)).toISOString().slice(0, 10);
      await serverTransaction({ date, name: `Day ${day}` });
    }
    sure.requests.length = 0;

    await pullRecent();

    expect(sure.requests.map((r) => r.path)).toContain("/api/v1/transactions?per_page=100");
    const cached = await db.transactions.orderBy("date").toArray();
    expect(cached).toHaveLength(100);
    expect(cached[0]!.name).toBe("Day 6");
    expect(cached.at(-1)!.name).toBe("Day 105");
  });

  test("reads the amount from amount_decimal, never the display string", async () => {
    const created = await serverTransaction({
      amount: 1234.5,
      notes: "Team lunch",
      category_id: "cat-restaurants",
      merchant_id: "mer-starbucks",
      external_id: "client-1",
      source: "sure-quick-entry",
    });
    sure.transactions[0]!.amount = "€9.99";

    await pullRecent();

    expect(await db.transactions.toArray()).toEqual([
      {
        id: created.id,
        accountId: "acc-cash",
        date: "2026-11-01",
        name: "Coffee",
        amountDecimal: "1234.5",
        currency: "EUR",
        categoryId: "cat-restaurants",
        merchantId: "mer-starbucks",
        notes: "Team lunch",
        externalId: "client-1",
      },
    ]);
  });

  test("refreshes the account balances", async () => {
    await serverTransaction();

    await pullRecent();

    expect(await db.accounts.get("acc-cash")).toMatchObject({
      balanceCents: 99_650,
      updatedAt: NOW,
    });
  });
});

describe("suggestions", () => {
  async function used(
    merchantId: string | undefined,
    categoryId: string | undefined,
    date: string,
  ) {
    await serverTransaction({ merchant_id: merchantId, category_id: categoryId, date });
    vi.setSystemTime(Date.now() + 60_000);
  }

  test("map each merchant to its most used category, with its count and last use", async () => {
    await used("mer-lidl", "cat-groceries", "2026-10-28");
    await used("mer-lidl", "cat-restaurants", "2026-10-29");
    await used("mer-lidl", "cat-groceries", "2026-10-30");
    await used("mer-starbucks", "cat-restaurants", "2026-10-31");
    // Neither can pre-fill anything.
    await used("mer-starbucks", undefined, "2026-11-01");
    await used(undefined, "cat-salary", "2026-11-01");

    await pullRecent();

    expect(await db.suggestions.orderBy("merchantName").toArray()).toEqual([
      {
        merchantName: "Lidl",
        merchantId: "mer-lidl",
        categoryId: "cat-groceries",
        count: 3,
        lastUsedAt: NOW + 2 * 60_000,
      },
      {
        merchantName: "Starbucks",
        merchantId: "mer-starbucks",
        categoryId: "cat-restaurants",
        count: 1,
        lastUsedAt: NOW + 3 * 60_000,
      },
    ]);
  });

  test("a tie goes to the category used on the latest date", async () => {
    await used("mer-lidl", "cat-restaurants", "2026-10-31");
    await used("mer-lidl", "cat-groceries", "2026-10-30");

    await pullRecent();

    expect(await db.suggestions.get("Lidl")).toMatchObject({
      categoryId: "cat-restaurants",
      count: 2,
    });
  });

  test("the window replaces a merchant's stats; merchants outside it are kept", async () => {
    await db.suggestions.bulkPut([
      {
        merchantName: "Lidl",
        merchantId: "mer-lidl",
        categoryId: "cat-salary",
        count: 50,
        lastUsedAt: 0,
      },
      {
        merchantName: "Old bakery",
        merchantId: "mer-old",
        categoryId: "cat-groceries",
        count: 4,
        lastUsedAt: 0,
      },
    ]);
    await used("mer-lidl", "cat-groceries", "2026-10-31");

    await pullRecent();

    expect(await db.suggestions.orderBy("merchantName").toArray()).toEqual([
      expect.objectContaining({ merchantName: "Lidl", categoryId: "cat-groceries", count: 1 }),
      expect.objectContaining({ merchantName: "Old bakery", count: 4 }),
    ]);
  });
});

describe("pending balance delta", () => {
  const coffee: EntryPayload = {
    accountId: "acc-cash",
    date: "2026-11-01",
    amount: "3.50",
    nature: "expense",
    currency: "EUR",
    name: "Coffee",
    notes: null,
    categoryId: null,
    merchantId: null,
  };

  test("clears only once the account is recalculated after Sure applied the write", async () => {
    await pullReference();
    vi.setSystemTime(NOW + 700);
    await enqueue({ op: "create", payload: coffee });
    expect(await pendingDeltas()).toEqual(new Map([["acc-cash", "-3.5000"]]));

    sure.pauseAccountSync();
    await push();
    await pullRecent();
    // Sent, but the balance Sure returns does not include it yet.
    expect(await db.accounts.get("acc-cash")).toMatchObject({ balanceCents: 100_000 });
    expect(await pendingDeltas()).toEqual(new Map([["acc-cash", "-3.5000"]]));

    vi.setSystemTime(NOW + 1500);
    await pullRecent();
    expect(await pendingDeltas()).toEqual(new Map([["acc-cash", "-3.5000"]]));

    sure.resumeAccountSync();
    await pullRecent();
    expect(await db.accounts.get("acc-cash")).toMatchObject({ balanceCents: 99_650 });
    expect(await pendingDeltas()).toEqual(new Map());
  });

  test("a recalculation in the same second as the write clears it", async () => {
    await pullReference();
    vi.setSystemTime(NOW + 700);
    await enqueue({ op: "create", payload: coffee });
    sure.pauseAccountSync();
    await push();

    // Sure renders both times in whole seconds: 10:00:00.
    vi.setSystemTime(NOW + 900);
    sure.resumeAccountSync();
    await pullRecent();

    expect(await pendingDeltas()).toEqual(new Map());
  });

  test("follows the balance direction: an expense lowers an asset and raises a liability", async () => {
    await pullReference();
    await enqueue({ op: "create", payload: { ...coffee, accountId: "acc-card" } });
    await enqueue({ op: "create", payload: { ...coffee, nature: "income", amount: "20" } });
    await enqueue({
      op: "transfer",
      payload: {
        fromAccountId: "acc-card",
        toAccountId: "acc-cash",
        date: "2026-11-01",
        amount: "100",
        currency: "EUR",
        name: "Cash advance",
        notes: null,
      },
    });

    expect(await pendingDeltas()).toEqual(
      new Map([
        ["acc-card", "103.5000"],
        ["acc-cash", "120.0000"],
      ]),
    );
  });

  test("a transfer stays on both accounts until Sure recalculates them", async () => {
    await pullReference();
    await enqueue({
      op: "transfer",
      payload: {
        fromAccountId: "acc-card",
        toAccountId: "acc-cash",
        date: "2026-11-01",
        amount: "100",
        currency: "EUR",
        name: "Cash advance",
        notes: null,
      },
    });

    sure.pauseAccountSync();
    await push();
    await pullRecent();
    expect(await pendingDeltas()).toEqual(
      new Map([
        ["acc-card", "100.0000"],
        ["acc-cash", "100.0000"],
      ]),
    );

    sure.resumeAccountSync();
    await pullRecent();
    expect(await pendingDeltas()).toEqual(new Map());
  });

  test("a failed record adds nothing", async () => {
    await pullReference();
    sure.failNext("POST /api/v1/transactions", { status: 422 });
    await enqueue({ op: "create", payload: coffee });

    await push();

    expect(await db.outbox.toArray()).toMatchObject([{ status: "failed" }]);
    expect(await pendingDeltas()).toEqual(new Map());
  });
});
