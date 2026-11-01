---
id: TASK-22
title: 'Styling foundation: Tailwind, mobile shell and Settings styles'
status: To Do
assignee: []
created_date: '2026-11-01T16:59:00Z'
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
