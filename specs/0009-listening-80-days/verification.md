# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | Full day/item/source inventory and stable-ID validation | PENDING |
| FR-002 | Immutable source and release SHA-256 attestation | PENDING |
| FR-003 | Full question-block geometry and source-content review | PENDING |
| FR-004 | Asset coverage validation plus special-day journeys | PENDING |
| FR-005 | Collection navigation, resource and eligible practice journeys | PENDING |
| FR-006 | Report-only/source numbering/denominator regression tests | PENDING |
| FR-007 | Complete authored explanation and limitation inventory | PENDING |
| FR-008 | Independent item-audit ledger and correctness exclusion tests | PENDING |
| FR-009 | Private asset authorization and truthful timing tests | PENDING |
| FR-010 | Pre-reveal protected-field and image leakage checks | PENDING |
| FR-011 | Saved/first/revised/reloaded/technical-error journeys | PENDING |
| FR-012 | Dry-run/idempotency/publish/archive coexistence tests | PENDING |
| FR-013 | OpenAPI/type, migration and compatibility checks | PENDING |
| FR-014 | Mobile/desktop, light/dark, keyboard and failure-state journeys | PENDING |
| FR-015 | Independent review, local gates and exact release evidence | PENDING |
| FR-016 | `backend/tests/test_listening_source_audio.py`; `frontend/tests/react/listening-source-audio.test.tsx`; new-vs-original replay timing in `frontend/tests/react/listening-source-collection.test.tsx`. Local PASS; live release acceptance pending. | PENDING |

| FR-017 | `frontend/tests/react/listening-source-collection.test.tsx`: immediate first-part admission, retained draft/flush, hidden media cleanup, keyboard tabs and stale day/account responses. Local PASS; staging/production journey pending. | PENDING |
| FR-018 | 31 GPT figures visually compared and hash-bound in `backend/content/listening/80-days-generated-figures-v1.json`; `backend/tests/test_listening_source_figures.py`; `frontend/tests/react/listening-source-native-display.test.tsx`. Private staging upload/readback: 31 created, hash verified. Live release acceptance pending. | PENDING |

| FR-019 | All80 source/runtime inventory reconciliation, supplemental source-question secrecy/order and reload/owner tests; hosted missing-item journeys | PENDING |
| FR-020 | Original digest/interval/clip coverage validation, private signing tests and pre-answer loop/switch/failure browser behavior | PENDING |

## Initial evidence

Worktree: `/Volumes/Kingston SSD/Code/ielts-listening-80-days`.
Discovery branch: `codex/listening-80-days`; starting staging SHA: `10b45543`.
Implementation branch: `codex/listening-80-days-implementation`. The approved
specification landed at `018c2c6702f541a21c59a626bb19c815eab205a1`; implementation
was rebased onto observed staging `2467dfe044f9ea6aa404a2e6abe7a217f43a718a`
and recorded at `d22b9a15a2037c492b0c0cf13ff07f77759ccf04` before this evidence update.
Read-only source/web/reviewer findings are in the task's external
`80-days-listening-preview/phase-1-*` folders. Their source inventory is evidence
for preparation only, not published content or completed semantic review.

## Historical release evidence — superseded by current closure

- Specification-only approval: PR #1547 merged on 2026-09-30 as staging SHA
  `018c2c6702f541a21c59a626bb19c815eab205a1`. Independent reviewer accepted
  all six specification documents; required checks passed for PR head
  `c93b637b84a93153172f70a78dcd9b0a49a7e806`. Local validator contract tests:
  88 passed. Pre-push backend baseline: 8,884 passed, 355 skipped; skipped
  provider/live/PostgreSQL tests do not certify those contracts.
- Implementation PR #1558 targets staging. Its first head was
  `46dc942219fd0724220af0afe5d1129aff14bd11`; its checks do not certify the
  subsequent consolidated correction. Independent runtime review closed
  R1–R10, then found R11/R12: protected warning prose and solved resource titles
  leaked through public day metadata. The shared public projection now emits
  neutral state copy and unopened-study descriptors; explicit study retains
  protected explanations and resource content. Stored release/importer/schema
  bytes are unchanged. Round4 independent review accepted the correction and
  actual80-day/195-form scan: all104 study positions and110 unopened study blocks
  are neutral; all104 protected items and93 zero-item resources retain their
  original explicit-study content. Actual CI at `e694fa57` failed because
  Ubuntu lacked `ffprobe`, and a pre-existing Mock browser fixture mixed
  countdown with intentional canonical-poll recovery. The final consolidation
  in a separate checkout integrates accepted staging `2b7fa5b6`, adds the real
  OS audio dependency and isolates the fixture's recovery signals. It changes
  neither the Mock app nor the frozen release. Final independent review and
  exact-head CI remain required; merge/publication are held.
