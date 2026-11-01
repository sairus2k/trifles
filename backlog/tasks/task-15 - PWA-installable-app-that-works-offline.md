---
id: TASK-15
title: 'PWA: installable app that works offline'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T19:30:00Z'
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
- [x] #1 The manifest is a static `public/manifest.webmanifest` and the service worker is hand-written (`src/sw.ts`, no `vite-plugin-pwa`, Workbox or Serwist); `scope` and `start_url` are the path the app is served from
- [x] #2 E2E: install the service worker → `context.setOffline(true)` → reload → the app loads
- [x] #3 E2E: enter a transaction offline → pending row → back online → synced
- [x] #4 The build loads no third-party or CDN scripts
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Manual checklist on a real iPhone passed: install to home screen, storage persists after several days, decimal keyboard and operator row work
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Research 2026-11-01 (Playwright 1.64.1 + Chromium, throwaway prototype in a scratchpad):
- With a service worker that returns without respondWith for other origins, context.route still intercepts the app's requests to Sure.
- context.route keeps fulfilling while context.setOffline(true): the fake Sure must abort its own requests while the test is offline, or 'offline' only means navigator.onLine === false.
- route.fulfill skips the CORS check (a response without Access-Control-Allow-Origin is readable), so a CORS E2E needs a real second-origin HTTP server, not page.route.
- The service worker update check (registration.update()) is not routed: an update E2E has to change the served sw.js on disk.
- msw 3 exports getResponse(handlers, request), so test/fake-sure handlers can answer Playwright routes unchanged.
- No dynamic import() in src: the build is one entry chunk, so deleting old shell caches on activate cannot break a running page.

