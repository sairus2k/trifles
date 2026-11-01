import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

// The browser fetches sw.js for an update check outside page.route, so a new build is simulated by
// rewriting the served file. Workers in other files may install either version; both are valid.
const SW = path.resolve(import.meta.dirname, "../dist/sw.js");

test("a new build replaces the cached shell after a reload", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const [first] = await page.evaluate(() => caches.keys());
  expect(first).toMatch(/^shell-/);

  const original = await readFile(SW, "utf8");
  try {
    const next = original.replace(/^const VERSION = ".*";$/m, 'const VERSION = "next-build";');
    expect(next).not.toBe(original);
    await writeFile(SW, next);

    await page.reload();
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(["shell-next-build"]);
  } finally {
    await writeFile(SW, original);
  }

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});
