import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { FAKE_SURE_URL, createFakeSure, type FakeSure } from "../../../test/fake-sure";
import { checkConnection } from "./check";

const settings = { baseUrl: FAKE_SURE_URL, apiKey: "test-key" };
const ACCOUNTS = "GET /api/v1/accounts";
const DELETE = "DELETE /api/v1/transactions/:id";

const server = setupServer();
let sure: FakeSure;

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
  sure = createFakeSure();
  server.use(...sure.handlers);
  vi.stubGlobal("location", { protocol: "https:" });
});
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

test("a read_write key on a reachable Sure passes and changes nothing", async () => {
  const before = sure.transactions.length;

  expect(await checkConnection(settings)).toEqual({ ok: true });

  expect(sure.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
    "GET /api/v1/accounts?per_page=1",
    expect.stringMatching(/^DELETE \/api\/v1\/transactions\/[\da-f-]{36}$/),
  ]);
  expect(sure.transactions).toHaveLength(before);
});

test.each(["sure.example", "ftp://sure.example", ""])(
  "%j is not an instance URL",
  async (baseUrl) => {
    expect(await checkConnection({ ...settings, baseUrl })).toEqual({
      ok: false,
      reason: "invalid-url",
    });
    expect(sure.requests).toEqual([]);
  },
);

test("an http URL is refused when the app is served over https", async () => {
  expect(await checkConnection({ ...settings, baseUrl: "http://sure.test" })).toEqual({
    ok: false,
    reason: "insecure-url",
  });
});

test("offline, nothing is requested", async () => {
  vi.stubGlobal("navigator", { onLine: false });

  expect(await checkConnection(settings)).toEqual({ ok: false, reason: "offline" });
  expect(sure.requests).toEqual([]);
});

test("a rejected key", async () => {
  sure.failNext(ACCOUNTS, { status: 401 });

  expect(await checkConnection(settings)).toEqual({ ok: false, reason: "bad-key" });
});

test("a read-only key", async () => {
  sure.failNext(DELETE, {
    status: 403,
    body: { error: "insufficient_scope", message: "This action requires the 'write' scope" },
  });

  expect(await checkConnection(settings)).toEqual({ ok: false, reason: "read-only" });
});

test.each([
  ["an HTML page", () => new HttpResponse("<html>Sign in</html>", { status: 200 }), 200],
  ["a JSON 404", () => HttpResponse.json({ error: "no route" }, { status: 404 }), 404],
  ["JSON without accounts", () => HttpResponse.json({ ok: true }), 200],
])("a URL that answers %s is not Sure", async (_, answer, status) => {
  server.use(http.get(`${FAKE_SURE_URL}/api/v1/accounts`, answer));

  expect(await checkConnection(settings)).toEqual({ ok: false, reason: "not-sure", status });
});

test("an unexpected answer to the scope probe", async () => {
  sure.failNext(DELETE, { status: 400 });

  expect(await checkConnection(settings)).toEqual({ ok: false, reason: "server", status: 400 });
});

test.each([
  ["429", 429],
  ["a 5xx", 502],
])("%s from Sure", async (_, status) => {
  sure.failNext(ACCOUNTS, { status });

  expect(await checkConnection(settings)).toEqual({ ok: false, reason: "server", status });
});

// The browser rejects a blocked preflight like a dead host; only a no-cors request, which carries
// no X-Api-Key, gets through.
test.each([ACCOUNTS, DELETE] as const)("a CORS block on %s", async (route) => {
  sure.failNext(route, "drop");

  expect(await checkConnection(settings)).toEqual({ ok: false, reason: "cors" });
  expect(sure.requests.at(-1)?.path).toBe("/api/v1/accounts");
});

test("an unreachable host", async () => {
  server.use(http.all("https://down.test/*", () => HttpResponse.error()));

  expect(await checkConnection({ ...settings, baseUrl: "https://down.test" })).toEqual({
    ok: false,
    reason: "unreachable",
  });
});

test("a host that never answers times out after 15 s", async () => {
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => realTimeout(10));
  sure.failNext(ACCOUNTS, "hang");

  expect(await checkConnection(settings)).toEqual({ ok: false, reason: "timeout" });
  expect(timeout).toHaveBeenCalledWith(15_000);
});
