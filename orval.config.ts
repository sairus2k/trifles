import { defineConfig } from "orval";

export default defineConfig({
  sure: {
    input: {
      target: "./spec/sure-openapi.yaml",
      // The spec puts `format` outside `schema` on three path parameters (see spec/README.md).
      unsafeDisableValidation: true,
      // Push probes write access with a recurring transaction create (README → Sure API notes).
      filters: {
        tags: ["Accounts", "Transactions", "Categories", "Merchants", "Recurring Transactions"],
      },
    },
    output: {
      target: "./src/api/generated/sure.ts",
      client: "fetch",
      mode: "single",
      override: {
        mutator: { path: "./src/api/http.ts", name: "sureFetch" },
      },
    },
    hooks: { afterAllFilesWrite: "oxfmt" },
  },
});