- Consolidated correction local gates: source boundary 49 passed; complete
  backend 9,024 passed / 358 skipped; frontend contracts 9,271 passed; React
  27 passed; strict/legacy type checks and production build passed. The initial
  sandbox frontend run failed on localhost binding; the permitted rerun passed.
  Skips do not certify live service contracts. Logs are bound in the external
  runtime reset audit, not treated as staging or production evidence.
- Final consolidation local evidence now binds accepted staging `2b7fa5b6`.
  Three navigation conflicts were resolved by retaining canonical source-day
  and source-collection links while preserving incoming General/IELTS library
  context. Two appended React cases prove foreign query parameters cannot
  change source links or create extra admission/save/reveal/read operations.
  Targeted Node38 and React20 pass. Actual merged OpenAPI generation is
  byte-identical to the automatically merged types, SHA-256
  `e0a4d89ce9afe8942c043550fcd59f746c60e0e9789866d664c557734836cd2a`.
  Full frontend9331/zero skips, React65, strict/legacy types and build pass.
  Final native browser fixtures pass Mock36, guided programme6 and incoming
  programme-context86. Their dedicated servers were stopped, unrelated
  sessions preserved, and generated runtime config restored to the exact
  committed unconfigured default. These are local synthetic fixtures, not
  authenticated source-collection journeys.
  The final host full backend run is9513 passed /38 skipped /3 failed in the
  same unchanged migration256 clock-sensitive cases. Its earlier `d276085e`
  run was9494/38/3. The unchanged whole module passed26/zero failures/errors/
  skips on the same Linux VM clock, with six strict Python/SQL brackets and
  identical1631 source hashes before/after; the exact owned runner was removed.
  This supplemental module does not convert either full host run into PASS;
  complete exact-head Ubuntu CI must pass. Earlier `d276085e` frontend9293,
  React39 and build/native evidence remains historical. Its two default-config
  assertions failed only while fixture endpoints were generated; the failure
  and the restored rerun remain recorded. Final Round5 acceptance and exact-head
  CI are still required before merge/publication.
- Full80 local package and independent source/projection/package review: PASS.
  Package `80-days-listening-source-v1`, manifest SHA-256
  `29819c11a65c71762d7912c919c459df306ed61209a36311a8e23c0d21f83841`.
  Complete native importer: 80 lessons, 195 forms, 1,572 practiced items,
  104 protected study-only positions (1,676 original positions total),
  638 vocabulary terms, 69 stimuli, 663 runtime assets, zero timing segments.
  Every item remains false/self_review with no band or automatic correctness.
  Day76 has two audio-covered forms with 19 practiced positions; unresolved19
  and original21–41 remain study. Day77 and vocabulary61–70 have zero forms.
- Actual full80 disposable PostgreSQL RPC: created/reused the same package UUID
  and exact80/195/1572/69 counts; invalid missing controlled-transcript source
  provenance was rejected with no partial package rows. No hosted or Storage
  writes; local PG does not certify Supabase Auth/PostgREST/Storage.
- Staging schema: canonical advisory-locked migration304 applied, followed by
  readback confirming293 ledger entries and the source namespace/nullable timing
  contract. Four prior package metadata fingerprints and19 attempt ID/status
  fingerprints were unchanged; this limited snapshot does not prove every
  historical answer/reveal/timestamp field. A subsequent genuine pre-import
  baseline uses two identical read-only database snapshots and complete-row
  digests, including19 existing attempts and7 reveals. The source package is
  absent, and the verifier/importer/projection identities are pinned to clean
  `e694fa57`. Two fresh non-admin synthetic students were created through the
  reviewed factory and independently read back; no login or learner journey
  is inferred. Initial asset transfers failed before the package RPC. The V3
  continuation terminated with44 new verified assets,46 submitted terminal
  outcomes and177 not submitted. Combined with440 prior receipts,484 of663
  assets are confirmed and179 remain unconfirmed. Both failures preserve actual
  transport exceptions; the fallback SDK returned object absence as404
  `not_found` with an underlying HTTP400, which the V3 retry classifier rejected.
  No package RPC was called. The independently accepted V4 uploader now handles
  the exact179 remainder, including the two failures, with at most3 workers and
  two canonical calls per asset. V4 has reported one failure and is draining
  already submitted workers; no new submission or restart is inferred. Partial
  live counters are not terminal receipts.
  Completed unpublished
  import/retry and fresh all663 asset/full-row readbacks remain pending;
  partial receipts are not a package completion certificate.
