import { expect, test } from "@playwright/test";

test("the built app loads and asks for the Sure settings on first run", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByLabel("Sure URL")).toBeVisible();
});
