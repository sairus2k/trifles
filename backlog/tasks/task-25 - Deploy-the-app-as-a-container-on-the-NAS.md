---
id: TASK-25
title: Deploy the app as a container on the NAS
status: Done
assignee:
  - '@claude'
created_date: '2026-11-02T18:02:00Z'
updated_date: '2026-11-02T20:16:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-2
references:
  - README.md
  - /Users/admin/projects/arcane-config/sure/compose.yaml
  - /Users/admin/projects/arcane-config/cloudflared/compose.yaml
priority: high
type: chore
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The app has no public URL yet, and the iPhone check (TASK-23) needs it over HTTPS: a service worker only runs in a secure context. Sure itself runs on the NAS (`sure.sairus.uk`), exposed through a Cloudflare Tunnel; the stacks live in `~/projects/arcane-config` and are deployed with Arcane. Hosting the app next to Sure keeps everything self-hosted; GitHub Pages and Cloudflare Pages were considered and declined (decision 2026-11-02).

The app must get its own subdomain of `sairus.uk`, not a path under `sure.sairus.uk` and never the shared `sairus2k.github.io`: any script on the app's origin can read the API key (README → Security). If Cloudflare Access protects `sure.sairus.uk`, `/api/*` needs a bypass policy (README → Deployment).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A push to `main` that passes CI publishes an image with the built app to ghcr.io; the NAS does not build it
- [x] #2 Running the image serves the same files as `npm run build` puts in `dist/`
- [x] #3 The app opens over HTTPS on its own `sairus.uk` subdomain through the existing Cloudflare Tunnel
- [x] #4 In the deployed app, Settings accepts the real Sure URL and a `read_write` key, and a new entry syncs to Sure
- [x] #5 README → Deployment describes the NAS setup: the image, the stack, the tunnel ingress and how a new build reaches the NAS
- [x] #6 The image is published only after the E2E suite (`npm run test:e2e`) passes in CI
- [x] #7 The Sure stack in `arcane-config` runs the app's container, and updating that container in Arcane picks up the new image without touching the Sure services
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. CI gate: add `npm run test:e2e` to the `check` job (Chromium is already installed; 12 tests, ~9 s locally).
2. Image: `Dockerfile` = pinned `nginx:*-alpine` with its default config + `COPY dist/`; `.dockerignore` keeps only `dist/`. Built for linux/amd64 only (the NAS is Intel: immich uses QuickSync/OpenVINO).
3. Workflow: an `image` job that `needs: check`, reuses the `dist/` the check job built (artifact), pushes `ghcr.io/sairus2k/trifles:latest` and `:<sha>` with `GITHUB_TOKEN` (`packages: write`), and smoke-tests the image first: run it and `cmp` every file of `dist/` against what it serves (AC #2).
4. `arcane-config`: new stack (dir named after the subdomain) with the image, `restart: unless-stopped`, a free host port (cloudflared runs with host networking; taken: 3000, 3080, 3552, 8000, 8083, 13378), `x-arcane` url and icon like the other stacks, and the chosen update mechanism.
5. Manual steps for the user: make the ghcr package public (or log the NAS in), deploy the stack in Arcane, add the tunnel public hostname → `http://localhost:<port>`, check Cloudflare Access on `sure.sairus.uk` for an `/api/*` bypass.
6. Verify AC #4 with curl over HTTPS; AC #5 together with the user on the real Sure.
7. README → Deployment: the NAS setup and how a new build arrives.

Decision 2026-11-02: the app is a service in the existing `sure` stack, not a stack of its own, and at `trifles.sairus.uk`. A manual project redeploy would also pull `sure:stable` (a Sure upgrade must wait for the contract tests, see `spec/README.md`), so the container updates through Arcane's per-container auto-updater label instead. Step 4 changes accordingly.

Decision 2026-11-02 (revised): Arcane's `com.getarcaneapp.arcane.updater` label only opts out of a global `autoUpdate`, so it cannot enable updates for one container. A container webhook (`UpdateSingleContainer`) was offered and declined: the user updates the `trifles` container by hand in Arcane (container update, not project redeploy). No updater label in the stack.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Committed: 7c4eaf3 (E2E step in CI), 40eb56e (Dockerfile on nginx:1.30-alpine, `nginx-types.conf` because nginx's mime.types lacks `webmanifest`, `image` job with smoke test and push, README → Deployment → Container image). arcane-config db250c9: `trifles` service in `sure/compose.yaml`, host port 3090, validated with `docker compose config`. The local Docker daemon is not running, so the image is first built and smoke-tested by CI.