- Staging SHA, integrated checks and live source-collection journeys: pending.
- Production promotion SHA, deployed markers and package publication: pending.

### Bound external evidence

- `80-days-listening-preview/phase-2-review/full80-independent-package-review.json`: independent actual full80/native package acceptance, SHA-256 `2bb1e65b72d890ecefa1e12a02593870cb004324d6d7dc7875967f78f7a35a4e`.
- `80-days-listening-releases/source-v1-20260930`: frozen local release; external `source-v1-20260930-dry-run.json` records actual pure importer result.
- `80-days-listening-preview/phase-2-review/full80-local-postgres-projection.json`: actual complete local RPC created/reused/rollback evidence.
- `80-days-listening-preview/phase-2-review/round5-2b7-native-browser-evidence.json`: actual final local Mock36/guided6/context86 evidence and owned stop receipts, SHA-256 `1d3352fb4d64ac452c69e322af21e367e6094f1ab5c920278abfed9280af57f3`.
- `80-days-listening-qa/round5-module256-vm-root-r2-20260930/module256-root-result.json`: actual unchanged26-case local same-clock module evidence, SHA-256 `1c75906a7fd56c2d030d547ec86cae1aafd612e7cf56daa88a299828bcb999c6`; independent review `module256-actual-same-clock-independent-review.json`, SHA-256 `771a8a89bc8df3c5bf41dd388e28fd57df65f3069ca117c70d0bf0476927b1f6`.
- `80-days-listening-preview/phase-2-review/release-projection-extension-78-80-review.json` plus revision3 `release-projection-extension-26-74-review.json`: final exact normalized tuples, with the original Day53 typed-prompt correction and review-hash rebinding explicitly superseded.

The requirement matrix above stays PENDING for end-to-end release closure; local preparation and code gates do not prove staging or production behavior.

## Unpublished staging closure and initial authorized correction (2026-10-01)

This checkpoint supersedes earlier pending hosted-import/partial-transfer status;
all historical failures above remain recorded. The final frozen manifest is
unchanged. Native source protection includes104 study-only positions,638 terms,
12 multi-gap questions with25 fields and zero fabricated timing. Day76 preserves
19 practiced positions in two covered forms and22 study positions (original
position19 and positions21–41); Day77 is resource-only.

Actual service evidence, all under external
`80-days-listening-content/release-preparation/`:

- Fresh absent baseline `staging-before-import-post-v5.json`: SHA-256
  `28109b52c9bdb940b7b1ef21946d5cc90ee55b3d80909fde46e4ca294bc55652`.
- Canonical created receipt `staging-import-commit-v2.json`: SHA-256
  `89d7dc382649016ecb966239e97ef48850812bb93cd74cd953a10139e2bd6a11`.
- Complete validated/private663 readback `staging-after-import-v2-readback.json`:
  SHA-256`07b9b9950271c391cf547ae487d74818f9bd674e15f6b300d695a913f44a55d2`.
- Actual reused retry `staging-import-retry-v2.json`: SHA-256
  `3c39e69dce4b558a98742c642085505afb6e54f9372af95752dcdf5926f1f378`.
- Complete retry readback `staging-after-import-v2-retry-readback.json`: SHA-256
  `56ed2924a66e98eba21b76cae6e1f5e96e73232071d1323e96ccd9f57d72fc6d`.

Both readbacks cover663 private assets/823353015 bytes, exact native payloads,
actual imported_byNULL, validated package/draft private descendants, identical
read-only transaction snapshots and unchanged full-row coexistence. Retry keeps
every owned UUID/timestamp/payload fingerprint and all prior learner rows. The
independent data closure SHA-256 is
`dd6228ea0aebc6837be8163c96ff182f262f6b0e8329b282e288bead46030eee`.

PR head d66301a9 passed actual Ubuntu CI (9516 backend passed/38 skipped) and
all applicable frontend/type/build/native gates. It is still open against
staging with three actionable conversations. The user subsequently said
“cho phép” to correct all three and reopen review after the documented hard
five-round limit. Trusted authorization artifact SHA-256
`afb38bd3ad944c3a172ce3b3b94bd30557142c07635b1852f1857504ffd4e3f4`.
The correction was saved locally as `99368c4054cff313b22fdb02972e2f58f4286b67`.
Observed staging then advanced to `a5a579d18c0ebc2ee5bdcada1722cc90e4324aeb`;
the isolated candidate integrated it as `03c5050e4bbb335c566cdadd68052ecb0d3dedd4`.
Only migration README numbering conflicted; incoming305/next306 was retained
alongside source304. Source definitions and all incoming Dictation definitions
were independently compared, and actual merged OpenAPI/generated types match.

