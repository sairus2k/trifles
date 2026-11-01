---
id: TASK-15
title: 'PWA: installable app that works offline'
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-10
  - TASK-11
  - TASK-12
  - TASK-13
  - TASK-14
references:
  - README.md
priority: high
type: feature
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The app is used from the phone home screen, often with no connection. When it is served from the same domain as Sure, the service worker must not intercept Sure itself.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The manifest and service worker come from `vite-plugin-pwa`; `scope` and `start_url` are the path the app is served from
- [ ] #2 E2E: install the service worker → `context.setOffline(true)` → reload → the app loads
- [ ] #3 E2E: enter a transaction offline → pending row → back online → synced
- [ ] #4 The build loads no third-party or CDN scripts
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Manual checklist on a real iPhone passed: install to home screen, storage persists after several days, decimal keyboard and operator row work
<!-- DOD:END -->
