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
- [x] T007 Validate complete content and import as unpublished on staging.
  `depends: T003,T004,T005`
- [ ] T008 Run independent content/code review, local suites and staged journeys.
  `depends: T006,T007`
- [ ] T009 Publish, promote and verify exact deployed SHA/package plus rollback.
  `depends: T008`
- [ ] T010 Audit every requirement and report final authoritative evidence.
  `depends: T009`

## Historical release checkpoint — superseded (2026-09-30)

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

## Historical first authorized correction checkpoint (2026-10-01)

T007 is closed for unpublished staging data preparation only. The unchanged
canonical importer created package UUID `2f744893-a231-4f17-bde2-86800b76e19f`
with80 lessons/195 forms/1572 practice items/69 stimuli and reused all663 assets.
A real retry reused the same package UUID and all663 assets. Both complete
private-byte/full-row readbacks agree, including every owned ID/timestamp/payload
and the full-row fingerprints of the four existing packages,19 attempts and7
reveals. Package remains validated; descendants remain draft/private. Independent
closure: `staging-unpublished-data-final-independent-review.json`, SHA-256
`dd6228ea0aebc6837be8163c96ff182f262f6b0e8329b282e288bead46030eee`.

Exact d66301a9 PR CI passed, including complete Ubuntu backend9516/38; these
checks do not certify the subsequent corrective candidate. Three existing
review conversations still identified missing whole-day submitted replay,
synchronous account scope and native multi-gap labels. The human explicitly
authorized correcting all three and reopening review on2026-10-01. This is one
coherent bounded correction: authoritative audio/field transports, account/media
lifetime and canonical answer/reference presentation; the source release,
importer and schema stay frozen. Permission record SHA-256
`afb38bd3ad944c3a172ce3b3b94bd30557142c07635b1852f1857504ffd4e3f4`.

The authorized correction is local99368c40; observed incoming staginga5a579d1
is integrated locally as03c5050e. The isolated merge preserves incoming
Dictation contracts and source304; README retains305/next306. Actual local
frontend9561/React146/types/build/Mock36/guided6/context86 gates pass. The full
backend9789/38skipped/3 retained clock failures is recorded honestly; all255
incoming Dictation cases and21 new source ASGI cases pass. New exact-head Ubuntu
CI and final independent acceptance are still required. No push or merge is
inferred from these local commits.

Actual source browser81 checks pass in four375/1440 light/dark paths with
original Day04 audio, native Q16/Q19 labels, account/attempt media cleanup and
truthful error handling. Fixture Auth/API, not hosted Auth/RLS/signing; those
remain T008. All earlier QA failures are preserved alongside actual native
control/Activity diagnostic evidence. Owned test servers are stopped and the
canonical unconfigured runtime restored. Source/importer/release remain frozen.

The candidate has not received final independent acceptance, new-head CI or
merge. T008–T010 remain open for authenticated staging source journeys, demo,
publication/promotion/production verification and the final requirement audit.
Earlier checkpoints above retain their historical failures and partial uploads.

### Single Round6 corrected freeze

The independent whole-contract audit did not accept ff879c83. Its consolidated
report `authorized-round6-consolidated-independent-findings.json` (SHA-256
`03475dd9a3e974a78e0b73b5f6e7348be712e2f6748a59ea852daebbcc74b254`)
identified exactly two gaps within the already authorized categories: in-progress
form state/media/async continuations were not scoped, and the real guided context
query omitted authored metadata. This same unpublished Round6 stays open for
one corrected frozen candidate; no additional numbered round or push occurred.

The form now remounts by Auth status/user/test identity, invalidates its captured
lifetime synchronously, aborts requests and stops/empties native media. Every
later queued save/reveal/submit/navigation/once-play continuation checks that
lifetime; query-only context changes preserve the current attempt. Shared Auth,
queue, replay and once-play helpers are unchanged. The backend reads metadata
through the real guided query; strict projected transport fixtures no longer
bypass that context. Focused178 cases pass, including all28 source transport
cases. The original query demonstrably failed four authored-metadata cases.

The new actual-component form suite passes22 cases; the exact ff879 form fails21
of those same cases while its positive query-only control passes. Current full
React168/15files, frontend9561/zero skipped and both typechecks pass. Before-proof
and harness failures are retained separately. A stale exact onEnded source regex
was replaced by structural wiring plus actual React current/inactive media
behavior; its prior9560/1 full-contract result remains preserved. New full PG
backend, build/native form/browser gates were subsequently completed below. The
single independent final disposition remains required before the consolidated push.


### Current final media lifetime freeze — product35062fe9

The final product snapshot is `35062fe919e496319e318708c4b3d4c35f993b52`;
the final review candidate adds only task/verification documentation. Same
unpublished human-authorized Round6 remains open; no push or new numbered review.
Reviewer retained2358 non-acceptance because old once ACK/clip rejection could
still pause the same restored Activity node or clear the newer clip listener.
That remaining R6-F1 intersection has one final component-local correction:
Form once uses a captured lease/generation-gated pause facade; Form/Result give
each replay its own controller plus current controller identity guard. All shared
Auth/queue/once/replay helper bytes remain unchanged. Seven new behavioral
regressions all fail exact2358; both complete owned React files pass53 cases,
preserving the original46 assertions. Direct old-to-new clip replacement is
covered alongside actual same-node Activity hide-return. Evidence SHA-256
`25f56f9e14deeda69cecf8b512f45b6170978658755d45a149b6bdd2c77eb98b`.

Current full frontend9561/zero skipped, React175/15files, both types, build
`yeThiDbAPibNbG-S4RZ7Z`, Mock36/guided6/context86 pass. Fresh original Day04 native
Form26 and Result81 (375/1440 light/dark) pass on35062. All screenshots inspected.
Form receipt SHA-256`56c56c5f3783ee434b0986dc626e6e9dc82541bc769189a744b8a12b77a89d91`;
Result receipt SHA-256`b9d2d143222f3e9d26f3851d3103f1e6c5cad8dc231265ee56c8afdbb2ed769a`.
Loopback synthetic Auth/API, not hosted learners/RLS/signing. Old browser and
before-test failures remain retained. The Result QA first passed20 cases then
expected only inner loading text; it observed the authored outer Suspense text
with old media empty/hidden and no old content. One QA-only exact authored-text
assertion correction passes81 without product/privacy/media changes.

The complete actual backend9796/38skipped/3 clock failures/zero errors remains
EXIT1, not overallPASS. All backend and tracked generated-type bytes are EXACT
unchanged since its95ed snapshot; no duplicate full backend run. All28 source
transports/255 incoming Dictation cases (73PG) pass; direct DB11.651ms ahead of
host explains the same three retained migration256 clock cases. New exact-head
Ubuntu CI remains required. Source/importer/release remain frozen.

Only owned API10675 and Next10690 were stopped after all final browser jobs;
API0/Next143 intentional SIGTERM. Runtime6230d49c restored; candidate clean.
Other sessions and QA DB untouched. Final sameRound6 independent disposition,
one canonical-hook consolidated push, exact CI/protected merge/deployed staging,
controlled publication/real journeys and human demo remain open. Production and
FR001–015/T008–T010 acceptance remain pending. T007 is data preparation only.
