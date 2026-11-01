import { defineConfig, devices } from "@playwright/test";

const port = 4173;
// A second build under a sub-path, as when the app shares a domain with Sure.
const subPathPort = 4174;
const subPath = "/quick/";

export default defineConfig({
  testDir: "./e2e",
  projects: [
    {
      name: "chromium",
      testIgnore: "sub-path.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${port}` },
    },
    {
      name: "sub-path",
      testMatch: "sub-path.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${subPathPort}${subPath}` },
    },
  ],
  // The service worker only exists in a production build, so E2E runs against `vite preview`.
  webServer: [
    {
      command: `npm run build && npx vite preview --port ${port} --strictPort`,
      url: `http://localhost:${port}`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npx vite build --base=${subPath} --outDir dist-sub-path && npx vite preview --base=${subPath} --outDir dist-sub-path --port ${subPathPort} --strictPort`,
      url: `http://localhost:${subPathPort}${subPath}`,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
