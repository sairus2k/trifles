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
  editPending,
  enqueue,
  enqueueDelete,
  enqueueUpdate,
  removePending,
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
