---
id: TASK-12
title: 'Entry form: expense, income and transfer'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T17:43:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-4
  - TASK-7
  - TASK-9
  - TASK-22
priority: high
type: feature
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The main job of the app: capture a transaction in under five seconds, even offline. The form is always on screen and keyboard-driven. The decimal keyboard on phones has no operators, so the form needs its own operator row.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Tabs switch between Expense, Income and Transfer; Transfer asks for source and destination accounts
- [ ] #2 The amount field uses `inputmode="decimal"`, has an on-screen `+ − × ÷` row and evaluates the expression on submit
- [ ] #3 After submit, amount and note are cleared, account and category are kept, and focus returns to the amount
- [ ] #4 Merchant autocomplete suggests names from history and pre-fills the category most often used with that merchant
- [ ] #5 Submitting writes to the outbox and works offline
- [ ] #6 Component tests cover sign per tab, calculator, sticky account/category and merchant pre-fill
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Research (code at 9bdc7ce, Sure 131e786 in ../sure):
- Building blocks exist: `evaluateAmount(input, scale)` (src/domain/calc.ts), `todayLocal()`, `enqueue({ op: "create" | "transfer" })` (src/sync/outbox.ts, notifies the engine itself), `EntryPayload` / `TransferPayload` (src/db/schema.ts), `createLiveQuery` for accounts, categories, merchants and suggestions. The form adds no sync code: an enqueue is an IndexedDB write, so it works offline by construction.
- `name` is required by Sure (`Entry validates :date, :name, :amount, :currency, presence`); the create params accept `merchant_id` only, no merchant name. `POST /api/v1/merchants` is a CSV import, so a new merchant cannot be created (TASK-6 comment).
- The calculator needs a scale per currency, and none exists yet (TASK-4 left it open). Sure's config/currencies.yml has `default_precision` per currency: 2 for 140 of 182, 0 for JPY/KRW/HUF/…, 3 for KWD/BHD/JOD/…, 1 for MGA/MRU, 4 for CLF, 8 for BTC/ETH/DOGE. `entries.amount` is decimal(19,4), so input precision is `min(default_precision, 4)`. This is not `minor_unit_conversion` (balance_cents, TASK-14): they differ for MGA/MRU and crypto.
- Sure names its own transfer legs "Transfer to X" / "Transfer from Y"; `TransferPayload` has one `name` for both legs, and matching (`auto_match_transfers!`) does not look at names.
- `suggestions` (TASK-9) holds merchant name → most used category, `count`, `lastUsedAt`, built only from transactions with both a merchant and a category; `merchants` holds every family merchant.
- Mount point (TASK-11 comment): the `fallback` of the `<Show>` in src/app.tsx, below the header, which stays. Browser tests share the app `db` and need `afterEach(cleanup)`.

Decisions (user, 2026-11-01):
- No date field: the date is `todayLocal()` at submit; Recent (TASK-13) edits it.
- The account survives a restart (kept in `meta`); the category is kept only for the session and starts empty after a restart.
- Autocomplete offers Sure merchants only (suggestions + merchants cache). A name typed in this app without a known merchant goes into `name` and is not suggested later.

Decisions (mine, routine):
- A known merchant (trimmed, case-insensitive exact match on the merchants cache) is sent as `merchant_id` with its canonical name as `name`; any other text is sent as `name` only. An empty name falls back to the category name, else "Expense" / "Income".
- The merchant name is cleared after submit together with amount and note (it belongs to one purchase); account and category stay.
- Category is sticky per tab (Expense and Income keep their own) within the session; Transfer has no category or merchant.
- Transfer: "To" lists active accounts with the same currency as "From", except "From" (cross-currency is out of v1); name `"<from> → <to>"` for both legs. The remembered account is used for Expense/Income and as the default "From".
- Autocomplete is a custom list under the field (up to 5: suggestions by count then lastUsedAt, then other merchants by name; prefix matches before substring), not `<datalist>`: iOS Safari shows datalist poorly and Playwright cannot drive the native popup. Picking a name sets the category from its suggestion, overriding the current one.
- Operator buttons insert at the caret (`setRangeText`) and `preventDefault` on `pointerdown`, so the amount field keeps focus and the phone keyboard stays open.

