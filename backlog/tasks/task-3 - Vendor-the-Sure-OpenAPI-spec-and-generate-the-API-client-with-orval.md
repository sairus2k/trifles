---
id: TASK-3
title: Vendor the Sure OpenAPI spec and generate the API client
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T13:28:00Z'
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
