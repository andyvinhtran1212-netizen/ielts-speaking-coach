# Tasks

- [x] T001 Add idempotent schema, RLS, immutable guards, promotion, and finalization functions.
- [x] T002 Add strict package validation/import with checksum and count invariants. `depends: T001`
- [x] T003 Add assigned-only learner/admin services and API contracts. `depends: T001,T002`
- [x] T004 Add native learner, review, educator, My Class, and assignment UI. `depends: T003`
- [x] T005 Add requirement-linked backend, frontend, type, build, and browser tests. `depends: T003,T004`
- [x] T006 Verify staging exact-SHA behavior and authorized production promotion. `depends: T005`
- [ ] T007 Complete the existing production activation gate: record the owner decision, feature-specific smoke and current release/count/flag readback before enabling the assigned diagnostic; keep self-serve disabled and retain the flag rollback switch. `depends: T006`

T006 release evidence is recorded in verification.md (promotion #1449 and the
later integration snapshot). T007 separately maps the existing activation gate;
this reconciliation does not change approved feature requirements.
