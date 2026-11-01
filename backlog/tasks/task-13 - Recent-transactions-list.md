---
id: TASK-13
title: Recent transactions list
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
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