Run 41503378788: check (incl. E2E) and image smoke test green; the first `docker push` got `error from registry: denied` on the manifest after all layers uploaded, a rerun of the failed job passed. Likely a race while ghcr created the new package; watch for it on the next pushes. The package is public (anonymous pull of `:latest` → 200), inherited from the public repo. The user's first Arcane deploy failed with `manifest unknown` before the image existed; Sure was untouched (`sure:stable` up to date, deploy stopped before recreating containers).

Ingress correction: the tunnel goes to Nginx Proxy Manager, which reaches containers by name on `net_proxy` (Sure: `http://sure-web:3000`). arcane-config a39e396 puts `trifles` on `net_proxy` and drops the host port; NPM proxy host `trifles.sairus.uk` → `http://trifles:80`. Cloudflare Access (one app, likely `*.sairus.uk`) covered both hosts: the user added a bypass for `trifles.sairus.uk` (works: no redirect); `sure.sairus.uk/api/*` still redirected to the Access login at the last check (GET 302, preflight 403).

Verified 2026-11-02 over HTTPS: all 9 files of `trifles.sairus.uk` match a fresh `npm run build` of main byte for byte, with the right MIME types (manifest `application/manifest+json`). After the user's Access bypass for `sure.sairus.uk/api` (path `api/*` plus `api`, Bypass → Everyone): `GET /api/v1/accounts` without a key → Sure's own 401 JSON; preflights for GET and DELETE from `https://trifles.sairus.uk` with `x-api-key` → 200 with `access-control-allow-origin: *`; the Sure UI still redirects to the Access login.

AC #4: the user saved the real Sure URL and a read_write key in the deployed app and a new entry synced to Sure.

AC #7: CI published `:latest` = sha256:bc48e721… (a0332ce) while the NAS ran sha256:f37c52bc… (40eb56e); the user ran Update on the `trifles` container in Arcane and confirmed it picked up the new image while `sure-web`, `sure-worker` and `sure-redis` kept their uptime. That push went through on the first try (the earlier `denied` did not recur).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The app is live at https://trifles.sairus.uk. CI now runs the E2E suite, and a separate `image` job (only after `check` passes, so after E2E; keeps `packages: write` away from npm install scripts) packages the built `dist/` into `nginx:1.30-alpine` (plus `nginx-types.conf`, since nginx has no MIME type for `.webmanifest`), checks that the image serves every file unchanged, and pushes `ghcr.io/sairus2k/trifles:latest` and `:<sha>` (public, linux/amd64). On the NAS it is the `trifles` service of the Sure stack in arcane-config, on `net_proxy` behind Nginx Proxy Manager (`trifles.sairus.uk` → `http://trifles:80`) and the existing Cloudflare Tunnel. New builds arrive by Update on that container in Arcane; a project redeploy would also pull `sure:stable`, and Arcane's updater label can only opt out of a global auto-update (a container webhook was offered and declined). Cloudflare Access needed bypasses for `trifles.sairus.uk` and `sure.sairus.uk/api` (path `api/*` plus `api`). README → Deployment documents the image, the setup and both Access rules.

Verified: CI runs 41503378788 and 41508713144 green; deployed files match a fresh build byte for byte with correct MIME types; Sure API answers its own 401 and CORS preflights from the app origin; the user synced a real entry and updated the container without restarting Sure. Risks: the first push to the new package got `denied` once (a rerun passed); `latest` is mutable, so the image digest in Arcane is the only record of what runs.
<!-- SECTION:FINAL_SUMMARY:END -->
