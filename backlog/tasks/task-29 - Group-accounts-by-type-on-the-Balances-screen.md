---
id: TASK-29
title: Group accounts by type on the Balances screen
status: To Do
assignee: []
created_date: '2026-11-03T19:59:00Z'
labels: []
dependencies: []
priority: medium
type: feature
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Balances screen (`src/features/balances/`) splits accounts only into Assets and Liabilities, each a single list by name. With several accounts the user has to scan the whole list; Sure's own accounts page groups them by type (cash, investments, crypto, credit cards, loans and so on), and the app should read the same way. Sure returns the type as `account_type` on every account (a free string in the spec, nullable, no enum), but the local `AccountRecord` does not store it yet, so the pull has to keep it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Within Assets and Liabilities, accounts are grouped by their Sure account type, each group under a heading with the type's name as Sure shows it, accounts within a group sorted by name
- [ ] #2 Groups follow Sure's order of types; a type the app does not know and a null `account_type` go to a trailing "Other" group of their classification instead of being dropped
- [ ] #3 Groups with no active accounts are not shown; pending deltas and the projected balance still show on each row as before
- [ ] #4 The account type is stored by the sync pull and reaches the local database of an existing install without a reinstall
- [ ] #5 The `account_type` values the app maps are confirmed against a real Sure (contract test) and covered by the fake Sure seed
- [ ] #6 Unit tests in `src/features/balances/rows.test.ts` cover grouping, order and unknown types; the browser test covers the group headings
<!-- AC:END -->
