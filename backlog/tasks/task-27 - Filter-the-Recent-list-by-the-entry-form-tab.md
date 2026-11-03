---
id: TASK-27
title: Filter the Recent list by the entry form tab
status: To Do
assignee: []
created_date: '2026-11-03T08:11:00Z'
labels: []
dependencies: []
priority: medium
type: feature
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Recent list below the entry form shows every kind of entry at once, whichever tab of the form is selected. On the Expense tab the user wants to see the expenses they just entered, not income and transfers mixed in; same for Income and Transfer. The tab state lives inside `Entry` (`src/features/entry/entry.tsx`), while `Recent` is its sibling in `src/app.tsx`. The Recent row rules are pure functions in `src/features/recent/rows.ts` (README → Architecture).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With the Expense tab selected, Recent shows only expense rows; with Income, only income rows; with Transfer, only transfer rows
- [ ] #2 A row is classified the way it is displayed: transfers (pending, failed or pulled pairs) by `transfer`, the rest by the sign of `amount`, including rows whose queued update changed the nature
- [ ] #3 Switching the tab updates the list immediately, without a reload or a sync
- [ ] #4 Day headers with no rows left after filtering are not shown, and an empty filtered list shows an empty-state message that names the selected kind
- [ ] #5 Switching tabs inside the edit dialog does not change the filter of the list behind it
- [ ] #6 Unit tests in `rows.test.ts` cover the classification; a browser test covers switching tabs and the empty state
<!-- AC:END -->
