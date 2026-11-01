import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { FAKE_SURE_URL, createFakeSure, type FakeSure } from "../../test/fake-sure";
import { configureSure } from "../api/http";
import { db, type EntryPayload, type TransferPayload } from "../db/schema";
import { enqueue, enqueueDelete, enqueueUpdate } from "./outbox";
import { push } from "./push";

const NOW = new Date("2026-11-01T10:00:00Z").getTime();
const POST = "POST /api/v1/transactions";
const TRANSACTIONS = `${FAKE_SURE_URL}/api/v1/transactions`;

const server = setupServer();
let sure: FakeSure;

const coffee: EntryPayload = {
  accountId: "acc-cash",
  date: "2026-11-01",
  amount: "3.50",
  nature: "expense",
  currency: "EUR",
  name: "Coffee",
  notes: null,
  categoryId: "cat-restaurants",
  merchantId: "mer-starbucks",
};

const withdrawal: TransferPayload = {
  fromAccountId: "acc-checking",
  toAccountId: "acc-cash",
  date: "2026-11-01",
  amount: "100",
  currency: "EUR",
  name: "Cash withdrawal",
  notes: null,
};

function entry(overrides: Partial<EntryPayload> = {}): EntryPayload {
  return { ...coffee, ...overrides };
}

function record(clientId: string) {
  return db.outbox.get(clientId);
}

function postedExternalIds() {
  return sure.requests
    .filter((r) => r.method === "POST")
    .map((r) => (r.body as { transaction: { external_id: string } }).transaction.external_id);
}

