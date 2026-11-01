import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { msw } from "msw/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { serviceWorker } from "./sw-plugin";

export default defineConfig({
  plugins: [solid(), tailwindcss(), serviceWorker()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts", "test/**/*.test.ts"],
          setupFiles: ["fake-indexeddb/auto", "./test/setup.ts"],
        },
      },
      {
        extends: true,
        // Serves /mockServiceWorker.js to the test page only; the app build never loads this plugin.
        plugins: [msw({ mode: "worker-only" })],
        test: {
          name: "browser",
          include: ["src/**/*.browser.test.tsx", "test/**/*.browser.test.tsx"],
          setupFiles: ["./test/setup.ts"],
          // Files share one origin and the app's db, which schema.browser.test.tsx deletes.
          fileParallelism: false,
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
