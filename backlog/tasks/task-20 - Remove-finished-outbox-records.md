---
id: TASK-20
title: Remove finished outbox records
status: To Do
assignee: []
created_date: '2026-11-01T15:54:00Z'
updated_date: '2026-11-01T18:30:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-9
  - TASK-13
references:
  - README.md
priority: medium
type: feature
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Push marks sent records `done` and nothing deletes them, so the outbox grows forever. A done record cannot go as soon as it is sent: until the pulled transaction (matched by `external_id`: `clientId`, or `<clientId>:out` / `<clientId>:in` for a transfer) is in the cache and the account balance has been recalculated (`pendingDeltas()`, TASK-9), the record is what keeps the row and its pending delta on screen. An entry dated before the latest 100 transactions never arrives in the cache, and a done update or delete has no server row to wait for, only a pull that started after it was sent. Decided while planning TASK-9; depends on how TASK-13 shows done records.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A done create or transfer is removed once its transaction(s) are in the cache and its balance delta has cleared
- [ ] #2 A done record whose date is older than every cached transaction is removed once its delta has cleared
- [ ] #3 A done update or delete is removed after a transactions pull that started after it was sent
- [ ] #4 Pending, sending and failed records are never removed by the cleanup
- [ ] #5 Tested against the fake
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-11-01T18:30:00Z

---

From TASK-13: the recent list (src/features/recent/rows.ts) keeps a done record on screen in three ways, so cleanup must not drop it early. A done create/transfer shows as its own row until a pulled transaction matches its external_id (then it is already hidden, so removing it changes nothing on screen). A done update keeps its values overlaid on the transaction and a done delete keeps the row hidden: drop them only after a transactions pull that started after the send, or the old values flash back until the next pull. Failed records now leave through discardFailed (src/sync/outbox.ts).

---
<!-- COMMENTS:END -->
