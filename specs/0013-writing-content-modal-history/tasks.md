# Tasks

Tasks are dependency ordered. Product implementation waits for approved base.

- [x] T001 Review and approve scope, fixed-parent close policy, query/submission
  precedence and shared tip/prompt lifecycle on the base branch.
  `owns: specs/0013-writing-content-modal-history/*`
- [ ] T002 Define executable URL/ownership/identity/failure contracts with
  canonical fixtures: any assignment_id presence suppresses content without
  rewriting parameters; duplicate tab/tip/prompt keys are invalid even when
  identical; empty/wrong-tab/tabless/conflicting items remain closed; plain
  valid-tab library view is valid. Test surviving-owned and direct-link reload
  separately, never deriving ownership from URL/referrer.
  `depends: T001; owns: frontend/lib/writing-content-navigation*.mjs, frontend/tests/writing-content-navigation*.test.mjs`
- [ ] T003 Integrate URL navigation/display reconciliation, guarded canonical
  reads and accessible shared dialog focus/close behavior.
  `depends: T002; owns: frontend/app/(authed-writing)/writing/dashboard/writing-behavior.tsx, frontend/app/(authed-writing)/writing/dashboard/page-shell.tsx`
- [ ] T004 Add FR-linked native browser/interaction journeys and request assertions,
  then complete affected Writing regressions. `depends: T003; owns: frontend/tooling/verify-writing-content-history-flow.mjs, frontend/tests/react/writing-content-dialog*.test.tsx`
- [ ] T005 Run independent scope/auth/history/accessibility review and affected
  full local suites; consolidate before pushing. `depends: T004`
- [ ] T006 Verify exact merged staging SHA, promote to main and record deployed
  SHAs plus learner keyboard/mobile history journeys. `depends: T005`
