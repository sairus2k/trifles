---
id: TASK-26
title: Prove live query cleanup without vi.mock
status: Done
assignee:
  - '@claude'
created_date: '2026-11-02T18:14:00Z'
updated_date: '2026-11-02T18:27:00Z'
labels: []
milestone: m-0
dependencies: []
references:
  - src/db/live.browser.test.tsx
  - https://github.com/vitest-dev/vitest/issues/11780
priority: high
type: bug
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
About one full `npm test` run in three fails all of `src/db/live.browser.test.tsx`, locally and therefore in CI (found while setting up TASK-2). The file swaps `liveQuery` with `vi.mock("dexie")` to count subscriptions; @vitest/browser-playwright 5.0.4+ first probes Chromium request interception with a hard 5s deadline, and when the main process is busy (the node project runs in parallel) the probe fails and the mock is silently dropped. Upstream: vitest-dev/vitest#11780, still open, same probe in 5.1.0. It is the only browser test with `vi.mock`. Dexie's ESM wrapper copies `liveQuery` off the class at import, so swapping it at runtime is not an option either.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No browser test uses `vi.mock`
- [x] #2 The tests still fail when `createLiveQuery` leaves a Dexie subscription open after dispose, after a reactive parameter changes or after unmount
- [x] #3 `npm test` passes ten full runs in a row
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Replace the `vi.mock("dexie")` subscription counter with a behavioural check: the query records each run, and after dispose, a parameter change or unmount a write that overlaps the old query must not run it again.
2. Know that Dexie has dispatched the write by waiting for a watcher live query subscribed after the query under test.
3. Mutation-check: make `createLiveQuery` leak a subscription and confirm the tests fail; revert.
4. Run `npm test` ten times in a row.

5. Ten-run loop exposed a second, unrelated race in `src/features/recent/recent.browser.test.tsx`: three tests read editor content inside `<Loading>` with synchronous `getBy*` right after the dialog opens. Switched them to `findBy*` (own commit), since the ten-run criterion cannot pass without it.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Mutation check: wrapping `liveQuery` in `createLiveQuery` so `unsubscribe()` is a no-op fails the dispose, parameter-change and unmount tests (3 of 4; the first only checks emissions). In the unmount test the leak already shows before `unmount()` (line 119), so that mutant does not isolate the post-unmount assertion; unmount goes through the same owner disposal as the dispose test.
Before: 1 failure in ~3 full runs (here and in a clean clone). After both fixes: 10/10 full `npx vitest run`, then green pre-commit runs for both commits.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`src/db/live.browser.test.tsx` no longer uses `vi.mock("dexie")`, which @vitest/browser-playwright silently drops under load (vitest-dev/vitest#11780, open, also in 5.1.0); it failed about one full run in three. The tests now record each query run and prove a closed subscription by writing into the old query's range and checking it does not run again; a watcher live query subscribed last tells when Dexie has dispatched the write. A leaking `createLiveQuery` mutant fails all three cleanup tests. Separately fixed a race in three editor tests in `recent.browser.test.tsx` (`getBy*` → `findBy*` for content inside `<Loading>`). Verified with 10/10 full `npm test` runs. Risk: the watcher relies on Dexie notifying `storagemutated` listeners in subscription order (Dexie 4.4.7 `liveQuery`).
<!-- SECTION:FINAL_SUMMARY:END -->
