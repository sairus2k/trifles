---
id: TASK-5
title: 'Local database: Dexie schema and Solid live query bridge'
status: Done
assignee:
  - '@claude'
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T14:59:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-1
references:
  - README.md
priority: high
type: feature
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The app is offline-first: the UI reads and writes only the local database, the network is a background concern. A bridge from Dexie live queries to Solid 2 signals lets screens update as soon as the outbox or cache changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Tables and keys match README → Local schema (accounts, categories, merchants, transactions, suggestions, outbox, meta)
- [x] #2 `createLiveQuery()` updates a Solid signal on every change and unsubscribes on cleanup
- [x] #3 A query with a reactive parameter re-subscribes when the parameter changes
- [x] #4 Tests run against real IndexedDB in Vitest browser mode
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Approved 2026-11-01.

Research findings:
- The node Vitest project resolves solid-js through the node condition to dist/server.dev.js, which is not reactive (effects never run). ssr.resolve.conditions [browser, development] fixes Solid but breaks msw/node; an alias of solid-js to dist/solid.dev.js works but points outside the package exports.
- The browser project runs Dexie on real IndexedDB with the client Solid build and needs no config change (spiked: initial value, update on put, re-subscribe on parameter change). Browser run ~1.9 s against ~0.7 s for node; Chromium already starts on every commit.
- Solid 2 rc.20 ships from(): an Observable becomes an AsyncIterable for createMemo, and the source closes on supersede and on owner disposal (spiked: 2 subscribes, 2 unsubscribes).
- Signals read inside the Dexie querier are not tracked; reactive parameters must be read in the memo body.
- Sure removed category classification; the API does not return it, so README's categories column is stale.
- Browser test files run in parallel and probably share one origin, so a fixed-name database would clash across files.

Decisions (user): TASK-5 tests run in Vitest browser mode on real IndexedDB (AC #4 reworded); whether sync tests keep fake-indexeddb is decided when planning TASK-6. createLiveQuery uses createMemo + from (recommended; the user did not object).

1. src/db/schema.ts, test first (src/db/schema.browser.test.tsx): db = new Dexie("sure-quick-entry") typed with EntityTable; version 1 stores accounts id, categories id, merchants id, transactions id + date + accountId, suggestions merchantName, outbox clientId, meta key. Record types follow README columns; categories without classification; timestamps as epoch ms; outbox op/status as literal unions, payload unknown. The test checks tables, primary keys and indexes and is the only file touching the shared db. Same commit: drop classification from README categories, note in README → Testing that schema and bridge tests run in browser mode, remove src/db/.gitkeep.
2. src/db/live.ts, test first (src/db/live.browser.test.tsx): createLiveQuery(query) and createLiveQuery(source, query) returning createMemo(() => from(liveQuery(() => query(source())))). The test uses its own uniquely named Dexie database and covers the initial value, updates on put and delete, unsubscribe on unmount and re-subscribe on parameter change, counting subscriptions through vi.mock("dexie"). Same commit: README → Solid ↔ Dexie bridge (Loading / Errored semantics).
3. typecheck, lint, format, test and build pass.

Out of scope: outbox indexes (TASK-7), API → record mapping (TASK-9), storage.persist() (TASK-15), meta → configureSure() (TASK-11).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Browser mode: importOriginal() in vi.mock("dexie") returns a namespace without liveQuery (also cmp, DexieYProvider), so the test mock calls Dexie.liveQuery from the class, as Dexie's import wrapper does.
Verification (2026-11-01): schema test reads stores and indexes back from Chromium's IndexedDB; 4 bridge tests (updates on put/delete, unsubscribe on dispose, re-subscribe on parameter change with 2 opened / 2 closed, Loading fallback then unsubscribe on unmount). Full suite 103 passed; typecheck, lint, format:check and build pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the local database and the Dexie → Solid bridge.

src/db/schema.ts: db ("sure-quick-entry") version 1 with the seven tables and keys from README → Local schema (transactions indexed on date and accountId) and typed records. Categories drop classification, which Sure removed and the API no longer returns; timestamps are epoch ms; outbox payload stays unknown for TASK-7.

src/db/live.ts: createLiveQuery(query) and createLiveQuery(source, query) return createMemo(() => from(liveQuery(...))). Solid 2's from() closes the subscription when the memo re-runs and on disposal; the accessor is pending until the first result (<Loading>) and errors reach <Errored>. Reactive parameters go through source because Dexie runs the query outside Solid's tracking.

Tests run in Vitest browser mode on real IndexedDB (AC #4 reworded with the user): the node project resolves solid-js to its non-reactive server build, and forcing the browser condition there breaks msw/node. The bridge test uses its own uniquely named database because browser test files run in parallel. README: categories row, Testing note and the bridge section rewritten.

Checks: 103 tests, typecheck, lint, format and build pass.

Follow-ups: decide at TASK-6 whether sync tests keep fake-indexeddb in Node or move to browser mode; outbox indexes for queue order (TASK-7); test isolation once several browser test files import the shared db.
<!-- SECTION:FINAL_SUMMARY:END -->
