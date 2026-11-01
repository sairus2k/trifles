---
id: TASK-22
title: 'Styling foundation: Tailwind, mobile shell and Settings styles'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-01T16:59:00Z'
updated_date: '2026-11-01T17:21:00Z'
labels: []
milestone: m-0
dependencies:
  - TASK-11
references:
  - README.md
priority: high
type: feature
ordinal: 11500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
No task covered styling, so each screen task (TASK-12, TASK-13, TASK-14) would have invented its own approach, and the Settings screen from TASK-11 ships as unstyled HTML. Tailwind 4 was chosen (user decision 2026-11-01): it works entirely at build time through `@tailwindcss/vite` (which supports Vite 8), puts only the CSS of used classes in the bundle and loads no script, so it keeps the rule against third-party and CDN scripts; the Play CDN script must not be used. Measured on 2026-11-01: `tailwindcss` + `@tailwindcss/vite` 4.3.3 add about 17 dev packages and 16 MB, and `lightningcss` is already installed through Vite. The app is used one-handed from the iPhone home screen, so the shell has to respect the notch and home indicator in standalone mode and keep tap targets large. Formatting runs through oxfmt, not Prettier, so `prettier-plugin-tailwindcss` class sorting does not apply.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Tailwind is installed with exact versions through its Vite plugin; README → Tech stack and Why these choices record the versions and the reason
- [ ] #2 The build loads no third-party or CDN script and its CSS contains only classes the app uses
- [ ] #3 Colors, spacing and type are defined once as theme tokens; the app follows the system light or dark preference
- [ ] #4 A mobile-first shell with the header (Settings, Sync paused) respects safe-area insets in standalone mode on iOS
- [ ] #5 Interactive elements are at least 44 px tall; the Settings screen, its pause explanation and its errors are styled
- [ ] #6 Existing component and E2E tests pass unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Research 2026-11-01: prototype in a scratch copy of the repo (Tailwind 4.3.3 + @tailwindcss/vite 4.3.3 on Vite 8.3.5 with the Solid plugin): build, typecheck, all 258 Vitest tests and the E2E test pass unchanged.

Findings that change the description:
- oxfmt 0.75 has built-in Tailwind class sorting (`sortTailwindcss`, same algorithm as prettier-plugin-tailwindcss). With `{"stylesheet": "./src/index.css"}` it sorts JSX `class` attributes and knows our custom tokens. Recommended: enable it.
- Automatic source detection scans the whole repo (README, backlog, spec) and non-UI TS: the build got .block, .fixed, .table, .sticky, .hidden, .visible, .rounded... that no component uses. `@import "tailwindcss" source(none); @source "./**/*.tsx"; @source not "./**/*.test.tsx";` gives exactly the used classes (5.2 kB, 1.75 kB gzip).
- Tailwind brings its own pinned lightningcss 1.32.0 (Vite has 1.33.0): 7 packages + platform binaries, ~14 MB.
- Tailwind 4.3.3 has no safe-area utilities; define them once with @utility.
- `light-dark()` in tokens + `color-scheme: light dark` is transpiled by lightningcss to a prefers-color-scheme fallback, so components need no `dark:` variants.

Steps:
1. Install `tailwindcss` and `@tailwindcss/vite` 4.3.3 exact as devDependencies; add `tailwindcss()` to vite.config.ts plugins; `import "./index.css"` in src/main.tsx (component tests do not import it, so they stay unchanged).
2. src/index.css: the import with source(none) + @source as above; `@theme { --color-*: initial; ... }` so only semantic color tokens exist (surface, surface-raised, ink, ink-muted, line, accent, on-accent, danger, warning), each `light-dark(light, dark)`; system font stack in --font-sans (no web fonts); keep the default --spacing scale; `:root { color-scheme: light dark }`, body bg-surface text-ink; @utility pt-safe / pb-safe / px-safe using env(safe-area-inset-*) with max() against the normal padding.
3. index.html: `viewport-fit=cover` in the viewport meta (env() insets are 0 without it), `<meta name="color-scheme" content="light dark">`, theme-color for light and dark via media.
4. .oxfmtrc.json: `sortTailwindcss: { stylesheet: "./src/index.css" }`; run oxfmt on src.
5. E2E first (red), e2e/style.spec.ts: (a) every request on load is same-origin and the page has a stylesheet from the app (AC2); (b) every button and input on Settings is >= 44 px tall (AC5); (c) emulateMedia colorScheme dark changes the body background (AC3).
6. Shell in src/app.tsx (no new component): min-h-dvh; main screen header sticky at top with pt-safe/px-safe and surface background, title + "Sync paused" (warning style) + "Settings" buttons, min-h-11; content area px-safe pb-safe. Same DOM roles and labels, so app.browser.test.tsx is unchanged.
7. Settings in src/features/settings/settings.tsx: pt-safe/px-safe/pb-safe, stacked labels; inputs min-h-11 and text-base (16 px, below that iOS Safari zooms on focus); Save as primary, Cancel as secondary, disabled state while checking; the pause explanation (role=status) in the warning style, errors (role=alert) in the danger style; visible focus rings.
8. Docs: README Tech stack row (Styling: tailwindcss, @tailwindcss/vite 4.3.3) and Lint/format row (oxfmt with Tailwind class sorting); Why these choices (build-time only, no script, no Play CDN, used classes only via @source); Project structure (src/index.css); Mobile details (safe-area, 44 px, 16 px inputs). AGENTS.md Gotchas: only src/**/*.tsx is scanned, write full class names (no `bg-${x}`), use semantic tokens, no `dark:`.
9. Verify: npm run typecheck, npm test, npm run test:e2e, build and list the classes in dist CSS; check light/dark in the browser at iPhone width.

Commits: (1) chore: add Tailwind 4 with theme tokens and class sorting (steps 1-4, README stack/why/structure); (2) feat: style the app shell and Settings (steps 5-7, README mobile details, AGENTS.md).

Out of scope: apple-mobile-web-app-status-bar-style and the manifest theme_color belong to TASK-15 (iOS status bar look in standalone mode needs a real iPhone check); styles for the entry form, list and balances belong to TASK-12/13/14.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
User decisions 2026-11-01: enable oxfmt sortTailwindcss (update the README Lint/format row); theme keeps only semantic color tokens (--color-*: initial).
<!-- SECTION:NOTES:END -->
