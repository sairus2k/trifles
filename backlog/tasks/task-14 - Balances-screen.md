---
id: TASK-14
title: Balances screen
status: Done
assignee:
  - '@claude'
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T18:48:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-9
  - TASK-22
priority: medium
type: feature
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Balances are one tap away from the form. Sure is the source of truth for balances; the app only shows what Sure returns plus a pending delta for unsynced entries.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Accounts are split into assets and liabilities with balances in each account currency
- [x] #2 An account with unsynced entries shows the pending delta as `≈`
- [x] #3 The delta disappears once pull brings a newer balance
- [x] #4 Component tests cover the split and the pending delta
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Decisions (user, 2026-11-01): a Balances button in the header switches the main screen between Entry+Recent and Balances (signal in App, no router, header kept); an account with a pending delta shows the projected balance large as "≈ <Sure balance + delta>" and a muted line "Sure <balance> · <delta>" under it.

Research findings:
- Sure (131e786) renders balance_cents as round(balance * minor_unit_conversion) (app/views/api/v1/accounts/_account.json.jbuilder). Conversion is 100 for most codes; 1 for JPY/KRW/CLP/...; 1000 for BHD/IQD/JOD/KWD/LYD/OMR/TND; 10000 CLF; 5 MGA/MRU (not a power of 10); 10^8 BTC/DOGE; 10^18 ETH.
- ETH balance_cents exceeds Number.MAX_SAFE_INTEGER, so JSON.parse already makes it approximate: display only, accept and comment.
- GET /accounts returns draft+active (scope visible); the entry form shows only active accounts. Balances follow the form: active only, sorted by name.
- Intl.NumberFormat throws RangeError for 4-letter codes Sure lists (DOGE, USDC, USDT), so formatAmount would crash the screen (and already the Recent list).
- pendingDeltas() (src/sync/outbox.ts) reads db.outbox and db.accounts, so one liveQuery over accounts + deltas re-runs on either change. The TASK-9 hint "toCents(delta, scale)" does not work for MGA/MRU (conversion 5); add decimals instead: Sure balance -> exact decimal string, plus the scale-4 delta.

1. fix (own commit): formatAmount falls back to a plain number + code when Intl rejects the currency code (DOGE, USDC, USDT). Unit test first in src/domain/money.test.ts.
2. feat (domain): src/domain/currency.ts gets minorUnitConversion(currency): bigint from Sure config/currencies.yml at 131e786 (default 100n), with a comment why it differs from amountScale. src/domain/money.ts gets fromMinorUnits(cents, conversion) -> exact decimal string (BigInt; pick the smallest k with 10^k divisible by the conversion, so 5 -> one digit) and addDecimals(a, b) -> exact sum of two decimal strings. Unit tests: EUR, JPY, KWD, MGA (odd/even cents), BTC, ETH, negatives, -0.
3. feat (screen): src/features/balances/rows.ts, pure: balanceRows(accounts, deltas) -> { assets, liabilities }, each row { id, name, currency, balance, delta?, projected? }; active only, by name; liabilities keep Sure's positive "owed" sign. Unit tests in rows.test.ts (split, filter, sort, delta added for EUR/MGA/BTC, account without delta has none).
4. src/features/balances/balances.tsx: createLiveQuery over { accounts: db.accounts.toArray(), deltas: pendingDeltas() }; two sections with headings Assets / Liabilities (a section with no accounts is hidden); each row name + formatAmount(balance, currency), or "≈ projected" plus the muted "Sure balance · delta" line; empty state like the entry form ("Your Sure accounts appear here after the first sync."). Semantic tokens only, min-h-11 for controls.
5. src/app.tsx: signal view "entry" | "balances" inside the main fallback; header button "Balances" / "Entry" before Settings; the title, Sync paused and Settings stay. Settings opening/closing does not reset the view requirement-wise (keep it simple: view survives).
6. Tests (browser, shared db, afterEach(cleanup)): src/features/balances/balances.browser.test.tsx seeds accounts and outbox: (a) assets and liabilities in their regions with their currency; (b) a queued create shows ≈ with the projected value and the Sure line; (c) after the record is done with appliedAt and the account is rewritten with a newer balance and updatedAt >= appliedAt, ≈ disappears and the new balance shows; (d) failed record shows no ≈. src/app.browser.test.tsx: the header button opens Balances and returns to the form.
7. README: Structure line for currency.ts, a short "Balances" section next to "Recent list" (active only, projected value, minor_unit_conversion, ETH precision, no totals across currencies).
8. Checks: npm run typecheck, lint, unit + browser tests; lefthook on each commit.

