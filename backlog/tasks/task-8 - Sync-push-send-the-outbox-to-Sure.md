---
id: TASK-8
title: 'Sync push: send the outbox to Sure'
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T15:18:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-3
  - TASK-6
  - TASK-7
references:
  - README.md
priority: high
type: feature
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The core risk of the app: a transaction entered offline must reach Sure exactly once. Sure deduplicates creates by `external_id` + `source`, so any ambiguous failure can be retried. The API cannot create transfers directly, so a transfer is two transactions that Sure auto-matches. See README → Sync engine rules and Transfers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Records are sent one at a time in creation order
- [ ] #2 Every create sends `external_id` = client UUID, `source: "sure-quick-entry"`, a positive `amount`, `nature` and the account `currency`
- [ ] #3 Lost response after the server applied the write → retry → `200` → no duplicate (test against the fake)
- [ ] #4 `422` marks the record `failed` with the server message and the queue continues
- [ ] #5 `401` pauses the queue without a retry loop
- [ ] #6 `5xx`, network error and timeout retry with exponential backoff and jitter; `500` then `201` is tested
- [ ] #7 A transfer sends `<clientId>:out` (expense) and `<clientId>:in` (income); one leg sent and one failed resumes without duplicating the sent leg
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-11-01T15:18:00Z

---

Findings from TASK-6 (Sure 131e786, transactions_controller.rb):
- An unknown or inaccessible `account_id` answers `404 record_not_found`. The spec does not declare 404 for `POST /transactions`, so `sureFetch` returns it as a value with a status outside the generated union. Push must handle unexpected statuses explicitly (probably as `failed`, like 422) instead of trusting the union to be exhaustive. The fake reproduces it.
- The idempotency key is account + `external_id` + `source`, not the pair: the same `external_id` on another account creates a new transaction. Editing the account of a partially sent record must not reuse an `external_id` that is already on the server.
- The fake serves only what TASK-6 needed. Add `PATCH` / `DELETE /transactions/{id}` (outbox `update` / `delete`) and a fault that never answers (MSW `delay("infinite")`) for the timeout test in AC #6 when this task needs them.

---
<!-- COMMENTS:END -->
