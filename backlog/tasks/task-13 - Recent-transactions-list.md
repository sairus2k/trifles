---
id: TASK-13
title: Recent transactions list
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T15:46:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-7
  - TASK-9
priority: medium
type: feature
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Right below the form the user sees what they just entered and whether it reached Sure. Mistakes are fixed in place.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Server and pending transactions are shown together, grouped by local day, newest first
- [ ] #2 Pending entries are marked; failed entries show the server error
- [ ] #3 Tap opens the entry for editing; swipe deletes it, both going through the outbox
- [ ] #4 Component tests cover grouping, pending and failed rows, edit and delete
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-11-01T15:46:00Z

---

Findings from TASK-8 (push), for the list and the edit screen:
- Duplicates: a `done` outbox record and the pulled server transaction are the same entry. Match them by `external_id` (`clientId`, or `<clientId>:out` / `<clientId>:in` for a transfer) and show one row.
- `PATCH /transactions/{id}` cannot clear a category or merchant (Sure drops null and blank ids), so removing one in the editor is silently lost. Disable clearing for synced transactions or say it will not apply. Notes do clear (push sends "").
- A failed transfer (one leg may already be on the server) cannot be edited or removed: `editPending` and `removePending` throw `OutboxLockedError`. The failed row needs an action, for example dismiss with a warning that one leg may exist in Sure; that needs a new outbox function.
- A record paused by `401` counts an attempt, so an entry that never reached Sure becomes locked for editing. Show why the row cannot be edited.

---
<!-- COMMENTS:END -->
