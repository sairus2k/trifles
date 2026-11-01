---
id: TASK-16
title: Contract tests against a real Sure in Docker
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T19:41:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-3
priority: low
type: task
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The fake encodes assumptions about Sure behaviour that must hold on the real instance version. These tests run before upgrading Sure, not on every commit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A script starts Sure in Docker at the version pinned in `spec/README.md` and runs the suite
- [ ] #2 A repeated `external_id` returns `200` with the existing transaction
- [ ] #3 `nature: "expense"` stores a positive amount
- [ ] #4 Two opposite transactions between same-currency manual accounts are auto-matched into a transfer
- [ ] #5 Balance update latency after a write is measured and reported
- [ ] #6 How to run the suite is documented in README
- [ ] #7 POST /transactions for an unknown account answers `500` (TASK-8 retries it; see TASK-19)
- [ ] #8 PATCH /transactions/{id} ignores null fields, blank `category_id` / `merchant_id` and `currency`, and clears notes with `""`
- [ ] #9 PATCH and DELETE of an unknown transaction answer `404 not_found`
- [ ] #10 A read-only API key answers `403` to POST /transactions
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Research (Sure 131e786, local checkout ../sure):
- Image: Sure's publish.yml tags every `main` build `type=sha,format=long`, and `ghcr.io/we-promise/sure:sha-131e786b9373bea821b2be16e35fd8ba89d8af66` exists for amd64 and arm64. The tag is derived from the commit in `spec/README.md`, so bumping the spec bumps the container.
- Stack: web + worker + postgres:16 + redis, as in Sure's compose.example.yml. The worker is required: `sync_account_later` enqueues the account sync, which recalculates the balance and then runs `family.auto_match_transfers!(account:)` in `Account::Syncer#perform_post_sync`. `bin/docker-entrypoint` runs `db:prepare` before `rails server`; `/up` is the health route; the image has curl. Env: SELF_HOSTED=true, RAILS_FORCE_SSL=false, RAILS_ASSUME_SSL=false; production config leaves `config.hosts` open.
- Seeding: the API cannot create a user, a key, an account (no POST /accounts) or a merchant (POST /merchants is a CSV import), so a `bin/rails runner` script does it with models, as `Demo::Generator` does: `Family.create!`, an admin `family.users.create!`, `api_keys.create!(name:, key:, scopes: ["read_write"] / ["read"], source: "web")` (`set_display_key` copies `key`, so both keys are fixed strings), two manual Depository accounts in the family currency via `Account.create_and_sync` with `owner:` the user (create does `writable_by(user).find`; an account the key cannot write answers 500), one category, one merchant.
- TransactionsController at 131e786: `ensure_write_scope` runs before `set_transaction`; `create` rescues everything (including RecordNotFound) into 500; update params `compact_blank` category/merchant, do not take `currency`, pass `notes` through; idempotency is `existing_idempotent_entry(account)`.
- Auto-match pairs any equal-amount expense/income in the family within 4 days between accounts with a common writer and the same currency. Every test therefore uses an amount no other test uses. The match is a pending Transfer, and the API renders `transfer: { id, ... }` on both legs.
- Client: tests call the generated functions with the per-request `settings` override (as check.ts does), so they exercise the same `sureFetch`. 5xx throws `SureError` (AC #7 expects a rejection with status 500); 403 is returned and is compared as `status as number`.

1. `test: start a pinned Sure in Docker for contract tests`
   - test/contract/compose.yml: web and worker on `ghcr.io/we-promise/sure:${SURE_IMAGE_TAG}`, postgres:16, redis with a pinned major; no named volumes; web on 127.0.0.1:${SURE_CONTRACT_PORT:-3999}; web healthcheck `curl -fsS localhost:3000/up` with a start period for db:prepare; seed.rb mounted read-only.
   - test/contract/seed.rb: the records above, with fixed names and keys.
   - test/contract/global-setup.ts: take the single 40-hex commit from the table in spec/README.md (fail if there is not exactly one), `docker compose -p trifles-contract -f test/contract/compose.yml up -d --wait`, `exec -T web bin/rails runner` the seed, `provide()` the base URL and both keys; teardown `down -v` unless `KEEP_SURE=1`. A missing docker binary fails with a message, not a stack trace.
   - vitest.contract.config.ts: node environment, include `test/contract/**/*.contract.ts` (outside the node project's `test/**/*.test.ts`, so `npm test` and the pre-commit hook never start Docker), `fileParallelism: false`, long test timeout.
   - package.json: `"test:contract": "vitest run --config vitest.contract.config.ts"`.
   - First test: GET /accounts with the read_write key lists the two seeded accounts (AC #1).
2. `test: contract-test idempotent creates and amount signs`
   - Helpers in test/contract/: settings per key, seeded ids looked up by name, a unique amount per test.
   - AC #2: POST twice with the same `external_id` + `source` → 201, then 200 with the same id; GET /transactions has it once.
   - AC #3: `nature: "expense"` → positive `amount_decimal`; `nature: "income"` → negative (README → Sure API notes).
3. `test: contract-test updates, deletes and error statuses`
   - AC #8: create with category, merchant, notes and the account currency; PATCH `{ name: null, category_id: "", merchant_id: "", currency: <another code>, notes: "" }` → name, category, merchant and currency unchanged, notes cleared.
   - AC #9: PATCH and DELETE of a random UUID → 404 `{ error: "not_found" }`.
   - AC #7: POST with a random `account_id` → SureError with status 500 (TASK-19).
   - AC #10: read key POST → 403, nothing created; plus the TASK-11 probe: read key DELETE of a random UUID → 403 `insufficient_scope`, read_write key → 404 `not_found`.
4. `test: contract-test transfer matching and balance latency`
   - AC #4: expense on account A and income on account B, same amount, date and currency → poll GET /transactions/{id} until both legs carry the same `transfer.id` (fail after 60 s).
   - AC #5: five creates in sequence; for each, the time from the 201 until GET /accounts/{id} shows `updated_at >= created_at` and the balance moved by the amount. Print min / median / max with `console.info`; fail only past 60 s.
5. `docs: document the contract suite`
   - README → Testing item 2: command, Docker requirement, first-run image pull, `KEEP_SURE`, `SURE_CONTRACT_PORT`; Getting started command list; Project structure (`test/contract/`).
   - spec/README.md → Updating: run `npm run test:contract` after changing the commit.
6. If real Sure contradicts the fake or README: stop and report; fix the fake and README in a separate `fix:` commit after the user agrees (scope change).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decision (user, 2026-11-01): Sure starts from a Vitest globalSetup in vitest.contract.config.ts (`npm run test:contract`), not a shell script.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-11-01T16:47:00Z

---

From TASK-11: Settings tells a read-only key apart with `DELETE /api/v1/transactions/<random UUID>`, relying on TransactionsController running `ensure_write_scope` before `set_transaction`. Contract-test it on each Sure upgrade: a `read` key → 403 `insufficient_scope`, a `read_write` key → 404 `not_found`, and no transaction is changed.

---
<!-- COMMENTS:END -->
