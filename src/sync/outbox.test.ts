import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  db,
  type EntryPayload,
  type OutboxRecord,
  type TransferPayload,
  type UpdatePayload,
} from "../db/schema";
import {
  OutboxLockedError,
  claimNext,
  editPending,
  enqueue,
  enqueueDelete,
  enqueueUpdate,
  headRetryAt,
  markDone,
  markFailed,
  markPaused,
  markRetry,
  onOutboxWrite,
  removePending,
  requeueStuck,
  retryNow,
  transferLegs,
  type PendingWrite,
} from "./outbox";

const NOW = new Date("2026-11-01T10:00:00Z").getTime();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const coffee: EntryPayload = {
  accountId: "acc-cash",
  date: "2026-11-01",
  amount: "3.50",
  nature: "expense",
  currency: "EUR",
  name: "Coffee",
  notes: null,
  categoryId: "cat-food",
  merchantId: "mer-cafe",
};

const withdrawal: TransferPayload = {
  fromAccountId: "acc-card",
  toAccountId: "acc-cash",
  date: "2026-11-01",
  amount: "100",
  currency: "EUR",
  name: "Cash withdrawal",
  notes: "ATM",
};

const changes: UpdatePayload["changes"] = {
  date: "2026-10-31",
  amount: "4.20",
  nature: "expense",
  currency: "EUR",
  name: "Coffee and croissant",
  notes: null,
  categoryId: "cat-food",
  merchantId: null,
};

// Test-only shortcut into states that push (TASK-8) produces.
async function setState(clientId: string, state: Partial<OutboxRecord>): Promise<OutboxRecord> {
  await db.outbox.update(clientId, state);
  return (await db.outbox.get(clientId))!;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await db.outbox.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("enqueue", () => {
  test("writes one pending record with a client UUID in one transaction", async () => {
    const transaction = vi.spyOn(db, "transaction");

    const clientId = await enqueue({ op: "create", payload: coffee });

    expect(clientId).toMatch(UUID);
    expect(transaction).toHaveBeenCalledOnce();
    expect(await db.outbox.toArray()).toEqual([
      {
        clientId,
        op: "create",
        payload: coffee,
        status: "pending",
        attempts: 0,
        nextAttemptAt: 0,
        lastError: null,
        createdAt: NOW,
      },
    ]);
  });

  test("keeps creation order within one millisecond", async () => {
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await enqueue({ op: "create", payload: coffee }));

    const queue = await db.outbox.orderBy("createdAt").toArray();
    expect(queue.map((r) => r.clientId)).toEqual(ids);
    expect(queue.map((r) => r.createdAt)).toEqual([NOW, NOW + 1, NOW + 2]);
  });

  test("a transfer is one record that produces two legs", async () => {
    const clientId = await enqueue({ op: "transfer", payload: withdrawal });

    const records = await db.outbox.toArray();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ clientId, op: "transfer", payload: withdrawal });

    const leg = { date: "2026-11-01", amount: "100", currency: "EUR", name: "Cash withdrawal" };
    expect(transferLegs(clientId, withdrawal)).toEqual([
      {
        externalId: `${clientId}:out`,
        payload: {
          ...leg,
          accountId: "acc-card",
          nature: "expense",
          notes: "ATM",
          categoryId: null,
          merchantId: null,
        },
      },
      {
        externalId: `${clientId}:in`,
        payload: {
          ...leg,
          accountId: "acc-cash",
          nature: "income",
          notes: "ATM",
          categoryId: null,
          merchantId: null,
        },
      },
    ]);
  });
});

