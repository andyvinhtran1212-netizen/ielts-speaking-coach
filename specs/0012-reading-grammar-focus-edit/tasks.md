# Tasks

Dependency ordered. Implementation starts only after this separately approved specification lands on the base branch.

- [x] T001 Independent behavioral product/academic/technical review and separate spec approval. `owns: specs/0012-reading-grammar-focus-edit/*`
- [ ] T002 Implement strict request/response/error contracts and canonical fingerprints. `depends: T001; owns: backend/models/reading_grammar_focus.py, focused tests`
- [ ] T003 Implement parameterized existing-transaction whole-state CAS and atomic governance receipt. `depends: T002; owns: backend/services/reading_grammar_focus.py, focused tests`
- [ ] T004 Add guarded L1-only GET/PATCH in current admin Reading router; preserve old contracts. `depends: T003; owns: backend/routers/admin_reading.py, focused tests`
- [ ] T005 Verify no-op/retry/reuse/concurrency, malformed/large data, denied access, atomic failures and every unchanged field/question. `depends: T004`
- [ ] T006 Independent convergence review and exact-SHA staging synthetic journey. `depends: T005`
- [ ] T007 Promote validated implementation, review actual canonical one-analysis diff, perform authorized correction and read-after/fingerprint checks. `depends: T006`
- [ ] T008 Record deployed SHAs, operation receipt, backup/restore path and academic/learner acceptance; update known original source package if located. `depends: T007`
