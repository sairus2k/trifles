---
id: TASK-5
title: 'Local database: Dexie schema and Solid live query bridge'
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
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
- [ ] #4 Tests run against `fake-indexeddb`
<!-- AC:END -->
