---
id: TASK-6
title: Stateful MSW fake of the Sure API for tests
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T15:12:00Z'
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
- [ ] #1 The fake keeps transactions keyed by `external_id` and answers `200` with the existing transaction on a repeated `external_id` + `source` pair
- [ ] #2 A test can make the next request answer `201`, `200`, `422`, `401`, `500` or drop the connection, including "server applied the write but the response was lost"
- [ ] #3 Accounts, categories and merchants endpoints return seeded data; account `updated_at` and balance change after a write
- [ ] #4 The fake lives in `test/fake-sure/` and is usable from Node and browser-mode tests
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
