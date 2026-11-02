---
id: TASK-18
title: Trim README to what the code does not already say
status: Done
assignee:
  - '@claude'
created_date: '2026-11-01T15:32:00Z'
updated_date: '2026-11-02T08:55:00Z'
labels: []
milestone: m-1
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
- [x] #1 Sections that only describe already implemented design visible in `src/` are removed or reduced to a pointer to the code
- [x] #2 Purpose, scope, getting started, deployment, security and the rationale behind rejected alternatives (README → Why these choices) stay
- [x] #3 Design for not-yet-implemented parts (sync push/pull/engine, screens, PWA) stays until that work lands
- [x] #4 Every link to a README section from `AGENTS.md`, code comments, test names and open Backlog tasks still resolves (Done tasks keep the README they were closed against), and `AGENTS.md` → Project no longer calls README the full design document if that stops being true
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Research (2026-11-02): every v1 task except TASK-2 (CI) and TASK-23 (iPhone check) is Done, so AC #3 protects nothing any more; the sync rules, schema, bridge, mutator, list and balance rules are all in src/ with comments that repeat README almost word for word. Rule for every sentence: remove it only if its "why" already lives in code, AGENTS.md or spec/README.md; otherwise it stays.

1. Keep as is: title, Why, Principles, Scope (v1 / Not in v1), Transfers, Why these choices, Getting started + Pre-commit hook, Deployment, Security, Roadmap, License.
2. Architecture: keep the diagram, annotate each box with its module path (src/features, src/db/schema.ts, src/sync/push.ts…), then drop "Project structure" (the tree only restates directory names; sw-plugin.ts / tsconfig.sw.json / public notes are in those files).
3. Data flow for a new transaction: keep (cross-module, server-clock reasoning), tighten to the four steps with pointers to outbox.ts pendingDeltas()/dropFinished.
4. Local schema (Dexie): remove the table, one line pointing to src/db/schema.ts. Rename the test in src/db/schema.browser.test.tsx ("match README → Local schema") so it no longer cites a deleted section.
5. Sync engine rules: replace prose with a compact list, one line per rule with its owning file: triggers + offline (engine.ts), one worker / Web Lock (engine.ts, outbox.ts), pause (settings.ts), switching instance (settings.ts, Settings screen), strict order + editing pending/synced records (outbox.ts), idempotency, status → outcome incl. the 500 → account lookup → write probe chain (push.ts), pull cadence (engine.ts, pull.ts). Keep "no Background Sync API" (also in AGENTS.md). Fix the Scope → Settings bullet that links "Sync engine rules → Switching instance".
6. Sure API notes: keep (Sure behaviour, referenced by orval.config.ts and Backlog). Reduce "Spec issues" to a pointer to spec/README.md → Known issues.
7. Tech stack: keep the exact-version warning and the table of areas/packages with constraint notes (Vite 8 because of Vitest 5.0, oxfmt Tailwind sorting); drop the Version column and the "as of" date in favour of package.json, which already pins exact versions. AGENTS.md → Gotchas link to "README → Tech stack" keeps resolving.
8. Implementation notes: remove API client (orval.config.ts copied verbatim; mutator contract is in src/api/http.ts and AGENTS.md), Solid ↔ Dexie bridge (src/db/live.ts comments say the same), Solid 2 gotchas (AGENTS.md → Gotchas; move the one non-obvious line "typecheck rejects removed Solid 1 APIs, no migration analyzer needed" into Why these choices → Solid 2, since TASK-2 weighs adding that analyzer), Recent list (src/features/recent/rows.ts), Balances (src/features/balances/rows.ts, src/domain/currency.ts). Mobile details: drop bullets already in index.html / settings.tsx / AGENTS.md (persist, theme-color, status bar, dates, calculator); keep only bullets with no code home (check 44 px / 16 px and the operator row first). If the section empties, point TASK-23's description at index.html instead of README → Mobile details.
9. Testing: keep effort-follows-risk, the five layers, why sync tests are Node-only and browser files run serially, and how/when to run contract tests; drop the fake's feature list (test/fake-sure/index.ts) and the required-scenario lists (the tests themselves). Keep the note on orval MSW mocks.
10. Getting started → Updating the Sure spec: replace the duplicated commands with a pointer to spec/README.md → Updating.
11. AGENTS.md → Project: drop "nothing is scaffolded yet" and "README is the design document"; say README holds purpose, scope, Sure API behaviour, the sync overview and rationale, code is the reference for the rest, and divergences still update README in the same commit.
12. Verify: grep README references in AGENTS.md, src/, test/, e2e/, *.ts and open tasks (TASK-2, TASK-23) and check each target heading exists; check README's own #anchors (#transfers, #v1); npm run format:check; commit passes lefthook (typecheck + tests run because of the .tsx rename).

Commits: (a) docs: trim README to what the code does not say (README, AGENTS.md, test title, TASK-23 if touched); (b) separately, docs: README status line and Contributing no longer say "design phase" / "once the scaffold is in place" (both stale).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Deviations from the plan: Implementation notes is gone; Mobile details became a top-level section with the three bullets that have no comment in code (safe-area utilities, 44 px / 16 px, operator row), so TASK-23's "README → Mobile details" still resolves; TASK-23's status-bar reference now points at index.html. "No totals" moved from Balances into Scope → v1, since no code comment says it. Verified: every "README → X" in AGENTS.md, src/, test/, e2e/, *.ts and open tasks (TASK-2, TASK-23) matches a heading; #transfers and #v1 anchors exist; oxfmt clean; pre-commit hook ran typecheck and 449 tests green.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
README trimmed from 409 to 244 lines (5d507ec). Removed sections the code and its comments now explain: Local schema, Project structure, API client, Solid ↔ Dexie bridge, Solid 2 gotchas, Recent list, Balances, the fake's feature list and the test scenario lists. Sync engine rules became a one-line-per-rule summary naming the owning file; the architecture diagram names module paths. Kept: purpose, scope, data flow, Transfers, Sure API notes, tech stack constraints (versions now live only in package.json), Why these choices (gained the Solid 1 → typecheck note), testing strategy, getting started, deployment, security. AGENTS.md → Project no longer calls README the design document of an unscaffolded app; the schema browser test no longer cites a removed section. Separate commit fd3ae8c fixes the stale "design phase" status and Contributing line. Done tasks keep their historical README references by design (AC #4). Follow-up seen, not done: TASK-2 notes still say the Dexie bridge uses onCleanup, which src/db/live.ts no longer does.
<!-- SECTION:FINAL_SUMMARY:END -->
