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

T003–T004 cover completed source preparation and independent content review;
T005–T006 cover the implemented runtime and UI. The R11/R12 public-boundary
correction passed independent round4 review at `e694fa57`. Its actual CI exposed
a missing `ffprobe` dependency and an unrelated Mock retry fixture that allowed
canonical polling to interfere with its countdown assertion. The final
consolidation is prepared in a separate CI checkout with observed staging
`d276085e`: install real audio tools and isolate the fixture's recovery signals,
preserving the app and the immutable source release. The unchanged whole
migration256 module passed all26 cases on the same Linux VM clock, with zero
skips and six strict Python/SQL clock brackets. Final review and exact-head CI
are still required. Accepted staging `2b7fa5b6` has now been integrated while
retaining source-day links and generic library context. Final local frontend
9331, React65, types/build and native Mock36/guided6/context86 pass. The host
backend full result9513/38/3 retains the same clock-sensitive failures; the
actual same-clock26 supplement does not certify a full Ubuntu backend run.

Staging migration304, the genuine complete-row pre-import baseline and two fresh
synthetic learner accounts have been verified. The V3 bounded immutable transfer
terminated after two network failures: 44 new assets were verified, bringing the
receipt total to 484 of 663; 179 remain unconfirmed in that terminal receipt.
The independently accepted V4 remainder uploader has reported a failure and
is draining already submitted workers; it has not been restarted. Its partial
progress does not replace a terminal asset receipt. Partial asset receipts do
not prove a completed package. Hosted
canonical import/readback/retry, exact staging
deployment and authenticated journeys, and production publication remain
T007–T010. Full80 local dry-run and disposable PostgreSQL import/reuse/invalid
provenance rollback passed; these do not certify hosted services or learners.