describe("pending writes", () => {
  test("editing a pending create rewrites it and queues nothing", async () => {
    const clientId = await enqueue({ op: "create", payload: coffee });
    const edited = { ...coffee, amount: "4.20", name: "Coffee and croissant" };
    vi.setSystemTime(NOW + 60_000);

    await editPending(clientId, { op: "create", payload: edited });

    expect(await db.outbox.toArray()).toEqual([
      expect.objectContaining({ clientId, op: "create", payload: edited, createdAt: NOW }),
    ]);
  });

  test("editing can turn a pending create into a transfer", async () => {
    const clientId = await enqueue({ op: "create", payload: coffee });

    await editPending(clientId, { op: "transfer", payload: withdrawal });

    expect(await db.outbox.toArray()).toEqual([
      expect.objectContaining({ clientId, op: "transfer", payload: withdrawal }),
    ]);
  });

  test("deleting a pending create removes it and queues nothing", async () => {
    const clientId = await enqueue({ op: "create", payload: coffee });

    await removePending(clientId);

    expect(await db.outbox.count()).toBe(0);
  });

  test("editing a failed create resets it to pending", async () => {
    const clientId = await enqueue({ op: "create", payload: coffee });
    await setState(clientId, {
      status: "failed",
      attempts: 1,
      nextAttemptAt: NOW + 5000,
      lastError: "Account is closed",
    });
    const edited = { ...coffee, accountId: "acc-card" };

    await editPending(clientId, { op: "create", payload: edited });

    expect(await db.outbox.get(clientId)).toMatchObject({
      payload: edited,
      status: "pending",
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
    });
  });

  test("a failed create can be deleted", async () => {
    const clientId = await enqueue({ op: "create", payload: coffee });
    await setState(clientId, { status: "failed", attempts: 1, lastError: "Account is closed" });

    await removePending(clientId);

    expect(await db.outbox.count()).toBe(0);
  });

  // Each of these may already be on the server, so an edit could be lost or duplicate it.
  test.each([
    ["sending", { status: "sending" }, "create"],
    ["retrying after an attempt", { status: "pending", attempts: 1 }, "create"],
    ["done", { status: "done", attempts: 1 }, "create"],
    ["a failed transfer", { status: "failed", attempts: 1 }, "transfer"],
  ] as const)("a record that is %s is locked", async (_, state, op) => {
    const write: PendingWrite =
      op === "create" ? { op, payload: coffee } : { op, payload: withdrawal };
    const clientId = await enqueue(write);
    const before = await setState(clientId, state);

    await expect(editPending(clientId, { op: "create", payload: coffee })).rejects.toThrow(
      OutboxLockedError,
    );
    await expect(removePending(clientId)).rejects.toThrow(OutboxLockedError);
    expect(await db.outbox.toArray()).toEqual([before]);
  });

  test("update and delete operations are not pending writes", async () => {
    const clientId = await enqueueUpdate("tx-1", changes);

    await expect(editPending(clientId, { op: "create", payload: coffee })).rejects.toThrow(
      OutboxLockedError,
    );
    await expect(removePending(clientId)).rejects.toThrow(OutboxLockedError);
  });

  test("a missing record is locked", async () => {
    await expect(removePending("gone")).rejects.toThrow(OutboxLockedError);
  });
});

describe("synced transactions", () => {
  test("an edit enqueues an update", async () => {
    const clientId = await enqueueUpdate("tx-1", changes);

    expect(await db.outbox.toArray()).toEqual([
      {
        clientId,
        op: "update",
        payload: { transactionId: "tx-1", changes },
        status: "pending",
        attempts: 0,
        nextAttemptAt: 0,
        lastError: null,
        createdAt: NOW,
      },
    ]);
  });

  test("a delete enqueues a delete", async () => {
    const clientId = await enqueueDelete("tx-1");

    expect(await db.outbox.toArray()).toEqual([
      expect.objectContaining({ clientId, op: "delete", payload: { transactionId: "tx-1" } }),
    ]);
  });

  test("a second edit rewrites the queued update", async () => {
    const clientId = await enqueueUpdate("tx-1", changes);
    const again = { ...changes, amount: "5" };

    expect(await enqueueUpdate("tx-1", again)).toBe(clientId);

    expect(await db.outbox.toArray()).toEqual([
      expect.objectContaining({ clientId, payload: { transactionId: "tx-1", changes: again } }),
    ]);
  });

  test("a delete replaces a queued update", async () => {
    const clientId = await enqueueUpdate("tx-1", changes);

    expect(await enqueueDelete("tx-1")).toBe(clientId);

    expect(await db.outbox.toArray()).toEqual([
      expect.objectContaining({ clientId, op: "delete", payload: { transactionId: "tx-1" } }),
    ]);
  });

  test("a failed update is rewritten and reset to pending", async () => {
    const clientId = await enqueueUpdate("tx-1", changes);
    await setState(clientId, { status: "failed", attempts: 2, lastError: "Invalid date" });

    await enqueueUpdate("tx-1", changes);

    expect(await db.outbox.get(clientId)).toMatchObject({
      status: "pending",
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
    });
  });

  test("an update in flight gets a new operation queued after it", async () => {
    const first = await enqueueUpdate("tx-1", changes);
    await setState(first, { status: "sending" });

    const second = await enqueueDelete("tx-1");

    expect(second).not.toBe(first);
    const queue = await db.outbox.orderBy("createdAt").toArray();
    expect(queue.map((r) => [r.clientId, r.op, r.status])).toEqual([
      [first, "update", "sending"],
      [second, "delete", "pending"],
    ]);
  });

  test("operations on different transactions stay separate", async () => {
    await enqueueUpdate("tx-1", changes);
    await enqueueDelete("tx-2");

    expect(await db.outbox.count()).toBe(2);
  });
});

