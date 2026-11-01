---
id: TASK-12
title: 'Entry form: expense, income and transfer'
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T16:50:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-4
  - TASK-7
  - TASK-9
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
