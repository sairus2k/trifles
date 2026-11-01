---
id: TASK-15
title: 'PWA: installable app that works offline'
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T13:20:00Z'
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
- [ ] #1 The manifest is a static `public/manifest.webmanifest` and the service worker is hand-written (`src/sw.ts`, no `vite-plugin-pwa`, Workbox or Serwist); `scope` and `start_url` are the path the app is served from
- [ ] #2 E2E: install the service worker → `context.setOffline(true)` → reload → the app loads
- [ ] #3 E2E: enter a transaction offline → pending row → back online → synced
- [ ] #4 The build loads no third-party or CDN scripts
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Manual checklist on a real iPhone passed: install to home screen, storage persists after several days, decimal keyboard and operator row work
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decision 2026-11-01 (prototypes of Serwist and a hand-written worker, both passed the same offline E2E suite; see README → Why these choices). Approach proven in the prototype:
- Vite plugin (apply: build, generateBundle with order: 'post' so index.html is in the bundle): collect bundle files + public/ files, hash their contents into VERSION, transpile src/sw.ts with `transformWithOxc`, prepend `const PRECACHE = [...]; const VERSION = '...'`, emit `sw.js` as an asset.
- src/sw.ts is a classic script (no imports/exports): `const sw = self as unknown as ServiceWorkerGlobalScope`; typecheck it with a separate tsconfig.sw.json (lib WebWorker) and exclude it from the main tsconfig.
- install: cache.addAll with `cache: 'reload'` + skipWaiting; activate: delete other `shell-*` caches + clients.claim; fetch: only GET; navigations inside scope (except `api/`) → cached index.html; precached URLs → cache; everything else (Sure API, other origins) → network untouched.
- Register in main.tsx only in PROD with `BASE_URL + 'sw.js'` and scope BASE_URL.
- Useful E2E cases beyond the AC: offline deep link falls back to the shell; offline fetch to /api/... is a network error (not index.html); rebuild with a new build id → app updates after reloads. Not verified in the prototype: base path other than '/', real iOS Safari.
<!-- SECTION:NOTES:END -->
