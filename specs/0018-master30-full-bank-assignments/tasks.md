# Tasks

- [ ] T001 Approve correction intent on staging before implementation. `owns: primary`
- [ ] T002 Correct/read every original item and obtain exact independent senior approval. `owns: B01–15/B16–30 authors, senior`
- [ ] T003 Implement typed frozen snapshot, atomic MCQ/E persistence and truthful counts. `depends: T001; owns: primary backend/schema`
- [ ] T004 Protect diagnostic pending/concurrent/finalization from full-bank exposure. `depends: T001; owns: primary backend/schema`
- [ ] T005 Add learner/teacher/admin UI and generated contracts, preserving history. `depends: T003; owns: primary frontend`
- [ ] T006 Integrate approved content; focused then full local suites/native browser. `depends: T002,T003,T004,T005`
- [ ] T007 Audit/merge implementation to staging; exact-SHA all-thirty hosted acceptance. `depends: T006`
- [ ] T008 Apply production schema/promote verified SHA; all-thirty acceptance, cleanup and readiness. `depends: T007`
