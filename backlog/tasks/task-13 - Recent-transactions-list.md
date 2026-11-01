---
id: TASK-13
title: Recent transactions list
status: Done
assignee:
  - '@claude'
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T18:31:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-7
  - TASK-9
  - TASK-22
priority: medium
type: feature
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Right below the form the user sees what they just entered and whether it reached Sure. Mistakes are fixed in place.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Server and pending transactions are shown together, grouped by local day, newest first
- [x] #2 Pending entries are marked; failed entries show the server error
- [x] #3 Tap opens the entry for editing; swipe deletes it, both going through the outbox
- [x] #4 Component tests cover grouping, pending and failed rows, edit and delete
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Research (code at 63d6c18, Sure source in ../sure):
- Building blocks exist: `createLiveQuery` (src/db/live.ts), the `transactions` cache (latest 100, replaced by every `pullRecent()`), the outbox with `editPending` / `removePending` (unsent create or transfer, or a create failed with a definitive answer), `enqueueUpdate` / `enqueueDelete` (overwrite a queued pending or failed update/delete of the same transaction), `OutboxLockedError`, `amountScale`, `todayLocal`.
- The cache loses Sure's order: `db.transactions` is keyed by a random UUID and `TransactionRecord` has no `created_at`. Sure lists by `date desc, created_at desc, id desc` (`Entry.reverse_chronological`), so a day needs `createdAt` to sort. The pull also drops `transfer` (`{ id, other_account }`), which identifies the two legs of a transfer made in Sure.
- The outbox does not keep the server id of a sent create: a `done` create is linked to its transaction only by `external_id` (`clientId`, `<clientId>:out` / `:in`) once a pull brings it (TASK-8 comment). Until then it cannot be edited (no id to PATCH).
- `PATCH` cannot clear a category or a merchant (TASK-8 comment, push `updateBody`); notes clear with `""`. A split parent answers 422 when amount, date or type change; that surfaces as a failed update with Sure's message.
- A failed transfer and a failed update/delete have no way out today: `removePending` refuses the first, nothing removes the others. A new outbox function is needed.
- `push()` counts an attempt on a pause (`markRetry` → `finishAttempt` adds 1), so an entry made while the key is rejected becomes locked although Sure never applied it (TASK-8 comment).
- Mount point (TASK-11 comment): below `<Entry />` in the `fallback` of the `<Show>` in src/app.tsx, header kept. Browser tests share the app `db` and need `afterEach(cleanup)`.
- Editor rules (TASK-12 comment): amount through `evaluateAmount(_, amountScale(currency))`, merchant by case-insensitive match on the cache, empty name → category name → "Expense"/"Income", transfer named "<from> → <to>". These live in `EntryForm` (src/features/entry/entry.tsx).

Decisions (user, 2026-11-01):
- A transfer is one row ("Cash → Card"), pending or synced. A pending one is edited and removed like any pending entry; a synced one can only be deleted (both legs), editing it is left to Sure.
- Fix push so a pause does not count an attempt (separate fix commit), instead of only explaining the lock in the UI.

Decisions (mine, routine):
- One row per entry: an outbox create/transfer whose `clientId` matches a cached `externalId` (`cid`, `cid:out`, `cid:in`) shows once, with the server values and the outbox status while it is not `done`. Server legs are grouped by `transferId`, or by the `clientId` in their `externalId` before Sure pairs them.
- Updates overlay their transaction (newest record wins), deletes hide it, while pending, sending or done; failed ones show the server row with the error. Done records keep the overlay until TASK-20 removes them after a later pull, so an edit never flips back to old values between push and pull. An update or delete whose transaction is outside the cache shows nothing.
- Order: `date` desc, then `createdAt` desc (server `created_at`, outbox `createdAt` for rows not yet pulled). Day headings: "Today", "Yesterday", else a localized weekday and date (year only when not the current one).
- Row status: Pending (queued, never sent), Sending, Retrying (with the last error), Failed (with the server error); synced rows carry no mark.
- Actions per row, decided in a pure function so they are unit-tested:
  - unsent create/transfer and failed create → edit via `editPending`, delete via `removePending`;
  - failed transfer → no edit; "Dismiss" via `discardFailed`, its error text says one leg may already be in Sure;
  - retrying, sending, or done but not yet pulled → locked; the row explains it can be changed once it has synced;
  - server transaction → edit via `enqueueUpdate`, delete via `enqueueDelete`; with a failed update/delete also "Discard change" via `discardFailed`;
  - server transfer → delete via `enqueueDelete` for each cached leg; tap explains transfers are edited in Sure.
