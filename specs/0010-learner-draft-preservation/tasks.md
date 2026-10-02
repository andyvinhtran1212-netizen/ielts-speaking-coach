# Tasks

Tasks are dependency ordered. Approval must land before implementation.

- [x] T000 Qualify the bounded Chrome152/macOS candidate with actual native
  Duplicate→earlyBack and new-document same-tab Back; other browsers stay
  unqualified/explicitly unsaved. See `feasibility.md`.
- [ ] T001 Review and approve the proposed tab lifetime, boundaries and panel
  restoration contract on staging. `depends: T000; owns: specs/0010-learner-draft-preservation/*`
- [ ] T002 Define versioned allowlisted draft models and fixtures, including
  cloned-tab isolation and storage failure behavior. `depends: T001`
- [ ] T003 [P] Integrate Reading answer restore/discard/notice and content
  fingerprint. `depends: T002; owns: frontend/app/(authed-reading)/reading/reading-detail.tsx, frontend/lib/learner-tab-drafts*, frontend/tests/react/reading-draft-preservation.test.tsx, frontend/tooling/verify-reading-detail-flow.mjs`
- [ ] T004 [P] Integrate Speaking preparation/panel/Part/topic restore with
  existing explicit Start. `depends: T002; owns: frontend/app/(authed-speaking)/speaking/speaking-behavior.tsx, frontend/app/(authed-speaking)/speaking/page-shell.tsx, frontend/lib/learner-tab-drafts*, frontend/tests/react/speaking-draft-preservation.test.tsx, frontend/tooling/verify-speaking-flow.mjs`
- [ ] T005 Complete FR-linked browser/interaction/failure/account/tab evidence
  and existing check/start regression suites. `depends: T003, T004`
- [ ] T006 Run independent whole-contract review and affected full local suites;
  consolidate before pushing. `depends: T005`
- [ ] T007 Verify exact merged staging SHA, promote staging to main and record
  production deployed SHA, learner journeys and accessibility evidence.
  `depends: T006`
