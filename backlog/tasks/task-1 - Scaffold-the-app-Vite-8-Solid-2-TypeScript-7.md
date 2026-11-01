---
id: TASK-1
title: 'Scaffold the app: Vite 8, Solid 2, TypeScript 7'
status: To Do
assignee: []
created_date: '2026-11-01T08:51:00Z'
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
- [ ] #1 Every dependency from README → Tech stack is installed with the exact pinned version (no `^` or `~` for Solid packages)
- [ ] #2 `npm run dev`, `npm run build`, `npm test` and `npm run test:e2e` exist and succeed on an empty app shell
- [ ] #3 Vitest runs both Node tests (with `fake-indexeddb`) and browser-mode component tests via `@vitest/browser-playwright`
- [ ] #4 Faker is seeded in the test setup so generated data is deterministic
- [ ] #5 Directory layout follows README → Project structure
<!-- AC:END -->
