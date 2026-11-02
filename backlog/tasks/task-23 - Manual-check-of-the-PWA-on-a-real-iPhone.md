---
id: TASK-23
title: Manual check of the PWA on a real iPhone
status: To Do
assignee: []
created_date: '2026-11-01T19:36:00Z'
updated_date: '2026-11-02T18:02:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-15
  - TASK-25
references:
  - README.md
priority: high
type: task
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-15 made the app installable and offline-capable and proved it in Chromium E2E, but iOS Safari behaviour cannot be automated here: home-screen install, storage eviction, the decimal keyboard, touch gestures and the status bar in standalone mode. The service worker needs a secure context, so the build must be reachable over HTTPS first (no deploy task exists yet; see README → Deployment). The status bar uses `default` with light/dark `theme-color` (`index.html`); if it is unreadable in either scheme, that is the fix to make.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Installed to the home screen, the app opens in standalone mode with its icon and name
- [ ] #2 In airplane mode the installed app opens and accepts an entry, which syncs once back online
- [ ] #3 An unsent entry is still there after several days without opening the app
- [ ] #4 The amount field opens the decimal keyboard and the operator row works
- [ ] #5 The decimal keyboard stays open after "Add expense" and after an operator button
- [ ] #6 Swiping a recent row left uncovers Delete without scrolling the page
- [ ] #7 The edit dialog opens over the form and its amount field gets the decimal keyboard
- [ ] #8 Status bar text is readable in standalone mode in both light and dark scheme
- [ ] #9 The header clears the notch and the last button clears the home indicator
<!-- AC:END -->
