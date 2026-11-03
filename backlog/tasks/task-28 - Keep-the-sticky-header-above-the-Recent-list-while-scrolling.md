---
id: TASK-28
title: Keep the sticky header above the Recent list while scrolling
status: Done
assignee:
  - '@claude'
created_date: '2026-11-03T08:16:00Z'
updated_date: '2026-11-03T19:30:00Z'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When the page scrolls, the transaction rows of the Recent list slide over the sticky app header (`src/app.tsx`) and hide it, while the day headings ("Today", dates) pass under it, so the header shows through only where a date row is. The header is meant to stay on top: it holds "Sync paused", Balances and Settings. Observed: the header has no stacking order of its own; the rows are positioned (`relative`, plus a `transform` for the swipe-to-delete) and the day headings are not.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 While the page scrolls, the header stays fully visible and opaque above every part of the Recent list: rows, day headings, status badges and a row swiped open to Delete
- [x] #2 The header buttons stay tappable while list content is scrolled under them
- [x] #3 The edit dialog still opens above the header
- [x] #4 A test or the E2E suite covers that the header is the top element at its position after scrolling the list under it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce in a browser test of App: 30 pending entries, one row swiped open, the list scrolled under the sticky header; elementFromPoint across the header must hit the header.
2. Give the header its own stacking order (z-10), above the positioned rows and their Delete buttons.
3. Check in the same test that the modal edit dialog still covers the header.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The sticky header in `src/app.tsx` had no z-index, so the Recent rows (positioned `relative` with a `transform` for the swipe) painted over it while scrolling, and only the unpositioned day headings passed under it. The header now has `z-10`.

Verified by a new browser test in `src/app.browser.test.tsx` with real Tailwind CSS:
- 30 pending entries, one row swiped open to Delete, scrolled under the header;
- `elementFromPoint` at the left, centre and right of the header hits the header (title and Settings button), not the row or its Delete button;
- the modal edit dialog still covers the header.

The test fails without the fix (the row button is hit) and passes with it. `npm test`: 450/450.

Not checked on a real iPhone; TASK-23 covers the device pass.
<!-- SECTION:FINAL_SUMMARY:END -->
