---
id: TASK-10
title: 'Sync engine: triggers, single worker and lifecycle'
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
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