Actual integrated local gates:9561 frontend contracts/zero skipped,146 React
tests, strict/legacy types, build and maintained Mock36/guided6/context86 pass.
The first contract run had two sandbox loopback permission failures; the
unchanged permitted rerun passed. The full7360-file backend snapshot reports
9789 passed/38 skipped/3 failed/13 warnings in292.21 seconds. All255 incoming
Dictation cases, including73 PostgreSQL cases, and21 new source ASGI cases pass.
The three failures remain the unchanged migration256 host/VM clock cases;
the actual trace records database time17.054ms ahead of the host. Exit1 is
retained; this is not an overall passing backend gate. Evidence
`integrated-03c5050e-full-backend-gate-evidence.json`, SHA-256
`7b6ceb8378d2655d7cfca348a2ef07dd4c633bc20c705909038d6ad282585792`.
The146 React cases include two actual Activity hide/return cases (source and
generic), which pass without any further product change. Final React log SHA-256
`1b6f3856d8ad4782d1d28848e82eed2d73d4c57e5ef900d7dd9acf8fa0baee4e`.
New exact-head Ubuntu CI and final independent acceptance remain required.
Old CI does not close this correction. No conversation is resolved yet.

Actual source browser81 checks pass on the same integrated build in four
375/1440 light/dark paths, using unchanged original Day04 audio (255.8 seconds).
Native Q16/Q19 cover four fields in browser; all12 native multi-gap items/25
fields are covered separately by the native React/ASGI fixtures. First/final/
editorial/printed-reference labels, actual play/pause/replay, real AuthProvider
synthetic account change, actual Next soft navigation, metadata503/media403,
zero application writes, zero hosted calls and zero DB operations are recorded.
Receipt SHA-256`7b6881b02c233d45d8037bf62e3e43291ff6b74ff24ab894660ca47d25e89ce2`.

Initial browser launch permission failure and both incorrect extra QA
assumptions remain preserved. Native-only control proves Chromium retains a
historical currentSrc after media is empty; actual Next/React Activity retains
hidden DOM while the callback releases media. QA now checks the visible active
view plus hidden-or-detached, paused/source-cleared/empty old media. It retains
strict account detachment, all content/playback/error/network assertions and
records both native properties and all-versus-visible DOM counts. Independent
control SHA-256`1f22c745d5e19f34e6735e35301f807cabf2d3aa543f03ab3b7b4ff0b3c4e258`;
Activity diagnostic SHA-256`30866039b9021d0fb9df3dbca461cbc1dfa67e8ead324f3e735b37eb71252928`.
No product change followed those QA corrections. This local fixture evidence
does not certify hosted Auth/RLS/signing. Owned test servers were stopped
(Next143 is intentional SIGTERM); default runtime was restored byte-for-byte
to SHA-256`6230d49c387433720e02481a2ba06eda3db23b99422cd7d4294f5404dd64df18`.

The end-to-end FR001–015 matrix remains pending until source Auth/RLS/rendered
journeys, exact staging deployment/demo, controlled publication/rollback and
production promotion/deployment/verification have actual evidence. T007 data
preparation closure is not overall release completion.

### Single Round6 corrected freeze evidence

The whole-contract audit of ff879c83 is **not acceptance**. Consolidated finding
receipt SHA-256`03475dd9a3e974a78e0b73b5f6e7348be712e2f6748a59ea852daebbcc74b254`
contains two findings within the authorized account/media and authored metadata
categories. The same unpublished Round6 remains open for one corrected frozen
candidate and its final disposition; there has been no further numbered review
or push. Earlier result/hook/canonical-label corrections and frozen T007 data
remain intact.

- In-progress form: Auth status/user/test keyed view, layout-owned captured
  lifetime and abort controller, native ref teardown/reattach, scoped later
  queued writes/reveal/submit/navigation and once/clip playback. Shared Auth,
  queue, once-play and replay helpers unchanged. Actual22-case React suite passes;
  the exact old ff879 component fails21 identical cases with one query-only
  positive control passing. Evidence`programme-form-scope-regressions-20261001.json`,
  SHA-256`f95edd9f6165fe759a9183619bfeaeb575e9dba8b4244ca5146c23ae798bb90f`;
  test SHA-256`7f236ba4b618c1f8cddd3dc8fe311128bba11028643521240a810eb9febe49aa`.
  Before-alias transform/config failures are retained and excluded from product
  regression counts. Current and inactive native error/ended behavior, StrictMode,
  source/generic Activity return and query-only preservation are exercised.
