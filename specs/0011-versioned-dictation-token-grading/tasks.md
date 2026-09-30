# Tasks

Implementation may start only after this approved specification lands on the base branch.

- [x] T001 Approve lexical policy, legacy compatibility and the policy matrix. `owns: specs/0011-versioned-dictation-token-grading`
- [ ] T002 Inventory all dictation write/read contracts and frozen evidence. `depends: T001`
- [ ] T003 Implement classification-only aggregate/UI with unchanged historical scores. `depends: T002`
- [ ] T004 Add compatible version/ref contracts and additive persistence. `depends: T002`
- [ ] T005 Implement versioned lexical grading and complete compatible consumers. `depends: T004`
- [ ] T006 Verify gold cohort, legacy/new resume/retry, ownership and immutability. `depends: T003, T005`
- [ ] T007 Review bounded historical comparison/repair decision and restore path. `depends: T006`
- [ ] T008 Independent contract review and exact-SHA staging acceptance. `depends: T006, T007`
- [ ] T009 Staged production promotion, scoped observation and rollback proof. `depends: T008`