- Editor: a native `<dialog>` (focus trap and Escape for free, the entry form underneath keeps its state) holding the entry form started from the row's values, plus a date field (`type="date"`, local `YYYY-MM-DD`) and a Delete button. Synced transaction: account shown read-only (PATCH cannot move it), currency from the transaction, "No category" disabled when it has one, a hint when the typed name matches no merchant ("Sure keeps the merchant X"), an untouched amount sends the original `amountDecimal` (no rounding of extra stored digits).
- Swipe: horizontal pointer drag on a row (`touch-action: pan-y` keeps vertical scrolling native) past a threshold reveals a Delete button; tapping it deletes. The editor's Delete button is the keyboard/desktop path. No confirm dialog: the reveal is the confirmation.
- Amounts: `Intl.NumberFormat` currency style with `amountScale(currency)` fraction digits, sign from `amountDecimal` (positive = expense, shown with "−"). `Number()` on `amountDecimal` is display-only.
- No Dexie version bump for the new non-indexed fields: the next pull replaces the whole table.

1. `fix: a paused push does not count an attempt` — src/sync/push.ts / outbox.ts: on 401, 403 or missing settings the record goes back to `pending` without adding an attempt, so it stays editable; a transfer still counts it (its first leg may have been accepted before the pause). Tests first in push.test.ts: 401 on a create → attempts 0 and `editPending` succeeds; 401 on a transfer → attempts 1. README → Sync engine rules (Pause, Editing pending records).
2. `feat: discard a failed outbox record` — src/sync/outbox.ts `discardFailed(clientId)`: deletes a `failed` record of any op, throws `OutboxLockedError` otherwise. Tests in outbox.test.ts. README → Editing pending records.
3. `feat: keep transaction order and transfer link in the cache` — `TransactionRecord` gains `createdAt` (epoch ms of `created_at`) and `transferId` (`transfer?.id ?? null`); pull.ts maps them; pull.test.ts asserts them. README → Local schema.
4. `refactor: let the entry form start from given values` — `EntryForm` takes initial values (tab, amount, account or from/to, category, name, note), the tabs offered, whether the account is selectable, an optional date field and an `onSubmit(write)`; `Entry` keeps the reset, focus and sticky account. The name/merchant/amount rules stay in one place. entry.browser.test.tsx passes unchanged before and after.
5. `feat: format amounts and day headings` — `formatAmount(decimal, currency, locale?)` (src/domain/money.ts) and `dayLabel(date, today, locale?)` (src/domain/dates.ts). Tests with a fixed locale: EUR, JPY (0 digits), KWD (3), income vs expense sign; Today / Yesterday / same year / other year.
6. `feat: merge server and pending transactions into day groups` — src/features/recent/rows.ts, a pure `recentDays({ transactions, outbox, accounts, categories })` → days with rows (values, status, error, actions). Node tests rows.test.ts for every rule above: dedupe by externalId, transfer grouping by transferId and by clientId, update overlay (newest wins), delete hiding, failed update/delete shown with error, ordering within and across days, actions per row kind and status.
7. `feat: show recent transactions under the form` — src/features/recent/recent.tsx, rendered after `<Entry />` in app.tsx: `createLiveQuery` over transactions, outbox, accounts and categories, day headings, rows (name, category · account or "from → to", signed amount, status mark and error), an empty state. Tokens only, rows `min-h-11`.
8. `feat: edit and delete recent transactions` — row tap opens the editor dialog (or the lock reason); Save → `editPending` / `enqueueUpdate`; Delete in the dialog and by swipe → `removePending` / `enqueueDelete` / `discardFailed` as listed. README → Scope and a "Recent list" implementation note (merge rules, why done records keep their overlay); Project structure.
9. Tests, src/features/recent/recent.browser.test.tsx (app `db` seeded directly, tables cleared before each test, `afterEach(cleanup)`, no engine, `vi.setSystemTime` for the day headings, swipe through dispatched `PointerEvent`s):
   - grouping: server and pending rows together, days newest first, newest first within a day, a done create and its pulled transaction shown once, a transfer shown once;
   - pending row marked, failed create and failed update show the server message, locked row explains why;
   - edit: pending create → outbox payload rewritten (amount, category, date); synced → `update` record with full values and the original amount when untouched; category cannot be cleared on a synced row;
   - delete: swipe on a pending create removes the record; on a synced transaction queues `delete` and hides the row; on a synced transfer queues a delete per leg; failed transfer dismissed.
   app.browser.test.tsx: the list is under the form.
