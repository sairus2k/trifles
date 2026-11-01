import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { FAKE_SURE_URL, createFakeSure, defaultSeed, type FakeSure } from "../../test/fake-sure";
import { SureError, configureSure } from "../api/http";
import { db } from "../db/schema";
import { pullReference } from "./pull";

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
