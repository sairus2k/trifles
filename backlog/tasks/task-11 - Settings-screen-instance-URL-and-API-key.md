---
id: TASK-11
title: 'Settings screen: instance URL and API key'
status: Done
assignee:
  - '@claude'
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T16:47:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-3
  - TASK-5
priority: high
type: feature
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The app needs a Sure instance URL and a `read_write` API key before it can sync. The key grants full access and is stored on the device. On iOS, only persistent storage protects an unsent outbox from eviction.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The user can enter and save the instance URL and API key; they are stored in the `meta` table
- [x] #2 Saving checks the connection and shows a clear error for a wrong URL, a wrong key and a CORS / preflight failure
- [x] #3 `navigator.storage.persist()` is requested on first run
- [x] #4 A `401` during sync opens Settings with an explanation
- [x] #5 Component tests cover save, validation errors and the 401 redirect
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Research (Sure 131e786, local checkout ../sure):
- The connection check must not touch the engine's settings: `sureFetch` reads the module-level settings from `configureSure`, and the engine reconfigures it on every meta change. Generated functions type their options as `Parameters<typeof sureFetch>[1]`, so an optional `settings` field on that init reaches the mutator typed, with no change to orval output.
- Read-only key: GET cannot reveal it. `TransactionsController` runs `ensure_write_scope` before `set_transaction`, so `DELETE /api/v1/transactions/<random UUID>` answers 403 `insufficient_scope` for a read key and 404 `not_found` (JSON, TransactionLookup) for read_write, changing nothing. Decision (user, 2026-11-01): use this probe. It also exercises the DELETE preflight.
- CORS vs wrong URL: both reject with TypeError. A follow-up `fetch(url, { mode: "no-cors" })` carries no custom header, so no preflight: it resolves (opaque) when the host answers and rejects when it is unreachable. Node's fetch accepts `mode: "no-cors"`, so the classifier runs in the Node project with msw/node: a handler that errors when `X-Api-Key` is present and answers without it stands in for a CORS block.
- Browser test files run in parallel on one origin and `schema.browser.test.tsx` deletes the app `db` in afterAll. Settings and App are the first browser tests on the app `db` (meta), so they would race with it.
- Decisions (user, 2026-11-01): a pause opens Settings with an explanation, but it can be closed to keep entering offline; a header button "Sync paused" leads back. Settings are saved only after a successful check (offline or CORS: no save).

1. `test: run browser test files one at a time` — vite.config.ts browser project `fileParallelism: false`; README → Testing: why (app `db` shared, schema test deletes it). Check the browser suite time before/after.
2. `feat: let a Sure request use settings other than the configured ones` — src/api/http.ts: `sureFetch(path, init: RequestInit & { settings?: SureSettings })`, the override wins, is stripped from the fetch init. Test in http.test.ts: override used while configured settings stay untouched.
3. `feat: check the Sure connection before saving settings` — src/features/settings/check.ts: `checkConnection(settings): Promise<CheckResult>`, `{ ok: true } | { ok: false, reason, status? }`, 15 s `AbortSignal.timeout` per request:
   - before any request: URL parses with http(s) → else `invalid-url`; app on https and URL http → `insecure-url` (mixed content is blocked silently); `navigator.onLine === false` → `offline`.
   - `GET /api/v1/accounts?per_page=1` with the candidate settings: 200 JSON → next step; 401 → `bad-key`; `not-json` or another returned status → `not-sure` (wrong path, a proxy login page); 429/5xx → `server`; timeout → `timeout`; network → no-cors probe of the same URL: resolves → `cors`, rejects → `unreachable`.
   - `DELETE /api/v1/transactions/{crypto.randomUUID()}`: 404 → ok; 403 → `read-only`; 401 → `bad-key`; network → the same probe; anything else → `server`.
   - Tests in check.test.ts (Node, msw/node + fake Sure, failNext): each reason, and that a successful check never writes meta or calls `configureSure`.
   - README → Sure API notes: the scope probe and the before_action order it relies on. Comment on TASK-16: contract-test the probe (read key → 403, read_write → 404).
