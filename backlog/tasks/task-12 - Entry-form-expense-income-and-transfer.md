---
id: TASK-12
title: 'Entry form: expense, income and transfer'
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
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
