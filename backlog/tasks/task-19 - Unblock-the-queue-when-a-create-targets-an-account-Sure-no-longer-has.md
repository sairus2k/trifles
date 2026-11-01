---
id: TASK-19
title: Unblock the queue when a create targets an account Sure no longer has
status: Done
assignee:
  - '@claude'
created_date: '2026-11-01T15:39:00Z'
updated_date: '2026-11-01T20:23:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-8
  - TASK-9
references:
  - README.md
priority: medium
type: feature
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sure 131e786 answers `500 internal_server_error` (not 404) to `POST /api/v1/transactions` when `account_id` is unknown or not writable by the key: `find` raises `RecordNotFound` inside `create`, whose own `rescue => e` catches it before `BaseController#rescue_from` can turn it into 404. Push treats 5xx as transient and retries with backoff, and a head that is backing off holds the queue, so one entry for an account deleted or unshared on the server blocks every later write forever. Found while planning TASK-8; the fake answers 500 like Sure.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A create (or transfer leg) for an account Sure does not have ends as `failed` with a message the UI can show, and the records behind it are sent
- [x] #2 A transient 500 for an account that does exist is still retried
- [x] #3 Tested against the fake
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Research (Sure 131e786, local checkout ../sure):
- `TransactionsController#create` looks the account up with `family.accounts.writable_by(user).find(id)` (owner, or a share with `full_control`). `RecordNotFound` falls into the method's own `rescue => e` and renders `500 { error: "internal_server_error", message: "An unexpected error occurred" }`: the body is the same as for any other exception, so the 500 alone cannot tell a missing account from a transient failure.
- `GET /api/v1/accounts/{id}` (`AccountsController#show`) looks it up with `accessible_by(user)` (owner or any share), filtered to `draft`/`active` unless `include_disabled=true`, and answers `404 { error: "not_found", message: "Account not found" }` for an unknown, deleted or unshared account. It is in the vendored spec, so `getApiV1AccountsId(id, { include_disabled: true })` is already generated and returns 404 in the union.
- Gap: an account shared with the key's user as `read_only` or `read_write` (annotate) is accessible but not writable: `GET` answers 200 and the create still answers 500. No API response exposes the share permission (the account JSON has no such field, no account_shares endpoint), so the app cannot detect it. Such an entry keeps retrying and holds the queue; out of scope here, tracked in TASK-24.
- Rejected: deciding from the cached `db.accounts` instead of a request. It saves one GET per 500 but trusts a cache that may be stale or empty (a failed or not-yet-run pull), and a wrong "missing" would fail an entry that a retry would have sent.
- The UI already shows `lastError` under a failed row (`src/features/recent/rows.ts`), a failed `create` is editable (`isEditable`: rejected create), and a failed transfer gets `FAILED_TRANSFER_ERROR` appended and can only be discarded. A create that failed because its account is gone was certainly not applied, so it fits the existing "definitive answer (422, 404)" rule for editing.
- The fake already answers 500 for an unknown account; `sure.accounts` is the live state array, so a test removes an account by splicing it. It has no `GET /accounts/:id` route yet.

1. `test: answer GET /accounts/{id} in the fake`
   - test/fake-sure/index.ts: route `GET /api/v1/accounts/:id` (added to `FakeSureRoute`, so `failNext` covers it): the account, or `404 { error: "not_found", message: "Account not found" }`.
   - test/fake-sure/fake-sure.test.ts: known id → 200 with the account; unknown id → 404 with that body.
2. `test: contract-test the account lookup for accounts the key cannot reach`
   - test/contract/seed.rb: a second family member with a manual account of their own, not shared with the key's user.
   - test/contract/errors.contract.ts: `GET /accounts/{random UUID}` → 404 `not_found`; for the other member's account, `POST /transactions` → 500 and `GET /accounts/{id}?include_disabled=true` → 404. This pins the assumption the push relies on. Check that the existing accounts-list test still sees only the key user's accounts.
   - Run `npm run test:contract` (needs Docker).
3. `feat: fail a create whose account Sure no longer has`
   - src/sync/push.ts, `create()`: when `postApiV1Transactions` throws a `SureError` with status exactly 500, request `getApiV1AccountsId(entry.accountId, { include_disabled: true }, timeout())`. On 404 return a `{ status: 404, data: { error: "not_found", message } }` reply with a message the UI can show (the account was deleted in Sure or is no longer shared with this key); otherwise rethrow the original error, so `attempt()` retries it as before. An error thrown by the lookup itself propagates into the same catch: 401 pauses, 5xx/network/timeout retries. Other 5xx (502/503/504 from a proxy) skip the lookup.
   - Transfers need no extra code: both legs go through `create()`; a missing `:out` account fails the transfer before the `:in` leg, a missing `:in` account fails it with the `:out` leg already on Sure (the row already says so).
   - src/sync/push.test.ts:
     - a create for an account removed from the fake ends `failed` with that message, and the record behind it is sent (AC #1);
     - a transfer whose `:in` account is gone ends `failed`, the `:out` leg is on the fake once, the next record is sent; a missing `:out` account sends no leg (AC #1);
     - a 500 for an account that exists is retried with backoff and the lookup was made (AC #2); a 503 makes no lookup;
     - the lookup failing (500 or dropped) retries the record; the lookup answering 401 pauses the queue;
     - the failed create stays editable (`isEditable`), so the user can move it to another account.
   - README.md: Sync engine rules → Error handling (a create's 500 is checked with `GET /accounts/{id}`; 404 → `failed`), Editing pending records (a create failed because its account is gone counts as a definitive answer), Sure API notes → Unknown account on create (what push does now, and the read-only share gap), Testing (the fake's new route, the contract checks).
4. `chore: finish TASK-19` (check ACs with the test names as evidence, final summary).

Deviation in step 3: a lookup that fails in any way (401 included) leaves the original 500 to be retried instead of pausing. markPaused does not count an attempt for a create, so a pause would make the record editable again, and a 500 may follow a saved entry. The next POST pauses on a revoked key anyway.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Contract suite (npm run test:contract, Sure 131e786 in Docker): 11/11 pass, including the unknown account and another member's unshared account (POST 500, GET /accounts/{id}?include_disabled=true 404).
Seeding found that create_and_sync auto-shares every account with the other family members (default_account_sharing "shared", members get read_write, guests read_only), and neither is writable_by. So the TASK-24 case is the default for any multi-member family; the seed removes the share to get an unshared account.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A create or transfer leg answered 500 now triggers GET /api/v1/accounts/{id}?include_disabled=true. A 404 (account deleted or no longer shared) fails the record with "The account is no longer in Sure or no longer shared with you.", which the recent list shows as the row error, and the queue continues; the failed create stays editable so it can move to another account. Any other answer, a failed lookup, or another 5xx keeps the existing retry with backoff.

Commits: 19f4106 (fake answers GET /accounts/{id}), 8082994 (contract tests for the lookup, seed gains an unshared account of another member), 8ea1d22 (push + tests + README).

Verification: src/sync/push.test.ts "account Sure no longer has" (create fails and the next record is sent; failed create editable and resent to another account; transfer to/from a missing account; a 500 for an existing account is retried; 503 skips the lookup; a failed lookup retries for the 500 and keeps the record locked) — AC #1, #2, #3. Full npm test passes in the pre-commit hook; npm run test:contract passes against Sure 131e786.

Risk / follow-up: an account shared without full_control (the default for another member's accounts) is found by the lookup and still holds the queue — TASK-24.
<!-- SECTION:FINAL_SUMMARY:END -->
