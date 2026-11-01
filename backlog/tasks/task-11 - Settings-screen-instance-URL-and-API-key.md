---
id: TASK-11
title: 'Settings screen: instance URL and API key'
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-3
  - TASK-5
priority: high
type: feature
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The app needs a Sure instance URL and a `read_write` API key before it can sync. The key grants full access and is stored on the device. On iOS, only persistent storage protects an unsent outbox from eviction.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The user can enter and save the instance URL and API key; they are stored in the `meta` table
- [ ] #2 Saving checks the connection and shows a clear error for a wrong URL, a wrong key and a CORS / preflight failure
- [ ] #3 `navigator.storage.persist()` is requested on first run
- [ ] #4 A `401` during sync opens Settings with an explanation
- [ ] #5 Component tests cover save, validation errors and the 401 redirect
<!-- AC:END -->
