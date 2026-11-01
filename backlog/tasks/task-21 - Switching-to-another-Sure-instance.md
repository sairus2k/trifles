---
id: TASK-21
title: Switching to another Sure instance
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-01T16:50:00Z'
updated_date: '2026-11-01T20:42:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-11
references:
  - README.md
priority: medium
type: feature
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Settings (TASK-11) saves a new URL like a new key: it lifts the pause and nothing else. The local cache (accounts, categories, merchants, transactions, suggestions) and the outbox were built against the old instance. After a switch the app shows the old balances and history until the next pull replaces them, the merchant suggestions keep old ids, and queued records carry `account_id`s the new instance does not have: Sure answers `500` for an unknown account, push retries it forever and the head holds the queue (TASK-19). Rotating the key of the same instance must keep everything, so the switch is detected by the URL; two URLs for the same instance (an alias, a trailing path) cannot be told apart, so the user should be told what a URL change does.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Saving a URL different from the saved one is treated as a switch; saving a new key for the same URL keeps the cache and the outbox
- [ ] #2 After a switch the app shows no account, transaction, category, merchant or suggestion from the old instance
- [ ] #3 Unsent records of the old instance are never sent to the new one without an explicit choice by the user, who is told how many entries are affected
- [ ] #4 Component tests cover a key rotation, a switch with an empty outbox and a switch with unsent records
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Research:
- `saveSettings()` (src/sync/settings.ts) writes `baseUrl`/`apiKey` to `meta` and clears `syncPausedAt`; nothing else. The engine (src/sync/engine.ts) learns about it through `liveQuery(readSyncConfig)`, calls `configureSure()` (module-global in src/api/http.ts) and requests a full run. `referencePulled` is a per-session boolean, so after a URL change categories and merchants are never re-pulled until a reload.
- Cache that belongs to an instance: `accounts`, `categories`, `merchants`, `transactions`, `suggestions` (upserted, never cleared by a pull), the whole `outbox`, and `meta.entryAccountId` (src/features/entry/entry.tsx; the form already shows a fallback when there are no accounts).
- Push and pull run under the `outbox` Web Lock. Nothing else serialises with them, so a URL saved mid-run has three races: (a) `configureSure()` switches the global mid-push, and the next claimed record of the old instance goes to the new one (breaks AC #3); (b) a pull that fetched from the old instance writes its result after the cache was cleared (breaks AC #2); (c) a run that was waiting for the lock starts before this tab's liveQuery has fired and still uses the old global settings.
- Pull GETs (src/sync/pull.ts) have no timeout, unlike push (30 s) and Settings' check (15 s). A hanging old instance would hold the lock, and so the switch, forever.
- The description is partly outdated: since TASK-19 a create for an unknown account answers 500 → `GET /accounts/{id}` 404 → `failed`, so it no longer holds the queue. Old records sent to another instance still go wrong: creates and transfers fail with "account no longer in Sure", updates fail with 404, and a delete's 404 is taken as success.
- The URL is used as `baseUrl.replace(/\/+$/, "") + path`, so `https://x` and `https://x/` hit the same API; URL parsing also lowercases the host and drops a default port.

Rules:
- Same instance = equal after normalisation: `URL.parse`, `origin` + `pathname` without trailing slashes. Anything else (another host, another path, http vs https) is a switch. A key change for the same URL keeps everything (AC #1).
- A switch runs under the `outbox` lock, so no sync run of any tab is in flight: it waits for the current one (bounded once pulls time out), and the runs that queue behind it see the new settings.
- Inside the lock and in one Dexie transaction: clear the five cache tables and the outbox, delete `entryAccountId`, store the settings, lift the pause (AC #2).
- Unsent = outbox records not `done` (pending, sending, failed). The switch counts them inside the lock and refuses when there are more than the caller allowed, returning the count. The UI first calls it allowing 0; with unsent records it shows the count and lets the user choose, then calls it again allowing that count. A record added by another tab in between makes it refuse again, so nothing is dropped without being counted (AC #3).
- The choice (AC #3): "Delete N entries and switch" (the switch above), "It's the same Sure, keep them" (the key-rotation path: `saveSettings()`, nothing cleared, the records go to the new URL), or Cancel (nothing saved). Under the URL field, while settings exist, a one-line hint says that a different address starts over with that Sure's data.
- The engine re-reads the settings from `meta` inside the lock at the start of every run and calls `configureSure()` there, and pulls reference data whenever the URL differs from the one it last pulled for (`referencePulledFor`), so the "keep" path refreshes categories and merchants too.

1. `fix: time out pull requests`
   - src/sync/pull.ts: every GET gets `{ signal: AbortSignal.timeout(30_000) }`, as push does.
   - src/sync/pull.test.ts: a `"hang"` on `GET /api/v1/accounts` fails the pull with a network `SureError` and leaves the cache as it was (spy on `AbortSignal.timeout` like push.test.ts).
2. `feat: clear the local data when switching to another Sure instance`
   - src/sync/outbox.ts: export `SYNC_LOCK = "outbox"`; src/sync/engine.ts uses it.
   - src/sync/settings.ts: `sameInstance(a, b)`; `switchInstance(settings, allowedUnsent): Promise<{ unsent: number } | undefined>` with the rules above.
   - src/sync/engine.ts: `sync()` reads `readSyncConfig()` inside the lock, returns without settings or while paused, calls `configureSure()`; `referencePulled` becomes `referencePulledFor`. The liveQuery only triggers runs.
   - src/features/settings/settings.tsx: after a successful check, `saveSettings()` on first run or for the same instance; otherwise `switchInstance(next, 0)`, and on a refusal a confirmation panel in place of the buttons: "N entries have not been sent to <old host>." with the three choices. The button reads "Saving…" while the switch waits for the lock. The URL hint.
   - test/fake-sure/index.ts: optional base URL in `createFakeSure()` (default `FAKE_SURE_URL`), for a second instance.
   - Tests:
     - src/sync/settings.test.ts: `sameInstance` (trailing slash, host case, default port, other path, other scheme, other host); `switchInstance` clears every cache table, the outbox and `entryAccountId` and lifts the pause; refuses with the count when unsent > allowed and changes nothing; drops `done` records without counting them; waits while the lock is held.
     - src/sync/engine.test.ts, two fakes: after a switch the next run pulls accounts, categories and merchants from the new instance and sends nothing to either; a run queued while the switch holds the lock uses the new URL and key (race c); a run in flight when Save is pressed finishes against the old instance before the cache is cleared (races a, b); the "keep" path sends the old records to the new URL and pulls reference data again.
     - src/features/settings/settings.browser.test.tsx (AC #4): key rotation keeps cache and outbox; a switch with an empty outbox clears the cache without asking; a switch with unsent records shows their count, and "Delete" clears them, "Same Sure" keeps them with the new URL saved, Cancel keeps the old settings and everything else.
     - src/app.browser.test.tsx: with a seeded cache, a switch through Settings leaves the main screen without the old accounts and recent transactions (AC #2).
   - README.md: Scope → Settings, Sync engine rules (new "Switching instance" bullet; the engine reads the settings inside the lock), Testing → required scenarios.
   - Run `npm test`; the pre-commit hook runs lint, format, typecheck and tests.
3. `chore: finish TASK-21` (check ACs with test names as evidence, final summary).

Not changed: the schema (no instance id stored per record), checkConnection, e2e. Detecting an alias automatically (cached account ids found on the new URL) is left out: the description asks to tell the user instead, and the "same Sure" choice covers it.
<!-- SECTION:PLAN:END -->
