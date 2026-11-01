---
id: TASK-17
title: Local quality gates with lefthook
status: Done
assignee:
  - '@claude'
created_date: '2026-11-01T13:35:00Z'
updated_date: '2026-11-01T13:45:00Z'
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
- [x] #1 `npm install` installs the git hooks automatically; `lefthook` is a devDependency with an exact version
- [x] #2 A commit is rejected when staged files fail `oxlint` or `oxfmt --check`
- [x] #3 A commit is rejected when `npm run typecheck` or `npm test` (Node and browser projects) fails
- [x] #4 README → Getting started describes the hooks and what each one runs
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Decisions (user, 2026-11-01): every check runs on pre-commit, no pre-push hook; typecheck and tests are skipped for Markdown-only commits; AGENTS.md gets a "do not bypass the hook" gotcha.

Research: `lefthook@2.2.2` postinstall runs `lefthook install` itself (skipped when `CI` is set), so no `prepare` script is needed. With default settings oxlint reports correctness rules as warnings and exits 0, so the hook needs `--deny-warnings`. `oxfmt --check` exits 2 when every given file is ignored (e.g. a backlog-only commit), so it needs `--no-error-on-unmatched-pattern`.

1. `npm i -D -E lefthook@2.2.2`.
2. `lefthook.yml`: `pre-commit`, parallel: `oxlint --deny-warnings {staged_files}` (JS/TS glob), `oxfmt --check --no-error-on-unmatched-pattern {staged_files}` (glob of oxfmt-supported extensions), `npm run typecheck` and `npm test` with `exclude` for `*.md` so Markdown-only commits skip them.
3. README → Getting started: what the hook runs, Chromium requirement, emergency bypass. AGENTS.md → Gotchas: do not bypass the hook.
4. Verify: hooks reinstall on `npm install`; commit rejected on lint warning, unformatted file, type error, failing test; Markdown-only commit skips typecheck/tests.
5. Commit `chore: add lefthook pre-commit checks` to `main` (no push).

Revision during implementation: no globs for lint/format. Both `oxlint` and `oxfmt` accept `--no-error-on-unmatched-pattern`, skip file types they do not handle and apply their own ignore patterns, so `{staged_files}` is passed as is. The rule against bypassing the hook went into AGENTS.md → Git, next to the commit rules, not Gotchas.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification (2026-11-01):
- AC1: deleted `.git/hooks/*` (non-sample), ran `npm ci`; lefthook postinstall recreated `pre-commit`.
- AC2: `git commit` of a file with `debugger` was rejected by `lint` (`eslint(no-debugger)` warning, `--deny-warnings`); `export const x={a:1}` was rejected by `format`.
- AC3: `const n: number = "s"` was rejected by `typecheck` (TS2322); a failing Vitest test was rejected by `test`; the test job ran 3 files (node `test/setup.test.ts`, browser `src/app.browser.test.tsx`, the probe). HEAD unchanged after every probe.
- Markdown-only staged change (backlog file with spaces in its name): `typecheck` and `test` skipped ("no matching staged files"), `lint` and `format` passed.
- AC4: README → Getting started → "Pre-commit hook" table.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added lefthook 2.2.2 (exact devDependency) with a single `pre-commit` hook: `oxlint --deny-warnings` and `oxfmt --check` on staged files, plus `npm run typecheck` and `npm test` (Node and browser) on the whole project, all in parallel; typecheck and tests are skipped for Markdown-only commits. The hook is installed by lefthook's postinstall, so `npm install`/`npm ci` sets it up. It is the only automatic gate until CI (TASK-2) lands after the MVP; there is no pre-push hook by decision.

Docs: README → Getting started describes the hook, Chromium requirement and emergency bypass; AGENTS.md → Git forbids agents from bypassing it.

Risks: typecheck and tests see the working tree, not only staged content, so unstaged edits can make a commit pass or fail spuriously; every code commit starts Chromium for the browser tests, which will grow with the suite.
<!-- SECTION:FINAL_SUMMARY:END -->