- Guided metadata: only the actual `_programme_guided_context` select adds
  metadata. Both protected transports now execute that real context in strict
  projected/filtering fixtures with genuine active/submitted/published boundaries.
  Focused178/zero skipped, including28 source transport cases, pass. The original
  query fails four real authored-granularity cases; one new generic fixture
  initially reused invalid source-only content and was corrected/disclosed.
  Evidence`guided-metadata-projection-correction-evidence.json`, SHA-256
  `8228893e6352f56ace76863844b4791a5cd436427ab73117b3e2ccdbb3990b45`.
- Current full frontend9561/zero skipped (logSHA
  `67f6eb2f917a90b4d7b78b8267d9a6cdbd0842894ea71aeef1b0a957247eb783`),
  full React168/15files (logSHA
  `0b95073099aa6c619aa88c2ea654979cfb9d86814d43c53ba08232eeec38ee11`),
  strict/legacy types pass. Original mutation path/payload/count checks are kept
  alongside abort signals; negative reveal checks inspect paths to avoid vacuous
  absence with changed optional argument counts. The old exact onEnded regex
  failure9560/1 is retained (logSHA
  `c4cab275114f81ebbbf3667ca783ecef34beffc00a6ce9a5470daf85bf79fb27`);
  structural event wiring plus actual React behavior replaces that implementation
  detail. No test is removed or skipped.

### Historical completed local verification — product95ed651a

The corrected product commit is `95ed651acf9f59858a147c47bbb9fd34f16a1ce6`.
The final review candidate differs only in task/verification documentation. This
is one final disposition of the same still-open unpublished Round6, not another
numbered review. Neither final acceptance nor a new push is implied.

- Complete PG-enabled backend:9796 passed,38 skipped,3 failed,zero errors,
  13 warnings/280.55s; exit1 retained. All28 source real-context transport cases
  and all255 incoming Dictation cases (73 actualPG) pass. Copied7361-file source
  hash mappings agree before/after. Only the same three unchanged migration256
  clock cases fail, with DB statement time11.651ms ahead of host. No assertions,
  tolerances, clock, skips/xfails or duplicate full-run changes. It is not an
  overall passing backend gate; new exact-head Ubuntu CI remains required.
  Evidence`corrected-95ed651a-full-backend-gate-evidence.json`, SHA-256
  `ab897893ec9df8c8594ef2c05f390dd8e4e7d345fc03a295181711a83f4e408a`.
  Actual OpenAPI SHA-256`59a6715af4fd81ce9a130368f627c058b2b493c6c05d8fdde1ada6e8de711157`
  regenerates tracked types byte-equal SHA-256
  `d18806ca37579c582c2fb19590d6812d6d2028cd88b746e0796bbfb19b502656`.
- Current production build passes:ID`PDmj221TdScc5Qp9AVA83`, logSHA-256
  `4845c58b5597d15d37390feba46d214843f4ac783215910e9a9a8df62da8b2be`.
  Maintained native Mock36/guided6/context86 pass on that build. Full frontend
  9561/React168 and both type boundaries above also pass; they were not rerun
  merely for the final documentation delta.
- New actual in-progress native form browser26 checks pass at375 light on95ed.
  Original Day04 audio255.8s plays, pauses, replays and restores after return.
  Account change strictly detaches old media/main; soft Next navigation retains
  old DOM only with display:none/zero bounds/invisible. Both immediate and
  settled states have paused/src-null/ready0/network0/time0/durationNaN audio.
  Historical currentSrc is recorded, not mistaken for a live source. Pending
  new views expose no old answers/feedback/hrefs/visible audio. Old heldQ17
  flush never launches a later reveal. Both native Q16 authored fields are
  blank for new account and both restore for the same account after return.
  Generic once actual play/button pause/resume has one claim acknowledgement.
  Receipt SHA-256`080dfc17224644ee2df23ef8f6429433c799c58a2581511f2d6f089cccb3f6c7`;
  actual inspection SHA-256
  `023a9d42013f0a2dd239a308d4a3dadf3fbdcfdd1be6b3edb7a16284fab9161d`.
  Root and source agent visually inspected both375 screenshots. Fifteen
  synthetic application request records and eight telemetry records are
  intercepted in-process; these count arrivals, not independent completed
  response certification. The old held PATCH is deliberately aborted. There
  are zero real server application writes, hosted calls, unmatched/remote
  requests or uncaught page errors. This does not certify hosted Auth/RLS.
