---
id: TASK-3
title: Vendor the Sure OpenAPI spec and generate the API client with orval
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
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
The app talks to the Sure API directly, with no backend of its own. Types must come from the spec of the Sure version the instance runs. orval is chosen because `openapi-typescript` and stable `@hey-api/openapi-ts` break on TypeScript 7. The Sure spec has three path parameters with `format` outside `schema`, which fails strict validation. A reverse proxy can answer 401 or 5xx with HTML, which generated types do not cover.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `spec/sure-openapi.yaml` is vendored and `spec/README.md` records the Sure commit it comes from
- [ ] #2 `npm run gen:api` regenerates `src/api/generated/` from the spec using the config in README → API client
- [ ] #3 The `sureFetch` mutator adds the instance URL and `X-Api-Key` from settings
- [ ] #4 The mutator checks `res.ok` and `content-type` before parsing JSON and returns a normalised error for HTML or non-JSON responses
- [ ] #5 Unit tests cover success, 401, 422, 5xx-with-HTML and network failure in the mutator
<!-- AC:END -->