10. Comments: TASK-20 — done updates overlay and done deletes hide their row until removed, so cleanup must wait for a pull that started after the send; TASK-15 — the offline E2E can check the "Pending" mark and its disappearance; TASK-14 — `formatAmount` for display.
11. Before done: full suite green in the hook, a mutation check of the dedupe and of the delete routing, then the finalization guide.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented as planned in 9 commits (8fcd0b6..1288317). Deviations from the plan:
- An outbox create/transfer that matches a pulled transaction but is not done shows the outbox payload, not the server values: they are the same write, and the outbox status decides what the row allows.
- formatAmount signs only negatives (d1d412f): a transfer has no direction, so the list adds the plus of an income itself.
- EntryForm stays in src/features/entry/entry.tsx, exported, rather than moving to its own file.
- recent.browser.test.tsx imports src/index.css: the swipe uncovers the Delete button by layout, and without styles the moved row still covers it.
Verification: npm test 350/350 (21 files) in Chromium and Node, typecheck and lint clean, lefthook green on every commit. Mutation checks: removing the done-and-pulled skip, the pulled-leg dedupe, failed-delete visibility, leg-delete hiding, isEditable, the unpulled reason, the externalId leg grouping, each delete route, the locked-error report, the untouched-amount rule and the disabled "No category" each fail at least one test.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-11-01T15:46:00Z

---

Findings from TASK-8 (push), for the list and the edit screen:
- Duplicates: a `done` outbox record and the pulled server transaction are the same entry. Match them by `external_id` (`clientId`, or `<clientId>:out` / `<clientId>:in` for a transfer) and show one row.
- `PATCH /transactions/{id}` cannot clear a category or merchant (Sure drops null and blank ids), so removing one in the editor is silently lost. Disable clearing for synced transactions or say it will not apply. Notes do clear (push sends "").
- A failed transfer (one leg may already be on the server) cannot be edited or removed: `editPending` and `removePending` throw `OutboxLockedError`. The failed row needs an action, for example dismiss with a warning that one leg may exist in Sure; that needs a new outbox function.
- A record paused by `401` counts an attempt, so an entry that never reached Sure becomes locked for editing. Show why the row cannot be edited.

---

author: @claude
created: 2026-11-01T16:50:00Z

---

From TASK-11: the main screen is the `fallback` of the `<Show>` in `src/app.tsx`; Settings replaces it on first run, from the header Settings button and when sync is paused (`pausedAt` in meta). The header there also holds the "Sync paused" button. Build this screen inside that fallback rather than replacing `App`, and keep the header. Browser component tests share the app `db` (files run one at a time) and need `afterEach(cleanup)`, see `src/app.browser.test.tsx`.

---

author: @claude
created: 2026-11-01T17:54:00Z

---

From TASK-12: the editor should follow the entry form rules in src/features/entry/entry.tsx: evaluate the amount with `amountScale(account.currency)`; a name that matches a cached merchant (case-insensitive) is sent as its `merchant_id` and canonical name, any other text as `name` only, an empty name falls back to the category name, then "Expense"/"Income". A transfer is named "<from> → <to>" on both legs. The form remembers its account in meta `entryAccountId`. The suggestion list stays open on blur on purpose: closing it moved the submit button out from under the pointer.

---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The main screen lists recent transactions under the entry form: cached server transactions and the outbox merged into one row per entry (matched by external_id, transfer legs grouped), grouped by local day, newest first. Pending, sending and retrying rows are marked; failed ones show Sure's message. Tapping opens the entry form in a dialog with a date field (pending entries are rewritten in the outbox, synced ones queue a full-value update with the account fixed and category kept); swiping left uncovers Delete (removePending, enqueueDelete, one per transfer leg, or discardFailed for a failed transfer). Rows that may be on their way to Sure are locked and say why.

Supporting changes: a paused push no longer counts an attempt for a create, so entries made while the key is rejected stay editable; discardFailed drops a failed record of any kind; the cache keeps created_at and the transfer id; formatAmount and dayLabel for display.

Verified by 350 passing tests (rows rules in Node, list, editor and swipe in Chromium) and mutation checks. Risks/follow-ups: done updates and deletes keep their overlay until TASK-20 cleans them up; a change to a transaction outside the latest 100 is not shown; synced transfers are edited in Sure; swipe and dialog still need the iPhone check (TASK-15).
<!-- SECTION:FINAL_SUMMARY:END -->
