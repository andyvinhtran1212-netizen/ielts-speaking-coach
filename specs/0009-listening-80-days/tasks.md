# Tasks

- [x] T001 Inspect source, existing web contracts and isolate the task worktree.
  `owns: source review artifacts outside repository`
- [x] T002 Independently review and land approved source collection spec on staging.
  Approved through specification-only PR #1547, merged as
  `018c2c6702f541a21c59a626bb19c815eab205a1` on 2026-09-30.
  `owns: specs/0009-listening-80-days/; depends: T001`
- [x] T003 Build normalized day/block/item inventory and faithful question assets.
  Read-only external inventory and candidate assets can continue before spec
  approval; committed preparation/import implementation waits for T002.
  `owns: dedicated source preparation script and release files; depends: T002`
- [x] T004 Author and independently review all explanations, source limitations
  and vocabulary resources in bounded batches. `depends: T003`
- [x] T005 Add required canonical import/API/runtime contracts and migration.
  `depends: T002`
- [x] T006 Add collection/day and eligible player/result UI. `depends: T002,T005`
- [ ] T007 Validate complete content and import as unpublished on staging.
  `depends: T003,T004,T005`
- [ ] T008 Run independent content/code review, local suites and staged journeys.
  `depends: T006,T007`
- [ ] T009 Publish, promote and verify exact deployed SHA/package plus rollback.
  `depends: T008`
- [ ] T010 Audit every requirement and report final authoritative evidence.
  `depends: T009`

## Release checkpoint — full source package (2026-09-30)

T003–T004 cover completed source preparation and independent content review; T005–T006 cover the implemented runtime and UI. The consolidated public-boundary correction R11/R12 passed local suites and independent round4 review. Staging migration304 is applied, but the immutable asset upload stopped on a Storage timeout before the package RPC. Hosted import/readback, exact staging deployment/journeys and production publication remain T007–T010. The actual full80 native dry-run and disposable PostgreSQL import/reuse/invalid-provenance rollback passed; these are not hosted service or browser evidence.
