import { defineConfig } from "vitest/config";

// Contract tests against a real Sure in Docker (`npm run test:contract`). A config of its own, so
// `npm test` and the pre-commit hook never start Docker.
export default defineConfig({
  test: {
    name: "contract",
    environment: "node",
    include: ["test/contract/**/*.contract.ts"],
    globalSetup: ["./test/contract/global-setup.ts"],
    // One Sure for the whole run: files must not race on the same accounts.
    fileParallelism: false,
    // Balance recalculation and transfer matching run in Sure's background jobs.
    testTimeout: 90_000,
  },
});
