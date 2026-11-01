import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";

// A real server on a second origin: page.route would hand the app a response the browser never
// checks for CORS.
let server: Server;
let host: string;

test.beforeAll(async () => {
  server = createServer((_, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ accounts: [] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

test("Settings tells a Sure that blocks CORS from one it cannot reach", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("API key").fill("key");

  await page.getByLabel("Sure URL").fill(`http://${host}`);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByText(`${host} answered, but the browser blocked the request (CORS).`),
  ).toBeVisible();

  server.close();
  server.closeAllConnections();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(`Cannot reach ${host}. Check the address.`)).toBeVisible();
});
