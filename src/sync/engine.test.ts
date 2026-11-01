import { http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  FAKE_SURE_URL,
  createFakeSure,
  defaultSeed,
  type FakeSure,
  type FakeSureSeed,
} from "../../test/fake-sure";
import { configureSure } from "../api/http";
import { db, type EntryPayload, type MetaRecord } from "../db/schema";
import { startSync, type SyncEngine } from "./engine";
import { enqueue } from "./outbox";
import { readSyncConfig, saveSettings, switchInstance } from "./settings";

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

// A full run pulls after it sends, and that pull drops the record once Sure has counted it.
async function synced(clientId: string) {
  await vi.waitFor(async () => {
    expect(await record(clientId)).toBeUndefined();
    expect(sure.transactions.filter((t) => t.external_id === clientId)).toHaveLength(1);
  });
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

    await synced(clientId);
    await started();
    expect(count("GET", "/api/v1/categories")).toBe(1);
    expect(count("GET", "/api/v1/merchants")).toBe(1);
    expect(await db.transactions.count()).toBeGreaterThan(0);
  });

  test("a write is sent without anyone asking", async () => {
    start();
    await started();

    const clientId = await add();

    await synced(clientId);
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

    await synced(clientId);
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

    await synced(clientId);
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
    await synced(sent);
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

    await synced(second);
    await synced(first);
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

    await synced(clientId);
    expect(postedExternalIds()).toEqual([clientId]);
  });

  test("a record backing off is sent when it is due, with no other trigger", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    sure.failNext(POST, { status: 500 });
    const clientId = await add();
    start();
    await vi.waitFor(async () => expect(await record(clientId)).toMatchObject({ attempts: 1 }));
    await lockReleased();

    await vi.advanceTimersByTimeAsync(1500); // 2 s backoff with equal jitter at random 0.5

    await synced(clientId);
    expect(Date.now()).toBeLessThan(NOW + 60_000);
  });
});

describe("switching instance", () => {
  const OTHER_URL = "https://other.test";
  const OTHER = { baseUrl: OTHER_URL, apiKey: "other-key" };
  let other: FakeSure;

  // Another instance: none of the ids of the default seed exist there.
  function otherSeed(): Partial<FakeSureSeed> {
    const seed = defaultSeed();
    return {
      accounts: seed.accounts.map((a) => ({ ...a, id: `other-${a.id}` })),
      categories: seed.categories.map((c) => ({ ...c, id: `other-${c.id}` })),
      merchants: seed.merchants.map((m) => ({ ...m, id: `other-${m.id}` })),
    };
  }

  function useOther(seed: Partial<FakeSureSeed> = otherSeed()) {
    other = createFakeSure(seed, OTHER_URL);
    server.use(...other.handlers);
  }

  // Straight to IndexedDB, so this tab's Dexie does not hear of it, as with a liveQuery that has not
  // yet seen another tab's write.
  function writeAsAnotherTab(records: MetaRecord[]) {
    return new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(db.name);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("meta", "readwrite");
        for (const record of records) tx.objectStore("meta").put(record);
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }

  function countOn(fake: FakeSure, method: string, path: string) {
    return fake.requests.filter((r) => r.method === method && r.path.startsWith(path)).length;
  }

  async function cachedAccountIds() {
    return (await db.accounts.orderBy("id").toArray()).map((a) => a.id);
  }

  test("the next run pulls everything from the new instance and nothing from the old", async () => {
    useOther();
    start();
    await started();
    const oldRequests = sure.requests.length;

    expect(await switchInstance(OTHER, 0)).toBeUndefined();

    await vi.waitFor(() => expect(countOn(other, "GET", "/api/v1/transactions")).toBe(1));
    await lockReleased();
    expect(countOn(other, "GET", "/api/v1/categories")).toBe(1);
    expect(countOn(other, "GET", "/api/v1/merchants")).toBe(1);
    expect(await cachedAccountIds()).toEqual(other.accounts.map((a) => a.id).sort());
    expect((await db.categories.toArray()).every((c) => c.id.startsWith("other-"))).toBe(true);
    expect(sure.requests).toHaveLength(oldRequests);
  });

  test("discarded records are sent to neither instance", async () => {
    useOther();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    sure.failNext(POST, { status: 429 });
    const clientId = await add();
    start();
    await vi.waitFor(async () => expect(await record(clientId)).toMatchObject({ attempts: 1 }));
    await lockReleased();

    expect(await switchInstance(OTHER, 1)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await lockReleased();

    await vi.waitFor(() =>
      expect(countOn(other, "GET", "/api/v1/transactions")).toBeGreaterThan(0),
    );
    await lockReleased();
    expect(postedExternalIds()).toEqual([clientId]);
    expect(countOn(other, "POST", "/api/v1/transactions")).toBe(0);
  });

  test("a run in flight finishes against the old instance before the cache is cleared", async () => {
    useOther();
    let reached = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    // Holds the start run's last request, then falls through to the old fake.
    server.use(
      http.get(
        `${FAKE_SURE_URL}/api/v1/transactions`,
        async () => {
          reached = true;
          await held;
        },
        { once: true },
      ),
    );
    start();
    await vi.waitFor(() => expect(reached).toBe(true));

    let switched = false;
    void switchInstance(OTHER, 0).then(() => (switched = true));
    await vi.advanceTimersByTimeAsync(50);
    expect(switched).toBe(false);

    online = false; // keeps the next run from refilling the cache before it is checked
    release();
    await vi.waitFor(() => expect(switched).toBe(true));
    // The old run wrote its pull before the switch, which cleared it.
    for (const table of [db.accounts, db.categories, db.merchants, db.transactions]) {
      expect(await table.count()).toBe(0);
    }

    goOnline();
    await vi.waitFor(() => expect(countOn(other, "GET", "/api/v1/transactions")).toBe(1));
    await lockReleased();
    expect(await cachedAccountIds()).toEqual(other.accounts.map((a) => a.id).sort());
  });

  test("a run behind another tab's switch uses the new URL and key before this tab hears of it", async () => {
    useOther();
    start();
    await started();
    const oldRequests = sure.requests.length;

    await locks.request("outbox", async () => {
      await writeAsAnotherTab([
        { key: "baseUrl", value: OTHER.baseUrl },
        { key: "apiKey", value: OTHER.apiKey },
      ]);
      goOnline(); // queues a run behind the switch
    });

    await vi.waitFor(() => expect(countOn(other, "GET", "/api/v1/transactions")).toBe(1));
    await lockReleased();
    expect(sure.requests).toHaveLength(oldRequests);
    expect(countOn(other, "GET", "/api/v1/categories")).toBe(1);
  });

  test("records kept for the same Sure under another address go to that address", async () => {
    useOther(defaultSeed()); // the same data, as an alias of the instance would have
    online = false;
    const clientId = await add();
    start();
    await saveSettings(OTHER);

    goOnline();

    await vi.waitFor(() =>
      expect(other.transactions.filter((t) => t.external_id === clientId)).toHaveLength(1),
    );
    await lockReleased();
    expect(countOn(other, "GET", "/api/v1/categories")).toBe(1);
    expect(sure.requests).toEqual([]);
  });
});
