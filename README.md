# sure-quick-entry

> Working title. A minimalist, offline-first PWA for entering transactions into a self-hosted [Sure](https://github.com/we-promise/sure) instance from your phone in a few seconds.

**Status:** pre-alpha, design phase.
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
- **Balances** per account, split into assets and liabilities, with a pending delta shown as `≈`.
- **Settings:** Sure instance URL and API key.

### Not in v1

- Currency exchange between accounts (see [Transfers](#transfers)).
- Tags (supported by the API, planned for v2).
- Budgets, reports, charts, splits, recurring transactions, investments.
- Multi-user or OAuth login.

## Architecture

```
UI (Solid 2): Entry · Recent · Balances · Settings
   │  reads only from the local DB (live queries)
   ▼
Local store (IndexedDB via Dexie)
   ├─ accounts, categories, merchants   ← reference data cache
   ├─ transactions                      ← cache of the latest N from the server
   ├─ suggestions                       ← merchant → category usage stats
   └─ outbox                            ← pending writes
   ▲
   │
Sync engine (plain TS, no UI dependencies)
   ├─ push: outbox → Sure API (sequential, idempotent)
   └─ pull: accounts, reference data, recent transactions → local cache
   ▼
Sure API (/api/v1, X-Api-Key)
```

### Data flow for a new transaction

1. The form validates input and writes **one outbox record** in a single Dexie transaction. The UI updates immediately through the live query.
2. The sync engine picks the record, sends `POST /api/v1/transactions` with `external_id = clientId`, and marks the record as done on `200` or `201`.
3. The engine pulls the affected account. Its balance replaces the pending delta once the account's `updated_at` is newer than the send time (Sure recalculates balances asynchronously).

### Local schema (Dexie)

| Table          | Key            | Notes                                                                                                                |
| -------------- | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `accounts`     | `id`           | `name`, `currency`, `classification` (asset/liability), `balanceCents`, `status`, `updatedAt`                        |
| `categories`   | `id`           | `name`, `color`, `icon` (Sure no longer has category classification)                                                 |
| `merchants`    | `id`           | `name`                                                                                                               |
| `transactions` | `id`           | Server transactions; index on `date` and `accountId`                                                                 |
| `suggestions`  | `merchantName` | `merchantId`, `categoryId`, `count`, `lastUsedAt`                                                                    |
| `outbox`       | `clientId`     | `op`, `payload`, `status`, `attempts`, `nextAttemptAt`, `lastError`, `createdAt`; index on `createdAt` (queue order) |
| `meta`         | `key`          | Instance URL, API key, last pull timestamps                                                                          |

Outbox `op` is one of `create`, `transfer`, `update`, `delete`. Status is `pending | sending | failed | done`.

### Sync engine rules

- **Triggers:** app start, `online`, `visibilitychange → visible`, after every enqueue, and a timer while the app is open. Do **not** rely on the Background Sync API (not available on iOS).
- **One worker:** wrap the push loop in `navigator.locks.request('outbox', …)` so only one tab processes the queue.
- **Sequential:** records are sent one at a time, in creation order.
- **Idempotency:** every create sends `external_id` (the client UUID) and `source: "sure-quick-entry"`. Sure returns `200` with the existing transaction if that account already has one with that pair (the key is scoped to the account), so **retrying after any ambiguous failure is safe**.
- **Error handling:**
  - `200` / `201` → done.
  - `422` → `failed`, shown in the UI with the server message; the queue continues.
  - `401` → pause the queue and send the user to Settings.
  - `5xx`, network error, timeout → retry with exponential backoff and jitter.
- **Editing pending records:** editing or deleting a record that has not been sent yet rewrites or removes the outbox entry instead of queuing a second operation. This is allowed only while the write certainly is not on the server: a `create` or `transfer` never attempted, or a `create` that failed with a definitive answer (`422`, `404`). Anything that may have reached Sure (`sending`, retrying after an attempt, a failed transfer with one leg possibly sent, `done`) is locked: a retry with the same `external_id` would answer `200` with the old values, and a changed account would create a second transaction. Once `done`, an edit goes out as an `update`.
- **Editing synced transactions** enqueues `update` (full values; `PATCH` cannot change the account) or `delete`. A queued `update` or `delete` for the same transaction is overwritten instead of queuing another one, unless it is already `sending`.
- **Pull:** accounts, categories and merchants on every online start; the latest 100 transactions after every successful push and on demand.

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
- **CORS:** Sure enables `Rack::Cors` with `origins "*"` for `/api/*`, so the app can be hosted on any origin. A reverse proxy or Cloudflare Access in front of Sure must let `OPTIONS` preflight requests through to Rails.
- **Endpoints used in v1:**

  | Purpose        | Endpoint                                                                    |
  | -------------- | --------------------------------------------------------------------------- |
  | Balances       | `GET /api/v1/accounts`                                                      |
  | Recent         | `GET /api/v1/transactions?per_page=100` (already reverse chronological)     |
  | Create         | `POST /api/v1/transactions`                                                 |
  | Edit / delete  | `PATCH`, `DELETE /api/v1/transactions/{id}`                                 |
  | Reference data | `GET /api/v1/categories`, `GET /api/v1/merchants`, `POST /api/v1/merchants` |

- **Create payload:** send a positive `amount` and `nature: "expense" | "income"`. Sure stores expenses as positive and income as negative.
- **Currency:** always send the account's `currency`. If omitted, Sure falls back to the family currency, which is wrong for foreign-currency accounts.
- **Amounts in responses:** use `amount_decimal` (exact, locale-independent, positive = outflow). `amount` is a formatted display string; do not parse it. Responses also contain `amount_cents` and `signed_amount_cents`, but **they are missing from the OpenAPI schema**, so they are not in the generated types; do not depend on them.
- **Balances are recalculated asynchronously** after a write. Expect a stale balance immediately after `201`.
- **Rate limit** for self-hosted instances is 10,000 requests per hour per key.
- **Spec issues:** three path parameters (`family_exports/{id}`, `family_exports/{id}/download`, `syncs/{id}`) put `format` outside `schema`, which fails strict validation. orval needs `unsafeDisableValidation: true`.

## Tech stack

Pinned versions as of 2026-10-31. Solid 2 is a release candidate: **install every Solid package with an exact version**. The `latest` dist-tag of `@solidjs/web` still points to `2.0.0-rc.0`, and `solid-js@latest` is 1.x, so a plain `npm i` produces an incompatible mix.

| Area                   | Package                                | Version                                    |
| ---------------------- | -------------------------------------- | ------------------------------------------ |
| Language               | `typescript`                           | 7.0.2                                      |
| Build                  | `vite`                                 | 8.3.5 (Vitest 5.0 does not support Vite 9) |
| UI                     | `solid-js`, `@solidjs/web`             | 2.0.0-rc.20                                |
| UI build               | `@solidjs/vite-plugin`                 | 3.0.0-next.54                              |
| PWA                    | hand-written service worker            | no dependency                              |
| Local DB               | `dexie`                                | 4.4.7                                      |
| API client             | `orval` (fetch client)                 | 8.46.0                                     |
| Mocks                  | `msw`, `@faker-js/faker`               | 3.0.3, 10.6.0                              |
| Unit / component tests | `vitest`, `@vitest/browser-playwright` | 5.0.5                                      |
| Component testing      | `@solidjs/testing-library`             | 1.0.0-rc.2                                 |
| IndexedDB in Node      | `fake-indexeddb`                       | 6.2.7                                      |
| E2E                    | `@playwright/test`                     | 1.64.1                                     |
| Lint / format          | `oxlint`, `oxfmt`                      | 1.90.0, 0.75.0 (default settings)          |

### Why these choices

- **Dexie instead of TanStack DB.** Three entities and one write type do not justify a reactive collection engine that is still pre-1.0. Dexie gives storage and live queries; the outbox is ~200 lines we fully control.
- **orval.** Works with TypeScript 7 out of the box (its core does not use the compiler API), produces a single file, and types responses as a union discriminated by status, which maps directly onto outbox handling. `openapi-typescript` and the current stable `@hey-api/openapi-ts` require the TypeScript 5/6 compiler API and break on TypeScript 7. kubb 5 was run on the same spec and tags (2026-11-01) and also passed `tsc` 7, with a smaller install (~26 MB and 59 packages, against ~95 MB and 82 packages for orval, which installs every generator plugin and two nested copies of `typescript@6.0.3`). It lost on the output: it copies its own runtime client into three extra files (99 KB in total, against 35 KB for orval's single file), it has no mutator, so the content-type check would live in a custom `transport`, and its "optional" `@kubb/parser-ts` peer is required: without it kubb reports success and writes functions with no declarations. It also sends telemetry unless `KUBB_DISABLE_TELEMETRY=1` is set. The extra install size is dev-only and never reaches the bundle.
- **Solid 2.** A small project with almost no ecosystem dependencies is a good place to adopt it early.
- **A hand-written service worker instead of `vite-plugin-pwa` or Serwist.** The worker only precaches the app shell and serves `index.html` for navigations; data lives in Dexie, so no runtime caching is needed. Prototypes of both options (2026-11-01) passed the same offline E2E suite: Serwist added 19 packages and a 10 kB (gzip) `sw.js`, the hand-written worker is ~75 lines (worker plus a small Vite plugin that injects the precache list and a content hash) and a 0.8 kB `sw.js`. `vite-plugin-pwa` pulls in ~266 packages through `workbox-build` and pins Vite to 8.

## Project structure

```
spec/
  sure-openapi.yaml        vendored spec, pinned to a Sure commit
src/
  api/
    generated/             orval output, do not edit
    http.ts                orval mutator: base URL, X-Api-Key, error normalisation
  db/
    schema.ts              Dexie schema and migrations
    live.ts                createLiveQuery() bridge to Solid
  sync/
    outbox.ts              enqueue, edit and remove pending writes; next, mark done/failed
    push.ts                send loop, backoff, idempotency
    pull.ts                reference data and recent transactions
    engine.ts              triggers, Web Lock, lifecycle
  domain/
    calc.ts                amount expression parser (no eval)
    money.ts               decimal string helpers
    dates.ts               local YYYY-MM-DD dates
  features/
    entry/  recent/  balances/  settings/
  app.tsx
  main.tsx
  sw.ts                    service worker: precache the shell, offline navigation
public/
  manifest.webmanifest
test/
  fake-sure/               stateful MSW fake of the Sure API
e2e/
```

## Implementation notes

### API client

`orval.config.ts`:

```ts
import { defineConfig } from "orval";

export default defineConfig({
  sure: {
    input: {
      target: "./spec/sure-openapi.yaml",
      unsafeDisableValidation: true,
      filters: { tags: ["Accounts", "Transactions", "Categories", "Merchants"] },
    },
    output: {
      target: "./src/api/generated/sure.ts",
      client: "fetch",
      mode: "single",
      override: {
        mutator: { path: "./src/api/http.ts", name: "sureFetch" },
      },
    },
    hooks: { afterAllFilesWrite: "oxfmt" },
  },
});
```

- Only the tags v1 uses are generated (~1,300 lines instead of ~10,600 for the whole spec). Add a tag to `filters` when a feature needs it.
- No MSW mocks are generated: the sync tests use the hand-written fake in `test/fake-sure/`. Add them in a separate file if a consumer appears, so the client never imports `msw` or faker.
- The output is formatted by oxfmt, so a spec update produces a readable diff.

Each generated function resolves to `{ status, data, headers }`, typed as a union of the statuses **the spec declares** for that operation (for `POST /transactions`: `200 | 201 | 422`). The mutator (`src/api/http.ts`) makes that type honest:

- It adds the instance URL (set with `configureSure({ baseUrl, apiKey })`) and `X-Api-Key`.
- It reads the body as text and checks the status and `content-type` **before** parsing JSON.
- It returns JSON responses with a 2xx or 4xx status, except 401 and 429, as `{ status, data, headers }`. This includes `422` with the server message.
- It throws `SureError` with `kind` and `status` for everything else: `http` for 401, 429 and 5xx (whatever the body, since a proxy may answer with HTML and the spec rarely declares them), `not-json` for a non-JSON or malformed body (for example a proxy login page with `200`), `network` when the request or body read fails, and `not-configured` without settings.

### Solid ↔ Dexie bridge

`src/db/live.ts` wraps a Dexie `liveQuery` in Solid 2's `from()` inside a `createMemo`:

```ts
const accounts = createLiveQuery(() => db.accounts.toArray());
const recent = createLiveQuery(accountId, (id) =>
  db.transactions.where("accountId").equals(id).toArray(),
);
```

- `from()` closes the Dexie subscription when the memo re-runs and when its owner is disposed, so there is no hand-written `onCleanup`.
- Until the first result arrives the accessor is pending: render it inside `<Loading>`. A failed query surfaces in `<Errored>`.
- Dexie runs the query outside Solid's tracking, so a signal read inside the query is **not** tracked. Pass reactive parameters (for example an account filter) as the first argument; when it changes, the old subscription closes and a new one opens.

**Do not add a second optimistic layer** with Solid's `action` / `createOptimistic`: the outbox already is the optimistic layer.

### Solid 2 gotchas

- Signal writes are applied on a microtask; `batch` is gone. Call `flush()` when you need to read a value right after writing it (for example reset a field and focus it).
- `createEffect` takes two functions: `createEffect(compute, apply)`.
- `Suspense` → `<Loading>`, `ErrorBoundary` → `<Errored>`, `For` and `Index` are merged.
- **AI coding assistants mostly know Solid 1** and will suggest `createResource`, `Suspense`, `batch` and single-argument `createEffect`. `npm run typecheck` rejects them: the removed APIs are not exported or typed in Solid 2, so no separate migration analyzer is needed. Point agents to [v2.solidjs.com](https://v2.solidjs.com/migration/from-solid-1).

### Mobile details

- Call `navigator.storage.persist()` on first run. On iOS, an app installed to the home screen is exempt from the 7-day storage eviction that applies to Safari tabs; an unsent outbox must not be lost.
- The amount field uses `inputmode="decimal"` plus an on-screen operator row (`+ − × ÷`), because the decimal keyboard has no operators.
- Dates are stored as local `YYYY-MM-DD`, never as ISO timestamps; otherwise an entry made at 00:30 lands on the previous day.
- The calculator is a small expression parser. Never use `eval` or `new Function`.

## Testing

Effort follows risk: most of the complexity is in the sync engine, so most of the tests are there.

1. **Sync engine** in the Node project (Vitest + `fake-indexeddb` + `msw/node` + the stateful fake in `test/fake-sure/`). The engine is plain TS with no Solid, and every Node test file gets its own `fake-indexeddb`, so the app's shared `db` needs no per-file isolation. The fake answers `201` for a new account + `external_id` + `source` and `200` with the existing transaction for a repeat, moves the account balance and `updated_at` (whole seconds, like Sure) after a write or holds them with `pauseAccountSync()`, and `failNext(route, fault)` makes the next request to a route answer a status (`401`, `422`, `500`…), drop the connection, or apply the write and lose the response. Required scenarios:
   - request reaches the server, response is lost → retry → `200` → no duplicate;
   - `422` → `failed`, the queue continues;
   - `401` → the queue pauses, no retry loop;
   - `500` then `201` → backoff works;
   - offline enqueue → `online` → push;
   - pending balance delta clears only after a newer account `updated_at`;
   - transfer with one leg sent and one failed → resumes correctly;
   - two concurrent sync triggers → one worker;
   - `vi.setSystemTime` at 00:30 Europe/Paris → correct local date.
2. **Contract tests** against a real Sure in Docker, on the same version as your instance. Run before upgrading Sure, not on every commit:
   - repeated `external_id` returns `200`;
   - `nature: "expense"` stores a positive amount;
   - two opposite transactions are auto-matched into a transfer;
   - balance update latency.
3. **Components** in Vitest browser mode with Playwright (real IndexedDB): entry form (sign, calculator, sticky account/category), pending rows. The Dexie schema and `createLiveQuery()` are tested here too: the node project resolves `solid-js` to its non-reactive server build. Browser test files run in parallel, so a test that is not about the app's `db` opens its own uniquely named database. A browser test that needs Sure starts `setupWorker(...sure.handlers)` from `msw/browser`; the browser project serves the worker script through `msw/vite` in `worker-only` mode (see `test/fake-sure/fake-sure.browser.test.tsx`).
4. **E2E** with Playwright: install the service worker → `context.setOffline(true)` → reload → app loads; enter offline → pending row → back online → synced.
5. **Manual checklist on a real iPhone:** install to home screen, storage persistence after several days, decimal keyboard and operator row.

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

The browser tests need Chromium (`npx playwright install chromium`). Typecheck and tests see the working tree, not only the staged changes. In an emergency, `git commit --no-verify` or `LEFTHOOK=0` skips the hook.

### Updating the Sure spec

```sh
# take docs/api/openapi.yaml from the Sure commit your instance runs
git -C ../sure show <commit>:docs/api/openapi.yaml > spec/sure-openapi.yaml
npm run gen:api
```

Record the Sure commit in `spec/README.md`. Keep the spec byte for byte as upstream (it is excluded from oxfmt).

## Deployment

The build output is static files. Any host works: GitHub Pages, Cloudflare Pages, or a location on the same reverse proxy as Sure.

- Set the web app manifest `scope` and `start_url` to the path the app is served from, so the service worker never intercepts Sure itself when both share a domain.
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

Issues and pull requests are welcome once the scaffold is in place. Please keep the app small: every new feature should make entering a transaction faster, not the app bigger.

## License

MIT. See [LICENSE](LICENSE).

This project is not affiliated with Sure or Maybe Finance.
