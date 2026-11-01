import { expect, test } from "@playwright/test";

test("the app loads only from its own origin and ships its stylesheet", async ({
  page,
  baseURL,
}) => {
  const origins = new Set<string>();
  page.on("request", (request) => origins.add(new URL(request.url()).origin));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  expect([...origins]).toEqual([new URL(baseURL!).origin]);
  expect(await page.locator('script[src]:not([src^="/"])').count()).toBe(0);
  await expect(page.locator('link[rel="stylesheet"][href^="/"]')).toHaveCount(1);
});

test("the app follows the system color scheme", async ({ page }) => {
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  const light = await background();

  await page.emulateMedia({ colorScheme: "dark" });
  expect(await background()).not.toBe(light);
});
