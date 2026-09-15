# Tasks

Tasks are dependency ordered; implementation begins only after this approved spec
is present on the base branch.

- [ ] T001 Land pure package validation, builder, and immutable source/media checksum tests. `owns: backend/services/advanced_vocab_package_builder.py, backend/services/advanced_vocab_package_validator.py, backend/tests/test_advanced_vocab_package_validator.py`
- [ ] T002 Validate and land the immutable core-30 content/media snapshot as a content-only change. `depends: T001; owns: backend/content/advanced_vocab/**, frontend/public/assets/advanced-vocab/**`
- [ ] T003 Review migration 263, apply it to staging, and verify it creates only missing Advanced Vocabulary stores while idempotently extending existing course-section evidence; prove attempt 1 is enforced, a second Reading/Listening row is rejected even with a different attempt number, same/different replay behavior, concurrent finalization, transaction rollback on an injected finalizer failure, and scoped repair of complete pre-trigger pilot rows. `depends: T002`
- [ ] T004 Merge canonical backend assignment, persistence, learner, and admin result flows only after T003 schema verification, including ordered-stage rejection, pre-attempt Practice projection, direct/stale-client Writing/Speaking submission rejection with no grading work, preservation of the separate teacher-assignment Writing path, and deletion rejection for every partial-evidence store; define request/response models, regenerate OpenAPI types, and include/pass service/API, assignment-version, RLS, migration, replay/concurrency, drift, and existing backend regression tests in this same tested SHA. `depends: T003`
- [ ] T005 Implement learner/admin UI states, independent Reading panes, and non-submittable Writing/Speaking reference surfaces using generated operation types; include/pass model, component/behavior, archive-only partial-evidence action, keyboard/focus, responsive, interruption/resume, and answer-boundary browser tests in this same tested SHA. `depends: T004`
- [ ] T006 Run cross-layer and existing course retry/report regression evidence on the combined candidate, including every pre/post-reveal boundary and a v1-assignment/v2-bank revision journey across learner, submit, resume, and admin reads. `depends: T001,T003,T004,T005`
- [ ] T007 Run independent inline review until clean and record exact-SHA staging evidence. `depends: T006`
- [ ] T008 Apply production migration, promote staging to main, smoke production, and verify the 30-bank import. `depends: T007`
