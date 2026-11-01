---
id: TASK-4
title: 'Domain helpers: amount calculator, money and local dates'
status: To Do
assignee: []
created_date: '2026-11-01T08:52:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-1
priority: high
type: feature
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The amount field accepts expressions like `120+35.5-10`, evaluated on submit. Running `eval` or `new Function` on user input is forbidden. Money must stay exact (Sure returns `amount_decimal` as a decimal string). Dates must be local `YYYY-MM-DD`; ISO timestamps put an entry made at 00:30 on the previous day.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The calculator supports `+ − × ÷`, decimal point and comma, and operator precedence, without `eval` or `new Function`
- [ ] #2 Invalid expressions, division by zero and non-positive results are rejected with a clear error
- [ ] #3 Money helpers convert between decimal strings and cents without floating-point drift
- [ ] #4 Today’s date helper returns the local date: a test with `vi.setSystemTime` at 00:30 Europe/Paris yields the correct day
- [ ] #5 All helpers have unit tests
<!-- AC:END -->
