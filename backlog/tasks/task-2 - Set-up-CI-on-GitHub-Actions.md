---
id: TASK-2
title: Set up CI on GitHub Actions
status: Done
assignee:
  - '@claude'
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-02T18:30:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-1
  - TASK-26
priority: high
type: chore
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Commits go straight to `main` without PRs, so after the v1 MVP CI becomes the automatic gate in addition to the local git hooks (TASK-17).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every push to `main` runs typecheck, build and unit/component tests
- [x] #2 Playwright browsers are installed in CI so browser-mode tests run
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add `.github/workflows/ci.yml`: on push to `main`, one job on ubuntu-latest with Node 26 (matches local dev, satisfies engines >=22.18) and the npm cache: `npm ci`, whole-project `oxlint --deny-warnings` and `oxfmt --check` (the hook only sees staged files), typecheck, build, `playwright install --with-deps chromium`, `npm test`.
2. E2E and contract tests stay out of scope (not in the acceptance criteria; contract tests need Docker and a 1 GB image).
3. Update the "only automatic gate" wording in `lefthook.yml`, AGENTS.md and README → Pre-commit hook.
4. Verify locally (`npm ci`-equivalent steps), commit, then confirm the first run on GitHub after push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Deferred until after the v1 MVP (decision 2026-11-01): until then the gate is local git hooks (see the lefthook task). Research for when this is picked up:
- `solid-migration-assistant@0.2.1` exits 0 even when it reports findings (README of the package, `shared/run-workflow.mjs` passes codemod status through). Findings go to stdout, progress to stderr, so the gate must fail on non-empty stdout or a non-zero exit.
- It targets Solid `2.0.0-rc.0` and flags every one-argument `onCleanup` and `createDeferred` from `solid-js`, which are still valid exports in rc.20. The Dexie bridge from README (TASK-5) uses `onCleanup`, so a strict gate needs an allowlist or a decision there.
- TypeScript already rejects most Solid 1 APIs (`createResource`, `batch`, `Suspense` are not exported; `createEffect` requires two arguments), so the analyzer mostly adds coverage for semantic changes (`createMemo` initial value, `classList`, `on:`/`use:`, `onMount`, `mergeProps`/`splitProps`).
- It depends on `codemod@1.12.13` with a ~146 MB native binary (linux-x64-gnu available).
- Current action majors: `actions/checkout@v7`, `actions/setup-node@v7`.

Decision 2026-11-01: `solid-migration-assistant` is dropped. A probe file with Solid 1 code (`batch`, `createResource`, `onMount`, `mergeProps`, `splitProps`, `Suspense`, `Index`, `createComputed`, `on`, `solid-js/web`, `solid-js/store`, one-argument `createEffect`, `createMemo(fn, 0)`, `Ctx.Provider`, `classList`, `on:`/`attr:`/`use:`) fails `npm run typecheck` at every site, so the analyzer adds nothing but false positives.

Workflow written (`.github/workflows/ci.yml`); lint, format, typecheck and build pass in a clean clone. `npm test` is flaky there and in the main checkout, with or without `CI`: about one full run in three fails `src/db/live.browser.test.tsx` with `Cannot verify that chromium request interception is active after 5s; module mocks would not apply reliably (#8339)`, so its `vi.mock("dexie")` is dropped and all three tests fail. Upstream bug vitest-dev/vitest#11780 (open; the probe in @vitest/browser-playwright 5.0.4+ treats a slow answer from a busy main process as no interception); 5.1.0 has the same probe. The browser project alone passed every run (cold and warm), so the load comes from the node project running in parallel. It is the only browser test that uses `vi.mock`. Dexie's ESM wrapper copies `liveQuery` off the class at import, so the test cannot swap it at runtime instead.

First run on push of 4e45d47: https://github.com/sairus2k/trifles/actions/runs/41501035534, green in ~70s; all 23 test files (449 tests) passed, including the 8 browser-mode files in Chromium. Before pushing, a flaky `npm test` was found and fixed in TASK-26 (vi.mock dropped under load) plus a race in three editor tests.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added `.github/workflows/ci.yml`: every push to `main` runs `npm ci`, whole-tree `oxlint --deny-warnings` and `oxfmt --check`, typecheck, build, installs Chromium with system deps and runs `npm test` (node and browser projects) on Node 26. Updated the "only automatic gate" wording in `lefthook.yml`, AGENTS.md and README → Pre-commit hook. E2E and contract tests are not in CI (out of scope; contract tests need Docker). Verified by the first GitHub run (run 41501035534, green, 449 tests). The flakiness found on the way is fixed in TASK-26.
<!-- SECTION:FINAL_SUMMARY:END -->
