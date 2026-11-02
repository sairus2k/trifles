---
id: TASK-24
title: Unblock the queue when a create targets an account shared read-only
status: Done
assignee:
  - '@claude'
created_date: '2026-11-01T20:18:00Z'
updated_date: '2026-11-02T08:29:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-19
references:
  - README.md
priority: medium
type: feature
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sure 131e786 answers `500` to `POST /api/v1/transactions` for an account the key's user can read but not write: a share with `read_only` or `read_write` (annotate) permission. `create` looks the account up with `writable_by` (owner or `full_control` share), and its own `rescue => e` turns the `RecordNotFound` into a generic 500. `GET /api/v1/accounts` and `GET /api/v1/accounts/{id}` use `accessible_by`, so such an account is listed in the entry form and the TASK-19 lookup answers 200: the create is retried with backoff and holds the queue forever. No API response exposes the share permission (the account JSON has no such field, there is no account_shares endpoint). Options to weigh: cap the attempts of a create that keeps getting 500 for an account that exists (careful: a 500 can also follow a saved entry, e.g. `sync_account_later` raising, so the failed record must not become editable), or let a create that keeps failing stop holding the records behind it. Found while planning TASK-19.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A create (or transfer leg) for an account the key can read but not write stops holding the queue, and the UI shows why
- [x] #2 A transient 500 for a writable account is still retried
- [x] #3 Tested against the fake
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Research (Sure 131e786, local checkout ../sure, `git show 131e786:<path>`):
- `TransactionsController#create` finds the account with `family.accounts.writable_by(user)` (owner, or a share with `full_control`) and its own `rescue => e` turns the `RecordNotFound` into the generic 500. `create_and_sync` shares every account with the other members (`read_write`) and guests (`read_only`), and neither is writable, so in a multi-member family every account of another member is listed, found by the TASK-19 lookup, and answers 500 forever.
- No response exposes the permission: `_account.json.jbuilder` has no share field, there is no account_shares endpoint.
- Write probe: `POST /api/v1/recurring_transactions` (`RecurringTransactionsController#create`) resolves `recurring_transaction.account_id` with the same `family.accounts.writable_by(user)` scope in `writable_account`, before any validation, and re-raises `RecordNotFound` to `BaseController#handle_not_found`: `404 { error: "record_not_found" }`. For a writable account, `validate_create_write_params` adds errors for blank `last_occurrence_date` / `next_expected_date`, and `errors.empty? && save` short-circuits: `422 validation_failed`, nothing saved, no `after_commit :generate_occurrences`. So a request with blank dates answers 404 = cannot write, 422 = can write, and changes nothing. `expected_day_of_month: 0` is a second guard: should a later Sure stop checking the dates, the model validation (`greater_than: 0`) still fails the save. The spec documents this operation with 404 and 422 (tag "Recurring Transactions", not in orval's `filters.tags` yet).
- Other writable_by lookups do not fit: trades check `transfer_account_id` only for an investment account's deposit, splits answer 403 only for an existing transaction.
- Rejected: capping the attempts of a create that keeps getting 500. A 500 also follows a saved entry (`sync_account_later` raising) and a long server outage, so the capped record could not be editable, and an outage would fail entries that a retry would have sent. Rejected: letting a failing head stop holding the queue: it keeps retrying forever and breaks the strict creation order README promises. Not in scope: hiding non-writable accounts in the entry form (one probe per account on every reference pull); a follow-up if wanted.
- UI: a failed create already shows `lastError` under its row and stays editable (`recent.browser.test.tsx`), a failed transfer gets `FAILED_TRANSFER_ERROR` appended and can only be discarded. A create refused for a non-writable account was certainly not saved (the lookup raises before `entries.new`), so it fits the "definitive answer" rule for editing. No UI change needed.

1. `chore: generate the recurring transactions client`
   - orval.config.ts: add "Recurring Transactions" to `filters.tags`; `npm run gen:api` (adds `postApiV1RecurringTransactions` with 404 and 422 in the union).
   - README.md: the orval config snippet in Tech stack.
2. `test: model accounts shared without full control in the fake`
   - test/fake-sure: a live list of account ids the key's user can read but not write (seeded empty, exposed like `sure.accounts`, so a test marks an account read-only by pushing its id). `POST /transactions` to such an account answers 500 like an unknown one; `GET /accounts/{id}` still answers 200.
   - New route `POST /api/v1/recurring_transactions` (in `FakeSureRoute`, so `failNext` covers it): unknown or non-writable account → 404 `record_not_found`; blank `last_occurrence_date` / `next_expected_date` → 422 `validation_failed`; anything else throws "not modelled" (the app never creates one).
   - test/fake-sure/fake-sure.test.ts: these answers.
3. `test: contract-test the write probe for shared accounts`
   - test/contract/seed.rb: the other member's accounts "Shared read_write" (the default share `create_and_sync` gives the key's user), "Shared read_only" and "Shared full_control" (share permission updated). They are listed, so `seeded()` finds them by name.
   - test/contract/errors.contract.ts: for the `read_only` and `read_write` shares, `POST /transactions` → 500, `GET /accounts/{id}?include_disabled=true` → 200, the probe → 404 `record_not_found`; for the owned Checking and the `full_control` share, the probe → 422 `validation_failed`, and a create on the `full_control` share → 201 (unique amount). `GET /recurring_transactions` lists nothing afterwards: the probe creates nothing.
   - Check the other contract tests still pass with three more listed accounts. Run `npm run test:contract` (Docker).
