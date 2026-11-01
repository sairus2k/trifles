---
id: TASK-10
title: 'Sync engine: triggers, single worker and lifecycle'
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T15:39:00Z'
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
- [ ] #1 Sync runs on app start, `online`, `visibilitychange` → visible, after every enqueue and on a timer while the app is open
- [ ] #2 The push loop runs inside `navigator.locks.request("outbox", …)`; two concurrent triggers result in one worker (tested)
- [ ] #3 Offline enqueue followed by `online` pushes the record (tested)
- [ ] #4 Pull of reference data runs on every online start; recent transactions are pulled after every successful push
- [ ] #5 A paused queue (after `401`) resumes once settings are saved
<!-- AC:END -->

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
<!-- COMMENTS:END -->