4. `feat: add the Settings screen` — src/features/settings/settings.tsx:
   - URL and key fields (key `type="password"`, `autocomplete="off"`), pre-filled from the saved settings; Save disabled while checking.
   - Save: trim → `checkConnection` → on ok `saveSettings()` (lifts the pause; the engine follows meta), then `navigator.storage.persist()` unless `persisted()` is already true (AC #3: the first save is the first run, and it runs in a user gesture); on failure one message per reason, naming the host, and for `cors` the proxy / Cloudflare Access hint from README.
   - While `pausedAt` is set: explanation that Sure rejected the key, sync is paused and entries stay on the device until a working key is saved.
   - src/app.tsx: `createLiveQuery(readSyncConfig)` in `<Loading>`; Settings is shown when nothing is configured (no way back), when the user opens it, or while `pausedAt` differs from the pause the user last closed (a new 401 opens it again). Header: Settings button, and "Sync paused" while paused. No router.
   - README: Mobile details (persist on the first save), Project structure if the files differ.
5. Tests (browser mode, msw/browser + fake Sure, app `db` meta cleared before each test):
   - settings.browser.test.tsx: save stores URL and key in meta and lifts a pause; wrong key, read-only key, unreachable host, CORS block and non-JSON answer each show their message and store nothing; persist() is requested on the first save.
   - app.browser.test.tsx: a fresh install shows Settings; `pauseSync()` opens Settings with the explanation; closing it shows the main screen with "Sync paused", which opens Settings again; saving a working key closes it. (401 → pause itself is covered in engine.test.ts.)
6. Before done: full suite green in the hook, mutation check of the classifier branches and the pause trigger, then the finalization guide.

AC map: #1 → 4, 5; #2 → 3, 5; #3 → 4, 5; #4 → 4, 5; #5 → 5.
Out of scope: switching to another Sure instance leaves the old cache and outbox (queued records target accounts the new instance lacks: the 500 of TASK-19); showing the head record's `lastError` on the pause screen; on-demand pull (TASK-13).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented as planned in 4 commits (56afc47 browser tests one file at a time, c480a31 per-request settings in sureFetch, 153c7b3 checkConnection, ff45c35 Settings screen). Additions to the plan: a 200 without an `accounts` array also counts as `not-sure`, and any DELETE-probe answer other than 403/404 is `server`; the E2E smoke test now expects Settings on first run.
Evidence: AC1 settings.browser.test.tsx "a working URL and key are stored in meta, lift the pause and request persistent storage"; AC2 the same file's "… is explained and nothing is stored" for a wrong key, a read-only key, a wrong URL, a CORS / preflight failure and a URL that is not Sure, plus check.test.ts (18 tests: every reason, and the probe changes nothing); AC3 "… request persistent storage" and "storage that is already persistent is not requested again"; AC4 app.browser.test.tsx "a 401 during sync opens Settings with an explanation" and "a closed pause leaves a way back, a new key ends it, and the next 401 opens Settings again" (the 401 → pause step is engine.test.ts); AC5 all of the above. Full suite 258 tests green twice in a row and in each pre-commit hook; E2E green against the build.
Mutation check: every classifier branch and every App/Settings condition (first-run Settings, pause trigger, closed pause, Cancel only when configured, persisted() guard, persist(), trim, failure path, setChecking reset, saveSettings) fails a test, except `mode: "no-cors"` on the probe: Node's fetch reports every request as `cors` to msw, and a response synthesized by the msw service worker skips the CORS check, so only a real cross-origin server could tell. Not covered.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Settings screen (src/features/settings/settings.tsx) for the Sure URL and API key. Save runs checkConnection() (check.ts) with the candidate settings, passed per request through a new `settings` field of sureFetch's init so the engine keeps its own: a malformed or http URL (when the app is on https), offline, an unreachable host, a CORS block (told apart by a follow-up no-cors request, which needs no preflight), a 15 s timeout, a URL that is not Sure, a rejected key, a read-only key (DELETE of a random transaction id: Sure checks the write scope first, so 403 vs 404, nothing changes) and a server error each get their own message; nothing is stored on failure. A successful save calls saveSettings() (lifting a pause) and requests persistent storage unless it is already granted. App shows Settings on first run, from a header button, and whenever sync is paused by a 401/403, with an explanation; a paused Settings can be closed to keep entering offline, a "Sync paused" button leads back, and the next pause opens it again. Browser test files now run one at a time because they share the app db. README: API client override, the key check, persist on first save, test parallelism.
Risks / follow-ups: the scope probe relies on Sure's before_action order (comment on TASK-16 to contract-test it); the no-cors mode of the CORS probe is untested outside a real browser; switching to another Sure instance keeps the old cache and outbox (queued records then target unknown accounts, TASK-19); the pause screen does not show the head record's lastError.
<!-- SECTION:FINAL_SUMMARY:END -->