- The initial13-pass form browser run failed a broad first-input assertion
  because the source-image dialog has a hidden zoom range value100. Its original
  verifier and terminal receipt remain unchanged, SHA-256
  `09dfb86659dcb7c10ddea6db8a4ef282dda614b19307fbbb54a82cf40a257cfc`.
  One coherent off-repository QA correction scopes both assertions to native
  Q16 country/birth_order authored labels and snapshots only answer controls.
  Exact verifier SHA-256
  `ae96d430b21d3f1434c64c411eea0a2c9f7c1c1b5659f5e273b35f9b2dafc205`;
  original product/fixture/privacy/media predicates are unchanged. Eight
  offline guards pass. No automatic adaptation or product patch followed.
- Only root-owned API81260/Next84630 stopped after terminal native evidence;
  API exit0/Next143 intentional SIGTERM. Canonical runtime restored byte-equal
  SHA-256`6230d49c387433720e02481a2ba06eda3db23b99422cd7d4294f5404dd64df18`.
  Cleanup receipt`corrected-95ed-runtime-cleanup.json`, SHA-256
  `0aaab834a78e678dc4a047b8c104e636f78e8e204a12c78cb27572704dc084a5`.
  Other sessions and the running QA database are preserved. Original importer
  operator remains clean at e694fa57 and frozen release manifest is unchanged.

Final independent disposition and then one normal consolidated push with the
canonical pre-push hook are required. Exact new-head Ubuntu CI, protected staging
merge/deployed-SHA checks, controlled attested publication, real source learner/
Auth/RLS/signing journeys and human demo approval remain open. Production
migration/promotion/deployment/publication/rollback/live verification and final
FR001–015/T008–010 acceptance remain pending. T007 is closed only for unpublished
staging data preparation. Historical complete source-result81 evidence certifies
unchanged result/hook/labels bytes; the form26 evidence above is separate.


## Current final same-Round6 media lifetime closure — product35062fe9

Final tested product`35062fe919e496319e318708c4b3d4c35f993b52`; final candidate
diff is documentation only. The independent2358 checkpoint was not accepted:
`authorized-round6-media-lifetime-intersection-audit.json`, SHA-256
`d9c2be5d7c84af16eaf73b94eb2234ba21ec315732296beda3ad447f03939b16`.
This was the remaining side effect in R6-F1, within the same already-authorized
async/media category. No new numbered review, architecture or push occurred.

- Minimal component correction: lease/media-generation-gated captured once pause
  facade in Form; separate replay controller per invocation plus current instance
  guard in both Form and Result. Delayed helper callbacks cannot mutate the
  current restored node/listener or expose a stale direct-switch error. Shared
  Auth/queue/once/replay helpers are byte-unchanged. Seven new actual-component
  behavioral tests all fail exact2358 before aliases; all53 cases in the two
  complete owned files pass35062, original46 assertion prefixes preserved.
  Evidence`activity-same-native-intersections-20261001.json`, SHA-256
  `25f56f9e14deeda69cecf8b512f45b6170978658755d45a149b6bdd2c77eb98b`.
  Actual Activity asserts the SAME node, newer accepted once playback before old
  ACK accept/deny/reject, old4s boundary does not pause/new9s boundary does pause,
  no extra claim/current alert/stale playback message. Media is mocked in jsdom;
  these sequencing tests are separate from genuine native browser playback.
- Current full frontend9561/zero skip (logSHA
  `aec56e208c8527eff3990a89ff20262401f37658f6d0d27536c6ce341a36fff3`),
  React175/15files (logSHA
  `e1f884ab1be3dc5798a20fa62050eaf3a83947b83d41fb6a5a3ffa0c09785b4c`),
  strict and legacy types pass. Production buildID`yeThiDbAPibNbG-S4RZ7Z`, logSHA
  `54f0decf55fe79ca065c3e479ace3e6547c6fbc5c6c6d7a0a3a455b2d8cc47d6`.
  Native maintained Mock36/guided6/context86 pass on this build.
- Fresh original Day04 Form26 and Result81 native browser checks pass35062.
  Result81 covers375/1440 light/dark, actual decode/play/pause/replay, native
  Q16/Q19 ordered first/final/editorial/printed labels, Auth account strict
  detachment and actual Next attempt Activity hidden/empty old media, truthful
  metadata503/media403. Form26 covers same account/form cleanup/return/current
  once normal playback. Both Form screenshots and all four Result screenshots
  visually inspected. Form receipt SHA-256
  `56c56c5f3783ee434b0986dc626e6e9dc82541bc769189a744b8a12b77a89d91`;
  Result receipt SHA-256
  `b9d2d143222f3e9d26f3851d3103f1e6c5cad8dc231265ee56c8afdbb2ed769a`.
  Intercepted local Auth/API only, zero real server/hosted/DB application writes.
  Synthetic telemetry/request arrival counters are distinguished from completed
  response certification. All12/25 native fields remain separately verified by
  current React and real-context backend transport cases.