describe("status transitions", () => {
  test("claimNext marks the oldest pending record sending", async () => {
    const first = await enqueue({ op: "create", payload: coffee });
    await enqueue({ op: "transfer", payload: withdrawal });

    const claimed = await claimNext();

    expect(claimed).toMatchObject({ clientId: first, status: "sending" });
    expect(await db.outbox.get(first)).toEqual(claimed);
  });

  test("a backing-off head holds the queue until it is due", async () => {
    const first = await enqueue({ op: "create", payload: coffee });
    await enqueue({ op: "create", payload: coffee });
    await setState(first, { attempts: 1, nextAttemptAt: NOW + 5000 });

    expect(await claimNext()).toBeUndefined();

    vi.setSystemTime(NOW + 5000);
    expect(await claimNext()).toMatchObject({ clientId: first });
  });

  test("failed and done records do not hold the queue", async () => {
    const failed = await enqueue({ op: "create", payload: coffee });
    const done = await enqueue({ op: "create", payload: coffee });
    const next = await enqueue({ op: "create", payload: coffee });
    await setState(failed, { status: "failed", attempts: 1, lastError: "Invalid" });
    await setState(done, { status: "done", attempts: 1 });

    expect(await claimNext()).toMatchObject({ clientId: next });
  });

  test("nothing is claimed while a record is sending", async () => {
    await enqueue({ op: "create", payload: coffee });
    await enqueue({ op: "create", payload: coffee });
    await claimNext();

    expect(await claimNext()).toBeUndefined();
  });

  test("nothing is claimed from an empty queue", async () => {
    expect(await claimNext()).toBeUndefined();
  });

  test("a record moves through retry, failure and back, keeping its bookkeeping", async () => {
    const clientId = await enqueue({ op: "create", payload: coffee });

    await claimNext();
    await markRetry(clientId, "Network error", NOW + 2000);
    expect(await db.outbox.get(clientId)).toMatchObject({
      status: "pending",
      attempts: 1,
      nextAttemptAt: NOW + 2000,
      lastError: "Network error",
    });

    vi.setSystemTime(NOW + 2000);
    await claimNext();
    await markFailed(clientId, "Amount is invalid");
    expect(await db.outbox.get(clientId)).toMatchObject({
      status: "failed",
      attempts: 2,
      nextAttemptAt: NOW + 2000,
      lastError: "Amount is invalid",
    });
  });

  test("markDone finishes a record and clears its error", async () => {
    const clientId = await enqueue({ op: "create", payload: coffee });
    await claimNext();
    await markRetry(clientId, "HTTP 500", NOW);
    await claimNext();

    await markDone(clientId);

    expect(await db.outbox.get(clientId)).toMatchObject({
      status: "done",
      attempts: 2,
      lastError: null,
    });
    expect(await claimNext()).toBeUndefined();
  });

  test("markPaused requeues a create without counting the attempt, so it stays editable", async () => {
    const clientId = await enqueue({ op: "create", payload: coffee });
    await claimNext();

    await markPaused(clientId, "HTTP 401");

    expect(await db.outbox.get(clientId)).toMatchObject({
      status: "pending",
      attempts: 0,
      nextAttemptAt: NOW,
      lastError: "HTTP 401",
    });
    await editPending(clientId, { op: "create", payload: { ...coffee, amount: "4" } });
  });

  test("markPaused counts the attempt of a transfer: its first leg may be on the server", async () => {
    const clientId = await enqueue({ op: "transfer", payload: withdrawal });
    await claimNext();

    await markPaused(clientId, "HTTP 401");

    expect(await db.outbox.get(clientId)).toMatchObject({ status: "pending", attempts: 1 });
    await expect(removePending(clientId)).rejects.toThrow(OutboxLockedError);
  });

  test.each([
    ["markDone", (id: string) => markDone(id)],
    ["markFailed", (id: string) => markFailed(id, "Invalid")],
    ["markRetry", (id: string) => markRetry(id, "HTTP 500", NOW)],
    ["markPaused", (id: string) => markPaused(id, "HTTP 401")],
  ])("%s only moves a record that is sending", async (_, mark) => {
    const clientId = await enqueue({ op: "create", payload: coffee });
    const before = await db.outbox.get(clientId);

    await expect(mark(clientId)).rejects.toThrow(/not being sent/);
    await expect(mark("gone")).rejects.toThrow(/not being sent/);
    expect(await db.outbox.get(clientId)).toEqual(before);
  });
});