4. `feat: fail a create for an account the key can read but not write`
   - src/sync/push.ts, `create()`: after a 500 the TASK-19 lookup runs as now; when it answers 200, send the probe (`account_id`, the entry's currency, `amount: 0`, `expected_day_of_month: 0`, blank dates, `name`). 404 → reply `{ status: 404, data: { error: "not_found", message: READ_ONLY_ACCOUNT } }` (not 403: a 403 reply pauses the queue) with a message like "This account is read-only for you in Sure. Ask its owner for full control, or move the entry to another account."; 422, any other answer or a `SureError` → rethrow the original 500, so `attempt()` retries it. Fold `isGone` and the probe into one helper that returns the failure message or nothing. Other 5xx still skip both requests.
   - Transfers need no extra code: both legs go through `create()`. A read-only `:out` account fails the transfer before the `:in` leg; a read-only `:in` account fails it with the `:out` leg on Sure (the row already says so).
   - src/sync/outbox.ts: `isEditable` comment names this case among the definitive answers.
   - src/sync/push.test.ts, describe "account shared without full control":
     - a create for a read-only account ends `failed` with the message and the record behind it is sent (AC #1);
     - the failed create stays editable and, moved to another account, is sent;
     - transfer with a read-only `:out` account sends no leg; with a read-only `:in` account the `:out` leg is on the fake once; both fail and the next record is sent (AC #1);
     - a 500 for a writable account makes the lookup and the probe (422) and is retried with backoff (AC #2);
     - the probe failing (500, dropped, 401) retries the record and keeps it locked;
     - an unknown account still fails with `ACCOUNT_GONE` and makes no probe; a 503 makes neither request.
   - README.md: Sync engine rules → Error handling (the probe after the lookup), Editing pending records (a create refused for a read-only account is a definitive answer), Sure API notes → Unknown account on create (replace the TASK-24 gap with the probe and why it is safe), Testing (the fake's new route and read-only accounts, the required scenario, the contract checks).
5. `chore: finish TASK-24` (check ACs with the test names as evidence, final summary).

Risks:
- The probe depends on Sure checking the account before the dates; the contract test pins it, and spec/README.md already requires `npm run test:contract` before a Sure upgrade.
- A share downgraded to read-only between the POST and the probe could leave a saved entry looking refused; the user could then move it and create a second transaction. Needs a permission change within one request round trip; accepted.
- A 500 for a writable account now costs two extra requests per attempt; backoff caps at 5 minutes.
- Read-only accounts stay in the entry form, so the user learns about them only after a push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From TASK-19 seeding: Account.create_and_sync calls auto_share_with_family! when family.default_account_sharing is "shared" (the default): other members get read_write, guests read_only. Neither is writable_by, so in any multi-member family every account owned by someone else is listed in the entry form and a create to it answers 500 forever. Consider raising the priority.

Contract suite (npm run test:contract, Sure 131e786 in Docker): 16/16 pass. The write probe answers 404 record_not_found for read_only and read_write shares, 422 validation_failed for an owned account and a full_control share, and creates no recurring transaction; a create on the full_control share answers 201.
Deviation from the plan: src/sync/outbox.ts is unchanged. isEditable's comment already names a create rejected with 404, which is the reply push now returns for a read-only account.
The README orval note now says ~1,900 generated lines (the Recurring Transactions tag added ~600).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A create or transfer leg answered 500 for an account that GET /accounts/{id} still finds now triggers a write probe: POST /api/v1/recurring_transactions with blank dates and expected_day_of_month 0. Sure resolves its account with the same writable_by scope as a transaction create before any validation, so 404 means no write access and 422 write access, and nothing is saved. A 404 fails the record with "This account is read-only for you in Sure. Ask its owner for full control, or move the entry to another account.", which the recent list shows as the row error; the queue continues and the failed create stays editable. A 422, any other answer or a failed probe keeps the retry with backoff.

Commits: 10be667 (generate the Recurring Transactions client), 0a6085b (fake: readOnlyAccountIds and the probe route), 95d4b5e (contract tests: accounts shared read_write, read_only and full_control), 31cb465 (push + tests + README).

Verification: src/sync/push.test.ts "account shared without full control" (create fails with the message and the next record is sent; the failed create is editable and resent to another account; transfer to/from a read-only account; a 500 for a writable account is retried after a 422 probe; a probe failing with 500, 401 or a network error retries and keeps the record locked) — AC #1, #2, #3; the UI renders a failed create's lastError (recent.browser.test.tsx). Full npm test passes in the pre-commit hook; npm run test:contract passes against Sure 131e786.

Risks / follow-ups: the probe depends on Sure checking the account before the dates (pinned by the contract suite, rerun on every Sure upgrade). A 500 for a writable account costs two extra requests per attempt. Read-only accounts stay in the entry form, so the user learns about them only after a push; hiding them would need one probe per account on every reference pull (no task created).
<!-- SECTION:FINAL_SUMMARY:END -->
