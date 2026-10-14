# Tasks

T002–T007 refer to prepared source/local results, not deployment. See verification.md for content coverage and release state.

- [x] T001 Land the separately approved spec on staging; preserve active promotion.
- [x] T002 Correct route/library navigation, grouping and truthful metadata. `owns: frontend/app/(authed-reading), frontend/lib/reading-*-context.mjs`
- [x] T003 Repair practice question rendering and complete-set grading. `depends: T001; owns: frontend/app/(authed-reading)/reading/reading-detail.tsx, frontend/lib/reading-detail-model.mjs, backend/routers/reading_student.py`
- [x] T004 Author/review bounded matching/stem repairs against passage evidence. `depends: T001`
- [x] T005 Author reviewed translation units, phrase links, glossaries and useful visuals; validate revision binding. `depends: T001`
- [x] T006 Implement inline translation, two-way highlights and after-check evidence navigation. `depends: T003, T005`
- [x] T007 Verify every requirement and reconcile findings R01–R10; review the consolidated diff. `depends: T002, T004, T006`
- [ ] T008 Obtain API write/release permissions for concrete code/data packages; stage and verify exact SHA. `depends: T007`
- [ ] T009 Perform any separately approved production promotion and live acceptance. `depends: T008`