describe("sync engine hooks", () => {
  test("every write that has something to send notifies after it commits", async () => {
    const committed: number[] = [];
    const unsubscribe = onOutboxWrite(() => void db.outbox.count().then((n) => committed.push(n)));

    const clientId = await enqueue({ op: "create", payload: coffee });
    await editPending(clientId, { op: "create", payload: { ...coffee, amount: "4" } });
    await enqueueUpdate("tx-1", changes);
    await enqueueDelete("tx-2");
    await removePending(clientId);
    unsubscribe();
    await enqueue({ op: "create", payload: coffee });

    await vi.waitFor(() => expect(committed).toEqual([1, 1, 2, 3]));
  });

  test("headRetryAt is when a backing-off head is due, and nothing otherwise", async () => {
    expect(await headRetryAt()).toBeUndefined();
    const head = await enqueue({ op: "create", payload: coffee });
    expect(await headRetryAt()).toBeUndefined();

    await setState(head, { attempts: 1, nextAttemptAt: NOW + 5000 });
    expect(await headRetryAt()).toBe(NOW + 5000);

    await setState(head, { status: "sending" });
    expect(await headRetryAt()).toBeUndefined();
  });

  test("requeueStuck puts a sending record back with the attempt counted", async () => {
    const stuck = await enqueue({ op: "create", payload: coffee });
    const next = await enqueue({ op: "create", payload: coffee });
    await setState(stuck, { status: "sending", attempts: 2, nextAttemptAt: NOW - 1000 });

    await requeueStuck();

    expect(await db.outbox.get(stuck)).toMatchObject({
      status: "pending",
      attempts: 3,
      nextAttemptAt: 0,
    });
    expect(await db.outbox.get(next)).toMatchObject({ status: "pending", attempts: 0 });
    expect(await claimNext()).toMatchObject({ clientId: stuck });
  });

  test("retryNow ends the backoff of pending records only", async () => {
    const backingOff = await enqueue({ op: "create", payload: coffee });
    const failed = await enqueue({ op: "create", payload: coffee });
    await setState(backingOff, { attempts: 3, nextAttemptAt: NOW + 60_000 });
    await setState(failed, { status: "failed", attempts: 1, nextAttemptAt: NOW + 2000 });

    await retryNow();

    expect(await db.outbox.get(backingOff)).toMatchObject({ attempts: 3, nextAttemptAt: 0 });
    expect(await db.outbox.get(failed)).toMatchObject({ nextAttemptAt: NOW + 2000 });
    expect(await claimNext()).toMatchObject({ clientId: backingOff });
  });
});
