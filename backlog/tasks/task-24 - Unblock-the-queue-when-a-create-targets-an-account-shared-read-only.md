---
id: TASK-24
title: Unblock the queue when a create targets an account shared read-only
status: To Do
assignee: []
created_date: '2026-11-01T20:18:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-19
references:
  - README.md
priority: medium
type: feature
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sure 131e786 answers `500` to `POST /api/v1/transactions` for an account the key's user can read but not write: a share with `read_only` or `read_write` (annotate) permission. `create` looks the account up with `writable_by` (owner or `full_control` share), and its own `rescue => e` turns the `RecordNotFound` into a generic 500. `GET /api/v1/accounts` and `GET /api/v1/accounts/{id}` use `accessible_by`, so such an account is listed in the entry form and the TASK-19 lookup answers 200: the create is retried with backoff and holds the queue forever. No API response exposes the share permission (the account JSON has no such field, there is no account_shares endpoint). Options to weigh: cap the attempts of a create that keeps getting 500 for an account that exists (careful: a 500 can also follow a saved entry, e.g. `sync_account_later` raising, so the failed record must not become editable), or let a create that keeps failing stop holding the records behind it. Found while planning TASK-19.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A create (or transfer leg) for an account the key can read but not write stops holding the queue, and the UI shows why
- [ ] #2 A transient 500 for a writable account is still retried
- [ ] #3 Tested against the fake
<!-- AC:END -->
