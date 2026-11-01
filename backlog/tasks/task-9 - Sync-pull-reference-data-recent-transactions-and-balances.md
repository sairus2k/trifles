---
id: TASK-9
title: 'Sync pull: reference data, recent transactions and balances'
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-3
  - TASK-5
  - TASK-6
references:
  - README.md
priority: high
type: feature
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Screens read only from the local cache, so pull keeps it fresh. Sure recalculates balances asynchronously, so a balance right after a write is stale; the pending delta must stay until the account is newer than the send time. Merchant autocomplete needs merchant → category usage stats.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Accounts, categories and merchants are pulled and replace the cache
- [ ] #2 The latest 100 transactions are pulled with `per_page=100` and amounts are read from `amount_decimal` only
- [ ] #3 The pending balance delta clears only after the account `updated_at` is newer than the send time (tested)
- [ ] #4 `suggestions` is updated with merchant → most used category, `count` and `lastUsedAt`
<!-- AC:END -->
