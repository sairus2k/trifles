---
id: TASK-20
title: Remove finished outbox records
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-01T15:54:00Z'
updated_date: '2026-11-01T20:27:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-9
  - TASK-13
references:
  - README.md
priority: medium
type: feature
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Push marks sent records `done` and nothing deletes them, so the outbox grows forever. A done record cannot go as soon as it is sent: until the pulled transaction (matched by `external_id`: `clientId`, or `<clientId>:out` / `<clientId>:in` for a transfer) is in the cache and the account balance has been recalculated (`pendingDeltas()`, TASK-9), the record is what keeps the row and its pending delta on screen. An entry dated before the latest 100 transactions never arrives in the cache, and a done update or delete has no server row to wait for, only a pull that started after it was sent. Decided while planning TASK-9; depends on how TASK-13 shows done records.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A done create or transfer is removed once its transaction(s) are in the cache and its balance delta has cleared
- [ ] #2 A done record whose date is older than every cached transaction is removed once its delta has cleared
- [ ] #3 A done update or delete is removed after a transactions pull that started after it was sent
- [ ] #4 Pending, sending and failed records are never removed by the cleanup
- [ ] #5 Tested against the fake
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Research:
- `done` is terminal: `finishAttempt` only leaves `sending`, `replaceQueued` rewrites only `pending`/`failed`, `discardFailed` only `failed`. So a `done` record never changes again, and a set of clientIds taken at one moment stays valid.
- Push and pull run under the same `outbox` Web Lock (src/sync/engine.ts), push first. `pullRecent()` fetches accounts, then `GET /transactions?per_page=100`, then replaces `accounts`, `transactions` and `suggestions` in one Dexie transaction. That is the only place where the cache learns about sent writes; `pullReference()` fetches no transactions.
- Sure (`TransactionsController#index`) lists `reverse_chronological` (date desc, then created_at desc) and leaves out transactions of accounts the key cannot reach. `update` and `destroy` are synchronous; only the balance recalculation (`sync_account_later`) is deferred, and `pendingDeltas()` already ignores updates and deletes.
- `pendingDeltas()` skips a `done` create/transfer leg once its cached account has `updatedAt >= appliedAt` (`isApplied`), and skips a leg whose account is not cached at all.
- src/features/recent/rows.ts: a `done` create/transfer is hidden once any of its legs is in the cache; otherwise it shows as a locked row (`UNPULLED_REASON`). A `done` update/delete overlays or hides its transaction until it leaves the outbox.

Rule (simpler than the description's, same ACs): a `done` record is removed by the first `pullRecent()` that started after it was `done`, provided every account its entries touch is either recalculated (`isApplied`) or no longer cached. Updates and deletes touch no account, so they go on that first pull (AC #3).
- Why not "transaction in the cache, or date older than every cached transaction": after a pull that started after the send, a create that is not in the cache can never arrive. Either it is outside the latest 100 (AC #2), or it was deleted in Sure by another client, or its account is no longer reachable. The literal rule keeps the last two forever as a locked "Saved in Sure" row; the pull-after-send rule covers all three without comparing dates or counting the window. AC #1 holds: a create inside the window is in the cache after that pull, and the row already comes from the server.
- Why a snapshot of clientIds and not a `sentAt` timestamp: no schema change, no clock, and it does not depend on the lock (a test can run `push()` while a pull is in flight).
- Why inside the pull's transaction: the cache and the outbox change in one commit, so live queries never see the record gone before the server row is there.

1. `feat: drop finished outbox records after a pull catches up with them`
   - src/sync/outbox.ts:
     - extract the entries of a record (create → its payload, transfer → both legs, update/delete → none) from `pendingDeltas()` into a private helper, reused below;
     - `doneClientIds(): Promise<string[]>`: clientIds of `done` records;
     - `dropFinished(doneBefore: string[]): Promise<void>`, called inside a rw transaction on `db.outbox` and `db.accounts` after the accounts are replaced: `bulkGet` the ids, keep those still `done` whose every entry's account is missing from `db.accounts` or `isApplied`, `bulkDelete` them. Pending, sending and failed records are never in the snapshot and are filtered again by status (AC #4).
   - src/sync/pull.ts, `pullRecent()`: take `doneClientIds()` before the first request; add `db.outbox` to the write transaction and call `dropFinished()` after `db.accounts.bulkPut`.
   - src/sync/pull.test.ts, new `describe("finished records")` against the fake (AC #5):
     - a create stays while `pauseAccountSync()` holds its account, though its transaction is in the cache, and goes on the first pull after `resumeAccountSync()` (AC #1);
     - a transfer stays until both accounts are recalculated: hold the `:in` account's `updated_at` behind `appliedAt` by hand, then let it catch up (AC #1);
     - a create dated before 100 newer server transactions is never in the cache, stays while its delta is held and goes once it clears (AC #2);
     - a create deleted in Sure by another client goes once its delta clears (the case the literal rule would keep);
     - a done update and a done delete go on the next pull, and the cached transaction shows Sure's values / is gone (AC #3);
     - a done update sent while a pull is in flight stays after that pull and goes on the next one: an msw handler `server.use`d in front of the fake holds `GET /api/v1/accounts` on a promise and then falls through (AC #3);
     - pending, sending and failed records of every op survive a pull, next to a done one that goes (AC #4);
     - a failed pull drops nothing.
   - src/sync/engine.test.ts: nine tests wait for `status: "done"`, which a full run now removes in the same run (the fake recalculates at once, so `pullRecent` drops the record). Replace those waits with a `synced(clientId)` helper: the record has left the outbox and the fake holds exactly one transaction with that `external_id`. "requeued and sent" checks `attempts: 2`, which the dropped record no longer carries: check `synced()` and one POST for that external_id (the test only flips the record to `sending`, nothing reached the fake); the attempt counting stays covered by the `requeueStuck` test in src/sync/outbox.test.ts.
   - README.md: Data flow for a new transaction (step 4: the next recent pull drops the record once its delta has cleared), Sync engine rules → Pull (what `pullRecent` drops and why), Recent list (replace "until the outbox drops it (TASK-20)" with the rule), Testing → required scenarios (finished records leave the outbox only after the pull catches up).
   - Run `npm test`; the pre-commit hook runs lint, format, typecheck and tests.
2. `chore: finish TASK-20` (check ACs with test names as evidence, final summary).

Not changed: rows.ts, the Balances screen and the schema. `UNPULLED_REASON` ("can be changed after the next sync") is shown for an old-dated create while its delta is pending, though it will never be pullable; it disappears with the record, so it is left as is.
<!-- SECTION:PLAN:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-11-01T18:30:00Z

---

From TASK-13: the recent list (src/features/recent/rows.ts) keeps a done record on screen in three ways, so cleanup must not drop it early. A done create/transfer shows as its own row until a pulled transaction matches its external_id (then it is already hidden, so removing it changes nothing on screen). A done update keeps its values overlaid on the transaction and a done delete keeps the row hidden: drop them only after a transactions pull that started after the send, or the old values flash back until the next pull. Failed records now leave through discardFailed (src/sync/outbox.ts).

---
<!-- COMMENTS:END -->
