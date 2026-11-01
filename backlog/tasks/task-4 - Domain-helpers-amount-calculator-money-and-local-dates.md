---
id: TASK-4
title: 'Domain helpers: amount calculator, money and local dates'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-01T08:52:00Z'
updated_date: '2026-11-01T14:18:00Z'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Approved 2026-11-01.

Research findings:
- Sure serialises amount_decimal with BigDecimal#to_s("F") ("12.5", "100.0", "-3.1234"); entries.amount is decimal(19,4), so up to 4 fraction digits, more than most currencies.
- Sure computes balance_cents as (amount * currency.minor_unit_conversion).round(0): half away from zero, factor from its own config/currencies.yml.
- Intl currency digits differ from Sure's minor_unit_conversion for 35 of 182 currencies (COP, IDR, PKR, IQD, crypto; Intl throws for USDT/DOGE; MGA/MRU use 5). Do not derive the scale from Intl.
- Create body types amount as number: the outbox keeps the exact decimal string, Number() happens at send time (TASK-8).
- Assigning process.env.TZ at runtime has no effect in worker_threads but works under the default Vitest 5 pool (spiked), so the date test sets TZ itself and restores it.

Decisions (user): helpers take an explicit scale (currency -> scale mapping is TASK-9/14); the calculator rounds the result half away from zero to scale.

1. src/domain/money.ts, tests first: toCents(decimal, scale) parses ^-?\d+(\.\d+)?$, rounds extra digits half away from zero, throws on malformed input or beyond MAX_SAFE_INTEGER; fromCents(cents, scale) formats (-5, 2) -> "-0.05", (12345, 0) -> "12345". String/BigInt only, no parseFloat or *100. Tests: 1.005 -> 101, 0.29 -> 29, negatives, scale 0 and 3, round trip, malformed input.
2. src/domain/calc.ts, tests first: evaluateAmount(input, scale) -> { ok: true, value } | { ok: false, error, message }, error in empty | invalid | division-by-zero | not-positive. Tokens: + - − * × / ÷, one . or , per number, spaces. Recursive descent with × ÷ precedence; no parentheses or unary minus. Exact BigInt rational arithmetic, one rounding at the end; intermediate negatives allowed; <= 0 after rounding -> not-positive. English messages.
3. src/domain/dates.ts, tests first: toLocalDate(date) and todayLocal() from local getters. Test with TZ=Europe/Paris and vi.setSystemTime: 00:30 CET 2026-11-02 -> "2026-11-02" (ISO would say 11-01), plus a CEST case.
4. Remove src/domain/.gitkeep; typecheck, lint, format, test pass; README changes only if the API diverges from Project structure.

Out of scope: currency -> scale mapping (TASK-9/14), display formatting (TASK-14), form error UI (TASK-12), Number() at send time (TASK-8).
<!-- SECTION:PLAN:END -->