function later(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

// Puts a transaction on the fake through the app's own push, as a synced entry would be.
async function synced(payload: EntryPayload = coffee) {
  const clientId = await enqueue({ op: "create", payload });
  await push();
  return sure.transactions.find((t) => t.external_id === clientId)!;
}

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  sure = createFakeSure();
  server.use(...sure.handlers);
  configureSure({ baseUrl: FAKE_SURE_URL, apiKey: "test-key" });
  await db.outbox.clear();
});
afterEach(() => {
  server.resetHandlers();
  configureSure(undefined);
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(() => server.close());

describe("order", () => {
  test("sends records one at a time in creation order", async () => {
    const realFetch = globalThis.fetch;
    let inFlight = 0;
    let maxInFlight = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (...args) => {
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      try {
        return await realFetch(...args);
      } finally {
        inFlight--;
      }
    });
    const ids = [
      await enqueue({ op: "create", payload: entry({ name: "First" }) }),
      await enqueue({ op: "create", payload: entry({ name: "Second" }) }),
      await enqueue({ op: "create", payload: entry({ name: "Third" }) }),
    ];

    const result = await push();

    expect(result).toEqual({ sent: 3, paused: false });
    expect(postedExternalIds()).toEqual(ids);
    expect(maxInFlight).toBe(1);
    expect((await db.outbox.toArray()).map((r) => r.status)).toEqual(["done", "done", "done"]);
  });

  test("a head that is backing off holds the records behind it", async () => {
    sure.failNext(POST, { status: 500 });
    const head = await enqueue({ op: "create", payload: coffee });
    const next = await enqueue({ op: "create", payload: entry({ name: "Tea" }) });

    expect(await push()).toEqual({ sent: 0, paused: false });

    expect(postedExternalIds()).toEqual([head]);
    expect(await record(next)).toMatchObject({ status: "pending", attempts: 0 });
  });
});

describe("create", () => {
  test("sends external_id, source, a positive amount, nature and the account currency", async () => {
    const clientId = await enqueue({ op: "create", payload: coffee });
    const income = await enqueue({
      op: "create",
      payload: entry({ name: "Refund", nature: "income", notes: "Overcharged" }),
    });

    await push();

    expect(sure.requests.map((r) => r.body)).toEqual([
      {
        transaction: {
          account_id: "acc-cash",
          date: "2026-11-01",
          amount: 3.5,
          nature: "expense",
          currency: "EUR",
          name: "Coffee",
          category_id: "cat-restaurants",
          merchant_id: "mer-starbucks",
          external_id: clientId,
          source: "sure-quick-entry",
        },
      },
      {
        transaction: expect.objectContaining({
          amount: 3.5,
          nature: "income",
          notes: "Overcharged",
          external_id: income,
        }),
      },
    ]);
    expect(sure.transactions.map((t) => t.amount_decimal)).toEqual(["3.5", "-3.5"]);
  });

  test("a lost response after the server applied the write is retried without a duplicate", async () => {
    sure.failNext(POST, "lose-response");
    const clientId = await enqueue({ op: "create", payload: coffee });

    await push();
    expect(await record(clientId)).toMatchObject({ status: "pending", attempts: 1 });
    expect(sure.transactions).toHaveLength(1);

    later(5 * 60_000);
    expect(await push()).toEqual({ sent: 1, paused: false });

    // The 200 carries the original transaction, so the time is when Sure first applied it.
    expect(await record(clientId)).toMatchObject({
      status: "done",
      attempts: 2,
      lastError: null,
      appliedAt: NOW,
    });
    expect(postedExternalIds()).toEqual([clientId, clientId]);
    expect(sure.transactions).toHaveLength(1);
  });

  test("records when Sure applied the write, in whole seconds of the server clock", async () => {
    vi.setSystemTime(NOW + 700);
    const clientId = await enqueue({ op: "create", payload: coffee });

    await push();

    expect(await record(clientId)).toMatchObject({ status: "done", appliedAt: NOW });
  });
});

describe("definitive errors", () => {
  test("422 marks the record failed with the server message and the queue continues", async () => {
    sure.failNext(POST, {
      status: 422,
      body: {
        error: "validation_failed",
        message: "Transaction could not be created",
        errors: ["Date can't be blank", "Name can't be blank"],
      },
    });
    const rejected = await enqueue({ op: "create", payload: coffee });
    const next = await enqueue({ op: "create", payload: entry({ name: "Tea" }) });

    expect(await push()).toEqual({ sent: 1, paused: false });

    expect(await record(rejected)).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "Date can't be blank; Name can't be blank",
    });
    expect(await record(next)).toMatchObject({ status: "done" });
  });

  test("a status the spec does not declare fails the record with its message", async () => {
    sure.failNext(POST, { status: 404 });
    const clientId = await enqueue({ op: "create", payload: coffee });

    await push();

    expect(await record(clientId)).toMatchObject({
      status: "failed",
      lastError: "The requested resource was not found",
    });
  });
});

describe("pause", () => {
  test.each([
    ["401", () => sure.failNext(POST, { status: 401 }), 1],
    ["403", () => sure.failNext(POST, { status: 403, body: { error: "insufficient_scope" } }), 1],
    ["missing settings", () => configureSure(undefined), 0],
  ])("%s pauses the queue without a retry loop", async (_, arrange, requests) => {
    arrange();
    const head = await enqueue({ op: "create", payload: coffee });
    const next = await enqueue({ op: "create", payload: entry({ name: "Tea" }) });

    expect(await push()).toEqual({ sent: 0, paused: true });

    expect(sure.requests).toHaveLength(requests);
    expect(await record(head)).toMatchObject({
      status: "pending",
      nextAttemptAt: NOW,
      lastError: expect.any(String),
    });
    expect(await record(next)).toMatchObject({ status: "pending", attempts: 0 });
  });

  test("the paused head goes out first on the next push", async () => {
    sure.failNext(POST, { status: 401 });
    const head = await enqueue({ op: "create", payload: coffee });
    await push();

    expect(await push()).toEqual({ sent: 1, paused: false });
    expect(await record(head)).toMatchObject({ status: "done" });
  });
});