1. `docs: POST /api/v1/merchants is a CSV import` — README → Sure API notes: drop it from Reference data, add that a merchant cannot be created through the API and what the form sends instead.
2. `feat: amount precision per currency` — src/domain/currency.ts `amountScale(currency)`: the codes whose Sure `default_precision` is not 2 (copied from ../sure config/currencies.yml at 131e786, source in a comment), capped at 4; any other code → 2. Tests first: USD 2, JPY 0, KWD 3, MGA 1, BTC 4 (capped), unknown 2. README → Project structure.
3. `feat: add the entry form` — src/features/entry/entry.tsx, rendered in the app.tsx fallback under the header:
   - Tabs Expense / Income / Transfer (`role="tablist"`, `aria-selected`).
   - Expense/Income: amount (`type="text"`, `inputmode="decimal"`, `autocomplete="off"`), operator row `+ − × ÷`, account (active accounts by name, with currency), category (optional, "No category"), merchant/name with the suggestion list, note, submit.
   - Transfer: amount + operator row, From, To, note.
   - Submit: `evaluateAmount(amount, amountScale(account.currency))`; an error shows `role="alert"` by the amount, refocuses it and enqueues nothing. Otherwise build `EntryPayload` / `TransferPayload` (date `todayLocal()`, account currency, notes trimmed or null), `enqueue`, store the account in meta (`entryAccountId`), clear amount, note and name, `flush()`, focus the amount. Submit disabled while the write runs.
   - No accounts yet (before the first pull): a short message instead of the form.
   - Styles from the tokens; controls `min-h-11`, inputs `text-base`.
   README → Local schema (`entryAccountId` in meta) and Scope/Implementation notes for the name and merchant rules.
4. Tests, src/features/entry/entry.browser.test.tsx (app `db` seeded directly, tables cleared before each test, `afterEach(cleanup)`, no engine started):
   - sign per tab: Expense → `nature: "expense"`, Income → `"income"`, Transfer → `op: "transfer"` with from/to and the shared currency;
   - calculator through the operator row: `120+35.5-10` → `"145.50"`; JPY `100÷3` → `"33"`; invalid and `0` show the error and write nothing;
   - after submit: amount, note and name empty, account and category kept, focus on the amount; after a remount the account is kept and the category is empty;
   - merchant: typing "li" offers "Lidl"; picking it sets Groceries and sends `merchant_id`; an unknown name is sent without one; an empty name falls back to the category name;
   - Transfer "To" excludes "From" and other currencies;
   - offline: with `navigator.onLine` stubbed `false`, submit writes a pending outbox record.
   app.browser.test.tsx: the main screen shows the form under the header.
5. Comments: TASK-14 — `amountScale` is input precision (`default_precision`), not the `minor_unit_conversion` balance_cents needs; TASK-13 — the name/merchant rules and `amountScale` for its editor; TASK-15 — the offline E2E can enter through this form.
6. Before done: full suite green in the hook, a mutation check of the sign per tab and the sticky reset, then the finalization guide.

AC map: #1 → 3, 4; #2 → 2, 3, 4; #3 → 3, 4; #4 → 3, 4; #5 → 3, 4; #6 → 4.
Out of scope: date field; suggesting names typed without a merchant; creating merchants; editing entries and the pending list (TASK-13); balances and pending deltas (TASK-14); cross-currency transfers; tags.
<!-- SECTION:PLAN:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-11-01T15:18:00Z

---

Finding from TASK-6: `POST /api/v1/merchants` is a CSV import (multipart `file`, see merchants_controller.rb and `PostApiV1MerchantsBody`), not a way to create one merchant. README → Sure API notes lists it under reference data, which is misleading. A merchant name that is not in the cache cannot be created through the API before the transaction is sent; decide here what the form does with it (for example only send `merchant_id` for known merchants and keep a new name in the transaction `name`), and fix the README line.

---

author: @claude
created: 2026-11-01T16:50:00Z

---

From TASK-11: the main screen is the `fallback` of the `<Show>` in `src/app.tsx`; Settings replaces it on first run, from the header Settings button and when sync is paused (`pausedAt` in meta). The header there also holds the "Sync paused" button. Build this screen inside that fallback rather than replacing `App`, and keep the header. Browser component tests share the app `db` (files run one at a time) and need `afterEach(cleanup)`, see `src/app.browser.test.tsx`.

---
<!-- COMMENTS:END -->
