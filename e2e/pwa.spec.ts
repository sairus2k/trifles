import { type Page, expect, test } from "@playwright/test";
import { FAKE_SURE_URL } from "../test/fake-sure";
import { routeFakeSure } from "./fake-sure";

async function installServiceWorker(page: Page) {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  // clients.claim() hands the open page to the worker; until then its requests skip the cache.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

test("the installed app loads offline", async ({ page, context }) => {
  await installServiceWorker(page);
  await context.setOffline(true);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});

test("an offline deep link opens the app, an offline API call is a network error", async ({
  page,
  context,
}) => {
  await installServiceWorker(page);
  await context.setOffline(true);

  await page.goto("/some/deep/link");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  const api = await page.evaluate(() =>
    fetch("/api/v1/accounts").then(
      (response) => `answered ${response.status}`,
      () => "network error",
    ),
  );
  expect(api).toBe("network error");
});

test("an entry made offline is pending, then synced once back online", async ({
  page,
  context,
}) => {
  const { sure, setOffline } = await routeFakeSure(context);
  await installServiceWorker(page);
  await page.getByLabel("Sure URL").fill(FAKE_SURE_URL);
  await page.getByLabel("API key").fill("key");
  await page.getByRole("button", { name: "Save" }).click();
  // The first pull fills the account list.
  await expect(page.getByLabel("Account")).toContainText("Cash");

  await setOffline(true);
  await page.reload();
  await page.getByLabel("Amount").fill("12.5");
  await page.getByLabel("Merchant").fill("Kiosk");
  await page.getByRole("button", { name: "Add expense" }).click();

  const recent = page.getByRole("region", { name: "Recent transactions" });
  await expect(recent.getByText("Kiosk")).toBeVisible();
  await expect(recent.getByText("Pending")).toBeVisible();
  await page.getByRole("button", { name: "Balances" }).click();
  await expect(page.getByRole("region", { name: "Assets" })).toContainText("≈");
  await page.getByRole("button", { name: "Entry" }).click();
  expect(sure.requests.filter((request) => request.method === "POST")).toEqual([]);

  await setOffline(false);
  await expect(recent.getByText("Pending")).toBeHidden();
  await expect(recent.getByText("Kiosk")).toBeVisible();
  expect(sure.transactions.map((transaction) => transaction.name)).toEqual(["Kiosk"]);
  await page.getByRole("button", { name: "Balances" }).click();
  await expect(page.getByRole("region", { name: "Assets" })).not.toContainText("≈");
});

test("with the worker installed, the app requests nothing outside its origin", async ({
  page,
  baseURL,
}) => {
  await installServiceWorker(page);
  const origins = new Set<string>();
  page.on("request", (request) => origins.add(new URL(request.url()).origin));

  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  expect([...origins]).toEqual([new URL(baseURL!).origin]);
  const sw = await (await page.request.get("/sw.js")).text();
  const precache: string[] = JSON.parse(/const PRECACHE = (\[.*?\]);/.exec(sw)![1]!);
  expect(precache).toContain("index.html");
  expect(precache.filter((path) => /^[a-z]+:|^\/\//i.test(path))).toEqual([]);
});
