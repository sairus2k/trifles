import type { BrowserContext } from "@playwright/test";
import { getResponse } from "msw";
import { FAKE_SURE_URL, createFakeSure } from "../test/fake-sure";

/**
 * Answers the app's requests to https://sure.test with the stateful fake from test/fake-sure.
 * route.fulfill skips the browser's CORS check, so the fake needs no CORS headers here.
 */
export async function routeFakeSure(context: BrowserContext) {
  const sure = createFakeSure();
  let offline = false;
  await context.route(`${FAKE_SURE_URL}/**`, async (route) => {
    // context.setOffline does not stop a route from answering.
    if (offline) return route.abort("internetdisconnected");
    const request = route.request();
    const response = await getResponse(
      sure.handlers,
      new Request(request.url(), {
        method: request.method(),
        headers: await request.allHeaders(),
        body: request.postData(),
      }),
    );
    if (!response || response.type === "error") return route.abort("failed");
    return route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });

  return {
    sure,
    async setOffline(value: boolean) {
      offline = value;
      await context.setOffline(value);
    },
  };
}
