---
id: TASK-1
title: 'Scaffold the app: Vite 8, Solid 2, TypeScript 7'
status: Done
assignee:
  - '@claude'
created_date: '2026-11-01T08:51:00Z'
updated_date: '2026-11-01T09:10:00Z'
labels: []
milestone: m-0
dependencies: []
references:
  - README.md
priority: high
type: chore
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The repository has only the design document. Every other task needs a buildable, testable project skeleton. Solid 2 is a release candidate: `solid-js@latest` is 1.x and the `latest` tag of `@solidjs/web` lags behind, so a plain `npm i` installs an incompatible mix. `vite-plugin-pwa` does not support Vite 9.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every dependency from README → Tech stack is installed with the exact pinned version (no `^` or `~` for Solid packages)
- [x] #2 `npm run dev`, `npm run build`, `npm test` and `npm run test:e2e` exist and succeed on an empty app shell
- [x] #3 Vitest runs both Node tests (with `fake-indexeddb`) and browser-mode component tests via `@vitest/browser-playwright`
- [x] #4 Faker is seeded in the test setup so generated data is deterministic
- [x] #5 Directory layout follows README → Project structure
- [x] #6 oxlint and oxfmt run with default settings; Claude Code hooks format edited files and run the fixer on stop
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Research (2026-11-01): every pinned version in README → Tech stack exists on npm; peer ranges are compatible (vitest 5.0.5 and vite-plugin-pwa 2.0.0 accept vite ^8, @solidjs/vite-plugin 3.0.0-next.54 needs solid-js/@solidjs/web >= rc.19, msw 3 accepts TS >= 5.9). typescript@7.0.2 is the native compiler: `tsc` binary, no classic JS API (Vite 8 transpiles with oxc, so not needed). Local Node 26.1.0 satisfies all engines (strictest: orval >= 22.18).

1. package.json (type: module, engines node >= 22.18) and .npmrc with save-exact=true. Install all Tech stack packages with exact versions, Solid packages via explicit @2.0.0-rc.20 / @3.0.0-next.54. Add `playwright@1.64.1` (peer of @vitest/browser-playwright, same version as @playwright/test). Commit package-lock.json. .gitignore: node_modules, dist, test-results, playwright-report.
2. Classic SPA mode, not the plugin's turnkey `start: true` (keeps README structure and static dist/): index.html → src/main.tsx (render from @solidjs/web) → src/app.tsx with a minimal shell.
3. vite.config.ts: @solidjs/vite-plugin; Vitest config with two projects: `node` (environment node, setupFiles fake-indexeddb/auto + test/setup.ts, include src/**/*.test.ts and test/**/*.test.ts) and `browser` (browser mode, provider playwright() from @vitest/browser-playwright, chromium headless, include src/**/*.browser.test.tsx, setupFiles test/setup.ts).
4. tsconfig.json for TS 7: jsx preserve, jsxImportSource @solidjs/web, moduleResolution bundler, strict, noEmit, explicit types (vite/client, browser provider types); no baseUrl (removed in TS 7).
5. test/setup.ts: faker.seed(<constant>) in beforeEach so data is deterministic per test regardless of order.
6. Smoke tests: node test (Dexie/indexedDB works under fake-indexeddb + faker determinism), browser test rendering <App/> with @solidjs/testing-library, e2e test that the built app loads.
7. playwright.config.ts: testDir e2e, webServer = build + vite preview on a fixed port, chromium.
8. Scripts: dev, build, preview, typecheck (tsc --noEmit), test (vitest run), test:e2e (playwright test). gen:api stays in TASK-3.
9. Directory layout from README → Project structure with .gitkeep in dirs whose content belongs to later tasks (spec/, src/api, src/db, src/sync, src/domain, src/features/{entry,recent,balances,settings}, test/fake-sure).
10. Out of scope (installed only, configured later): orval config/gen:api (TASK-3), Dexie schema (TASK-5), MSW fake (TASK-6), vite-plugin-pwa config (TASK-15), CI + solid-migration-assistant (TASK-2).
11. Verify: npx playwright install chromium; npm run typecheck, build, test, test:e2e all green; grep package.json for ^/~. Update README (Getting started note, typecheck script). Commits per step 14.

12. Lint/format (oxc, defaults): devDeps oxlint@1.90.0 and oxfmt@0.75.0 (exact). No .oxlintrc (default correctness rules). .oxfmtrc.json holds only ignorePatterns for backlog/** (managed by the Backlog CLI) — no style options. Scripts: lint (oxlint), format (oxfmt), format:check (oxfmt --check). No git hooks (user decision 2026-11-01).
13. Claude Code hooks, modelled on mef-frontend .claude/: .claude/settings.json + .claude/hooks/*.sh — PostToolUse(Write|Edit) formats the edited file with oxfmt; Stop formats and runs oxlint --fix on changed/untracked files and prints surviving errors; PreToolUse(Bash) blocks prettier.
14. Commits: (a) chore: scaffold app; (b) chore: add oxlint, oxfmt and Claude Code hooks; (c) style: format repo with oxfmt (first run touches README.md / AGENTS.md). README → Tech stack and Getting started list the new tools and scripts.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified 2026-11-01 on Node 26.1.0: typecheck, lint, format:check, build, npm test (node: 2, browser chromium: 1) and test:e2e (1) pass; dev server serves the transformed app. Extra devDeps beyond README: playwright@1.64.1 (peer of @vitest/browser-playwright) and @types/node@22.20.5 (engine floor). orval pulls a nested typescript@6.0.3 via @orval/hono and @orval/zod; npm audit reports 10 low/moderate transitive issues (glob, minimatch, deepmerge). Hooks are agent-only (Claude Code), no git hooks, per user.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Scaffolded the app: Vite 8.3.5 + Solid 2.0.0-rc.20 + TypeScript 7.0.2 in classic SPA mode (index.html → src/main.tsx → src/app.tsx, static dist/). All dependencies are pinned exactly (.npmrc save-exact). Vitest runs a node project with fake-indexeddb and a browser project via @vitest/browser-playwright; faker is reseeded before every test. Playwright E2E runs against vite preview. README → Project structure directories exist (.gitkeep where later tasks add content). Added oxlint and oxfmt with default settings plus Claude Code hooks (format on Write/Edit, format + oxlint --fix on Stop, prettier blocked). Commits: 41e8636, 26ad2c1, f29b601. Follow-ups: CI (TASK-2) should also run lint and format:check; TASK-3 must add src/api/generated/** to .oxfmtrc.json ignorePatterns.
<!-- SECTION:FINAL_SUMMARY:END -->
