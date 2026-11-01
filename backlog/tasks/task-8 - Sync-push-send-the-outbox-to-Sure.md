---
id: TASK-8
title: 'Sync push: send the outbox to Sure'
status: Done
assignee:
  - '@claude'
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T15:44:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-3
  - TASK-6
  - TASK-7
references:
  - README.md
priority: high
type: feature
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The core risk of the app: a transaction entered offline must reach Sure exactly once. Sure deduplicates creates by `external_id` + `source`, so any ambiguous failure can be retried. The API cannot create transfers directly, so a transfer is two transactions that Sure auto-matches. See README → Sync engine rules and Transfers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Records are sent one at a time in creation order
- [x] #2 Every create sends `external_id` = client UUID, `source: "sure-quick-entry"`, a positive `amount`, `nature` and the account `currency`
- [x] #3 Lost response after the server applied the write → retry → `200` → no duplicate (test against the fake)
- [x] #4 `422` marks the record `failed` with the server message and the queue continues
- [x] #5 `401` pauses the queue without a retry loop
- [x] #6 `5xx`, network error and timeout retry with exponential backoff and jitter; `500` then `201` is tested
- [x] #7 A transfer sends `<clientId>:out` (expense) and `<clientId>:in` (income); one leg sent and one failed resumes without duplicating the sent leg
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Research (Sure 131e786, src/sync/outbox.ts, src/api/http.ts, test/fake-sure):
- PATCH/DELETE of a missing transaction answer 404 `not_found` (TransactionLookup). A DELETE retried after a lost response therefore gets 404: treat it as done.
- PATCH drops blank `category_id`/`merchant_id` (`compact_blank`) and nil `notes` (`compact`): an update cannot clear category or merchant; notes clear only with "".
- 403 `insufficient_scope` (read-only key) is returned as a value by sureFetch, like any 4xx.
- POST with an unknown/inaccessible account_id: `find` raises inside `create`, whose own `rescue => e` catches it before BaseController's rescue_from, so Sure answers 500, not 404 (the TASK-6 comment and the fake say 404). Push would back off forever and hold the queue. Decision pending.
- sureFetch has no timeout; generated functions pass `options` through to fetch, so a `signal` fits without touching http.ts.

1. Fake (test commit): add `PATCH` and `DELETE /api/v1/transactions/:id` mirroring Sure (signed amount from nature, compact_blank on category/merchant, nil notes ignored, 404 `not_found`, account balance moves on amount change/delete); add a `"hang"` fault (`delay("infinite")`); tests for both in fake-sure.test.ts. Unknown account on create per the pending decision.
2. src/sync/push.ts: `push(): Promise<{ sent: number; paused: boolean }>` drains the queue: `claimNext()` → send → mark, until claimNext returns nothing (empty, head backing off) or the queue pauses.
   - create: POST with external_id = clientId, source "sure-quick-entry", positive `Number(amount)` (Sure does `to_f` anyway), nature, currency; null notes/category/merchant omitted.
   - transfer: legs from `transferLegs()`, sent :out then :in, stop at the first non-success. Every attempt resends both; idempotency answers 200 for the leg already on the server, so no per-leg state in the record.
   - update: PATCH full values (notes null → ""); delete: DELETE, 404 → done.
   - Outcomes: 200/201 → markDone. 422, 404 and any other returned 4xx except 403 → markFailed with `message ?? error`. SureError 401, returned 403, not-configured → markRetry(now) and stop with paused = true (no further request). 429, 5xx, network, timeout, not-json → markRetry with backoff and continue. Unexpected exception → markRetry with backoff, rethrow (a record never stays `sending`).
   - Backoff: delay = min(5 min, 2 s × 2^attempts), nextAttemptAt = now + delay × (0.5 + random/2) (equal jitter).
   - Timeout: every request gets `signal: AbortSignal.timeout(30 s)`; the abort surfaces as SureError `network`.
3. src/sync/push.test.ts (Node: fake-indexeddb + msw/node + fake), one test per AC: order of 3 records; create body fields; lose-response → 200 → one transaction; 422 failed + next record sent; 401 → one request, paused, record pending; 500 then 201 with backoff (Date faked, Math.random spied) and timeout via "hang" (AbortSignal.timeout spied to a short real timeout); transfer :out sent, :in 500 → retry → :out 200, :in 201, two transactions total. Plus update/delete paths and 404-on-delete = done.
4. README → Sync engine rules / Sure API notes: 403 pauses, other 4xx fail, DELETE 404 = done, PATCH cannot clear category/merchant, timeout and backoff numbers, 500 on unknown account.
Commits: `test:` fake extension, `feat:` push + README.

Decisions (approved 2026-11-01): the fake answers 500 for an unknown account on create, like Sure; the guard is follow-up work (new task). Requeueing records stuck in `sending` after a crash belongs to TASK-10, under the Web Lock (comment added there).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Evidence (src/sync/push.test.ts, 23 tests, all green; full suite green in the pre-commit hook): AC1 "sends records one at a time in creation order" (fetch spy: max 1 in flight); AC2 create body test (exact body); AC3 lose-response → retry → one transaction; AC4 422 → failed with the server errors, next record done; AC5 401/403/missing settings → paused, one request; AC6 "500 then 201", delay doubling and 5-minute cap, 429 and network retried, "hang" + 30 s timeout; AC7 :out/:in bodies, :in 500 → retry → no duplicate :out. Mutation check: removing the DELETE-404 rule, the 403 pause, the exponent, the requeue on unexpected errors or the stop after a failed :out leg each fails a test.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-11-01T15:18:00Z

---

Findings from TASK-6 (Sure 131e786, transactions_controller.rb):
- An unknown or inaccessible `account_id` answers `404 record_not_found`. The spec does not declare 404 for `POST /transactions`, so `sureFetch` returns it as a value with a status outside the generated union. Push must handle unexpected statuses explicitly (probably as `failed`, like 422) instead of trusting the union to be exhaustive. The fake reproduces it.
- The idempotency key is account + `external_id` + `source`, not the pair: the same `external_id` on another account creates a new transaction. Editing the account of a partially sent record must not reuse an `external_id` that is already on the server.
- The fake serves only what TASK-6 needed. Add `PATCH` / `DELETE /transactions/{id}` (outbox `update` / `delete`) and a fault that never answers (MSW `delay("infinite")`) for the timeout test in AC #6 when this task needs them.

---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added src/sync/push.ts: `push()` drains the outbox one record at a time in creation order and returns `{ sent, paused }` for the engine (TASK-10). Creates carry external_id = clientId and source "sure-quick-entry"; transfers resend both legs on every attempt and rely on Sure idempotency for the leg already sent; updates PATCH full values; deletes treat 404 as done. 2xx → done; 422 and other returned 4xx → failed with the server message; 401, 403, missing settings → paused (one request, no loop); 429, 5xx, network, non-JSON and a 30 s timeout → retry with 2 s exponential backoff, 5-minute cap, equal jitter. The fake gained PATCH/DELETE, a "hang" fault, and answers 500 for an unknown account like Sure 131e786 (its create rescues RecordNotFound itself). README documents the rules, the PATCH limits (cannot clear category/merchant; notes clear with "") and the 500. Follow-ups: TASK-19 (an unknown account blocks the queue with retries); requeueing records stuck in `sending` after a crash is noted on TASK-10. Known tradeoff: a 401 counts an attempt, so an entry never sent but paused on 401 can no longer be edited.
<!-- SECTION:FINAL_SUMMARY:END -->
