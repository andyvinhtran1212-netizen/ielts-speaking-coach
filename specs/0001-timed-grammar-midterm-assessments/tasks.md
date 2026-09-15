# Tasks

- [ ] T001 Add forward migrations for atomic timed assessment boundaries and safe bank replacement.
- [ ] T002 Add strict five-choice Course assessment import validation and CLI dry-run/commit modes. `depends: T001`
- [ ] T003 Extend assignment, quiz, retry, expiry, and reconciliation backend contracts. `depends: T001`
- [ ] T004 Add admin timer and learner A–E/countdown/result states. `depends: T003`
- [ ] T005 Add requirement-linked backend, migration, frontend, and browser regression tests. `depends: T002,T003,T004`
- [ ] T006 Verify staging migrations, source packages, live behavior, review findings, and production rollout. `depends: T005`
