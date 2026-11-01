import { cleanup, render, screen } from "@solidjs/testing-library";
import { HttpResponse, http } from "msw";
import { setupWorker } from "msw/browser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { FAKE_SURE_URL, createFakeSure, type FakeSure } from "../../../test/fake-sure";
import { db, type EntryPayload, type OutboxStatus } from "../../db/schema";
import { enqueue } from "../../sync/outbox";
import { pauseSync, readSyncConfig, saveSettings } from "../../sync/settings";
import { Settings } from "./settings";

const worker = setupWorker();
let sure: FakeSure;
let persist: ReturnType<typeof vi.fn<() => Promise<boolean>>>;

beforeAll(() => worker.start({ quiet: true, onUnhandledFrame: "error" }));
beforeEach(async () => {
  sure = createFakeSure();
  worker.use(...sure.handlers);
  await Promise.all(db.tables.map((table) => table.clear()));
  vi.spyOn(navigator.storage, "persisted").mockResolvedValue(false);
  persist = vi.fn(async () => true);
  vi.spyOn(navigator.storage, "persist").mockImplementation(persist);
});
afterEach(() => {
  cleanup();
  worker.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => worker.stop());

async function submit(baseUrl: string, apiKey: string) {
  await userEvent.fill(screen.getByLabelText("Sure URL"), baseUrl);
  await userEvent.fill(screen.getByLabelText("API key"), apiKey);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
}

test("a working URL and key are stored in meta, lift the pause and request persistent storage", async () => {
  await saveSettings({ baseUrl: FAKE_SURE_URL, apiKey: "revoked" });
  await pauseSync();
  const onSaved = vi.fn();
  render(() => (
    <Settings settings={{ baseUrl: FAKE_SURE_URL, apiKey: "revoked" }} paused onSaved={onSaved} />
  ));

  await submit(`  ${FAKE_SURE_URL}  `, " new-key ");

  await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(await readSyncConfig()).toEqual({
    settings: { baseUrl: FAKE_SURE_URL, apiKey: "new-key" },
    pausedAt: undefined,
  });
  expect(persist).toHaveBeenCalledOnce();
});

test("storage that is already persistent is not requested again", async () => {
  vi.spyOn(navigator.storage, "persisted").mockResolvedValue(true);
  const onSaved = vi.fn();
  render(() => <Settings settings={undefined} paused={false} onSaved={onSaved} />);

  await submit(FAKE_SURE_URL, "key");

  await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(persist).not.toHaveBeenCalled();
});

test("the saved settings are filled in", () => {
  render(() => (
    <Settings
      settings={{ baseUrl: FAKE_SURE_URL, apiKey: "key" }}
      paused={false}
      onSaved={() => {}}
    />
  ));

  expect(screen.getByLabelText<HTMLInputElement>("Sure URL").value).toBe(FAKE_SURE_URL);
  expect(screen.getByLabelText<HTMLInputElement>("API key").value).toBe("key");
});

test.each([
  [
    "a wrong key",
    FAKE_SURE_URL,
    () => sure.failNext("GET /api/v1/accounts", { status: 401 }),
    /rejected the API key/,
  ],
  [
    "a read-only key",
    FAKE_SURE_URL,
    () => sure.failNext("DELETE /api/v1/transactions/:id", { status: 403 }),
    /read-only/,
  ],
  [
    "a wrong URL",
    "https://down.test",
    () => worker.use(http.all("https://down.test/*", () => HttpResponse.error())),
    /Cannot reach down\.test/,
  ],
  [
    "a CORS / preflight failure",
    "https://blocked.test",
    // A blocked preflight fails the request; a no-cors request carries no X-Api-Key and gets through.
    () =>
      worker.use(
        http.all("https://blocked.test/*", ({ request }) =>
          request.headers.has("X-Api-Key") ? HttpResponse.error() : new HttpResponse(null),
        ),
      ),
    /blocked\.test answered, but the browser blocked the request \(CORS\)/,
  ],
  [
    "a URL that is not Sure",
    "https://site.test",
    () => worker.use(http.all("https://site.test/*", () => HttpResponse.html("<p>Sign in</p>"))),
    /site\.test does not answer like Sure's API/,
  ],
])("%s is explained and nothing is stored", async (_, baseUrl, arrange, message) => {
  arrange();
  const onSaved = vi.fn();
  render(() => <Settings settings={undefined} paused={false} onSaved={onSaved} />);

  await submit(baseUrl, "key");

  expect((await screen.findByRole("alert")).textContent).toMatch(message);
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
  expect(onSaved).not.toHaveBeenCalled();
  expect(await readSyncConfig()).toEqual({ settings: undefined, pausedAt: undefined });
  expect(persist).not.toHaveBeenCalled();
});

test("Cancel is offered only when there is something to go back to", async () => {
  const onClose = vi.fn();
  const { unmount } = render(() => (
    <Settings settings={undefined} paused={false} onSaved={() => {}} />
  ));
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  unmount();

  render(() => (
    <Settings
      settings={{ baseUrl: FAKE_SURE_URL, apiKey: "key" }}
      paused={false}
      onClose={onClose}
      onSaved={() => {}}
    />
  ));
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledOnce();
});

describe("another URL", () => {
  const OTHER_URL = "https://other.test";
  const saved = { baseUrl: FAKE_SURE_URL, apiKey: "key" };
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
  let onSaved: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(async () => {
    worker.use(...createFakeSure({}, OTHER_URL).handlers);
    await saveSettings(saved);
    await db.meta.put({ key: "entryAccountId", value: "acc-cash" });
    await db.accounts.put({
      id: "acc-cash",
      name: "Cash",
      currency: "EUR",
      classification: "asset",
      balanceCents: 0,
      status: "active",
      updatedAt: 0,
    });
    await db.categories.put({ id: "cat-food", name: "Food", color: "#000000", icon: "x" });
    await db.merchants.put({ id: "mer-lidl", name: "Lidl" });
    await db.suggestions.put({
      merchantName: "Lidl",
      merchantId: "mer-lidl",
      categoryId: "cat-food",
      count: 1,
      lastUsedAt: 0,
    });
    onSaved = vi.fn();
    render(() => <Settings settings={saved} paused={false} onSaved={onSaved} />);
  });

  async function queue(...statuses: OutboxStatus[]) {
    for (const status of statuses) {
      const clientId = await enqueue({ op: "create", payload: coffee });
      await db.outbox.update(clientId, { status });
    }
  }

  async function cacheCounts() {
    const tables = [db.accounts, db.categories, db.merchants, db.suggestions, db.outbox];
    return Promise.all(tables.map((table) => table.count()));
  }

  test("a new key for the same URL keeps the cache and the outbox", async () => {
    await queue("pending", "done");
    expect(screen.getByLabelText("Sure URL").getAttribute("aria-describedby")).toBe(
      "base-url-hint",
    );
    expect(document.getElementById("base-url-hint")?.textContent).toMatch(
      /Another address replaces the accounts and entries on this device/,
    );

    await submit(`${FAKE_SURE_URL}/`, "new-key");

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(await cacheCounts()).toEqual([1, 1, 1, 1, 2]);
    expect(await db.meta.get("entryAccountId")).toBeDefined();
    expect(await readSyncConfig()).toMatchObject({ settings: { apiKey: "new-key" } });
  });

  test("a switch with nothing unsent clears this device's data without asking", async () => {
    await queue("done");

    await submit(OTHER_URL, "other-key");

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(await cacheCounts()).toEqual([0, 0, 0, 0, 0]);
    expect(await db.meta.get("entryAccountId")).toBeUndefined();
    expect(await readSyncConfig()).toEqual({
      settings: { baseUrl: OTHER_URL, apiKey: "other-key" },
      pausedAt: undefined,
    });
  });

  test("a switch with unsent entries says how many and deletes them only when asked", async () => {
    await queue("pending", "failed", "done");

    await submit(OTHER_URL, "other-key");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch("2 entries have not been sent to sure.test.");
    expect(onSaved).not.toHaveBeenCalled();
    expect(await cacheCounts()).toEqual([1, 1, 1, 1, 3]);
    expect(await readSyncConfig()).toMatchObject({ settings: saved });

    await userEvent.click(screen.getByRole("button", { name: "Delete 2 entries and switch" }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(await cacheCounts()).toEqual([0, 0, 0, 0, 0]);
    expect(await readSyncConfig()).toMatchObject({ settings: { baseUrl: OTHER_URL } });
  });

  test("unsent entries are kept, with everything else, for the same Sure", async () => {
    await queue("pending");

    await submit(OTHER_URL, "other-key");
    expect((await screen.findByRole("alert")).textContent).toMatch("1 entry has not been sent");
    await userEvent.click(screen.getByRole("button", { name: "It's the same Sure, keep them" }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(await cacheCounts()).toEqual([1, 1, 1, 1, 1]);
    expect(await readSyncConfig()).toMatchObject({
      settings: { baseUrl: OTHER_URL, apiKey: "other-key" },
    });
  });

  test("Cancel keeps the old settings and every entry", async () => {
    await queue("pending");

    await submit(OTHER_URL, "other-key");
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    expect(await cacheCounts()).toEqual([1, 1, 1, 1, 1]);
    expect(await readSyncConfig()).toMatchObject({ settings: saved });
  });
});
