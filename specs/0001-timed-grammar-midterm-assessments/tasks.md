# Tasks

- [ ] T001 Add forward migrations for atomic timed assessment boundaries and safe bank replacement.
- [ ] T002 Add strict five-choice Course assessment import validation and CLI dry-run/commit modes. `depends: T001`
- [ ] T003 Extend assignment, quiz, retry, expiry, and reconciliation backend contracts. `depends: T001`
- [ ] T004 Add admin timer and learner A–E/countdown/result states. `depends: T003`
- [ ] T005 Add requirement-linked backend, migration, frontend, and browser regression tests. `depends: T002,T003,T004`
- [ ] T006 Verify staging migrations, source packages, live behavior, review findings, and production rollout. `depends: T005`
- [ ] T007 Add backward-compatible Course completion modes and atomic single-attempt terminal admission. `depends: T001`
- [ ] T008 Add the canonical admin Course bank preview response and mutation-free route. `depends: T007`
- [ ] T009 Redesign the assignment dialog shell, completion policy controls, and responsive preview UI. `depends: T008`
- [ ] T010 Verify answer sealing, terminal single-attempt behavior, unchanged mastery behavior, preview immutability, and the viewport/theme/keyboard matrix. `depends: T007,T008,T009`
