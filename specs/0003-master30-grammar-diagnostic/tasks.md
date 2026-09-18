# Tasks

- [x] T001 Add idempotent schema, RLS, immutable guards, promotion, and finalization functions.
- [x] T002 Add strict package validation/import with checksum and count invariants. `depends: T001`
- [x] T003 Add assigned-only learner/admin services and API contracts. `depends: T001,T002`
- [x] T004 Add native learner, review, educator, My Class, and assignment UI. `depends: T003`
- [x] T005 Add requirement-linked backend, frontend, type, build, and browser tests. `depends: T003,T004`
- [ ] T006 Verify staging exact-SHA behavior and authorized production promotion. `depends: T005`
