import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getApiV1Accounts, postApiV1Transactions } from "./generated/sure";
import { SureError, configureSure, sureFetch } from "./http";

type Result = { status: number; data: unknown; headers: Headers };

const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function html(status: number) {
  return new Response("<html><body>Bad gateway</body></html>", {
    status,
    headers: { "content-type": "text/html" },
  });
}

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => expect.unreachable("expected a rejection"),
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SureError);
  return error as SureError;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  configureSure({ baseUrl: "https://sure.example/", apiKey: "secret-key" });
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  configureSure(undefined);
});

describe("sureFetch", () => {
  test("adds the instance URL and X-Api-Key and returns status, data and headers", async () => {
    fetchMock.mockResolvedValue(json(200, { accounts: [] }));

    const result = await sureFetch<Result>("/api/v1/accounts", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ accounts: [] });
    expect(result.headers.get("content-type")).toContain("application/json");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://sure.example/api/v1/accounts");
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Api-Key")).toBe("secret-key");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(init?.method).toBe("GET");
  });

  test("returns a 422 with the server message as a value", async () => {
    fetchMock.mockResolvedValue(
      json(422, { error: "validation_failed", message: "Amount is invalid" }),
    );

    const result = await sureFetch<Result>("/api/v1/transactions", { method: "POST" });

    expect(result.status).toBe(422);
    expect(result.data).toEqual({ error: "validation_failed", message: "Amount is invalid" });
  });

  test.each([
    ["401 with an HTML body", () => html(401), 401],
    ["401 with a JSON body", () => json(401, { error: "unauthorized" }), 401],
    ["429", () => json(429, { error: "rate_limited" }), 429],
    ["5xx with an HTML body", () => html(502), 502],
  ])("throws an http SureError on %s", async (_, response, status) => {
    fetchMock.mockResolvedValue(response());

    const error = await rejection(sureFetch("/api/v1/transactions", { method: "POST" }));

    expect(error.kind).toBe("http");
    expect(error.status).toBe(status);
  });

  test("throws a not-json SureError when a 200 is not JSON (e.g. a proxy login page)", async () => {
    fetchMock.mockResolvedValue(html(200));

    const error = await rejection(sureFetch("/api/v1/accounts"));

    expect(error.kind).toBe("not-json");
    expect(error.status).toBe(200);
  });

  test("throws a not-json SureError when a JSON content type carries a malformed body", async () => {
    fetchMock.mockResolvedValue(
      new Response("{", { status: 200, headers: { "content-type": "application/json" } }),
    );

    const error = await rejection(sureFetch("/api/v1/accounts"));

    expect(error.kind).toBe("not-json");
  });

  test("throws a network SureError when the request fails", async () => {
    const cause = new TypeError("Failed to fetch");
    fetchMock.mockRejectedValue(cause);

    const error = await rejection(sureFetch("/api/v1/accounts"));

    expect(error.kind).toBe("network");
    expect(error.status).toBeUndefined();
    expect(error.cause).toBe(cause);
  });

  test("throws a not-configured SureError without calling fetch", async () => {
    configureSure(undefined);

    const error = await rejection(sureFetch("/api/v1/accounts"));

    expect(error.kind).toBe("not-configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("settings passed with a request", () => {
  const candidate = { baseUrl: "https://other.example", apiKey: "candidate-key" };

  test("are used instead of the configured ones, which stay in place", async () => {
    fetchMock.mockImplementation(async () => json(200, { accounts: [] }));

    await getApiV1Accounts({ per_page: 1 }, { settings: candidate });
    await getApiV1Accounts();

    const [[url, init], [nextUrl, nextInit]] = fetchMock.mock.calls as [
      Parameters<typeof fetch>,
      Parameters<typeof fetch>,
    ];
    expect(url).toBe("https://other.example/api/v1/accounts?per_page=1");
    expect(new Headers(init?.headers).get("X-Api-Key")).toBe("candidate-key");
    expect(init).not.toHaveProperty("settings");
    expect(nextUrl).toBe("https://sure.example/api/v1/accounts");
    expect(new Headers(nextInit?.headers).get("X-Api-Key")).toBe("secret-key");
  });

  test("work when nothing is configured", async () => {
    configureSure(undefined);
    fetchMock.mockResolvedValue(json(200, { accounts: [] }));

    const result = await getApiV1Accounts(undefined, { settings: candidate });

    expect(result.status).toBe(200);
  });
});

describe("generated client", () => {
  test("sends a create through sureFetch and narrows the result by status", async () => {
    fetchMock.mockResolvedValue(json(201, { id: "tx-1", amount_decimal: "12.50" }));

    const result = await postApiV1Transactions({
      transaction: {
        account_id: "acc-1",
        date: "2026-11-01",
        amount: 12.5,
        name: "Coffee",
        nature: "expense",
        currency: "EUR",
        external_id: "client-1",
        source: "sure-quick-entry",
      },
    });

    expect(result.status).toBe(201);
    if (result.status === 201) expect(result.data.id).toBe("tx-1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://sure.example/api/v1/transactions");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("X-Api-Key")).toBe("secret-key");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      transaction: { external_id: "client-1", nature: "expense" },
    });
  });
});