1. Manifest and icons (commit: feat: add the web app manifest and icons)
   - public/manifest.webmanifest: name, short_name, display standalone, start_url "./" and scope "./" (relative to the manifest, so they follow the path the app is served from), theme_color/background_color = light --color-surface (#ffffff), icons 192, 512 and 512 maskable.
   - public/icon.svg plus PNGs (192, 512, maskable 512, apple-touch-icon 180) rendered once from the SVG; the render script is not committed.
   - index.html: link rel=manifest, icon, apple-touch-icon; theme-color twice with media (prefers-color-scheme: light/dark) repeating the --color-surface literals (#ffffff / #0f1115); apple-mobile-web-app-status-bar-style "default" (black-translucent draws white text on the light theme); comment on why the literals repeat src/index.css.
2. Service worker (commit: feat: precache the app shell in a hand-written service worker)
   - src/sw.ts: classic script, no imports/exports; declare const PRECACHE: string[] and VERSION: string; const sw = self as unknown as ServiceWorkerGlobalScope. install: caches.open('shell-' + VERSION), addAll(PRECACHE as Requests with cache: 'reload'), skipWaiting. activate: delete other shell-* caches, clients.claim. fetch: only GET; same-origin navigations inside the registration scope, except <scope>api/, answer the cached index.html (network fallback); precached URLs answer from the cache; everything else (Sure, other origins) is not touched (no respondWith).
   - Vite plugin (sw-plugin.ts at the root, included by tsconfig's *.ts): apply 'build', generateBundle with order 'post'; PRECACHE = bundle file names (no sw.js, no maps) + public/ files, as paths relative to sw.js so any base works; VERSION = short sha256 over their contents; transpile src/sw.ts with transformWithOxc, prepend the two consts, emitFile asset sw.js.
   - tsconfig.json excludes src/sw.ts; tsconfig.sw.json (lib ESNext + WebWorker, include src/sw.ts); npm run typecheck runs both.
   - src/main.tsx: register only when import.meta.env.PROD, at BASE_URL + 'sw.js' with scope BASE_URL.
   - README: Project structure (sw-plugin.ts, tsconfig.sw.json), Deployment (scope comes from the build base / manifest location), Mobile details (status bar and theme-color).
3. Offline E2E (commit: test: load and enter transactions offline), e2e/pwa.spec.ts plus a helper e2e/fake-sure.ts that answers context.route('https://sure.test/**') with createFakeSure().handlers through getResponse and aborts with 'internetdisconnected' while the test is offline.
   - AC #2: first visit → wait for navigator.serviceWorker.ready and a controller → setOffline(true) → reload → Settings heading visible.
   - AC #3: save Settings (https://sure.test + key) online → wait for a cached account in the form → offline → Add expense through the form (Amount, Merchant) → row in "Recent transactions" marked "Pending", Balances row shows "≈" → setOffline(false) → the fake received POST /api/v1/transactions, "Pending" and "≈" are gone.
   - Offline deep link (/some/path) loads the shell; offline fetch to /api/v1/accounts on the app origin is a network error, not index.html.
   - AC #4: with the service worker installed, a reload requests only the app origin, and every PRECACHE entry is relative (no scheme).
4. Run npm run test:e2e (not part of the pre-commit hook) plus the hook checks; README → Testing lists the new E2E cases.
5. Finish: hand the iPhone checklist (DoD) to the user. It needs the build on HTTPS; there is no deploy task yet. Checklist: install to home screen; airplane mode → app opens; storage (an unsent entry) survives several days; decimal keyboard + operator row; keyboard stays open after Add expense and after an operator button; swipe left uncovers Delete without scrolling the page; the edit dialog opens over the form with the decimal keyboard; status bar text readable in standalone, light and dark; header clears the notch, last button clears the home indicator.

Scope added by the user 2026-11-01 (beyond the AC), each its own commit after step 3:
6. Non-root base (commit: test: serve the app under a sub-path): a second Playwright webServer builds with --base=/quick/ into its own outDir and previews it on another port; a project for it checks: the registration scope is /quick/, an offline reload of /quick/ loads the app, the manifest and icons resolve under /quick/, and an offline navigation to / (where Sure would live) is not answered by the worker. Fix whatever the sub-path breaks (index.html links, PRECACHE paths) in a separate fix: commit.
7. CORS (commit: test: report a Sure that blocks CORS), from TASK-11 comment #1: a node:http server started by the test on a second origin answers /api/v1/accounts without CORS headers; enter it in Settings → expect "… answered, but the browser blocked the request (CORS)", not "Cannot reach …". page.route cannot do this: route.fulfill skips the CORS check.
8. Worker update (commit: test: a new build replaces the cached shell): in a serial describe, rewrite VERSION in the served dist/sw.js (restore it in finally); after reloads the new worker controls the page, caches.keys() holds only the new shell-* cache, and the app still loads offline. route cannot replace sw.js for registration.update().
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decision 2026-11-01 (prototypes of Serwist and a hand-written worker, both passed the same offline E2E suite; see README → Why these choices). Approach proven in the prototype:
- Vite plugin (apply: build, generateBundle with order: 'post' so index.html is in the bundle): collect bundle files + public/ files, hash their contents into VERSION, transpile src/sw.ts with `transformWithOxc`, prepend `const PRECACHE = [...]; const VERSION = '...'`, emit `sw.js` as an asset.
- src/sw.ts is a classic script (no imports/exports): `const sw = self as unknown as ServiceWorkerGlobalScope`; typecheck it with a separate tsconfig.sw.json (lib WebWorker) and exclude it from the main tsconfig.
- install: cache.addAll with `cache: 'reload'` + skipWaiting; activate: delete other `shell-*` caches + clients.claim; fetch: only GET; navigations inside scope (except `api/`) → cached index.html; precached URLs → cache; everything else (Sure API, other origins) → network untouched.
- Register in main.tsx only in PROD with `BASE_URL + 'sw.js'` and scope BASE_URL.
- Useful E2E cases beyond the AC: offline deep link falls back to the shell; offline fetch to /api/... is a network error (not index.html); rebuild with a new build id → app updates after reloads. Not verified in the prototype: base path other than '/', real iOS Safari.

Implemented 2026-11-01 (commits 9c70fe5..2e70572, plus 7965832 fixing a flaky recent.browser test the hook hit).
Evidence: npm run test:e2e 12/12, three runs in a row; npm test 398/398.
- AC #1: public/manifest.webmanifest (start_url/scope "./"), src/sw.ts + sw-plugin.ts, no PWA dependency; e2e/sub-path.spec.ts proves scope, start_url, manifest and icons resolve to /quick/ and the root stays with the network.
- AC #2, #3: e2e/pwa.spec.ts. The offline entry test reloads offline before entering, checks "Pending" and the "≈" balance, then the fake Sure receives the POST and both marks go.
- AC #4: e2e/pwa.spec.ts (only the app origin after the worker is installed, PRECACHE all relative) plus the existing e2e/style.spec.ts.
- Mutation checks: no registration → all four pwa tests fail; probe without mode "no-cors" → cors.spec fails; activate keeping old caches → update.spec fails.
- sw.js is 1.7 kB unminified. vite.config.ts imports ./sw-plugin.ts with the extension (Vite's native config loader warns otherwise), hence allowImportingTsExtensions in tsconfig.json.
Open: DoD #1, the iPhone checklist, needs the build on HTTPS; there is no deploy task yet.
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

author: @claude
created: 2026-11-01T18:48:00Z

---

From TASK-14: the offline E2E can check the balance delta too: the header button "Balances" opens regions "Assets" / "Liabilities"; an unsent entry shows "≈ <projected>" on its account row, and the mark goes once synced and pulled. The button label flips to "Entry" to go back.

---
<!-- COMMENTS:END -->
