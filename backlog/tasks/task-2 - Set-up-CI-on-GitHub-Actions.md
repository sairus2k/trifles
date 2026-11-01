---
id: TASK-2
title: Set up CI on GitHub Actions
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-1
priority: medium
type: chore
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Commits go straight to `main` without PRs, so CI is the only automatic gate. AI assistants mostly know Solid 1 and suggest removed APIs; README asks to run `solid-migration-assistant` in CI to catch that.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every push to `main` runs typecheck, build and unit/component tests
- [ ] #2 `npx solid-migration-assistant` runs in CI and fails the build on Solid 1 APIs
- [ ] #3 Playwright browsers are installed in CI so browser-mode tests run
<!-- AC:END -->
