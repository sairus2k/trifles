---
id: TASK-17
title: Local quality gates with lefthook
status: To Do
assignee: []
created_date: '2026-11-01T13:35:00Z'
updated_date: '2026-11-01T13:37:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-1
priority: high
type: chore
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Commits go straight to `main` and CI (TASK-2) is deferred until after the v1 MVP, so git hooks are the only automatic gate until then. The Claude Code hooks from TASK-1 only format and lint files Claude edits; they run no typecheck or tests and do not block commits made any other way. This reverses the "no git hooks" decision recorded in TASK-1.

The typecheck is also the guard against Solid 1 code from AI assistants: removed Solid 1 APIs are not exported or typed in Solid 2, so `tsc` rejects them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `npm install` installs the git hooks automatically; `lefthook` is a devDependency with an exact version
- [ ] #2 A commit is rejected when staged files fail `oxlint` or `oxfmt --check`
- [ ] #3 A push is rejected when `npm run typecheck` or `npm test` (Node and browser projects) fails
- [ ] #4 README → Getting started describes the hooks and what each one runs
<!-- AC:END -->
