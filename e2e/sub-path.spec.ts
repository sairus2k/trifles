import { expect, test } from "@playwright/test";

// baseURL ends in /quick/; Sure would live at the root of the same origin.

test.beforeEach(async ({ page, baseURL }) => {
  await page.goto(baseURL!);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
});

test("the worker and the manifest cover only the sub-path", async ({ page, baseURL }) => {
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe(baseURL);

  const manifestUrl = await page.locator('link[rel="manifest"]').evaluate((link) => {
    return (link as HTMLLinkElement).href;
  });
  expect(manifestUrl).toBe(`${baseURL}manifest.webmanifest`);
  const manifest = await (await page.request.get(manifestUrl)).json();
  expect(new URL(manifest.scope, manifestUrl).href).toBe(baseURL);
  expect(new URL(manifest.start_url, manifestUrl).href).toBe(baseURL);
  for (const icon of manifest.icons as { src: string }[]) {
    const response = await page.request.get(new URL(icon.src, manifestUrl).href);
    expect(response.status(), icon.src).toBe(200);
  }
});

test("offline, the app loads under its path and the root is left to the network", async ({
  page,
  context,
  baseURL,
}) => {
  await context.setOffline(true);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.goto(`${baseURL}some/deep/link`);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  await expect(page.goto(new URL("/", baseURL).href)).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/);
});
