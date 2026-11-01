---
id: TASK-3
title: Vendor the Sure OpenAPI spec and generate the API client
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T13:53:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-1
references:
  - README.md
priority: high
type: feature
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The app talks to the Sure API directly, with no backend of its own. Types must come from the spec of the Sure version the instance runs. The generator is orval or kubb, decided in this task: `openapi-typescript` and stable `@hey-api/openapi-ts` break on TypeScript 7 because they take the compiler API from the project through a `typescript` peer dependency. orval works on TypeScript 7 but is a monolith that installs every generator plugin, including two nested copies of `typescript@6.0.3` (71 MB, 83 packages). kubb 5 installs only the plugins in use, has `typescript` as an optional peer and comes to 26 MB and 58 packages for cli + adapter-oas + plugin-ts + plugin-fetch. It also supports single-file output (`output.mode: 'file'`) and a result union discriminated by status (`throwOnError: false`), but it has not yet been run on the Sure spec under TypeScript 7. The Sure spec has three path parameters with `format` outside `schema`, which fails strict validation. A reverse proxy can answer 401 or 5xx with HTML, which generated types do not cover.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `spec/sure-openapi.yaml` is vendored and `spec/README.md` records the Sure commit it comes from
- [ ] #2 `npm run gen:api` regenerates `src/api/generated/` from the spec using the config in README → API client
- [ ] #3 The `sureFetch` mutator adds the instance URL and `X-Api-Key` from settings
- [ ] #4 The mutator checks `res.ok` and `content-type` before parsing JSON and returns a normalised error for HTML or non-JSON responses
- [ ] #5 Unit tests cover success, 401, 422, 5xx-with-HTML and network failure in the mutator
- [ ] #6 orval and kubb are both run on the vendored spec under TypeScript 7; the one kept generates a single file with responses typed as a union discriminated by status, and README → Tech stack, README → API client and AGENTS.md record the choice and why
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Approved 2026-11-01.

Research findings:
- Sure `131e786` is on upstream `main`; its `docs/api/openapi.yaml` is identical to current `main` (`5ed9103`) and differs from `v0.7.6` only in one description. The local `../sure` checkout is on a feature branch, so take the spec with `git show 131e786:docs/api/openapi.yaml`.
- The spec has 80 paths, 34 tags and no `operationId`.
- orval 8.46.0 spike (full spec, `mode: single`, `unsafeDisableValidation`): generates 10.6k lines / 300 KB, passes `tsc` 7. Generated functions are typed `Promise<xResponse>`, a union of declared statuses only (POST /transactions: 200 | 201 | 422), so the mutator cannot widen it: undeclared outcomes must be thrown.
- Generated output is unformatted and not ignored by oxfmt/oxlint.

Decisions (user): generate only tags Accounts, Transactions, Categories, Merchants (the full spec is vendored); no MSW mocks for now.

1. Vendor `spec/sure-openapi.yaml` from Sure `131e786`; `spec/README.md` records commit, date, update steps and known spec issues; remove `spec/.gitkeep`.
2. Spike orval and kubb 5 in the scratchpad on the vendored spec under TypeScript 7.0.2. Compare: generation and `tsc` pass, single file, status-discriminated union, how a custom fetch plugs in (base URL, headers, `SureError`), install size / package count in a clean dir, output size, naming.
3. Install the winner with exact versions (remove orval if kubb wins), add config + `gen:api`, commit `src/api/generated/sure.ts`, ignore it in oxfmt/oxlint. Same commit: README (Tech stack, Why these choices with measured numbers, API client, Getting started) and AGENTS.md.
4. `src/api/http.ts` mutator, tests first (`src/api/http.test.ts`): `configureSure({ baseUrl, apiKey })` module state (Dexie `meta` wiring is TASK-5/TASK-11). JSON + (2xx or 4xx except 401/429) -> return `{ status, data, headers }`. Otherwise throw `SureError { kind: network | http | not-json | not-configured, status?, message }`. Tests: success (URL + X-Api-Key), 401 HTML, 422, 5xx HTML, network failure, 200 text/html, not configured, one call through a generated function.
5. Verify: re-running `gen:api` leaves no diff; typecheck, lint, test, build pass.

Out of scope: Dexie meta wiring (TASK-5/11), stateful fake (TASK-6), retry/backoff (TASK-8).
<!-- SECTION:PLAN:END -->
