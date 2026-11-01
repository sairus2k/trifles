import { type Page, expect, test } from "@playwright/test";

const SURE = "https://sure.test";

/**
 * A Sure that accepts the key during the Settings check and rejects it afterwards, so sync pauses
 * and every control of the app is on screen at some point: Save, Cancel, Settings, Sync paused.
 */
async function routeSureThatRevokesTheKey(page: Page) {
  let checked = false;
  await page.route(`${SURE}/**`, (route) => {
    const request = route.request();
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "x-api-key, content-type",
      "access-control-allow-methods": "GET, POST, PATCH, DELETE",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (checked) return route.fulfill({ status: 401, headers, json: { error: "unauthorized" } });
    if (request.method() === "DELETE") {
      checked = true;
      return route.fulfill({ status: 404, headers, json: { error: "not_found" } });
    }
    return route.fulfill({ status: 200, headers, json: { accounts: [] } });
  });
}

async function expectTouchSized(page: Page) {
  const controls = await page.locator("button, input").all();
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    const box = await control.boundingBox();
    expect(box?.height, await control.evaluate((node) => node.outerHTML)).toBeGreaterThanOrEqual(
      44,
    );
  }
}

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

test("every control is at least 44 px tall", async ({ page }) => {
  await routeSureThatRevokesTheKey(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expectTouchSized(page);

  await page.getByLabel("Sure URL").fill(SURE);
  await page.getByLabel("API key").fill("key");
  await page.getByRole("button", { name: "Save" }).click();

  // Sync gets a 401, so Settings opens again with the pause explanation and Cancel.
  await expect(page.getByRole("status")).toContainText("sync is paused");
  await expectTouchSized(page);

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Sync paused" })).toBeVisible();
  await expectTouchSized(page);
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
