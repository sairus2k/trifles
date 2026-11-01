---
id: TASK-6
title: Stateful MSW fake of the Sure API for tests
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-3
priority: high
type: task
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
orval-generated MSW handlers always answer 200 with random data, which cannot test idempotency or failure handling. The sync engine tests need a fake that keeps state and can be told how to fail.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The fake keeps transactions keyed by `external_id` and answers `200` with the existing transaction on a repeated `external_id` + `source` pair
- [ ] #2 A test can make the next request answer `201`, `200`, `422`, `401`, `500` or drop the connection, including "server applied the write but the response was lost"
- [ ] #3 Accounts, categories and merchants endpoints return seeded data; account `updated_at` and balance change after a write
- [ ] #4 The fake lives in `test/fake-sure/` and is usable from Node and browser-mode tests
<!-- AC:END -->