describe("retry", () => {
  test("500 then 201: backs off, holds until the time comes, then sends", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    sure.failNext(POST, { status: 500 });
    const clientId = await enqueue({ op: "create", payload: coffee });

    await push();
    // 2 s base: half fixed, half jittered.
    expect(await record(clientId)).toMatchObject({
      status: "pending",
      attempts: 1,
      nextAttemptAt: NOW + 1500,
      lastError: "POST /api/v1/transactions failed with status 500",
    });

    later(1499);
    expect(await push()).toEqual({ sent: 0, paused: false });
    expect(sure.requests).toHaveLength(1);

    later(1);
    expect(await push()).toEqual({ sent: 1, paused: false });
    expect(await record(clientId)).toMatchObject({ status: "done", lastError: null });
    expect(sure.transactions).toHaveLength(1);
  });

  test("the delay doubles per attempt, is capped at 5 minutes and jittered", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const clientId = await enqueue({ op: "create", payload: coffee });
    const delays: number[] = [];
    for (let i = 0; i < 3; i++) {
      sure.failNext(POST, { status: 503 });
      await push();
      const { nextAttemptAt } = (await record(clientId))!;
      delays.push(nextAttemptAt - Date.now());
      vi.setSystemTime(nextAttemptAt);
    }
    expect(delays).toEqual([1000, 2000, 4000]);

    await db.outbox.update(clientId, { attempts: 30 });
    random.mockReturnValue(0.999);
    sure.failNext(POST, { status: 503 });
    await push();
    expect((await record(clientId))!.nextAttemptAt - Date.now()).toBe(
      Math.round(150_000 + 0.999 * 150_000),
    );
  });

  test.each([
    ["429", { status: 429 }],
    ["a network error", "drop"],
  ] as const)("%s is retried", async (_, fault) => {
    sure.failNext(POST, fault);
    const clientId = await enqueue({ op: "create", payload: coffee });

    await push();

    expect(await record(clientId)).toMatchObject({ status: "pending", attempts: 1 });
    expect((await record(clientId))!.nextAttemptAt).toBeGreaterThan(NOW);
  });

  test("a request that never answers times out after 30 s and is retried", async () => {
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => realTimeout(10));
    sure.failNext(POST, "hang");
    const clientId = await enqueue({ op: "create", payload: coffee });

    await push();

    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(await record(clientId)).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "POST /api/v1/transactions failed to complete",
    });
  });

  test("an unexpected error requeues the record with backoff and is rethrown", async () => {
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      throw new TypeError("boom");
    });
    const clientId = await enqueue({ op: "create", payload: coffee });

    await expect(push()).rejects.toThrow("boom");

    const failed = (await record(clientId))!;
    expect(failed).toMatchObject({ status: "pending", lastError: "TypeError: boom" });
    expect(failed.nextAttemptAt).toBeGreaterThan(NOW);
  });
});

