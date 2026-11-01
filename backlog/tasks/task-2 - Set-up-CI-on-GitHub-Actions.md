---
id: TASK-2
title: Set up CI on GitHub Actions
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T18:36:00Z'
labels: []
milestone: m-1
dependencies:
  - TASK-1
priority: low
type: chore
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Commits go straight to `main` without PRs, so after the v1 MVP CI becomes the automatic gate in addition to the local git hooks (TASK-17).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every push to `main` runs typecheck, build and unit/component tests
- [ ] #2 Playwright browsers are installed in CI so browser-mode tests run
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Deferred until after the v1 MVP (decision 2026-11-01): until then the gate is local git hooks (see the lefthook task). Research for when this is picked up:
- `solid-migration-assistant@0.2.1` exits 0 even when it reports findings (README of the package, `shared/run-workflow.mjs` passes codemod status through). Findings go to stdout, progress to stderr, so the gate must fail on non-empty stdout or a non-zero exit.
- It targets Solid `2.0.0-rc.0` and flags every one-argument `onCleanup` and `createDeferred` from `solid-js`, which are still valid exports in rc.20. The Dexie bridge from README (TASK-5) uses `onCleanup`, so a strict gate needs an allowlist or a decision there.
- TypeScript already rejects most Solid 1 APIs (`createResource`, `batch`, `Suspense` are not exported; `createEffect` requires two arguments), so the analyzer mostly adds coverage for semantic changes (`createMemo` initial value, `classList`, `on:`/`use:`, `onMount`, `mergeProps`/`splitProps`).
- It depends on `codemod@1.12.13` with a ~146 MB native binary (linux-x64-gnu available).
- Current action majors: `actions/checkout@v7`, `actions/setup-node@v7`.

Decision 2026-11-01: `solid-migration-assistant` is dropped. A probe file with Solid 1 code (`batch`, `createResource`, `onMount`, `mergeProps`, `splitProps`, `Suspense`, `Index`, `createComputed`, `on`, `solid-js/web`, `solid-js/store`, one-argument `createEffect`, `createMemo(fn, 0)`, `Ctx.Provider`, `classList`, `on:`/`attr:`/`use:`) fails `npm run typecheck` at every site, so the analyzer adds nothing but false positives.
<!-- SECTION:NOTES:END -->
