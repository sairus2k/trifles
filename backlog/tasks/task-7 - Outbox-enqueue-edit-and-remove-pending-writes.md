---
id: TASK-7
title: 'Outbox: enqueue, edit and remove pending writes'
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
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
- [ ] #1 Enqueuing a create writes one outbox record with a client UUID in a single Dexie transaction
- [ ] #2 A transfer is enqueued as one record that later produces two legs
- [ ] #3 Editing a pending create rewrites its payload; deleting a pending create removes it; no extra operation is queued
- [ ] #4 Edits and deletes of synced transactions enqueue `update` / `delete` operations
- [ ] #5 Records move through `pending | sending | failed | done` and keep `attempts`, `nextAttemptAt` and `lastError`
- [ ] #6 Unit tests cover all of the above
<!-- AC:END -->
