---
id: TASK-25
title: Deploy the app as a container on the NAS
status: To Do
assignee: []
created_date: '2026-11-02T18:02:00Z'
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
- [ ] #1 A push to `main` that passes CI publishes an image with the built app to ghcr.io; the NAS does not build it
- [ ] #2 Running the image serves the same files as `npm run build` puts in `dist/`
- [ ] #3 `arcane-config` has a stack for the app, and it runs on the NAS
- [ ] #4 The app opens over HTTPS on its own `sairus.uk` subdomain through the existing Cloudflare Tunnel
- [ ] #5 In the deployed app, Settings accepts the real Sure URL and a `read_write` key, and a new entry syncs to Sure
- [ ] #6 README → Deployment describes the NAS setup: the image, the stack, the tunnel ingress and how a new build reaches the NAS
<!-- AC:END -->
