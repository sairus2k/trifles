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

Pre-alpha: nothing is scaffolded yet. `README.md` is the design document (architecture, sync rules, pinned stack, testing plan). Read the relevant section before implementing. If the implementation has to diverge from it (a version, the structure, a sync rule), update `README.md` in the same commit.

## Git

Conventional Commits (`feat:`, `fix:`, `chore:`, ...). No PRs, no feature branches: commit directly to `main`.

## Gotchas

- **Solid 2, not Solid 1.** No `createResource`, `Suspense`, `ErrorBoundary`, `batch` or single-argument `createEffect`. Use `<Loading>`, `<Errored>`, `createEffect(compute, apply)` and `flush()`. Check APIs at https://v2.solidjs.com/migration/from-solid-1.
- **Install every Solid package with an exact version** (see README → Tech stack). `solid-js@latest` is 1.x, so a plain `npm i` produces an incompatible mix.
- TypeScript 7: `openapi-typescript` and stable `@hey-api/openapi-ts` break on it, so use orval. Vitest 5.0 does not support Vite 9, so stay on Vite 8.
- The service worker is hand-written (`src/sw.ts`). Don't add `vite-plugin-pwa`, Workbox or Serwist (see README → Why these choices).
- `src/api/generated/` is orval output. Never edit it; regenerate with `npm run gen:api`.
- Read money from `amount_decimal`. Never parse `amount`, and don't use `amount_cents` / `signed_amount_cents`: they are not in the OpenAPI schema. On create, send a positive `amount` plus `nature`, and always send the account's `currency`.
- Store dates as local `YYYY-MM-DD`, never as ISO timestamps.
- The calculator is a hand-written parser. Never use `eval` or `new Function`.
- The outbox is the optimistic layer. Don't add Solid `action` / `createOptimistic` on top.
- No third-party or CDN-loaded scripts: any script on the origin can read the API key.
- The sync engine must not depend on the Background Sync API (not available on iOS).
