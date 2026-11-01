---
id: TASK-7
title: 'Outbox: enqueue, edit and remove pending writes'
status: Done
assignee:
  - '@claude'
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T15:31:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-5
priority: high
type: feature
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every write goes to the outbox first; it is the optimistic layer, so the UI must not add a second one. Editing or deleting an entry that has not been sent yet must change the queued operation, not queue another one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Enqueuing a create writes one outbox record with a client UUID in a single Dexie transaction
- [x] #2 A transfer is enqueued as one record that later produces two legs
- [x] #3 Editing a pending create rewrites its payload; deleting a pending create removes it; no extra operation is queued
- [x] #4 Edits and deletes of synced transactions enqueue `update` / `delete` operations
- [x] #5 Records move through `pending | sending | failed | done` and keep `attempts`, `nextAttemptAt` and `lastError`
- [x] #6 Unit tests cover all of the above
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Approved 2026-11-01.

Research findings:
- The outbox key clientId is a random UUID, so queue order needs an index on createdAt (TASK-5 follow-up).
- Sync tests run in the Node project on fake-indexeddb (TASK-6 decision); each file has its own database, so outbox tests can use the shared db.
- evaluateAmount returns a positive decimal string; payloads keep it as a string and push converts it when sending.
- PATCH /transactions/{id} takes no account_id: an update cannot move a synced transaction to another account.
- A record that may have reached Sure (sending, or attempts > 0) cannot be edited safely: a retry with the same external_id answers 200 with the old values, and a changed account creates a duplicate because the key is scoped to the account.

Decisions (user):
- Edit/remove is allowed only for records that certainly did not reach Sure: pending with attempts === 0, or a failed create (422/404 are definitive). Everything else (sending, pending after an attempt, failed transfer, done, missing) throws OutboxLockedError; after done, an edit goes through as update.
- Strict queue order: claimNext looks only at the oldest pending record and returns nothing if its nextAttemptAt is in the future; failed and done records do not block.
- Edits of synced transactions coalesce: a second update rewrites a queued update, a delete turns it into delete; a sending record gets a new operation after it.

1. Schema, test first (schema.browser.test.tsx expects outbox index createdAt): db.version(2) with outbox "clientId, createdAt". README → Local schema notes the index.
2. src/sync/outbox.ts, test first (src/sync/outbox.test.ts, Node): OutboxRecord becomes a union by op (create → EntryPayload, transfer → TransferPayload, update → { transactionId, changes } without accountId, delete → { transactionId }). enqueueCreate / enqueueTransfer write one record with crypto.randomUUID() in one rw transaction, createdAt = max(now, last.createdAt + 1); transferLegs(record) gives <clientId>:out (expense, source) and <clientId>:in (income, destination); editPending(clientId, { op, payload }) rewrites the payload (create <-> transfer allowed) and resets a failed create to pending; removePending deletes; enqueueUpdate / enqueueDelete coalesce. README: Editing pending records rule and Project structure line; remove src/sync/.gitkeep.
3. Status transitions, test first: claimNext (pending → sending, strict order), markDone, markFailed(error), markRetry(error, nextAttemptAt); only from sending, otherwise throw. Time from Date.now(); tests fake only Date.
4. typecheck, lint, format, test and build pass.

Out of scope: backoff, server id on done and per-leg transfer progress (TASK-8); requeue of records stuck in sending after a crash (TASK-10); cleanup of done records (TASK-9); moving a synced transaction to another account and overlaying the outbox on the cache in the UI (TASK-12/13).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Deviations from the plan: one enqueue({ op, payload }) for creates and transfers instead of enqueueCreate / enqueueTransfer, mirroring editPending; transferLegs(clientId, payload) instead of taking the record. claimNext treats a sending head as holding the queue too (strict order), so a record stuck in sending after a crash blocks until TASK-10 requeues it. nextAttemptAt starts at 0 (due now) rather than createdAt, which the monotonic clock can push 1 ms into the future. Every finished attempt (done, failed, retry) increments attempts.
Verification (2026-11-01): 31 Node tests in src/sync/outbox.test.ts (one record, UUID v4 and a single db.transaction call; order within one millisecond; transfer as one record and its :out/:in legs; edit, create<->transfer, remove and failed-create reset; locked states sending / retrying / done / failed transfer / update op / missing; update and delete coalescing, failed update reset, in-flight successor; claimNext head-of-line with backoff, failed/done skipped, sending holds; retry/failed/done bookkeeping; transitions only from sending). Mutation checks: dropping the attempts === 0 rule, the monotonic createdAt, the create-only failed rule, the in-flight exclusion, the backoff check, the sending-holds rule, the attempts increment and the sending guard each fail a test. Full suite 157 passed; typecheck, lint, format:check and build pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the outbox in src/sync/outbox.ts, the optimistic layer every write goes through.

- Schema: db version 2 indexes outbox on createdAt for queue order; OutboxRecord is a union by op with typed payloads (EntryPayload, TransferPayload, UpdatePayload without accountId because PATCH cannot move a transaction, DeletePayload). Amounts stay calculator decimal strings.
- enqueue writes one record with crypto.randomUUID() in one rw transaction; createdAt is strictly increasing so same-millisecond writes keep their order. A transfer is one record; transferLegs gives <clientId>:out (expense) and <clientId>:in (income).
- editPending / removePending rewrite or remove a create or transfer only while it certainly is not on the server (pending with no attempts, or a failed create); anything else throws OutboxLockedError (decision with the user), because a retry with the same external_id would answer 200 with the old values and a changed account would duplicate it.
- enqueueUpdate / enqueueDelete for synced transactions coalesce per transaction unless the queued one is sending.
- claimNext / markDone / markFailed / markRetry move records through pending, sending, failed and done, keeping attempts, nextAttemptAt and lastError, in strict creation order.
README: outbox index, editing rules, strict order and the outbox.ts line.

Checks: 157 tests, typecheck, lint, format and build pass.

Follow-ups: TASK-8 computes backoff, stores the server id on done and needs per-leg progress before a failed transfer can be edited or removed; TASK-10 requeues records stuck in sending after a crash (they hold the queue); TASK-9 cleans up done records; TASK-12/13 handle moving a synced transaction to another account (delete + create) and overlay the outbox on the cache.
<!-- SECTION:FINAL_SUMMARY:END -->
