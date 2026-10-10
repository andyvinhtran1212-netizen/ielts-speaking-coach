# Tasks

- [x] T001 Read both original audit files and compare public production articles with the current base.
- [x] T002 Prepare bounded candidate source/qid/field bundle and all 589 GA IDs for review.
- [x] T003 Read complete current production bank/question extras and bounded history fingerprints (148 physical banks; read-only repeatable-read snapshot); independently review contextual source decisions. Final live per-bank classification/CAS remains T007/T008.
- [x] T004 Independently review final sources and bounded publication/history contract; approve and land spec only on staging.
- [x] T005 Implement the approved existing-owner extension and source regression tests. Depends: T004.
- [x] T006 Verify full relevant local suites, actual PG preservation/races, native UI and current-frame controls.
- [ ] T007 PR, CI, merge and exact-SHA staging code/data publication and Live Staging E2E.
- [ ] T008 Apply required production migration, promote exact staging SHA, publish approved bank revisions and accept production behavior/history.
- [ ] T009 Close every GA ID with evidence; report completion or genuine blockers to user and dot.
