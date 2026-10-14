# Tasks

- [x] T001 Add contracts, additive schema, scope checks and atomic persistence. owns: backend shared-set routes/services/migration and generated OpenAPI.
- [x] T002 Implement admin authoring, publication, distribution and results. depends: T001.
- [x] T003 Implement learner hub, library, set detail, study/resume and review. depends: T001.
- [x] T004 Integrate legacy navigation, statistics and accessibility fixes. depends: T003.
- [x] T005 Verify requirement-linked backend, React, Next browser and schema behavior. depends: T002,T003,T004.
- [x] T006 Review the final affected contract, run required local checks and publish a staging PR. depends: T005.
- [x] T007 Apply additive schema and verify deployed staging journeys at the accepted SHA `92019185b79675e2e4d44f1535685b1fedfeec3d`. depends: T006.
- [ ] T008 Close both promotion retry findings in one bounded API/player correction and verify it on staging. depends: T007.
- [ ] T009 Apply unchanged migration 317 and promote staging to main under the production authorization, then verify the production release and affected journeys. depends: T008.
