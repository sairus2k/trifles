import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  db,
  type AccountRecord,
  type EntryPayload,
  type OutboxStatus,
  type SuggestionRecord,
  type TransactionRecord,
} from "../db/schema";
import { SYNC_LOCK, enqueue } from "./outbox";
import { pauseSync, readSyncConfig, sameInstance, saveSettings, switchInstance } from "./settings";

const NOW = new Date("2026-11-01T10:00:00Z").getTime();
const settings = { baseUrl: "https://sure.example", apiKey: "key-1" };

const account: AccountRecord = {
  id: "acc-cash",
  name: "Cash",
  currency: "EUR",
  classification: "asset",
  balanceCents: 0,
  status: "active",
  updatedAt: 0,
};
const transaction: TransactionRecord = {
  id: "tx-1",
  accountId: "acc-cash",
  date: "2026-11-01",
  name: "Coffee",
  amountDecimal: "3.5",
  currency: "EUR",
  categoryId: "cat-food",
  merchantId: "mer-lidl",
  notes: null,
  externalId: null,
  createdAt: 0,
  transferId: null,
};
const suggestion: SuggestionRecord = {
  merchantName: "Lidl",
  merchantId: "mer-lidl",
  categoryId: "cat-food",
  count: 1,
  lastUsedAt: 0,
};
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

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await db.meta.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

test("nothing is configured on a fresh install", async () => {
  expect(await readSyncConfig()).toEqual({ settings: undefined, pausedAt: undefined });
});

test("saved settings are read back", async () => {
  await saveSettings(settings);

  expect(await readSyncConfig()).toEqual({ settings, pausedAt: undefined });
});

test("a pause holds until settings are saved", async () => {
  await saveSettings(settings);
  await pauseSync();
  expect(await readSyncConfig()).toEqual({ settings, pausedAt: NOW });

  await saveSettings({ ...settings, apiKey: "key-2" });

  expect(await readSyncConfig()).toEqual({
    settings: { ...settings, apiKey: "key-2" },
    pausedAt: undefined,
  });
});

test.each([
  ["a trailing slash", "https://sure.example/", true],
  ["the host's case", "https://Sure.Example", true],
  ["the default port", "https://sure.example:443", true],
  ["another path", "https://sure.example/sure", false],
  ["another scheme", "http://sure.example", false],
  ["another host", "https://other.example", false],
])("%s: same instance is %s", (_, other, same) => {
  expect(sameInstance(settings.baseUrl, other)).toBe(same);
});

describe("switchInstance", () => {
  const other = { baseUrl: "https://other.example", apiKey: "key-2" };

  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    await saveSettings(settings);
    await pauseSync();
    await db.meta.put({ key: "entryAccountId", value: "acc-cash" });
    await db.accounts.put(account);
    await db.categories.put({ id: "cat-food", name: "Food", color: "#000000", icon: "x" });
    await db.merchants.put({ id: "mer-lidl", name: "Lidl" });
    await db.transactions.put(transaction);
    await db.suggestions.put(suggestion);
  });

  async function queue(...statuses: OutboxStatus[]) {
    for (const status of statuses) {
      const clientId = await enqueue({ op: "create", payload: coffee });
      await db.outbox.update(clientId, { status });
    }
  }

  test("clears the cache, the outbox and the rest of meta, and stores the new settings", async () => {
    await queue("done", "pending");

    expect(await switchInstance(other, 1)).toBeUndefined();

    for (const table of [
      db.accounts,
      db.categories,
      db.merchants,
      db.transactions,
      db.suggestions,
    ]) {
      expect(await table.count()).toBe(0);
    }
    expect(await db.outbox.count()).toBe(0);
    expect(await db.meta.get("entryAccountId")).toBeUndefined();
    expect(await readSyncConfig()).toEqual({ settings: other, pausedAt: undefined });
  });

  test("records Sure has are not counted as unsent", async () => {
    await queue("done", "done");

    expect(await switchInstance(other, 0)).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });

  test("more unsent records than allowed change nothing and are counted", async () => {
    await queue("pending", "sending", "failed", "done");

    expect(await switchInstance(other, 2)).toEqual({ unsent: 3 });

    expect(await db.outbox.count()).toBe(4);
    expect(await db.accounts.count()).toBe(1);
    expect(await db.meta.get("entryAccountId")).toBeDefined();
    expect(await readSyncConfig()).toEqual({ settings, pausedAt: NOW });
  });

  test("waits for a sync run to release the lock", async () => {
    let release!: () => void;
    const run = navigator.locks.request(SYNC_LOCK, () => new Promise<void>((r) => (release = r)));
    let switched = false;
    const switching = switchInstance(other, 0).then(() => (switched = true));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(switched).toBe(false);
    expect(await db.accounts.count()).toBe(1);

    release();
    await run;
    await switching;
    expect(await db.accounts.count()).toBe(0);
  });
});
