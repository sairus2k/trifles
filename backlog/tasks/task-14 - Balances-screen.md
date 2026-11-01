---
id: TASK-14
title: Balances screen
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-9
priority: medium
type: feature
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Balances are one tap away from the form. Sure is the source of truth for balances; the app only shows what Sure returns plus a pending delta for unsynced entries.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Accounts are split into assets and liabilities with balances in each account currency
- [ ] #2 An account with unsynced entries shows the pending delta as `≈`
- [ ] #3 The delta disappears once pull brings a newer balance
- [ ] #4 Component tests cover the split and the pending delta
<!-- AC:END -->
