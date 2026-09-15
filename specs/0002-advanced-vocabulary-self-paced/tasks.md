# Tasks

Tasks are dependency ordered; implementation begins only after this approved spec
is present on the base branch.

- [ ] T001 Land the immutable authored core-30 content and media as a content-only change. `owns: backend/content/advanced_vocab/**, frontend/public/assets/advanced-vocab/**`
- [ ] T002 Establish migration 263, RLS, versioning, and package validation contracts. `depends: T001`
- [ ] T003 Implement canonical backend assignment, persistence, learner, and admin result flows. `depends: T002`
- [ ] T004 Implement learner and admin UI states, independent Reading panes, Writing reference, and Speaking practice. `depends: T003`
- [ ] T005 Add requirement-linked backend, frontend, and browser regression evidence. `depends: T002,T003,T004`
- [ ] T006 Run independent inline review until clean and record exact-SHA staging evidence. `depends: T005`
- [ ] T007 Apply production migration, promote staging to main, smoke production, and verify the 30-bank import. `depends: T006`
