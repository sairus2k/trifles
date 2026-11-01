---
id: TASK-10
title: 'Sync engine: triggers, single worker and lifecycle'
status: Done
assignee:
  - '@claude'
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T16:20:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-8
  - TASK-9
priority: high
type: feature
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Push and pull need to run at the right moments without the Background Sync API, which iOS does not support. Several open tabs must not process the queue at the same time.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Sync runs on app start, `online`, `visibilitychange` → visible, after every enqueue and on a timer while the app is open
- [x] #2 The push loop runs inside `navigator.locks.request("outbox", …)`; two concurrent triggers result in one worker (tested)
- [x] #3 Offline enqueue followed by `online` pushes the record (tested)
- [x] #4 Pull of reference data runs on every online start; recent transactions are pulled after every successful push
- [x] #5 A paused queue (after `401`) resumes once settings are saved
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Research findings (2026-11-01):
- Engine tests run in the Node project (resolves comment #1). Spike passed in Node 26: `navigator.locks` serialises two requests; Dexie `liveQuery` + MSW + fake-indexeddb work under `vi.useFakeTimers({ toFake: [Date, setTimeout, clearTimeout, setInterval, clearInterval] })` (fake-indexeddb schedules with setImmediate, which stays real); `window`/`document` stubbed as `EventTarget` with `vi.stubGlobal` deliver events. Browser mode is ruled out by a hard clash, not a preference: `schema.browser.test.tsx` deletes the shared `db` in `afterAll` while other browser files run in parallel on the same origin. Real `online` / offline behaviour is covered by the TASK-15 E2E.
- Pitfall 1: an offline attempt fails as `network`, which counts an attempt (the record can no longer be edited) and backs off up to 5 min, so `online` alone would not send it. Hence: skip runs while `navigator.onLine === false`, and on `online` clear the backoff of pending records.
- Pitfall 2: with only a periodic timer, a 2 s backoff becomes "next tick". After each run, schedule a wake-up at the head's `nextAttemptAt`.
- Pitfall 3: the pause must survive a reload and be visible to every tab and to the UI (TASK-11 AC #4), otherwise each reload sends one more 401 and counts one more attempt.

1. Outbox helpers (src/sync/outbox.ts, tests in outbox.test.ts), commit `feat: requeue outbox records left sending by a closed tab`:
   - `requeueStuck()`: every `sending` record → `pending`, `attempts + 1` (the request may have reached Sure), `nextAttemptAt: 0`. Called only under the lock (comment #2).
   - `retryNow()`: pending records get `nextAttemptAt: 0` (used on `online`).
   - `headRetryAt()`: `nextAttemptAt` of the oldest unfinished record if it is pending and backing off, else undefined.
   - `onOutboxWrite(listener): () => void`: called after `enqueue`, `editPending`, `enqueueUpdate`, `enqueueDelete` commit. The engine subscribes, so "after every enqueue" does not depend on UI call sites and outbox does not import the engine.
2. Settings and pause in `meta` (src/sync/settings.ts + settings.test.ts), commit `feat: keep Sure settings and the sync pause in meta`:
   - Keys `baseUrl`, `apiKey`, `syncPaused` (the error message).
   - `saveSettings({ baseUrl, apiKey })` writes both and deletes `syncPaused` in one transaction (TASK-11 calls it after its connection check).
   - `pauseSync(message)`.
3. Engine (src/sync/engine.ts + engine.test.ts), commit `feat: run sync on triggers under a Web Lock`:
   - `startSync(): { stop(): void }`, no Solid. Per instance: a liveQuery on the three meta keys (calls `configureSure`; a change that leaves settings present and unpaused requests a full run), `online` / `visibilitychange` listeners, a 60 s interval, the backoff wake-up timeout, the outbox write listener. `stop()` removes all of them.
   - Triggers: start, `online` (`retryNow()` first), `visibilitychange → visible`, interval tick (skipped while hidden) → full run; outbox write and backoff wake-up → push run.
   - Coalescing within a tab: at most one run in flight plus one queued; queued flags are OR-ed (full wins).
   - A run is skipped when offline, unconfigured or paused. Otherwise, inside `navigator.locks.request("outbox", …)`: `requeueStuck()`; `pullReference()` until it succeeds once in this session (so an offline start pulls on the first online run); `push()`; `pullRecent()` if `sent > 0` or the run is full. Then schedule the wake-up from `headRetryAt()`.
   - Errors: `paused` from push and a 401 `SureError` from either pull → `pauseSync(message)`. Other `SureError`s from pull are left to the next trigger; unexpected errors are logged with `console.error` and never break the loop.
   - `src/main.tsx` calls `startSync()`.
4. Tests (Node, stubbed `window`/`document`/`navigator.onLine`, fake Sure):
   - AC #1: start sends a queued record and pulls; an enqueue after start is sent with no explicit call; `online`, `visible` and a 60 s tick each run; no tick runs while hidden; `stop()` silences everything.
   - AC #2: two engines on the same `db` (two tabs) triggered together → every record POSTed once and at most one request in flight; repeated triggers in one tab → bounded runs.
   - AC #3: offline enqueue makes no request and keeps `attempts: 0`; `online` → `done`. A record backing off after a network error is sent at once on `online`.
   - AC #4: `pullReference` once per session on an online start, and on the first online run after an offline start; `pullRecent` after a push that sent something, not after a push run that sent nothing.
   - AC #5: a 401 on push or on pull → `syncPaused` set, further triggers make no request; `saveSettings` → the queue resumes and the record is sent.
   - A record left `sending` → requeued with `attempts + 1` and sent; a 500 → retried at `nextAttemptAt` with no other trigger.
5. README (same commit as the engine): Sync engine rules (offline skip, `online` clears backoff, 60 s timer while visible, backoff wake-up, stuck `sending` requeue, pause stored in `meta` and cleared by saving settings), Local schema → `meta` keys, Project structure (`sync/settings.ts`), Testing → the engine runs in the Node project with stubbed globals and why browser mode is not used.

Out of scope: the Settings UI and the 401 redirect (TASK-11), on-demand pull from the UI (TASK-13; `startSync` can expose it then), cleanup of done records (TASK-20), the unknown-account 500 (TASK-19).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Deviation from the plan: the pause is stored as `syncPausedAt` (a timestamp), not `syncPaused` with the error message. `push()` returns only `{ sent, paused }`, and carrying the message would have meant changing its API and 14 push tests; the server message stays on the head record's `lastError`, which TASK-11 can show.
Evidence (src/sync/engine.test.ts, 17 tests, green 3 runs in a row; full suite green in the pre-commit hook; E2E `the built app loads` green with startSync() in main.tsx): AC1 "start sends the queue and pulls…", "a write is sent without anyone asking", "online, visible and the timer each run a full sync", "nothing runs while hidden or after stop"; AC2 "two tabs triggered together send each record once, one request at a time" (fetch spy: max 1 in flight, each external_id POSTed once), "triggers that fire together merge into one queued run"; AC3 "an entry made offline makes no request, stays editable and goes out online", "online ends the backoff…"; AC4 "reference data is pulled once per session", "an offline start pulls reference data on the first online run", "recent transactions follow a push that sent something, not one that sent nothing"; AC5 "a 401 on push pauses sync until settings are saved", "a 401 on a pull pauses sync too". Outbox helpers covered in outbox.test.ts, settings in settings.test.ts.
Mutation check: removing the lock, retryNow on online, the offline skip, the once-per-session reference guard, the pull after a send, the full pull, requeueStuck, the backoff wake-up, either pause, the in-tab merge, the hidden check on the tick or the write trigger each fails a test. Removing the listener cleanup in stop() does not: the `stopped` guard already makes stopped triggers no-ops.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-11-01T15:18:00Z

---

Decide where the engine's tests run: Node or Vitest browser mode. TASK-6 ran sync tests (TASK-8, TASK-9) in the Node project on fake-indexeddb + msw/node, but the engine itself runs in the browser main thread, and this task is the one most exposed to the difference.
- Node: every test file gets its own fake-indexeddb, so the shared `db` from src/db/schema.ts needs no isolation; MSW intercepts fetch in-process, so backoff and timers work with `vi.useFakeTimers()`; `navigator.locks` exists in Node 26. Against: `online`, `visibilitychange` and `document.visibilityState` have to be stubbed, which is most of AC #1 and #3.
- Browser mode: real IndexedDB, real window/document events and Web Locks, the same environment as production; the fake works through `setupWorker` (see test/fake-sure/fake-sure.browser.test.tsx). Against: browser test files run in parallel on one origin, so the shared fixed-name `db` clashes across files (open since TASK-5); requests go through a service worker, and how that combines with fake timers is unverified.
Spike both on the trigger tests before choosing, and record the choice in README → Testing.

---

author: @claude
created: 2026-11-01T15:39:00Z

---

From TASK-8 planning: a record left `sending` by a closed tab or a crash holds the queue forever (`claimNext` stops at a `sending` head). Once the push loop runs under the Web Lock, reset such records to `pending` with `attempts + 1` (the request may have reached Sure) before calling `push()`. This is safe only under the lock: without it, a second tab would requeue a request still in flight.

---

author: @claude
created: 2026-11-01T16:00:00Z

---

From TASK-9: call `pullReference()` (accounts, categories, merchants) on every online start and `pullRecent()` (accounts, latest 100 transactions, suggestions) after a push that sent something, on the timer and on demand. Sure recalculates balances in a background job, so the pull right after a push often still sees the old balance; the pending delta covers it until a later pull (the timer) sees the recalculated account. Both throw `SureError` like push (401 → pause).

---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added src/sync/engine.ts: `startSync()` runs push and pull without the Background Sync API, on app start, `online`, `visibilitychange → visible`, a 60 s timer while visible, every outbox write (`onOutboxWrite`) and when a backing-off head is due. Each run holds `navigator.locks.request("outbox")`, so one tab processes the queue; triggers within a tab merge into one queued run; a record a closed tab left `sending` is requeued with the attempt counted (comment #2). No run starts offline, so offline entries stay editable, and `online` ends every backoff. A run pushes, then pulls reference data once per session and recent transactions after a push that sent something or on a full trigger; a failed pull waits for the next trigger. A 401/403 on push or pull sets `syncPausedAt` in meta; `saveSettings()` (src/sync/settings.ts) stores the URL and key and lifts the pause, and the engine follows meta through a liveQuery, so every tab resumes. Engine tests run in the Node project with stubbed window/document/navigator.onLine (comment #1; browser mode would share and delete the app db); README documents the rules, the meta keys and the test setup.
Follow-ups: TASK-11 calls `saveSettings()` after its connection check and reads `syncPausedAt` for the 401 screen; TASK-13 needs an on-demand pull, which `startSync()` does not expose yet.
<!-- SECTION:FINAL_SUMMARY:END -->
