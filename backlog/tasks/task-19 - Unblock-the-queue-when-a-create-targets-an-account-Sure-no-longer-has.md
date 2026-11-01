---
id: TASK-19
title: Unblock the queue when a create targets an account Sure no longer has
status: To Do
assignee: []
created_date: '2026-11-01T15:39:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-8
  - TASK-9
references:
  - README.md
priority: medium
type: feature
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sure 131e786 answers `500 internal_server_error` (not 404) to `POST /api/v1/transactions` when `account_id` is unknown or not writable by the key: `find` raises `RecordNotFound` inside `create`, whose own `rescue => e` catches it before `BaseController#rescue_from` can turn it into 404. Push treats 5xx as transient and retries with backoff, and a head that is backing off holds the queue, so one entry for an account deleted or unshared on the server blocks every later write forever. Found while planning TASK-8; the fake answers 500 like Sure.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A create (or transfer leg) for an account Sure does not have ends as `failed` with a message the UI can show, and the records behind it are sent
- [ ] #2 A transient 500 for an account that does exist is still retried
- [ ] #3 Tested against the fake
<!-- AC:END -->