describe("transfer", () => {
  test("sends the :out leg as an expense and the :in leg as an income", async () => {
    const clientId = await enqueue({ op: "transfer", payload: withdrawal });

    expect(await push()).toEqual({ sent: 1, paused: false });

    expect(sure.requests.map((r) => r.body)).toEqual([
      {
        transaction: expect.objectContaining({
          account_id: "acc-checking",
          nature: "expense",
          amount: 100,
          currency: "EUR",
          external_id: `${clientId}:out`,
          source: "sure-quick-entry",
        }),
      },
      {
        transaction: expect.objectContaining({
          account_id: "acc-cash",
          nature: "income",
          amount: 100,
          currency: "EUR",
          external_id: `${clientId}:in`,
          source: "sure-quick-entry",
        }),
      },
    ]);
    expect(sure.transactions.map((t) => t.amount_decimal)).toEqual(["100.0", "-100.0"]);
  });

  test("one leg sent and one failed resumes without duplicating the sent leg", async () => {
    // The fake queues faults per route, so fail the :in leg with a handler in front of it.
    let failIn = true;
    server.use(
      http.post(TRANSACTIONS, async ({ request }) => {
        const { transaction } = (await request.clone().json()) as {
          transaction: { external_id: string };
        };
        if (failIn && transaction.external_id.endsWith(":in")) {
          failIn = false;
          return HttpResponse.json({ error: "internal_server_error" }, { status: 500 });
        }
        return undefined;
      }),
    );
    const clientId = await enqueue({ op: "transfer", payload: withdrawal });

    await push();
    expect(await record(clientId)).toMatchObject({ status: "pending", attempts: 1 });
    expect(sure.transactions.map((t) => t.external_id)).toEqual([`${clientId}:out`]);

    later(5 * 60_000);
    expect(await push()).toEqual({ sent: 1, paused: false });

    // The :out leg went out first, so its time comes from the first attempt.
    expect(await record(clientId)).toMatchObject({ status: "done", appliedAt: NOW });
    expect(sure.transactions.map((t) => t.external_id)).toEqual([
      `${clientId}:out`,
      `${clientId}:in`,
    ]);
  });

  test("a rejected :out leg fails the transfer without sending the :in leg", async () => {
    sure.failNext(POST, { status: 422 });
    const clientId = await enqueue({ op: "transfer", payload: withdrawal });

    await push();

    expect(await record(clientId)).toMatchObject({ status: "failed" });
    expect(postedExternalIds()).toEqual([`${clientId}:out`]);
  });
});

describe("update", () => {
  test("sends full values with PATCH; null notes clear with an empty string", async () => {
    const transaction = await synced(entry({ notes: "Old note" }));

    const clientId = await enqueueUpdate(transaction.id, {
      date: "2026-10-31",
      amount: "4.20",
      nature: "expense",
      currency: "EUR",
      name: "Coffee and croissant",
      notes: null,
      categoryId: "cat-groceries",
      merchantId: null,
    });
    expect(await push()).toEqual({ sent: 1, paused: false });

    expect(sure.requests.at(-1)).toEqual({
      method: "PATCH",
      path: `/api/v1/transactions/${transaction.id}`,
      body: {
        transaction: {
          date: "2026-10-31",
          amount: 4.2,
          nature: "expense",
          currency: "EUR",
          name: "Coffee and croissant",
          notes: "",
          category_id: "cat-groceries",
        },
      },
    });
    expect(transaction).toMatchObject({
      name: "Coffee and croissant",
      amount_decimal: "4.2",
      notes: "",
      category: { id: "cat-groceries" },
    });
    expect(await record(clientId)).toMatchObject({ status: "done" });
  });

  test("404 for a transaction deleted on the server fails the update", async () => {
    const { accountId: _, ...changes } = coffee;
    const clientId = await enqueueUpdate("missing", changes);

    await push();

    expect(await record(clientId)).toMatchObject({
      status: "failed",
      lastError: "Transaction not found",
    });
  });
});

describe("delete", () => {
  test("sends DELETE and marks the record done", async () => {
    const transaction = await synced();

    const clientId = await enqueueDelete(transaction.id);
    expect(await push()).toEqual({ sent: 1, paused: false });

    expect(sure.requests.at(-1)).toMatchObject({
      method: "DELETE",
      path: `/api/v1/transactions/${transaction.id}`,
    });
    expect(sure.transactions).toHaveLength(0);
    expect(await record(clientId)).toMatchObject({ status: "done" });
  });

  test("a retry after a lost response gets 404 and counts as done", async () => {
    const transaction = await synced();
    sure.failNext("DELETE /api/v1/transactions/:id", "lose-response");

    const clientId = await enqueueDelete(transaction.id);
    await push();
    expect(await record(clientId)).toMatchObject({ status: "pending", attempts: 1 });

    later(5 * 60_000);
    expect(await push()).toEqual({ sent: 1, paused: false });
    expect(await record(clientId)).toMatchObject({ status: "done", attempts: 2 });
  });
});
