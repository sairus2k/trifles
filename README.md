# sure-quick-entry

> Working title. A minimalist, offline-first PWA for entering transactions into a self-hosted [Sure](https://github.com/we-promise/sure) instance from your phone in a few seconds.

**Status:** pre-alpha. The v1 scope is built; the check on a real iPhone is still pending.
**License:** MIT

---

## Why

Sure is a great personal finance app, but entering a cash expense on the go means opening the full web UI, navigating to an account and filling a long form. This project is a tiny companion app focused on one job: **capture a transaction in under five seconds, even without a connection**, and sync it to Sure later.

The UX is inspired by the classic Russian budgeting service _Drebedengi_: one keyboard-driven form that is always on screen, recent entries right below it, and balances one tap away.

## Principles

- **Offline-first.** The UI reads and writes only to a local database. The network is a background concern.
- **No backend of our own.** A static SPA that talks directly to the Sure API. Host it anywhere.
- **PWA.** Installable on iOS and Android, works from the home screen with no connection.
- **Minimal UI.** Three screens. No charts, no budgets, no settings sprawl.
- **Sure is the source of truth for data.** We never re-implement Sure's accounting logic (balances, signs, transfers); we cache what Sure returns.

## Scope

### v1

- **Entry form** with three tabs: **Expense / Income / Transfer**.
- **Calculator in the amount field:** `120+35.5-10` is evaluated on submit.
- **The form stays open after submit:** amount and note are cleared, account and category are kept, focus returns to the amount.
- **Merchant autocomplete** from history, which also pre-fills the category most often used with that merchant.
- **Recent transactions** grouped by day, with pending (unsynced) entries marked; tap to edit, swipe to delete.
- **Balances** per account, split into assets and liabilities, with a pending delta shown as `≈`. No totals: summing accounts in different currencies would need exchange rates.
- **Settings:** Sure instance URL and API key. A new key keeps the data on the device; another URL replaces it with that instance's (see Sync engine rules → Switching instance).

### Not in v1

- Currency exchange between accounts (see [Transfers](#transfers)).
- Tags (supported by the API, planned for v2).
- Budgets, reports, charts, splits, recurring transactions, investments.
- Multi-user or OAuth login.

## Architecture

```
UI (Solid 2): Entry · Recent · Balances · Settings          src/features/
   │  reads only from the local DB (live queries)           src/db/live.ts
   ▼
Local store (IndexedDB via Dexie)                           src/db/schema.ts
   ├─ accounts, categories, merchants   ← reference data cache
   ├─ transactions                      ← cache of the latest N from the server
   ├─ suggestions                       ← merchant → category usage stats
   └─ outbox                            ← pending writes
   ▲
   │
Sync engine (plain TS, no UI dependencies)                  src/sync/
   ├─ push: outbox → Sure API (sequential, idempotent)      push.ts, outbox.ts
   └─ pull: accounts, reference data, recent transactions → local cache  pull.ts
   ▼
Sure API (/api/v1, X-Api-Key)                               src/api/
```

The rest: `src/domain/` (calculator, money, currencies, local dates), `src/sw.ts` and `sw-plugin.ts` (service worker), `spec/` (the vendored Sure spec), `test/fake-sure/` (stateful fake of the Sure API), `test/contract/` and `e2e/`. Tables, keys and indexes are declared in `src/db/schema.ts`. The rules of the Recent list and the Balances screen are pure functions with unit tests in `src/features/recent/rows.ts` and `src/features/balances/rows.ts`.

### Data flow for a new transaction

1. The form validates input and writes **one outbox record** in a single Dexie transaction. The UI updates immediately through the live query.
2. The sync engine picks the record, sends `POST /api/v1/transactions` with `external_id = clientId`, and marks the record as done on `200` or `201`, keeping the transaction's `created_at` as `appliedAt`.
3. The engine pulls the affected account. Its balance replaces the pending delta (`pendingDeltas()`) once the account's `updated_at` is at or after `appliedAt`. Sure recalculates balances asynchronously, after it created the transaction, and renders both times on its own clock in whole seconds, so `>=` also clears a recalculation in the same second. The device clock is never compared with the server's. Only creates and transfers carry a delta: a `DELETE` answer has no server time.
4. A recent pull that started after the record was done removes it once its delta has cleared (`dropFinished()`), in the same Dexie transaction that replaces the cache. That pull has the transaction if it is among the latest 100, and never will otherwise (older, deleted in Sure, or on an account the key no longer reaches), so nothing else is waited for. A done `update` or `delete` carries no delta and goes on the first such pull.

### Sync engine rules

A summary; the reasons sit in comments next to the code that applies each rule (files under `src/sync/`).

- **Triggers** (`engine.ts`): app start, `online`, `visibilitychange → visible`, a 60 s timer while the app is visible, every outbox write, and a backing-off head becoming due. Never the Background Sync API (not available on iOS). No run starts while `navigator.onLine` is `false`.
- **One worker** (`engine.ts`, `SYNC_LOCK` in `outbox.ts`): a run holds a Web Lock, so only one tab processes the queue; triggers that fire during a run merge into one queued run.
- **Order and idempotency** (`outbox.ts`, `push.ts`): records go one at a time in creation order, and a head that is backing off or `sending` holds the queue. Every create sends `external_id` (the client UUID) and `source`, so retrying after an ambiguous failure is safe.
- **Answers** (`push.ts`):
  - `200` / `201`, or `404` to a `DELETE` → done.
  - `422` and any other returned `4xx` → `failed` with Sure's message; the queue continues.
  - `401`, `403` (a read-only key) or missing settings → pause.
  - `429`, `5xx`, network error, non-JSON answer, 30 s timeout → exponential backoff (2 s doubling, capped at 5 minutes, equal jitter).
  - `500` to a create → the account lookup, then the write probe (see Sure API notes): an account that is gone or read-only for the user fails the record, anything else is retried.
- **Pause** (`settings.ts`): `syncPausedAt` in `meta` holds across reloads and tabs until `saveSettings()` stores new settings.
- **Switching instance** (`settings.ts`, Settings screen): another URL clears the cache, the outbox and the rest of `meta` under the sync lock. With unsent records the user deletes them, keeps them (the same Sure under another address), or cancels. A new key for the same URL keeps everything.
- **Editing** (`isEditable()` in `outbox.ts`): a write that certainly is not on the server is rewritten or removed in the outbox; anything that may have reached Sure is locked. A synced transaction changes through a full-value `update` or a `delete`, which replaces a queued one for the same transaction. A `failed` record can be discarded.
- **Pull** (`pull.ts`, `engine.ts`): a run pushes first, then pulls. Reference data on the first online run of a session and after the URL changes; accounts and the latest 100 transactions after a push that sent something and on every other trigger except a write or a backoff wake-up. Each pull replaces the cache in one Dexie transaction, so a failed pull changes nothing.

### Transfers

The Sure API cannot create a transfer directly (`/api/v1/transfers` is read-only, and `POST /transactions` takes no transfer link). A transfer is sent as **two transactions**:

- an expense on the source account with `external_id = <clientId>:out`;
- an income on the destination account with `external_id = <clientId>:in`.

After the account sync, Sure's `auto_match_transfers!` pairs them into a transfer when the currency is the same and the dates are within its matching window. Each leg is idempotent on its own, so a partially sent transfer is safely resumed.

**Limitations:**

- If another pair with the same amount exists within the window, Sure may pair the wrong legs.
- Cross-currency pairs between manual accounts are **not** matched automatically (Sure restricts that to provider-linked accounts). This is why currency exchange is out of v1.

## Sure API notes

Verified against Sure `main` at commit `131e786` (2026-10-31). Pin the spec to the version of your instance.

- **Auth:** API key from _Settings → API Key_, scope `read_write`, sent as `X-Api-Key`.
- **Checking a key:** a read-only key reads like a `read_write` one. Settings sends `DELETE /api/v1/transactions/<random UUID>`: `TransactionsController` runs `ensure_write_scope` before it looks the transaction up, so a read-only key gets `403` and a `read_write` key `404`, and nothing changes. A CORS block and an unreachable host both fail with a bare `TypeError`; a follow-up `no-cors` request (no `X-Api-Key`, so no preflight) resolves only when the host answers.
- **CORS:** Sure enables `Rack::Cors` with `origins "*"` for `/api/*`, so the app can be hosted on any origin. A reverse proxy or Cloudflare Access in front of Sure must let `OPTIONS` preflight requests through to Rails.
- **Endpoints used in v1:**

  | Purpose        | Endpoint                                                                |
  | -------------- | ----------------------------------------------------------------------- |
  | Balances       | `GET /api/v1/accounts`                                                  |
  | Recent         | `GET /api/v1/transactions?per_page=100` (already reverse chronological) |
  | Create         | `POST /api/v1/transactions`                                             |
  | Edit / delete  | `PATCH`, `DELETE /api/v1/transactions/{id}`                             |
  | Reference data | `GET /api/v1/categories`, `GET /api/v1/merchants`                       |

- **Create payload:** send a positive `amount` and `nature: "expense" | "income"`. Sure stores expenses as positive and income as negative.
- **Merchants cannot be created through the API:** `POST /api/v1/merchants` is a CSV import, and a create takes only `merchant_id`. The form sends `merchant_id` for a name that matches a cached merchant and puts any other name in the transaction `name` only.
- **Currency:** always send the account's `currency`. If omitted, Sure falls back to the family currency, which is wrong for foreign-currency accounts.
- **Update payload:** `PATCH` ignores `null` fields, blank `category_id` / `merchant_id` and `currency`, so an update cannot clear a category or a merchant. Notes clear with `""`.
- **Unknown account on create:** Sure answers `500`, not `404`: `create` looks the account up with `writable_by` (owner or a `full_control` share) and rescues the `RecordNotFound` itself before the API's `rescue_from` can turn it into a `404`. `GET /accounts/{id}` looks it up with `accessible_by` (owner or any share) and answers `404`, so push asks it after a `500` to tell a deleted or unshared account from a transient failure. It cannot tell a `read_only` or `read_write` share, which every account of another member gets by default (`default_account_sharing: "shared"`): the account is listed and found, and the create keeps answering `500`.
- **Write probe:** no answer carries the user's permission on an account (the account JSON has no such field, and there is no account shares endpoint). `POST /recurring_transactions` resolves `account_id` with the same `writable_by` scope before it checks anything else and leaves the `RecordNotFound` to `rescue_from`: `404 record_not_found` without write access. With it, blank `last_occurrence_date` and `next_expected_date` fail the create before it saves: `422`, nothing created. The probe also sends `expected_day_of_month: 0`, which the model rejects, should a later Sure stop checking the dates. The contract suite pins these answers.
- **Amounts in responses:** use `amount_decimal` (exact, locale-independent, positive = outflow). `amount` is a formatted display string; do not parse it. Responses also contain `amount_cents` and `signed_amount_cents`, but **they are missing from the OpenAPI schema**, so they are not in the generated types; do not depend on them.
- **Balances are recalculated asynchronously** after a write. Expect a stale balance immediately after `201`. The recalculation ends with `account.update!(balance:, cash_balance:)`, which moves the account's `updated_at` only when the balance changes.
- **Rate limit** for self-hosted instances is 10,000 requests per hour per key.
- **Spec issues:** see `spec/README.md` → Known issues. Because of them orval needs `unsafeDisableValidation: true`.

## Tech stack

`package.json` pins every package to an exact version. Solid 2 is a release candidate: **install every Solid package with an exact version**. The `latest` dist-tag of `@solidjs/web` still points to `2.0.0-rc.0`, and `solid-js@latest` is 1.x, so a plain `npm i` produces an incompatible mix.

| Area                   | Package                                | Note                                  |
| ---------------------- | -------------------------------------- | ------------------------------------- |
| Language               | `typescript`                           | 7                                     |
| Build                  | `vite`                                 | 8: Vitest 5.0 does not support Vite 9 |
| UI                     | `solid-js`, `@solidjs/web`             | 2 (release candidate)                 |
| UI build               | `@solidjs/vite-plugin`                 |                                       |
| Styling                | `tailwindcss`, `@tailwindcss/vite`     | 4                                     |
| PWA                    | hand-written service worker            | no dependency                         |
| Local DB               | `dexie`                                |                                       |
| API client             | `orval` (fetch client)                 |                                       |
| Mocks                  | `msw`, `@faker-js/faker`               |                                       |
| Unit / component tests | `vitest`, `@vitest/browser-playwright` |                                       |
| Component testing      | `@solidjs/testing-library`             |                                       |
| IndexedDB in Node      | `fake-indexeddb`                       |                                       |
| E2E                    | `@playwright/test`                     |                                       |
| Lint / format          | `oxlint`, `oxfmt`                      | Tailwind class sorting on             |

### Why these choices

- **Dexie instead of TanStack DB.** Three entities and one write type do not justify a reactive collection engine that is still pre-1.0. Dexie gives storage and live queries; the outbox is ~200 lines we fully control.
- **orval.** Works with TypeScript 7 out of the box (its core does not use the compiler API), produces a single file, and types responses as a union discriminated by status, which maps directly onto outbox handling. `openapi-typescript` and the current stable `@hey-api/openapi-ts` require the TypeScript 5/6 compiler API and break on TypeScript 7. kubb 5 was run on the same spec and tags (2026-11-01) and also passed `tsc` 7, with a smaller install (~26 MB and 59 packages, against ~95 MB and 82 packages for orval, which installs every generator plugin and two nested copies of `typescript@6.0.3`). It lost on the output: it copies its own runtime client into three extra files (99 KB in total, against 35 KB for orval's single file), it has no mutator, so the content-type check would live in a custom `transport`, and its "optional" `@kubb/parser-ts` peer is required: without it kubb reports success and writes functions with no declarations. It also sends telemetry unless `KUBB_DISABLE_TELEMETRY=1` is set. The extra install size is dev-only and never reaches the bundle.
- **Tailwind 4 through `@tailwindcss/vite`.** Every screen gets the same tokens instead of inventing its own styles. It runs only at build time and loads no script, so the rule against third-party and CDN scripts holds (the Play CDN script is never used). Its CSS holds only the classes the app uses: `src/index.css` limits scanning to the components, because automatic detection also reads the README, the backlog and the sync code and turns words like `block` or `table` into CSS. The theme keeps only semantic colors (`--color-*: initial`), each a `light-dark()` pair, so the app follows the system scheme with no `dark:` variants; lightningcss compiles `light-dark()` down for older Safari. The install is dev-only (7 packages plus platform binaries, ~14 MB, with Tailwind's own pinned `lightningcss`). oxfmt sorts the classes with the same algorithm as `prettier-plugin-tailwindcss`.
- **Solid 2.** A small project with almost no ecosystem dependencies is a good place to adopt it early. AI coding assistants mostly know Solid 1 and suggest `createResource`, `Suspense`, `batch` and single-argument `createEffect`; `npm run typecheck` rejects them, since Solid 2 neither exports nor types the removed APIs, so no separate migration analyzer is needed.
- **A hand-written service worker instead of `vite-plugin-pwa` or Serwist.** The worker only precaches the app shell and serves `index.html` for navigations; data lives in Dexie, so no runtime caching is needed. Prototypes of both options (2026-11-01) passed the same offline E2E suite: Serwist added 19 packages and a 10 kB (gzip) `sw.js`, the hand-written worker is ~75 lines (worker plus a small Vite plugin that injects the precache list and a content hash) and a 0.8 kB `sw.js`. `vite-plugin-pwa` pulls in ~266 packages through `workbox-build` and pins Vite to 8.

## Mobile details

What the markup does not explain; persistent storage, the status bar and `theme-color` are explained where they are set (`src/features/settings/settings.tsx`, `index.html`).

- The viewport covers the notch (`viewport-fit=cover`), so screens pad themselves with the `pt-safe`, `px-safe` and `pb-safe` utilities from `src/index.css`; without them the header sits under the status bar and the last button under the home indicator in standalone mode.
- Every button and input is at least 44 px tall (`min-h-11`), and inputs use 16 px text (`text-base`): iOS Safari zooms the page in when it focuses a field with smaller text.
- The amount field uses `inputmode="decimal"` plus an on-screen operator row (`+ − × ÷`), because the decimal keyboard has no operators.

## Testing

Effort follows risk: most of the complexity is in the sync engine, so most of the tests are there.

1. **Sync engine** in the Node project (Vitest + `fake-indexeddb` + `msw/node` + the stateful fake in `test/fake-sure/`). The engine is plain TS with no Solid, and every Node test file gets its own `fake-indexeddb`, so the app's shared `db` needs no per-file isolation. The engine's triggers run here too: `window`, `document` and `navigator.onLine` are stubbed with `vi.stubGlobal`, and fake timers cover `setTimeout` and `setInterval` (fake-indexeddb schedules with `setImmediate`, which stays real). Browser mode is not an option for sync tests: browser test files share one origin and the app's `db`, and `schema.browser.test.tsx` deletes it. The E2E tests cover real `online` and offline.
2. **Contract tests** against a real Sure in Docker (`test/contract/`), on the commit pinned in `spec/README.md`. They check that the fake's assumptions hold. Run `npm run test:contract` before upgrading Sure, not on every commit: it needs Docker, and the first run pulls the Sure image (about 1 GB). The stack listens on `127.0.0.1:3999` (`SURE_CONTRACT_PORT` changes the port) and is removed afterwards; `KEEP_SURE=1` leaves it running for inspection. The suite has its own config (`vitest.contract.config.ts`), so `npm test` and the pre-commit hook never start Docker.
3. **Components** in Vitest browser mode with Playwright (real IndexedDB). The Dexie schema and `createLiveQuery()` are tested here too: the node project resolves `solid-js` to its non-reactive server build. Browser test files share one origin, and `schema.browser.test.tsx` deletes the app's `db`, so they run one file at a time (`fileParallelism: false`) and a test that is not about the app's `db` opens its own uniquely named database. `@solidjs/testing-library` registers no automatic cleanup without Vitest globals, so a file that renders components calls `cleanup()` in `afterEach`. A browser test that needs Sure starts `setupWorker(...sure.handlers)` from `msw/browser` (see `test/fake-sure/fake-sure.browser.test.tsx`).
4. **E2E** with Playwright against `vite preview` (`e2e/`): offline start and sync, a build under a sub-path, service worker updates, CORS and the built CSS. `e2e/fake-sure.ts` answers `https://sure.test` with the stateful fake through `context.route`. A route keeps answering while the context is offline, so the helper's `setOffline()` makes it abort too; `route.fulfill` skips the browser's CORS check, so `e2e/cors.spec.ts` starts a real server on a second origin; and the browser's update check bypasses `page.route`, so `e2e/update.spec.ts` rewrites the served `dist/sw.js`.
5. **Manual checklist on a real iPhone** (TASK-23): install to home screen, storage persistence after several days, decimal keyboard and operator row.

orval's generated MSW handlers (`mock: true`) always answer `200` and fill fields with random strings, so the sync engine tests use the hand-written fake instead, and the client is generated without them. Seed faker in test setup.

## Getting started

Requires Node.js 22.18 or newer.

```sh
npm install                       # also installs the lefthook pre-commit hook
npx playwright install chromium   # browser for component and E2E tests
npm run gen:api      # orval: spec/sure-openapi.yaml → src/api/generated
npm run dev          # Vite dev server
npm run typecheck    # tsc (TypeScript 7)
npm run lint         # oxlint
npm run format       # oxfmt (format:check to verify only)
npm test             # Vitest: Node and browser-mode projects
npm run test:e2e     # Playwright against `vite preview`
npm run test:contract # contract tests against a real Sure in Docker
npm run build        # static build in dist/
```

### Pre-commit hook

Commits go straight to `main`, so [lefthook](https://lefthook.dev) checks every commit (`lefthook.yml`). The checks run in parallel:

| Check     | Command                                  | Runs on                                              |
| --------- | ---------------------------------------- | ---------------------------------------------------- |
| lint      | `oxlint --deny-warnings` (warnings fail) | staged files                                         |
| format    | `oxfmt --check`                          | staged files                                         |
| typecheck | `npm run typecheck`                      | the whole project; skipped for Markdown-only commits |
| test      | `npm test` (Node and browser projects)   | the whole project; skipped for Markdown-only commits |

After every push to `main`, CI (`.github/workflows/ci.yml`) runs lint and format on the whole tree, typecheck, the build, `npm test` and the E2E suite.

The browser tests need Chromium (`npx playwright install chromium`). Typecheck and tests see the working tree, not only the staged changes. In an emergency, `git commit --no-verify` or `LEFTHOOK=0` skips the hook.

### Updating the Sure spec

See `spec/README.md` → Updating: copy the spec from the Sure commit your instance runs, regenerate the client, record the commit and run the contract tests against it.

## Deployment

The build output is static files. Any host works: GitHub Pages, Cloudflare Pages, or a location on the same reverse proxy as Sure.

- Serve the app from its own path when it shares a domain with Sure, and build with that path as the base (`vite build --base=/quick/`). The service worker is registered with the base as its scope, and the manifest's `scope` and `start_url` are `"./"`, relative to the manifest, so the worker never intercepts Sure itself.
- The service worker serves the cached app shell first. A new build is picked up on the next visit and applies after a reload.
- If Sure is behind Cloudflare Access, add a bypass policy for `/api/*` (the API key protects it), or the API calls will be redirected to the login page.

## Security

- The API key has full `read_write` access and is stored in IndexedDB on the device. Treat the device as trusted.
- **No third-party scripts:** no analytics, no CDN-loaded code. Any script on the app's origin can read the key.
- Revoke the key in Sure if a device is lost.

## Roadmap

- **v1:** everything in [Scope → v1](#v1).
- **v2:** tags; currency exchange (with a manual-match hint in Sure); quick-entry templates.
- **Later:** share target ("share a receipt photo"), widgets, splits.

## Contributing

Issues and pull requests are welcome. Please keep the app small: every new feature should make entering a transaction faster, not the app bigger.

## License

MIT. See [LICENSE](LICENSE).

This project is not affiliated with Sure or Maybe Finance.
