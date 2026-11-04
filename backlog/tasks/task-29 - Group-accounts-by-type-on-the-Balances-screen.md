---
id: TASK-29
title: Group accounts by type on the Balances screen
status: Done
assignee:
  - '@claude'
created_date: '2026-11-03T19:59:00Z'
updated_date: '2026-11-04T08:27:00Z'
labels: []
dependencies: []
priority: medium
type: feature
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Balances screen (`src/features/balances/`) splits accounts only into Assets and Liabilities, each a single list by name. With several accounts the user has to scan the whole list; Sure's own accounts page groups them by type (cash, investments, crypto, credit cards, loans and so on), and the app should read the same way. Sure returns the type as `account_type` on every account (a free string in the spec, nullable, no enum), but the local `AccountRecord` does not store it yet, so the pull has to keep it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Within Assets and Liabilities, accounts are grouped by their Sure account type, each group under a heading with the type's name as Sure shows it, accounts within a group sorted by name
- [x] #2 Groups follow Sure's order of types; a type the app does not know and a null `account_type` go to a trailing "Other" group of their classification instead of being dropped
- [x] #3 Groups with no active accounts are not shown; pending deltas and the projected balance still show on each row as before
- [x] #4 The account type is stored by the sync pull and reaches the local database of an existing install without a reinstall
- [x] #5 The `account_type` values the app maps are confirmed against a real Sure (contract test) and covered by the fake Sure seed
- [x] #6 Unit tests in `src/features/balances/rows.test.ts` cover grouping, order and unknown types; the browser test covers the group headings
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. AccountRecord gets an optional accountType (Sure's account_type; absent for null and for records cached before this change). toAccount stores it, so the next pull fills existing installs; no Dexie version needed for a non-indexed field. Pull tests cover both.
2. balances/rows.ts: ACCOUNT_TYPES in Sure's Accountable::TYPES order with the plural English labels of accounts.types_plural (read from the pinned image). balanceGroups returns per classification a list of { title, rows }; an unknown or missing type joins Sure's own trailing group of its classification (Other Assets / Other Liabilities) instead of a second near-duplicate 'Other'. Unit tests: grouping, order, unknown and null types, empty groups.
3. balances.tsx: a heading per type group under Assets / Liabilities; rows unchanged. Browser test for the headings.
4. Contract: seed.rb adds one account per non-Depository type; a contract test checks the account_type of each against the keys of ACCOUNT_TYPES. The fake seed's account() takes the app's type keys, so the fake can only use confirmed values.
5. README: feature line and a Sure API behaviour note on account_type.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Order and names read from the pinned image (ghcr.io/we-promise/sure:sha-131e786): app/models/concerns/accountable.rb TYPES, BalanceSheet::ClassificationGroup#account_groups, config/locales/views/accounts/en.yml types_plural, api/v1/accounts/_account.json.jbuilder. Unknown or null types join Sure's own Other Assets / Other Liabilities group rather than a separate 'Other', which would sit next to a near-identical heading. accountType is optional on AccountRecord (null from Sure and records cached before this change), so no Dexie version bump. The fake seed is checked to use only confirmed types; it was not extended with more accounts. Verified: full vitest (463), e2e (12), contract suite against the pinned Sure (17).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Pull now keeps Sure's `account_type` as optional `accountType`; the next pull fills it on an existing install. `balanceGroups` in `src/features/balances/rows.ts` returns per classification a list of type groups in the order of Sure's `Accountable::TYPES`, titled with Sure's English plural names (Cash, Investments, ..., Other Liabilities); an unknown or missing type goes to the classification's Other group, groups with no active accounts disappear, rows and pending deltas are unchanged. The screen shows an h3 per group under Assets / Liabilities. Contract seed creates one account of every type and a contract test checks that the returned account_type values are exactly the app's keys; a fake-sure test checks the fake seed uses only those values. README: feature line and an Account type note in Sure API behaviour. Risk: the labels are English and copied from Sure; a new type in a future Sure lands in Other until ACCOUNT_TYPES learns it, and the contract test fails on the upgrade.
<!-- SECTION:FINAL_SUMMARY:END -->
