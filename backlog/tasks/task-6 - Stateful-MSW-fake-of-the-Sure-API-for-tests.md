---
id: TASK-6
title: Stateful MSW fake of the Sure API for tests
status: Done
assignee:
  - '@claude'
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T15:16:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-3
priority: high
type: task
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
orval-generated MSW handlers always answer 200 with random data, which cannot test idempotency or failure handling. The sync engine tests need a fake that keeps state and can be told how to fail.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The fake keeps transactions keyed by `external_id` and answers `200` with the existing transaction on a repeated `external_id` + `source` pair
- [x] #2 A test can make the next request answer `201`, `200`, `422`, `401`, `500` or drop the connection, including "server applied the write but the response was lost"
- [x] #3 Accounts, categories and merchants endpoints return seeded data; account `updated_at` and balance change after a write
- [x] #4 The fake lives in `test/fake-sure/` and is usable from Node and browser-mode tests
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Approved 2026-11-01.

Research findings (Sure 131e786, transactions_controller.rb and views):
- Idempotency key is (account, external_id, source); source defaults to "api"; source without external_id is 422; a repeat answers 200 with the existing transaction. An unknown account_id answers 404 record_not_found, which the spec does not declare for POST /transactions.
- amount_decimal is BigDecimal#to_s("F") in the entry sign (expense positive, income negative, "12.0" for integers). An expense lowers an asset balance and raises a liability balance. updated_at is ISO8601 with second precision.
- accounts, categories and transactions answer { items, pagination } (per_page default 25, max 100); merchants answer a bare array. Transactions are ordered by date desc, then created_at desc.
- MSW 3.0.3 (spiked): msw/node setupServer works with the generated client; HttpResponse.error() becomes SureError "network". In Vitest browser mode setupWorker fails until /mockServiceWorker.js is served; msw({ mode: "worker-only" }) from msw/vite on the browser project only fixes it, vite build output unchanged.

Decisions (user): sync tests (TASK-8/9/10) run in Node on fake-indexeddb + msw/node; browser mode stays for components and the fake works there too. 200/201 follow from fake state, only failures are forced. Fake responses are typed with the generated types and omit amount_cents / signed_amount_cents.

1. test/fake-sure, test first (test/fake-sure/fake-sure.test.ts, Node, through the generated client): createFakeSure(seed?) with handlers, failNext(route, { status, body? } | "drop" | "lose-response") as a FIFO per route, pauseAccountSync() / runAccountSync(), state (accounts, transactions) and a requests log. Endpoints: GET accounts, categories, merchants, transactions (page/per_page) and POST transactions; fixed default seed. Same commit: README Testing item 1 (key is account + external_id + source, sync tests in Node) and the idempotency rule in Sync engine rules; remove test/fake-sure/.gitkeep.
2. Browser mode: msw({ mode: "worker-only" }) on the browser project, include test/**/*.browser.test.tsx, smoke test test/fake-sure/fake-sure.browser.test.tsx (create, repeat 200, lose-response). README Testing: how to use the fake in browser tests.
3. typecheck, lint, format, test and build pass.

Out of scope: PATCH/DELETE /transactions/{id}, GET /accounts/{id}, a "hang" fault for timeouts (TASK-8/9 add them when needed); X-Api-Key checks (covered by http.test.ts); transfer auto-matching (contract tests).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Deviations from the plan: runAccountSync() is named resumeAccountSync() (it applies the held writes and turns pausing off). MSW 3 renamed onUnhandledRequest to onUnhandledFrame; the old name is silently ignored at runtime and only typecheck catches it.
Verification (2026-11-01): 21 Node tests through the generated client and sureFetch (201/200 on account + external_id + source, scoping, source default api, family currency fallback, 422/404, failNext 401/500/503/422/drop/lose-response, per-route FIFO, seed and pagination, asset/liability balances and whole-second updated_at, pause/resume, transaction order and per_page cap, request log); 2 browser tests through setupWorker. Mutation check: treating lose-response as drop fails the lose-response test. Full suite 126 passed; typecheck, lint, format:check and build pass; dist has no mockServiceWorker.js.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a stateful MSW fake of the Sure API in test/fake-sure/.

createFakeSure(seed?) serves GET accounts, categories, merchants and transactions and POST transactions from in-memory state, typed with the generated response types, mirroring Sure 131e786: creates are idempotent on account + external_id + source (source defaults to api) and answer 200 with the existing transaction on a repeat; amount_decimal is signed like BigDecimal#to_s("F"); a write moves the account balance (down for assets, up for liabilities) and updated_at in whole seconds; a missing currency falls back to the family currency (USD, so the bug is visible); unknown accounts answer 404. failNext(route, fault) queues a status, a dropped connection or a lost response per route; pauseAccountSync()/resumeAccountSync() model Sure's asynchronous balance recalculation; requests logs every request.

Decision (user): sync tests run in the Node project on fake-indexeddb + msw/node. Browser mode works too: msw/vite in worker-only mode on the browser project serves the worker script, and the browser project now includes test/**/*.browser.test.tsx. README: idempotency rule scoped to the account, Testing items 1 and 3.

Checks: 126 tests, typecheck, lint, format and build pass.

Follow-ups for later tasks: TASK-9 compares updated_at (whole seconds) with a millisecond send time, so a strict comparison can leave the pending delta stuck; TASK-8 gets 404 for an unknown account, a status outside the generated union, and adds PATCH/DELETE and a hang fault for timeouts when it needs them.
<!-- SECTION:FINAL_SUMMARY:END -->