Out of scope: totals per group (would need FX across currencies), showing draft accounts, Sure's 8 digits for BTC/DOGE/ETH (formatAmount rounds to amountScale = 4, like the Recent list).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Diverged from plan step 5: the header button toggles its label (Balances / Entry), and Entry + Recent stay mounted under a hidden wrapper instead of unmounting, so an amount typed before a look at the balances survives (covered in src/app.browser.test.tsx). The delta sign comes from the decimal string, not the formatted one, since some locales print U+2212.
Verification: npm test (398 passed, incl. src/features/balances/rows.test.ts and balances.browser.test.tsx), npm run typecheck, oxlint, oxfmt, npx playwright test (4 passed).
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-11-01T16:00:00Z

---

From TASK-9: render `pendingDeltas()` (src/sync/outbox.ts) through `createLiveQuery`. It returns `Map<accountId, string>`, a decimal at scale 4 in the direction of `balanceCents` (e.g. "-3.5000"); convert with `toCents(delta, scale)` once the currency → scale mapping exists (Sure minor_unit_conversion, not Intl; see TASK-4). Accounts with no delta are absent. Only creates and transfers carry a delta; an edited or deleted synced transaction shows no ≈ until Sure recalculates.

---

author: @claude
created: 2026-11-01T16:50:00Z

---

From TASK-11: the main screen is the `fallback` of the `<Show>` in `src/app.tsx`; Settings replaces it on first run, from the header Settings button and when sync is paused (`pausedAt` in meta). The header there also holds the "Sync paused" button. Build this screen inside that fallback rather than replacing `App`, and keep the header. Browser component tests share the app `db` (files run one at a time) and need `afterEach(cleanup)`, see `src/app.browser.test.tsx`.

---

author: @claude
created: 2026-11-01T17:54:00Z

---

From TASK-12: `amountScale(currency)` in src/domain/currency.ts is the precision of an entered amount (Sure `default_precision`, capped at 4), not the `minor_unit_conversion` that `balance_cents` and `toCents(delta, scale)` need: they differ for MGA/MRU (5, not a power of 10) and crypto (BTC 10^8, ETH 10^18). Add a separate mapping for balances from the same config/currencies.yml.

---

author: @claude
created: 2026-11-01T18:30:00Z

---

From TASK-13: formatAmount(decimal, currency, locale?) in src/domain/money.ts formats a display amount with amountScale digits and signs only negatives. It suits entered amounts; balance_cents still needs the minor_unit_conversion mapping noted above before it can be passed in.

---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Balances screen behind a header button (commits de339ca, 95944a5, 872b6b5).
- fix: formatAmount no longer throws for DOGE/USDC/USDT (Intl rejects non three-letter codes); prints the number and the code.
- domain: minorUnitConversion() from Sure config/currencies.yml (131e786), fromMinorUnits() and addDecimals() on BigInt, so balance_cents converts exactly for MGA/MRU (5), BTC (10^8) and ETH (10^18).
- screen: src/features/balances/rows.ts splits active accounts by classification and adds pendingDeltas(); balances.tsx renders Assets/Liabilities, and for a pending delta shows ≈ projected balance with Sure's balance and the signed delta under it. README gained a Balances section.
Tests: rows unit tests (split, filter, sort, currencies, deltas); browser tests for the split, ≈ on asset and liability, ≈ cleared after a pull with updatedAt >= appliedAt, no ≈ for failed; app test for the header toggle keeping a typed amount.
Known limits: ETH balances above 2^53 minor units are approximate (JSON.parse); crypto shows 4 digits like the recent list (Sure shows 8); no totals across currencies; draft accounts hidden.
<!-- SECTION:FINAL_SUMMARY:END -->
