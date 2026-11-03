import { cleanup, render, screen } from "@solidjs/testing-library";
import { setupWorker } from "msw/browser";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { FAKE_SURE_URL, createFakeSure } from "../test/fake-sure";
import { App } from "./app";
import { db } from "./db/schema";
import "./index.css";
import { enqueue } from "./sync/outbox";
import { pauseSync, saveSettings } from "./sync/settings";

const worker = setupWorker();

beforeAll(() => worker.start({ quiet: true, onUnhandledFrame: "error" }));
beforeEach(async () => {
  worker.use(...createFakeSure().handlers);
  await db.meta.clear();
  vi.spyOn(navigator.storage, "persisted").mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  worker.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => worker.stop());

const settingsHeading = () => screen.findByRole("heading", { name: "Settings" });
const mainHeading = () => screen.findByRole("heading", { name: "Sure Quick Entry" });

test("a fresh install opens Settings, and saving a working key shows the app", async () => {
  render(() => <App />);
  await settingsHeading();
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();

  await userEvent.fill(screen.getByLabelText("Sure URL"), FAKE_SURE_URL);
  await userEvent.fill(screen.getByLabelText("API key"), "key");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await mainHeading();
});

test("the main screen shows the entry form under the header and recent entries under it", async () => {
  await saveSettings({ baseUrl: FAKE_SURE_URL, apiKey: "key" });
  await db.accounts.clear();
  await db.accounts.put({
    id: "acc-cash",
    name: "Cash",
    currency: "EUR",
    classification: "asset",
    balanceCents: 0,
    status: "active",
    updatedAt: 0,
  });
  render(() => <App />);

  await mainHeading();
  expect(await screen.findByLabelText("Amount")).toBeTruthy();
  const submit = screen.getByRole("button", { name: "Add expense" });
  const recent = await screen.findByRole("region", { name: "Recent transactions" });
  expect(submit.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("Settings opens from the header and closes without saving", async () => {
  await saveSettings({ baseUrl: FAKE_SURE_URL, apiKey: "key" });
  render(() => <App />);

  await userEvent.click(await screen.findByRole("button", { name: "Settings" }));
  await settingsHeading();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

  await mainHeading();
});

test("a 401 during sync opens Settings with an explanation", async () => {
  await saveSettings({ baseUrl: FAKE_SURE_URL, apiKey: "revoked" });
  render(() => <App />);
  await mainHeading();
  expect(screen.queryByRole("button", { name: "Sync paused" })).toBeNull();

  // What the engine does on a 401 or 403 (engine.test.ts covers that part).
  await pauseSync();

  await settingsHeading();
  expect(screen.getByRole("status").textContent).toMatch(/rejected the API key, so sync is paused/);
});

test("a closed pause leaves a way back, a new key ends it, and the next 401 opens Settings again", async () => {
  await saveSettings({ baseUrl: FAKE_SURE_URL, apiKey: "revoked" });
  await pauseSync();
  render(() => <App />);
  await settingsHeading();

  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await mainHeading();
  await userEvent.click(screen.getByRole("button", { name: "Sync paused" }));
  await settingsHeading();

  await userEvent.fill(screen.getByLabelText("API key"), "new-key");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await mainHeading();
  await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Sync paused" })).toBeNull());

  // The pause the user closed is over; the next rejection opens Settings again.
  await pauseSync();
  await settingsHeading();
});

test("Balances in the header swaps the form for the balances and back, keeping a typed amount", async () => {
  await saveSettings({ baseUrl: FAKE_SURE_URL, apiKey: "key" });
  await db.accounts.clear();
  await db.accounts.put({
    id: "acc-cash",
    name: "Cash",
    currency: "EUR",
    classification: "asset",
    balanceCents: 120_000,
    status: "active",
    updatedAt: 0,
  });
  render(() => <App />);
  await mainHeading();
  await userEvent.fill(await screen.findByLabelText("Amount"), "12");

  await userEvent.click(screen.getByRole("button", { name: "Balances" }));
  expect(await screen.findByRole("region", { name: "Assets" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Recent transactions" })).toBeNull();
  expect(screen.getByLabelText("Amount")).not.toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Entry" }));
  expect(screen.queryByRole("region", { name: "Balances" })).toBeNull();
  expect(screen.getByLabelText<HTMLInputElement>("Amount").value).toBe("12");
  expect(screen.getByLabelText("Amount")).toBeVisible();
});

test("switching to another Sure leaves nothing of the old one on screen", async () => {
  worker.use(...createFakeSure({}, "https://other.test").handlers);
  await saveSettings({ baseUrl: FAKE_SURE_URL, apiKey: "key" });
  await Promise.all([db.accounts.clear(), db.transactions.clear(), db.outbox.clear()]);
  await db.accounts.put({
    id: "acc-cash",
    name: "Cash",
    currency: "EUR",
    classification: "asset",
    balanceCents: 120_000,
    status: "active",
    updatedAt: 0,
  });
  await db.transactions.put({
    id: "tx-1",
    accountId: "acc-cash",
    date: "2026-10-31",
    name: "Old coffee",
    amountDecimal: "3.5",
    currency: "EUR",
    categoryId: null,
    merchantId: null,
    notes: null,
    externalId: null,
    createdAt: 0,
    transferId: null,
  });
  render(() => <App />);
  await mainHeading();
  expect(await screen.findByText("Old coffee")).toBeTruthy();

  await userEvent.click(screen.getByRole("button", { name: "Settings" }));
  await settingsHeading();
  await userEvent.fill(screen.getByLabelText("Sure URL"), "https://other.test");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await mainHeading();
  expect(
    await screen.findByText("Your Sure accounts appear here after the first sync."),
  ).toBeTruthy();
  expect(screen.queryByText("Old coffee")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Balances" }));
  const balances = await screen.findByRole("region", { name: "Balances" });
  await vi.waitFor(() => expect(balances.textContent).toMatch(/after the first sync/));
  expect(balances.textContent).not.toMatch("Cash");
});

test("the header stays above the recent list scrolled under it", async () => {
  await saveSettings({ baseUrl: FAKE_SURE_URL, apiKey: "key" });
  await Promise.all([db.transactions.clear(), db.outbox.clear()]);
  for (let i = 0; i < 30; i++) {
    await enqueue({
      op: "create",
      payload: {
        accountId: "acc-cash",
        date: `2026-10-${String(10 + (i % 3)).padStart(2, "0")}`,
        amount: "1",
        nature: "expense",
        currency: "EUR",
        name: `Coffee ${i}`,
        notes: null,
        categoryId: null,
        merchantId: null,
      },
    });
  }
  render(() => <App />);
  await mainHeading();
  const row = (await screen.findByText("Coffee 23")).closest("li")!;

  // Swiped open, so its Delete button is under the right end of the header too.
  const swipe = row.querySelector("button:not([hidden])")!;
  for (const [type, clientX] of [
    ["pointerdown", 300],
    ["pointermove", 150],
    ["pointerup", 150],
  ] as const) {
    swipe.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX }));
  }
  const remove = await screen.findByRole("button", { name: "Delete" });

  const header = screen.getByRole("banner");
  const bar = header.getBoundingClientRect();
  const y = bar.top + bar.height / 2;
  window.scrollBy(0, row.getBoundingClientRect().top - y);
  expect(row.getBoundingClientRect().top).toBeLessThan(y);
  expect(remove.getBoundingClientRect().right).toBeGreaterThan(bar.right - 8);

  for (const x of [bar.left + 8, bar.left + bar.width / 2, bar.right - 8]) {
    const hit = document.elementFromPoint(x, y);
    expect(header.contains(hit), hit?.outerHTML).toBe(true);
  }
  window.scrollTo(0, 0);

  // The edit dialog is modal, in the top layer, so it stays above the header.
  await userEvent.click(screen.getByText("Coffee 29"));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.contains(document.elementFromPoint(bar.left + bar.width / 2, y))).toBe(true);
});
