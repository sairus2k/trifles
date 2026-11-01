---
id: TASK-21
title: Switching to another Sure instance
status: To Do
assignee: []
created_date: '2026-11-01T16:50:00Z'
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
