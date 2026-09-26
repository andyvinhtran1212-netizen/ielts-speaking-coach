---
name: ui-review
description: Review Aver Learning Next.js screens against its shared design system, theme, navigation, state truth and accessibility conventions.
---

Use the requested screen or changed UI as the scope. Read `AGENTS.md`,
`frontend/AGENTS.md` and these maintained design references as needed:

- `frontend/css/aver-design/tokens.css`: colors, spacing, typography and motion.
- `frontend/css/aver-design/components.css`: shared shell and UI components.
- `frontend/css/aver-design/DESIGN_SYSTEM.md`: design system conventions.
- `frontend/css/aver-design/UNIFIED_DESIGN_BRIEF.md`: design context/history;
  resolve historical assumptions against current components and instructions.

Inspect the live Next route and its React/state ownership. HTML fixtures and
generated knowledge graphs are supporting context, not deployed screens.

Check relevant desktop/mobile and light/dark states:

- Existing `--av-*` tokens, shared shell/chrome and readable text contrast;
  avoid one-off hardcoded styling that diverges from the product system.
- Navigation context, headings, semantic controls, labels, focus order, visible
  focus, keyboard behavior and modal focus restoration.
- Loading, empty, error, success and disabled states; errors must be visible.
- Backend shape, canonical persisted state, immediate post-action UI and full
  reload. Never hide a data visibility bug by making an association look empty.
- Route transitions and auth boundaries, not just a static screenshot.

Report concrete findings with severity, location, user impact, minimal fix and
verification. Distinguish browser evidence from source inspection; flag missing
mobile or screen-reader evidence rather than claiming it passed. Follow the
shared workflow for any authorized changes.
