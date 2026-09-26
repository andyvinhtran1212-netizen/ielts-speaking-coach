---
name: new-feature
description: Implement a new Aver Learning feature across the backend and Next.js frontend using approved specs and existing product contracts.
---

Read `AGENTS.md`, `docs/AGENT_WORKFLOW.md` and `specs/README.md` from the current
repository root. Use the user's requested feature as the scope.

- Classify the change first. Feature/high-risk implementation requires the
  approved spec on the base branch; do not self-approve it in the implementation
  PR. Normal work starts from `origin/staging` and targets `staging`.
- Inspect existing routes, services, data and UI before choosing layers to add.
  Content imports supported by the current contract need validation/import/
  verification, not a new platform.
- Add a migration only if schema is actually missing. Follow
  `backend/migrations/README.md` and preserve existing learner history.
- Keep domain logic in the existing service layer, authenticate and authorize
  API operations, and mount new routers in `backend/main.py` when needed.
- Build UI in `frontend/app/` with existing route groups, shared components,
  browser API and Supabase runtime boundaries. Read `frontend/AGENTS.md`.
  Use maintained `--av-*` design tokens; do not scaffold retired HTML pages.
- Verify each changed layer locally and record requirement evidence in the
  applicable spec. Preserve canonical persisted truth on immediate UI updates
  and reloads. Use the shared workflow for review, PR and release evidence.
