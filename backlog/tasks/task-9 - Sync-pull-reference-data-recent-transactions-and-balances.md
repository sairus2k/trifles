---
id: TASK-9
title: 'Sync pull: reference data, recent transactions and balances'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T15:54:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-3
  - TASK-5
  - TASK-6
references:
  - README.md
priority: high
type: feature
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Screens read only from the local cache, so pull keeps it fresh. Sure recalculates balances asynchronously, so a balance right after a write is stale; the pending delta must stay until the account is newer than the send time. Merchant autocomplete needs merchant → category usage stats.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Accounts, categories and merchants are pulled and replace the cache
- [ ] #2 The latest 100 transactions are pulled with `per_page=100` and amounts are read from `amount_decimal` only
- [ ] #3 The pending balance delta clears only after the account `updated_at` is newer than the send time (tested)
- [ ] #4 `suggestions` is updated with merchant → most used category, `count` and `lastUsedAt`
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Research (Sure 131e786, src/sync, src/db/schema.ts, test/fake-sure):
- Sure creates the transaction (created_at), then `sync_account_later`; the job ends with `account.update!(balance:, cash_balance:)`, which moves `updated_at`. Both are rendered with `iso8601` (whole seconds, server clock). `update!` does not touch `updated_at` when the balance is unchanged, so the rule only holds for a non-zero delta (always true for create and transfer).
- A device-clock `sentAt` set in `markDone` fails twice: the recalculation can finish before the response arrives (updated_at < sentAt for good), and the phone clock may differ from the server. The POST response `created_at` is on the same clock as the account `updated_at`; an idempotent 200 returns the original one.
- DELETE returns no server time and `Date` is not readable cross-origin (CORS), hence no delta for update/delete.
- GET /accounts and /categories paginate (default 25, max 100); /merchants is a bare array.

1. Outbox `appliedAt?: number` (epoch ms, server clock): push passes the POST `created_at` to `markDone` (transfer: the :out leg). No index, no Dexie version. Tests in push.test.ts: 201, and lose-response → 200 keeps the original time.
2. src/sync/pull.ts `pullReference()`: accounts, categories, merchants with `per_page=100`, every page; each table replaced atomically (clear + bulkPut in one transaction). Tests: stale row removed, 30 accounts over two pages.
3. `pullRecent()`: accounts + `GET /transactions?per_page=100`, cache replaced, amounts from `amount_decimal` only, `TransactionRecord.externalId` added. Tests: per_page=100 sent, `amount` never parsed.
4. Suggestions rebuilt in `pullRecent()` from the pulled transactions with both merchant and category: key merchantName, most used category (tie → most recent), count, lastUsedAt = latest created_at. Merchants outside the window are kept.
5. `pendingDeltas()` in outbox.ts: per-account decimal string (scale 4) from create/transfer that are pending/sending, or done while `account.updatedAt < appliedAt` (whole seconds, so `>=` clears). failed records add nothing. Expense lowers an asset and raises a liability. Currency scale stays in TASK-14. Tests: send at .700 with pauseAccountSync → pull → delta kept; next second, no recalculation → kept; resumeAccountSync → pull → cleared; same-second recalculation; transfer; liability; failed.
6. README (data flow step 3, schema table, Pull rule, Testing) in the same commits. Comment on TASK-10: `pullReference()` on start, `pullRecent()` after push and on the timer.

Decisions (approved 2026-11-01): server time from `created_at` instead of a device `sentAt`; delta only for create/transfer; removing done outbox records is a separate task.
<!-- SECTION:PLAN:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-11-01T15:18:00Z

---

Finding from TASK-6: Sure renders account `updated_at` with `Time#iso8601`, in whole seconds, while the send time is stored in epoch milliseconds. A strict `updatedAt > sentAt` fails when the recalculation lands in the same second as the send (sent at 10:00:00.700, recalculated at 10:00:00.900, `updated_at` = 10:00:00), and the pending delta then stays until some later write touches the account. Compare at second precision (floor the send time to the second, then decide between `>` and `>=`) and cover it with a test. The fake reproduces the precision, and `pauseAccountSync()` / `resumeAccountSync()` let a test show the stale balance first.

---

author: @claude
created: 2026-11-01T15:46:00Z

---

Findings from TASK-8 (push):
- AC #3 compares the account `updated_at` with the send time, but the outbox does not store one: `markDone` only sets `status`. Add a `sentAt` (epoch ms) to `OutboxRecord` and set it in `markDone`; a Dexie schema version is needed only if it gets an index.
- `done` records are never removed, so the outbox keeps growing. The pull of recent transactions is the natural place: once a pulled transaction carries the record's `external_id` (`clientId` for a create, `<clientId>:out` and `<clientId>:in` for a transfer) and the balance delta has cleared, the record can go. Keep it until then, or the pending row and its delta vanish before the server row arrives.

---
<!-- COMMENTS:END -->
