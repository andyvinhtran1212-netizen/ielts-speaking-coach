# Tasks

- [x] T001 Review and approve 65 instructions, nine titles and five outcome sets. `owns: lesson-metadata-draft.json`
- [ ] T002 Translate and review all 1,045 items in batches, including choice labels and answer-language guidance. `owns: translation-batch-*.json`; `depends: T001`
- [x] T003 Approve the original high-risk spec on the staging base branch. `owns: spec.md, plan.md, ui-states.md, rollout.md`; `depends: T001`
- [ ] T008 Approve the active-attempt and localized-visual amendment on the staging base branch. `owns: spec.md, plan.md, ui-states.md, rollout.md`; `depends: owner cutover choice`
- [ ] T004 Implement the smallest source-bound package and import contract with validation tests. `owns: content builder, backend/services/listening_package_import.py, backend/tests`; `depends: T002, T008`
- [ ] T005 Consume reviewed language pairs in the player and test both navigation modes/themes. `owns: frontend/lib/listening-programme-learning.mjs, frontend/app/(authed-listening-player), frontend/tests`; `depends: T004`
- [ ] T006 Build new unpublished package IDs, compare invariants, dry-run and stage. `owns: new package revision and operator report`; `depends: T004, T005`
- [ ] T009 Implement and verify the owner-selected active-attempt cutover policy without losing saved v1.0 answers. `owns: attempt lifecycle contract/tests`; `depends: T008`
- [ ] T010 Review localized museum-map visuals and verify responsive/accessibility parity before either form's language switch. `owns: localized visual assets, UI evidence`; `depends: T008`
- [ ] T007 Independent review, exact-SHA staging verification and explicit owner publish decision. `owns: verification.md, release evidence`; `depends: T006, T009, T010`
