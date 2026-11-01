---
id: TASK-15
title: 'PWA: installable app that works offline'
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T18:30:00Z'
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

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-11-01T16:50:00Z

---

From TASK-11: the CORS classification in `src/features/settings/check.ts` is not covered by any test that a real browser enforces. Node fetch reports every request as `cors` to msw, and a response synthesized by the msw service worker skips the CORS check, so removing `mode: "no-cors"` from the follow-up probe fails nothing. Add an E2E case: serve a second origin from Playwright that answers `/api/v1/accounts` without CORS headers (or fails the OPTIONS preflight), enter it in Settings and expect the CORS message ("… answered, but the browser blocked the request (CORS)"), not "Cannot reach …".

---

author: @claude
created: 2026-11-01T17:29:00Z

---

From TASK-22: index.html has viewport-fit=cover and the screens pad with pt-safe/px-safe/pb-safe (src/index.css), so content clears the notch and home indicator. Still open here, together with the manifest: apple-mobile-web-app-status-bar-style (black-translucent always draws white status-bar text, unreadable on the light theme; default does not follow dark mode) and theme-color / manifest theme_color. Their values have to repeat the --color-surface literals, since meta tags cannot read CSS variables. Check the result on a real iPhone in standalone mode in light and dark.

---

author: @claude
created: 2026-11-01T17:54:00Z

---

From TASK-12: the offline E2E can enter through the form (labels "Amount", "Merchant", "Note"; buttons "Add expense" / "Add income" / "Add transfer"); it needs a cached account, so seed IndexedDB or let a first online pull run. Add to the iPhone checklist: after "Add expense" and after an operator button, the decimal keyboard stays open (focus returns to the amount after an await, outside the tap, and iOS may refuse to reopen the keyboard there).

---

author: @claude
created: 2026-11-01T18:30:00Z

---

From TASK-13: the offline E2E can check the pending row: the recent list (region "Recent transactions") marks an unsent entry "Pending" and drops the mark once it is synced and pulled. Add to the iPhone checklist: swipe left on a row uncovers Delete without scrolling the page (touch-action: pan-y), and the edit <dialog> opens over the form with the decimal keyboard working.

---
<!-- COMMENTS:END -->
