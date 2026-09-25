# Tasks

- [x] T001 Review and approve 65 instructions, nine titles and five outcome sets. `owns: lesson-metadata-draft.json`
- [ ] T002 Translate and review all 1,045 items in batches, including choice labels and answer-language guidance. `owns: translation-batch-*.json`; `depends: T001`
- [ ] T003 Approve the high-risk spec on the staging base branch. `owns: spec.md, plan.md, ui-states.md, rollout.md`; `depends: T001`
- [ ] T004 Implement the smallest source-bound package and import contract with validation tests. `owns: content builder, backend/services/listening_package_import.py, backend/tests`; `depends: T002, T003`
- [ ] T005 Consume reviewed language pairs in the player and test both navigation modes/themes. `owns: frontend/lib/listening-programme-learning.mjs, frontend/app/(authed-listening-player), frontend/tests`; `depends: T004`
- [ ] T006 Build new unpublished package IDs, compare invariants, dry-run and stage. `owns: new package revision and operator report`; `depends: T004, T005`
- [ ] T007 Independent review, exact-SHA staging verification and recorded direct/delegated publish authority. `owns: verification.md, release evidence`; `depends: T006`
- [ ] T008 Apply migration 303, activate the v1.0 new-start drain, prove zero active attempts, then stage-test archive→publish and failed-publish v1.0 restoration. `owns: rollout.md, migration 303, staging evidence`; `depends: T006, T007`
- [ ] T009 Promote only the exact green staging SHA, apply production schema first, and repeat the monitored cutover per programme. `owns: promotion and production verification`; `depends: T008`
