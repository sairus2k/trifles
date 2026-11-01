import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { FAKE_SURE_URL, createFakeSure, type FakeSure } from "../../test/fake-sure";
import { configureSure } from "../api/http";
import { db, type EntryPayload } from "../db/schema";
import { startSync, type SyncEngine } from "./engine";
import { enqueue } from "./outbox";
import { readSyncConfig, saveSettings } from "./settings";

// The engine runs in the browser main thread; here `window`, `document` and `navigator.onLine` are
// stand-ins whose events the tests fire by hand. Real events are covered by the E2E tests.

const NOW = new Date("2026-11-01T10:00:00Z").getTime();
const POST = "POST /api/v1/transactions";
const SETTINGS = { baseUrl: FAKE_SURE_URL, apiKey: "test-key" };

const server = setupServer();
const locks = navigator.locks;
let sure: FakeSure;
let online: boolean;
let page: EventTarget & { visibilityState: DocumentVisibilityState };
let engines: SyncEngine[];

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

function start(): SyncEngine {
  const engine = startSync();
  engines.push(engine);
  return engine;
}

function add(name = "Coffee") {
  return enqueue({ op: "create", payload: { ...coffee, name } });
}

function record(clientId: string) {
  return db.outbox.get(clientId);
}

function count(method: string, path: string) {
  return sure.requests.filter((r) => r.method === method && r.path.startsWith(path)).length;
}

function postedExternalIds() {
  return sure.requests
    .filter((r) => r.method === "POST")
    .map((r) => (r.body as { transaction: { external_id: string } }).transaction.external_id);
}

// Resolves once the run holding the lock, if any, has finished.
function lockReleased() {
  return locks.request("outbox", () => {});
}

// Waits for the start run: its last request is the recent transactions pull.
async function started(transactionPulls = 1) {
  await vi.waitFor(() => expect(count("GET", "/api/v1/transactions")).toBe(transactionPulls));
  await lockReleased();
}

function goOnline() {
  online = true;
  window.dispatchEvent(new Event("online"));
}