- The first current Result run passes20 checks then fails an over-specific QA
  loading-text assertion, receipt SHA-256
  `3b7cf1e7ac9e108a85ffbb3a577a13e9ba9577a162c286bc3cc12e30903bc6c3`.
  Recorded pending view has one visible main/zero visible h1/audio/hrefs; old
  media hidden, paused/src-null/ready0/network0/time0/durationNaN. It contains
  authored outer Suspense “Đang mở phần tự đối chiếu…” before inner authored
  “Đang tải phần tự đối chiếu…”. Original script/log/screenshot retained. One
  QA-only condition accepts EXACTLY those two source strings while retaining
  all old-content/privacy/native-media assertions, not arbitrary loading text.
  Verifier SHA-256`7c5e5e7035782cb8a36a224e41ddce6df65601ce7280376514f6fdd4da8f713d`;
  exact diff SHA-256`d0449f6fc57db042d65e4519748ea2b774b1c93ef9abf338cb25745427237190`.
  No product changed, no further automatic adaptation or rerun.
- Backend proof reuses actual95ed complete9796/38/3 EXIT1 honestly: EVERY backend
  path and generated tracked type byte is unchanged through35062/final docs.
  No repeated full backend run. The same three migration256 host/Colima clock
  failures remain, DB11.651ms ahead; no skip/xfail/assertion/tolerance/clock
  changes. All28 source transports and all255 incoming Dictation cases (73PG)
  pass. Actual OpenAPI/type parity above remains valid. Not an overall passing
  backend gate; new exact-head Ubuntu CI must pass before protected merge.
- All final native jobs terminal. Only root-owned API10675/Next10690 stopped:
  API0/Next143 intentional SIGTERM. Canonical runtime6230d49c restored byte-equal;
  clean candidate, other sessions/QA DB preserved. Cleanup SHA-256
  `9810e5d621b716fa1e068279645670bd86a901f9f636506dda3ea84c0fa6a05b`.
  Frozen importer operator e694fa57/release manifest unchanged.

Final independent disposition of this same frozen Round6 remains required, then
one normal consolidated push with canonical pre-push hook and exact-new-head CI.
The local staged-journey v2 protocol is prepared/offline only with deployed SHA
NULL and execution gates disabled; it has not logged in or touched hosted data.
Protected merge/exact staging deploy/integrated/live smoke, attested publication,
real source Auth/RLS/learner journeys and human demo approval precede production
promotion/publication. All final FR001–015/T008–T010 gates stay pending; T007
closure remains unpublished staging data preparation only.


## Current checkpoint — 2026-10-05: native presentation and separate audio

This supersedes the historical local-only release conclusions above. Editorial
PR #1587 is merged; its revised explanations were checked on live staging. The
immutable source package is already published on staging with manifest
`29819c11a65c71762d7912c919c459df306ed61209a36311a8e23c0d21f83841`.
Production was checked directly and still has no 80-day package. Shared code
promotion #1586 completed before this task integrates its own release.

Current branch `codex/listening-native-display-20261005`, base `f2a73572`, adds
private native presentation on real day/player/study routes and independent
authenticated audio choices. All 453 runtime block bindings and all 195 forms
match source; 350 question blocks / 1,676 positions, 41 layouts and 31 existing
SVGs are covered. No source question route signs/displays PDF crops. Source
keys, grading, original package and learner attempts remain unchanged.

Kokoro choices bind all 80 final reviewed MP3 hashes; 69 originals remain
separate, with truthful Day76 partial/Day77 missing/vocabulary-track states.
The immutable upload CLI validates all 80 before writes and verifies private
Storage readback. Staging bucket and package identity have been checked;
all 80 objects were created and verified by hash, upload exit 0.
Production content import has not run.

Consolidated local evidence: full backend 9,746 passed / 646 skipped; full React
417 passed; both TypeScript checks and webpack production build passed. Full
frontend contracts passed 10,651 / zero failures or skips with the required
loopback permission and no concurrent runtime-config generation. The committed
null runtime stub is restored. Actual local Next checks at 375/1440px, light/dark
passed table rows, SVG/zoom, study guard and multi-gap save with mocked auth/API.
These are local acceptance, not deployed acceptance.

One independent council code/data review accepted the complete native/audio
patch with no blocker. It is not a new human audio or source-fidelity certificate.
Next required evidence: exact-head CI, deployed native/audio staging journeys,
then production code/content publication and actual production journeys.

