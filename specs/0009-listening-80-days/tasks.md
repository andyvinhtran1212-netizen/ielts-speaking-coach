# Tasks

- [x] T001 Inspect source, existing web contracts and isolate the task worktree.
  `owns: source review artifacts outside repository`
- [ ] T002 Independently review and land approved source collection spec on staging.
  `owns: specs/0009-listening-80-days/; depends: T001`
- [ ] T003 Build normalized day/block/item inventory and faithful question assets.
  Read-only external inventory and candidate assets can continue before spec
  approval; committed preparation/import implementation waits for T002.
  `owns: dedicated source preparation script and release files; depends: T002`
- [ ] T004 Author and independently review all explanations, source limitations
  and vocabulary resources in bounded batches. `depends: T003`
- [ ] T005 Add required canonical import/API/runtime contracts and migration.
  `depends: T002`
- [ ] T006 Add collection/day and eligible player/result UI. `depends: T002,T005`
- [ ] T007 Validate complete content and import as unpublished on staging.
  `depends: T003,T004,T005`
- [ ] T008 Run independent content/code review, local suites and staged journeys.
  `depends: T006,T007`
- [ ] T009 Publish, promote and verify exact deployed SHA/package plus rollback.
  `depends: T008`
- [ ] T010 Audit every requirement and report final authoritative evidence.
  `depends: T009`
