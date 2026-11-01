---
id: TASK-8
title: 'Sync push: send the outbox to Sure'
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
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
