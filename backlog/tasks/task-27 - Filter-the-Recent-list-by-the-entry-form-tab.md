---
id: TASK-27
title: Filter the Recent list by the entry form tab
status: Done
assignee:
  - '@claude'
created_date: '2026-11-03T08:11:00Z'
updated_date: '2026-11-03T20:08:00Z'
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
- [x] #1 With the Expense tab selected, Recent shows only expense rows; with Income, only income rows; with Transfer, only transfer rows
- [x] #2 A row is classified the way it is displayed: transfers (pending, failed or pulled pairs) by `transfer`, the rest by the sign of `amount`, including rows whose queued update changed the nature
- [x] #3 Switching the tab updates the list immediately, without a reload or a sync
- [x] #4 Day headers with no rows left after filtering are not shown, and an empty filtered list shows an empty-state message that names the selected kind
- [x] #5 Switching tabs inside the edit dialog does not change the filter of the list behind it
- [x] #6 Unit tests in `rows.test.ts` cover the classification; a browser test covers switching tabs and the empty state
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. rows.ts: pure rowKind(row) (transfer flag first, else the sign of amount) and ofKind(days, kind) that drops other rows and empty days; unit tests in rows.test.ts.
2. EntryForm: optional onTabChange prop; Entry takes tab + onTabChange and starts the form on that tab, so the form and the list agree after Settings remounts the form. The editor passes no onTabChange, so its tabs never touch the list.
3. App owns the tab signal (default expense) and passes it to Entry and Recent.
4. Recent takes a required kind prop, filters with ofKind and names the kind in the empty state.
5. Browser tests: app test for switching tabs, the edit dialog leaving the filter alone, and the empty state; update existing Recent tests to pass the kind they show.
6. README feature list mentions the filter.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Initial-tab read is wrapped in untrack(): Solid 2 reported STRICT_READ_UNTRACKED for the one-time snapshot. Mutation checks: the App tests fail with the filter removed and without the initial tab. Full vitest (457) and e2e (12) pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The entry form's tab moved up into App, which passes it to Recent as `kind`. Pure `rowKind` / `ofKind` in `src/features/recent/rows.ts` classify a row the way it is displayed (transfer flag, else the sign of the amount, which already reflects a queued nature change) and drop days left empty; the empty state names the kind ("No expenses yet." etc.). The editor's EntryForm gets no `onTabChange`, so its tabs never touch the list. Entry starts the form on App's tab, so returning from Settings (which unmounts the form) keeps the form and list in agreement. Tests: unit tests in rows.test.ts, Recent browser tests per kind and empty state, App browser tests for switching tabs, the edit dialog and the Settings round trip. README feature list updated.
<!-- SECTION:FINAL_SUMMARY:END -->