Before integration, a live staging inspection identified three instructions
that still directed learners to PDF crops. These are now bound Vietnamese
native instruction overrides for Day1 matching/closest-meaning and Day80
fishing. Original English text, word/selection limits, question layouts,
options and source digests remain unchanged. The council accepted this bounded
correction; all 72 affected source/native/audio tests passed after adding the
three real source-block fixtures.

PR #1591's two P2 findings are corrected together: native lookup requires the
active published package manifest and all 1,572 practice display-question hashes;
the free-listening audio select has a 44px minimum target and explicit keyboard
focus styling. The council accepted the bounded consolidated revision. Actual
375px deployed selector measurement remains pending. The initial PR browser run
failed one Admin Writing Tips request assertion: its page heading was visible
before its list effect. The verifier now awaits the existing canonical item
heading before making the same assertion; no product behavior/assertion is removed.
The focused Admin Writing Tips browser journey now passes all 13 checks with
canonical isolated runtime settings; initial missing-runtime local attempts
failed before the product heading and are not passing evidence.
Shared promotion #1586 has finished; this task may now proceed through its own
exact-head CI and staging acceptance without racing that session.

## FR-016 — synthetic free-study scope evidence, 2026-10-05

The user's later explicit per-lesson Kokoro request authorizes this scope
extension; it is not retroactively included in the September30 approval.
Spec-only PR #1593 recorded that authorization after implementation. This
clarification adds requirement traceability without changing runtime behavior.

- `backend/tests/test_listening_source_audio.py`: all80 catalogue days,69
  original recordings and days without originals, vocabulary/Day76/77 truth, wrong package/manifest/day fail
  closed, authenticated route, unavailable signed assets, and upload tampering
  rejection before writes. `frontend/tests/react/listening-source-audio.test.tsx`
  checks original default, separate synthetic switching without attempt POST,
  day/account media cleanup, unavailable media and retry. These passed in the
  consolidated PR #1591 suites; unchanged product bytes retain that evidence.
- All80 generated WAV/MP3/plan/receipt/ASR bindings were verified against the
  final manifest `21bcf24a85984f68d4959a43455c3969bde96b9ad4cea3743c3ac66ef50f3199`.
  Council evaluation is machine-based integrity/transcription assessment, not
  a human naturalness certificate. The canonical staging upload readback
  verified80 private MP3 objects;69 original files remain unchanged.
- Authenticated live staging66a8374b played original and Kokoro Day1,
  vocabulary-only Day61 and synthetic-only Day77 without media errors. Day77
  retained zero Listening starts and protected40-question study; Day76 retained
  original Section1–2 coverage. The375px selector was45px with visible keyboard
  focus. Official smoke37261556465 passed and confirms frontend/backend both
  serve `1d1b9e220ea17f07aa87194384b8e1f67314978d`; only spec prose changed after
  the product acceptance. No human listening acceptance is asserted.
- Production package import, private variant upload/publication and affected
  live production journeys remain pending production access. Staging evidence
  does not certify production content availability.

## FR-016/019/020 — original audio and complete practice, 2026-10-11

Spec approval #1631 supersedes the generated-audio default. The isolated
implementation preserves the published package and canonical attempts. Direct
read-only reconciliation of both staging and production confirms all 80 days:
1,676 source positions, 1,572 canonical questions and 104 previously excluded
positions. The native supplemental projection restores those 104 as local
unscored drafts in source order; 1,689 response fields distinguish multi-gap
questions from additional questions. Days 61–70 remain vocabulary lessons.

Original recordings remain unchanged. The clip catalogue covers the 1,615
positions with an original recording; Day76 Section3–4 and all Day77 account
for the 61 positions without one. Private cuts are anchored to numbered source
contexts or cited transcript lines aligned to original word timestamps. Shared
dialogue context is explicitly labelled. Alignment and playback checks do not
constitute human listening acceptance or certify the source answer key.

Question clips are available before answering/revealing, with unlimited native
looping and cleanup across media, Part, day, variant and owner changes.
Supplement drafts never enter canonical answer/reveal/submit requests. The
backend batch signer authenticates before planning private paths and retains
per-asset retry state; the upload CLI verifies full coverage, immutable original
bindings, physical clip hashes/lengths and private Storage readback.

Tests: source supplements/native projection; complete original clip inventory,
wrong original binding and incomplete upload refusal; authenticated batch signing;
React supplement order, canonical writes, pre-answer looping, scope cleanup and
retry. Full frontend contracts, React, both typechecks and production build pass.
Backend final catalogue verification, exact-head CI, deployed staging acceptance
and production promotion are release evidence to record after execution.
