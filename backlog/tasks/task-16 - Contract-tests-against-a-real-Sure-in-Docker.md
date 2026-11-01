---
id: TASK-16
title: Contract tests against a real Sure in Docker
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T15:46:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-3
priority: low
type: task
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The fake encodes assumptions about Sure behaviour that must hold on the real instance version. These tests run before upgrading Sure, not on every commit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A script starts Sure in Docker at the version pinned in `spec/README.md` and runs the suite
- [ ] #2 A repeated `external_id` returns `200` with the existing transaction
- [ ] #3 `nature: "expense"` stores a positive amount
- [ ] #4 Two opposite transactions between same-currency manual accounts are auto-matched into a transfer
- [ ] #5 Balance update latency after a write is measured and reported
- [ ] #6 How to run the suite is documented in README
- [ ] #7 POST /transactions for an unknown account answers `500` (TASK-8 retries it; see TASK-19)
- [ ] #8 PATCH /transactions/{id} ignores null fields, blank `category_id` / `merchant_id` and `currency`, and clears notes with `""`
- [ ] #9 PATCH and DELETE of an unknown transaction answer `404 not_found`
- [ ] #10 A read-only API key answers `403` to POST /transactions
<!-- AC:END -->
