import { setupWorker } from "msw/browser";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { postApiV1Transactions } from "../../src/api/generated/sure";
import { SureError, configureSure } from "../../src/api/http";
import { FAKE_SURE_URL, createFakeSure, type FakeSure } from "./index";

const worker = setupWorker();
let sure: FakeSure;

beforeAll(() => worker.start({ quiet: true, onUnhandledFrame: "error" }));
beforeEach(() => {
  worker.resetHandlers();
  sure = createFakeSure();
  worker.use(...sure.handlers);
  configureSure({ baseUrl: FAKE_SURE_URL, apiKey: "test-key" });
});
afterAll(() => {
  configureSure(undefined);
  worker.stop();
});

const transaction = {
  account_id: "acc-cash",
  date: "2026-11-01",
  amount: 12.5,
  name: "Coffee",
  nature: "expense",
  currency: "EUR",
  external_id: "client-1",
  source: "sure-quick-entry",
} as const;

test("the fake answers through the service worker: 201, then 200 on a repeat", async () => {
  expect((await postApiV1Transactions({ transaction })).status).toBe(201);
  expect((await postApiV1Transactions({ transaction })).status).toBe(200);
  expect(sure.transactions).toHaveLength(1);
});

test("lose-response applies the write and fails the request", async () => {
  sure.failNext("POST /api/v1/transactions", "lose-response");

  const error = await postApiV1Transactions({ transaction }).catch((e: unknown) => e);

  expect(error).toBeInstanceOf(SureError);
  expect((error as SureError).kind).toBe("network");
  expect(sure.transactions).toHaveLength(1);
  expect((await postApiV1Transactions({ transaction })).status).toBe(200);
});
