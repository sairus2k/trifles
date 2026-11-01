import { cleanup, render, screen } from "@solidjs/testing-library";
import { setupWorker } from "msw/browser";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { FAKE_SURE_URL, createFakeSure } from "../test/fake-sure";
import { App } from "./app";
import { db } from "./db/schema";
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

test("the main screen shows the entry form under the header", async () => {
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
  expect(screen.getByRole("button", { name: "Add expense" })).toBeTruthy();
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
