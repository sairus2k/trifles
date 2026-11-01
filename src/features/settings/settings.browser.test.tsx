import { cleanup, render, screen } from "@solidjs/testing-library";
import { HttpResponse, http } from "msw";
import { setupWorker } from "msw/browser";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { FAKE_SURE_URL, createFakeSure, type FakeSure } from "../../../test/fake-sure";
import { db } from "../../db/schema";
import { pauseSync, readSyncConfig, saveSettings } from "../../sync/settings";
import { Settings } from "./settings";

const worker = setupWorker();
let sure: FakeSure;
let persist: ReturnType<typeof vi.fn<() => Promise<boolean>>>;

beforeAll(() => worker.start({ quiet: true, onUnhandledFrame: "error" }));
beforeEach(async () => {
  sure = createFakeSure();
  worker.use(...sure.handlers);
  await db.meta.clear();
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