function show(state: DocumentVisibilityState) {
  page.visibilityState = state;
  page.dispatchEvent(new Event("visibilitychange"));
}

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(async () => {
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  vi.setSystemTime(NOW);
  sure = createFakeSure();
  server.use(...sure.handlers);
  online = true;
  page = Object.assign(new EventTarget(), { visibilityState: "visible" as const });
  vi.stubGlobal("navigator", {
    locks,
    get onLine() {
      return online;
    },
  });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", page);
  engines = [];
  await Promise.all(db.tables.map((table) => table.clear()));
  await saveSettings(SETTINGS);
});
afterEach(async () => {
  for (const engine of engines) engine.stop();
  await lockReleased();
  server.resetHandlers();
  configureSure(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(() => server.close());

describe("triggers", () => {
  test("start sends the queue and pulls reference data and recent transactions", async () => {
    const clientId = await add();

    start();

    await vi.waitFor(async () => expect(await record(clientId)).toMatchObject({ status: "done" }));
    await started();
    expect(count("GET", "/api/v1/categories")).toBe(1);
    expect(count("GET", "/api/v1/merchants")).toBe(1);
    expect(await db.transactions.count()).toBeGreaterThan(0);
  });

  test("a write is sent without anyone asking", async () => {
    start();
    await started();

    const clientId = await add();

    await vi.waitFor(async () => expect(await record(clientId)).toMatchObject({ status: "done" }));
  });

  test("online, visible and the timer each run a full sync", async () => {
    start();
    await started();

    goOnline();
    await started(2);
    show("visible");
    await started(3);
    await vi.advanceTimersByTimeAsync(60_000);
    await started(4);
  });

  test("nothing runs while hidden or after stop", async () => {
    const engine = start();
    await started();
    const request = vi.spyOn(locks, "request");

    show("hidden");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).not.toHaveBeenCalled();

    engine.stop();
    show("visible");
    goOnline();
    await add();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("one worker", () => {
  test("two tabs triggered together send each record once, one request at a time", async () => {
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
    const ids = [await add("First"), await add("Second"), await add("Third")];

    start();
    start();

    // Both tabs ran: each ends with its own recent transactions pull.
    await started(2);
    expect(postedExternalIds()).toEqual(ids);
    expect(maxInFlight).toBe(1);
  });

  test("triggers that fire together merge into one queued run", async () => {
    start();
    await started();
    const request = vi.spyOn(locks, "request");

    goOnline();
    show("visible");
    goOnline();
    await add();

    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await lockReleased();
    expect(request).toHaveBeenCalledTimes(3); // the two runs, plus lockReleased itself
  });
});

describe("offline", () => {
  test("an entry made offline makes no request, stays editable and goes out online", async () => {
    start();
    await started();
    const requests = sure.requests.length;
    online = false;

    const clientId = await add();

    await lockReleased();
    expect(sure.requests).toHaveLength(requests);
    expect(await record(clientId)).toMatchObject({ status: "pending", attempts: 0 });

    goOnline();

    await vi.waitFor(async () => expect(await record(clientId)).toMatchObject({ status: "done" }));
  });

  test("online ends the backoff of a record that failed while the connection was down", async () => {
    start();
    await started();
    sure.failNext(POST, "drop");
    const clientId = await add();
    await vi.waitFor(async () => expect(await record(clientId)).toMatchObject({ attempts: 1 }));
    await lockReleased();
    await db.outbox.update(clientId, { nextAttemptAt: NOW + 5 * 60_000 });

    goOnline();

    await vi.waitFor(async () => expect(await record(clientId)).toMatchObject({ status: "done" }));
    expect(Date.now()).toBeLessThan(NOW + 60_000);
  });
});

describe("pulls", () => {
  test("reference data is pulled once per session", async () => {
    start();
    await started();

    goOnline();
    await started(2);

    expect(count("GET", "/api/v1/categories")).toBe(1);
  });

  test("an offline start pulls reference data on the first online run", async () => {
    online = false;
    start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sure.requests).toEqual([]);

    goOnline();

    await started();
    expect(count("GET", "/api/v1/categories")).toBe(1);
  });

  test("recent transactions follow a push that sent something, not one that sent nothing", async () => {
    start();
    await started();

    const sent = await add();
    await vi.waitFor(async () => expect(await record(sent)).toMatchObject({ status: "done" }));
    await started(2);

    sure.failNext(POST, { status: 500 });
    const retried = await add();
    await vi.waitFor(async () => expect(await record(retried)).toMatchObject({ attempts: 1 }));
    await lockReleased();
    expect(count("GET", "/api/v1/transactions")).toBe(2);
  });

  test("a failed pull leaves sync running for the next trigger", async () => {
    sure.failNext("GET /api/v1/accounts", { status: 500 });
    start();
    await vi.waitFor(() => expect(count("GET", "/api/v1/accounts")).toBe(1));
    await lockReleased();

    goOnline();

    await started();
    expect(await readSyncConfig()).toMatchObject({ pausedAt: undefined });
  });
});

describe("pause", () => {
  test("a 401 on push pauses sync until settings are saved", async () => {
    sure.failNext(POST, { status: 401 });
    const first = await add("First");
    const second = await add("Second");
    start();
    await vi.waitFor(async () =>
      expect(await readSyncConfig()).toMatchObject({ pausedAt: expect.any(Number) }),
    );
    await lockReleased();
    const requests = sure.requests.length;

    goOnline();
    show("visible");
    await add("Third");
    await vi.advanceTimersByTimeAsync(60_000);
    await lockReleased();
    expect(sure.requests).toHaveLength(requests);

    await saveSettings({ ...SETTINGS, apiKey: "new-key" });

    await vi.waitFor(async () => expect(await record(second)).toMatchObject({ status: "done" }));
    expect(await record(first)).toMatchObject({ status: "done" });
    expect(await readSyncConfig()).toMatchObject({ pausedAt: undefined });
  });

  test("a 401 on a pull pauses sync too", async () => {
    sure.failNext("GET /api/v1/accounts", { status: 401 });

    start();

    await vi.waitFor(async () =>
      expect(await readSyncConfig()).toMatchObject({ pausedAt: expect.any(Number) }),
    );
  });

  test("nothing runs without settings", async () => {
    await db.meta.clear();
    await add();

    start();
    await vi.advanceTimersByTimeAsync(60_000);
    goOnline();
    await lockReleased();

    expect(sure.requests).toEqual([]);
  });
});

describe("recovery", () => {
  test("a record left sending by a closed tab is requeued and sent", async () => {
    const clientId = await add();
    await db.outbox.update(clientId, { status: "sending" });

    start();

    await vi.waitFor(async () =>
      expect(await record(clientId)).toMatchObject({ status: "done", attempts: 2 }),
    );
  });

  test("a record backing off is sent when it is due, with no other trigger", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    sure.failNext(POST, { status: 500 });
    const clientId = await add();
    start();
    await vi.waitFor(async () => expect(await record(clientId)).toMatchObject({ attempts: 1 }));
    await lockReleased();

    await vi.advanceTimersByTimeAsync(1500); // 2 s backoff with equal jitter at random 0.5

    await vi.waitFor(async () => expect(await record(clientId)).toMatchObject({ status: "done" }));
    expect(Date.now()).toBeLessThan(NOW + 60_000);
  });
});
