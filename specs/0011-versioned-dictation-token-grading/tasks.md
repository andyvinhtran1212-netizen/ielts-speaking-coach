# Tasks

Implementation may start only after this approved specification lands on the base branch.

- [x] T001 Approve lexical policy, legacy compatibility and the policy matrix. `owns: specs/0011-versioned-dictation-token-grading`
- [x] T002 Inventory all dictation write/read contracts and frozen evidence. `depends: T001`
- [x] T003 Implement classification-only aggregate/UI with unchanged historical scores. `depends: T002`
- [x] T004 Add compatible version/ref contracts and additive persistence. `depends: T002`
- [x] T005 Implement versioned lexical grading and complete compatible consumers. `depends: T004`
- [x] T006 Verify gold cohort, legacy/new resume/retry, ownership and immutability. `depends: T003, T005`
- [x] T007 Review bounded historical comparison/repair decision and restore path. `depends: T006`
- [ ] T008 Independent contract review and exact-SHA staging acceptance. `depends: T006, T007`
- [ ] T009 Staged production promotion, scoped observation and rollback proof. `depends: T008`


T006 records local deterministic gold/owner/real-PG compatibility gates, not deployed
acceptance. T007 records the reviewed decision to leave historical repair disabled;
no historical write run is authorized. T008–T009 remain open for final independent
PR/CI review, staged migrations/live acceptance and production release/observation.

R4 local completion includes the whole-contract reset after R3 browser CI failed:
9539 Node/54 React/both TypeScript/build,135 browser checks across56 scenarios
and17 legacy checks pass. Source review includes late ACK/reconcile/unmount,
boolean admission, explicit stored feedback, newer-receipt preservation and
actual-wire long-reference Admin retention/wrapping. T008 remains open for the
exact pushed head, integrated staging and required accessibility/live matrix;
T009 remains open for production enablement/observation/rollback.
