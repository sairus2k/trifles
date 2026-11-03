---
id: TASK-28
title: Keep the sticky header above the Recent list while scrolling
status: To Do
assignee: []
created_date: '2026-11-03T08:16:00Z'
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
- [ ] #1 While the page scrolls, the header stays fully visible and opaque above every part of the Recent list: rows, day headings, status badges and a row swiped open to Delete
- [ ] #2 The header buttons stay tappable while list content is scrolled under them
- [ ] #3 The edit dialog still opens above the header
- [ ] #4 A test or the E2E suite covers that the header is the top element at its position after scrolling the list under it
<!-- AC:END -->
