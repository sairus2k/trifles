---
id: TASK-18
title: Trim README to what the code does not already say
status: To Do
assignee: []
created_date: '2026-11-01T15:32:00Z'
labels: []
dependencies: []
documentation:
  - README.md
priority: low
type: chore
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
README.md was written as the design document before anything was scaffolded. Much of it now duplicates what is already implemented and readable in the app itself (project structure, Dexie schema, API client details, the Solid/Dexie bridge, finished design decisions), so it drifts from the code and costs time to keep in sync. The README should keep only what a reader cannot get from the code: purpose, scope, non-obvious constraints and rationale, setup, and the design of parts that are not built yet.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Sections that only describe already implemented design visible in `src/` are removed or reduced to a pointer to the code
- [ ] #2 Purpose, scope, getting started, deployment, security and the rationale behind rejected alternatives (README → Why these choices) stay
- [ ] #3 Design for not-yet-implemented parts (sync push/pull/engine, screens, PWA) stays until that work lands
- [ ] #4 Every link to a README section from `AGENTS.md` and Backlog tasks still resolves, and `AGENTS.md` → Project no longer calls README the full design document if that stops being true
<!-- AC:END -->
