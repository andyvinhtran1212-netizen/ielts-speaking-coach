# Tasks

- [x] T001 Read both original audit files and compare public production articles with the current base.
- [x] T002 Prepare bounded candidate source/qid/field bundle and all 589 GA IDs for review.
- [x] T003 Read complete current production bank/question extras and bounded history fingerprints (148 physical banks; read-only repeatable-read snapshot); independently review contextual source decisions. Final live per-bank classification/CAS remains T007/T008.
- [x] T004 Independently review final sources and bounded publication/history contract; approve and land spec only on staging.
- [x] T005 Implement the approved existing-owner extension and source regression tests. Depends: T004.
- [x] T006 Verify full relevant local suites, actual PG preservation/races, native UI and current-frame controls.
- [x] T007 PR, CI, merge and exact-SHA staging code/data publication and Live Staging E2E. PRs 1623/1625; staging 28b524e84e8f9d86d8e547c2715588a59e64f5a4, all integrated push checks and live smoke passed. 79 revisions verified, 11 earlier revisions retained; 90 canonical banks, 137 full article matches, 2248 isolated authored answers and 101 audit controls passed. A ledger-only successor must retain exact-SHA release provenance before promotion.
- [ ] T008 Promote exact staging SHA, publish the 79 pending production bank revisions and accept production behavior/history. Production migration 314 is already applied and verified with unchanged counts, historical binding and private-helper grants; do not ask for or rerun that completed step. Retain the 11 already published production revisions.
- [ ] T009 Close every GA ID with evidence; report completion or genuine blockers to user and dot.
