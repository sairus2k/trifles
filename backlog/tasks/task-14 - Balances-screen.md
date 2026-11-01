---
id: TASK-14
title: Balances screen
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T16:00:00Z'
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

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-11-01T16:00:00Z

---

From TASK-9: render `pendingDeltas()` (src/sync/outbox.ts) through `createLiveQuery`. It returns `Map<accountId, string>`, a decimal at scale 4 in the direction of `balanceCents` (e.g. "-3.5000"); convert with `toCents(delta, scale)` once the currency → scale mapping exists (Sure minor_unit_conversion, not Intl; see TASK-4). Accounts with no delta are absent. Only creates and transfers carry a delta; an edited or deleted synced transaction shows no ≈ until Sure recalculates.

---
<!-- COMMENTS:END -->
