---
id: TASK-5
title: 'Local database: Dexie schema and Solid live query bridge'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T14:56:00Z'
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
- [ ] #1 Tables and keys match README → Local schema (accounts, categories, merchants, transactions, suggestions, outbox, meta)
- [ ] #2 `createLiveQuery()` updates a Solid signal on every change and unsubscribes on cleanup
- [ ] #3 A query with a reactive parameter re-subscribes when the parameter changes
- [ ] #4 Tests run against real IndexedDB in Vitest browser mode
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
