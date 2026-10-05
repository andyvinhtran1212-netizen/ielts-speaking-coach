# Tasks

- [x] T001 Confirm reviewed teaching and practice sources for the first assignable Bxx lessons; map stable IDs and revisions. `owns: content manifest`
- [x] T002 Define and verify subtype, assignment, attempt and API contracts with additive migration only if needed. `depends: T001; owns: migration, OpenAPI models`
- [x] T003 Implement backend catalog, authorization, lesson practice and canonical completion. `depends: T002; owns: backend lesson service/routes`
- [x] T004 Add teacher selection and result views and the learner My Class lesson journey. `depends: T002; owns: Next class and learner surfaces`
- [x] T005 Add requirement-linked backend, frontend and browser tests; run affected local suites. `depends: T003,T004`
- [ ] T006 Audit the full contract against concurrent Grammar work, then stage and verify exact-SHA rollout. `depends: T005`
- [x] T007 Prepare all thirty lesson-specific teaching/practice packages with independent senior content approval tied to exact content hashes. `owns: content agents; user requested all thirty ready on 2026-10-05`
- [ ] T008 Verify all thirty catalog rows are assignable on staging and production, preserving v1 historical attempts and diagnostic independence. `depends: T006,T007; owns: release and live acceptance`
