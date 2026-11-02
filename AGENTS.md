<!-- BACKLOG.MD GUIDELINES START -->
<!-- backlog.md-instructions-version: 1.55.3 -->

<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management.

**At the beginning of each conversation in this project, run `backlog instructions overview` before answering or taking action. Re-read it only if you have not read it yet in the current conversation.**

Use the overview to decide whether to search, read, create, or update Backlog tasks.

Before task lifecycle actions, read the matching detailed guide:

- `backlog instructions task-creation` before creating or splitting tasks
- `backlog instructions task-execution` before planning, changing status or assignee, adding a plan or implementation notes, or implementing task work
- `backlog instructions task-finalization` before checking acceptance criteria, writing final summaries, or moving tasks to terminal statuses

Use `backlog <command> --help` before running unfamiliar commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->

## Project

`README.md` keeps what the code cannot say: purpose and scope, the architecture and sync overview, Sure API behaviour, the testing strategy and the reasons behind rejected alternatives. The code and its comments are the reference for everything else. Read the relevant README section before implementing. If a change contradicts it (a sync rule, a Sure behaviour, a stack constraint), update `README.md` in the same commit.

## Git

Conventional Commits (`feat:`, `fix:`, `chore:`, ...). No PRs, no feature branches: commit directly to `main`.

The lefthook pre-commit hook (lint, format, typecheck, tests) is the only gate before a commit; CI (`.github/workflows/ci.yml`) repeats the checks after every push to `main`. Never bypass the hook with `--no-verify` or `LEFTHOOK=0`; fix the cause. If the failure is unrelated to your change, stop and report it.

## Gotchas

- **Solid 2, not Solid 1.** No `createResource`, `Suspense`, `ErrorBoundary`, `batch` or single-argument `createEffect`. Use `<Loading>`, `<Errored>`, `createEffect(compute, apply)` and `flush()`. Check APIs at https://v2.solidjs.com/migration/from-solid-1.
- **Install every Solid package with an exact version** (see README → Tech stack). `solid-js@latest` is 1.x, so a plain `npm i` produces an incompatible mix.
- Tailwind scans only `src/**/*.tsx` (see `src/index.css`). Write whole class names (no `` `bg-${tone}` ``), use the semantic color tokens (the default palette is removed) and no `dark:` variants: the tokens switch with the system scheme.
- TypeScript 7: `openapi-typescript` and stable `@hey-api/openapi-ts` break on it, so use orval. kubb 5 was compared and rejected (multi-file runtime, no mutator; see README → Why these choices). Vitest 5.0 does not support Vite 9, so stay on Vite 8.
- Generated functions only type the statuses the spec declares. `sureFetch` throws `SureError` for 401, 429, 5xx, non-JSON bodies and network failures, so catch it alongside the returned union; don't add those statuses to the union by hand.
- The service worker is hand-written (`src/sw.ts`). Don't add `vite-plugin-pwa`, Workbox or Serwist (see README → Why these choices).
- `src/api/generated/` is orval output. Never edit it; regenerate with `npm run gen:api`.
- Read money from `amount_decimal`. Never parse `amount`, and don't use `amount_cents` / `signed_amount_cents`: they are not in the OpenAPI schema. On create, send a positive `amount` plus `nature`, and always send the account's `currency`.
- Store dates as local `YYYY-MM-DD`, never as ISO timestamps.
- The calculator is a hand-written parser. Never use `eval` or `new Function`.
- The outbox is the optimistic layer. Don't add Solid `action` / `createOptimistic` on top.
- No third-party or CDN-loaded scripts: any script on the origin can read the API key.
- The sync engine must not depend on the Background Sync API (not available on iOS).
