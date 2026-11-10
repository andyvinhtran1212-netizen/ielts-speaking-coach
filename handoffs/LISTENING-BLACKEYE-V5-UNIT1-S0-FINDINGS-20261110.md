# Black Eye Unit 1 — S0 findings and transport freeze candidate

Task **aver-web/t_a7881371**, replacement of t_098a5840. Author web-feature (GPT). Local-only S0; no product acceptance or PR approval.

## 1. Exact object, authority and status

- Canonical contract: `AVER-WEB-BLACKEYE-U1-20261110-v1`, team-root `handoffs/LISTENING-BLACKEYE-V5-UNIT1-IMPLEMENTATION-CONTRACT-20261110.md`, independently re-hashed **2df625064ae7ffb81b68a216237658dfd7e3447d2d07be68b91c9a8b0d24796f** before work.
- Original user records read: decision753, Unit 1 clarify uid `ba41c785082a4cc6b0367cb318b84ecf` (2026-11-10 12:09 +07), terminal uid `532d3d4369134fbe83375d3594897ae0` (12:28 +07), implementer message4550 uid `0f65a5533b3b427abf89d14e4cf64e3a` (12:39 +07). These permit local synthetic work only, not publication. Later role grant supersedes paper contract's old Feature-does-not-code role wording.
- Reused exact clone authorized by Leader's 13:02 reconciliation and replacement card; no clone/fetch/network call in this run. Before edits: HEAD = local `origin/staging` = **7243b3364cfd637dc1bd0cd464c810380e27d10e**, branch **blackeye-u1-s0**, porcelain empty, local-ahead count 0. This is the handed-over source baseline, **not current remote HEAD or served deployment proof**. Live staging contact is forbidden on this card.
- All paths below are relative to this clone unless labelled team-root. Final commit identity is recorded in the card handoff and team-root evidence receipt, not embedded in its own committed contents.
- **S0 outcome: missing-path identification, not MV1/MV2 closure.** Existing generic submitted review does exist; Black Eye identity/revision/assigned authorization and assignment admission do not yet satisfy the contract. No production module, migration, frontend code, lockfile or guard changed. S0 adds this document and an offline source-characterization suite/evidence only.
- Sections 4–7 fix one proposed shape for Coordinator's S0 amendment. They are **NOT implemented endpoints/OpenAPI schemas** and not a second canonical contract. Independent exact-commit review and Coordinator freeze must precede PR1. If reuse below cannot be proven narrowly, STOP for amendment; do not fabricate a snapshot table or generic LMS.

## 2. Current paths — observed from baseline source

### Identity/public projection (MV1 remains OPEN)

`backend/models/listening_source_collection.py:7–9` defines `SOURCE_PROGRAMME='ielts-80-days-listening'`, collection `80-days`, source contract `source_book_v1`. Collection/day responses have literal `80-days` (:223–271). This is not a generic Black Eye transport. `SourceModel.extra='ignore'` is not a strict incoming Black Eye validator. Source response fields (:38–50) describe native blanks; no KEEP/CHANGE composite exists.

`backend/routers/listening.py:8090–8095` `_source_required_for_test` compares only to SOURCE_PROGRAMME. Synthetic Black Eye programme returns **False**, while a missing test row raises **503**. This is an incompatibility finding, not a claim that a deployed Black Eye endpoint leaks. It prohibits treating the generic non-source branch as adequate Black Eye security.

Player bundle path is `GET /api/listening/tests/{test_id}` (`ListeningPlayerResponse`, :6151 onward). Its source-required exercise check at :6002 expects `source_book_v1`. Existing programme payload uses `variant='programme_form_v1'` and numeric `q_num` plus `source_item_id`. No Black Eye-specific binding exists in backend Python at this baseline (bounded source search).

### Attempt/save/submit/result and protected review (MV2 remains OPEN)

| Actual route | Existing DTO/behavior | Reuse limit |
|---|---|---|
| `POST /api/listening/tests/{test_id}/attempts?standalone=true` | `_ListeningAttemptStartRequest`: `renderer_affinity_protocol: 'claim-v1'|null`, `purpose: 'practice'|'assigned_practice'|'mock_delivery'|null`, `mock_sitting_id: UUID|null` (:5043–5053). Imported report-only forms acquire/resume via `fn_acquire_listening_programme_attempt_v2` (:7728–7789) | Atomic standalone is a pattern, not assigned support. No first-version overwrite of submitted Black Eye attempts allowed |
| `GET /api/listening/tests/{test_id}/attempts/in-progress` | Query `standalone`, `class_item`, `sitting_id`; returns attempt receipt/answers or null (:7553–7645) | Reject standalone+assigned/sitting mix; freeze activity/revision/context in new branch |
| `PATCH /api/listening/tests/attempts/{attempt_id}/answers` | `TestAttemptAnswerPatchRequest(extra='forbid')`: `{q_num:int,user_answer:str}` (:5026–5029). Owner fetch, active status/TTL/class gate, **q_num 1..40**, then `fn_upsert_listening_answer(p_attempt_id,p_q_num,p_user_answer)` (:7999–8062). ACK `{attempt_id,answer_count,performance_event_recorded}` | A13 cell 41 and 48 currently **422** before RPC. Fixing importer alone would not solve 48 cells |
| `POST /api/listening/tests/attempts/{attempt_id}/submit` | No body. Owner fetch; report-only finalization persists `status,score=null,band_estimate=null,grading_details,result_summary,submitted_at` with status/answers/expiry CAS (:8488–8620) | Submitted report-only retry reads live exercises **before** overlaying stored summary/details (:8505–8522); cannot guarantee immutable retry if content changes or fails to load. Blank confirmation is not a backend DTO here |
| `GET /api/listening/tests/attempts/{attempt_id}` | Owner-only canonical status/answers/stored result/time (:8699–8725) | Useful ACK recovery; no source-contract/revision fields in this response. Saved state is not submitted state |
| `GET /api/listening/tests/attempts/{attempt_id}/review` | `ListeningAttemptReviewResponse`; owner or global admin, submitted required (**409** otherwise), sealed/confidence guards (:9002–9051) then `_assemble_listening_review` | Generic submitted review **exists**, including a synthetic assigned attempt when injected after admission. It is not a cohort-scoped teacher capability. No complete Black Eye programme/source/revision/publication checks before assembly |
| `GET .../guided-state`, `POST .../questions/{q_num}/reveal` | `ListeningGuidedStateResponse` (:8169–8250) | `_programme_guided_context`: non-progress **409**; assigned/sitting **422 before private reads** (:8114–8147). Keep this guard unchanged |

`ListeningAttemptReviewResponse` in `backend/models/listening_programmes.py:278–315` is a permissive shared DTO: `attempt_id,test_id,title,status,score,max_score,band_estimate,scoring_policy,assisted,result_summary,programme_id,listening_lesson_id,form_purpose,replay_policy,support_policy,claim_policy,trap_analytics,audio_url,audio_granularity,audio_duration,section_offsets,cue_points,band_conversion,sections,review,controlled_transcripts,web_explanation_access,context_source`. `ListeningReviewItem:251–275` has string `user_answer` and optional source fields/explanation, solution/self_review and context provenance; it does not define Black Eye identity/source-status/scoring-mode/composite semantics.

Assembler (:8748–9000) loads a mock review snapshot **if available**, otherwise reads current test/content/exercises; signs audio, assembles transcripts and solution fields. Source-specific sanitization is conditional on the 80-days programme. It explicitly assumes caller authorization. Never call it directly as a Black Eye endpoint or equate a review route name with MV1 PASS.

### Assignment/admin/learner flow

- `POST /admin/cohorts/{cohort_id}/assignments`, `AssignmentCreate` (`backend/routers/admin_class_assignments.py:113–226,2622–2775`) accepts one `content_id`, `skill='listening'`, date/time, `student_ids` or current whole roster and delivery/correction options. Imported report-only programme forms are explicitly rejected **400** at :2706–2716, before writing assignments. This protects against impossible homework; do not delete the guard globally.
- `give_request_id` is currently enforced/used for individual Grammar gives, not generic Listening (:180,202–205,2637). It cannot simply be inherited as Black Eye idempotency.
- `validate_class_item_for_test` (`backend/services/class_assignment_service.py:1082–1150`) verifies student ownership, open assignment, deadline, active cohort membership, unarchived class, matching skill/test. Preserve these checks. Assignment artifact mapping :1168–1175 uses `listening_test_attempts` / `listening_attempt`; it does not freeze a Unit collection's activity order/revisions/denominator.
- Imported report-only start rejects non-standalone **422** at listening.py:7706–7709, before `validate_class_item_for_test`. Setting standalone with class_item also **422** (:7668–7670). Both admission boundaries need a narrow new Black Eye branch, not query-parameter tricks.
- Frontend `frontend/app/(authed-listening-player)/listening/programmes/form/[testId]/programme-form-runner.tsx:142–176` unconditionally starts standalone, fetches bundle, loads guided state, PATCHes string answers. It cannot be used unchanged for assigned Black Eye work. Result UI is `frontend/app/(authed-listening-review)/listening/programmes/result/[attemptId]/programme-result.tsx:56` calling generic review.
- Admin `frontend/app/(authed-admin-classes)/admin/classes/[cohortId]/admin-class-homework.tsx:198–250` loads current catalog paths; no Black Eye readiness/revision catalog is established here. Existing Grammar per-recipient retry state is not proof of Listening support.

## 3. Immutable revision reuse — conditional, not invented closure

Existing reusable machinery:

1. `backend/services/mock_paper_policy.py:120–135` returns no marking snapshot for `paper_revision is None`, otherwise requires a stored `mock_paper_attempt_snapshots` row with marking/paper/source/order/override fields. `guard_owned_attempt:175–181` is a separate RPC authorization, not a substitute for source identity.
2. `backend/services/mock_review_context.py:14–34` checks skill, attempt ID, test/paper ID and paper revision; deep-copies frozen rows and fails **503** for wrong/missing frozen context. It deliberately returns `None` for revisionless attempts or admin preview. `context_reference:46–55` labels current fallback as possibly changed, never immutable history.
3. `backend/migrations/306_mock_paper_policy_and_admission.sql:168–300` shows admission revisions/snapshot creation depend on `fn_mock_admission_contract_active()`; revisionless N-1 behavior remains explicit. `:362–375` wraps standalone programme acquire with practice admission. **Read only; no migration executed.** Existing SQL source is not the local/live DB schema.
4. Programme package/source manifest hashes can identify immutable imports, but a mutable current publication lookup is not a frozen attempt. Report-only retry's live read is a concrete remaining gap.

Freeze candidate: reuse the existing admission snapshot **only if** a synthetic DB proof demonstrates both standalone and assigned Black Eye starts pin the same content/answer/policy identity, author/publication state, source contract, ordered source cells and private review material atomically. No runtime-flag assumption, no public preview fallback, no legacy attempt backfill. A Black Eye attempt missing a frozen snapshot must fail closed before signing/reading references; generic N-1 behavior stays unchanged. Content revision changes produce new bindings, not edits to submitted history. No new table, trigger, migration filename or flag enablement is selected/authorized by S0. If this reuse cannot meet the contract without schema work, Coordinator/Andy must amend exact scope before implementation.

## 4. Proposed exact transport for Coordinator freeze (not registered OpenAPI)

Names below are the single S0 candidate, not claims of shipped routes. Future modules: `backend/models/listening_blackeye.py` for strict transport; `backend/services/listening_blackeye.py` for programme boundary/allowlisted projection. Keep 80-days constants/models unchanged. No generic import framework.

### Common identity

`BlackEyeRevisionBinding` (strict, extra forbidden):

```ts
type BlackEyeRevisionBinding = {
  programme_id: 'blackeye-v5-upper-listening';
  collection_id: 'blackeye-v5-upper';
  source_contract: 'blackeye_u1_v1';
  unit_id: 'U1';
  activity_id: string; // ^U1-A(0[1-9]|1[0-9]|20)$
  content_revision: string; // nonempty immutable revision, no 'latest'
  answer_set_revision: string; // nonempty; may identify reviewed self-check material
  policy_revision: string; // nonempty immutable policy identity
};
```

Transport revision strings are opaque IDs; mapping to existing integer DB revisions must be explicit, not silent string/integer equality. On attempt routes the server resolves this binding from the attempt + frozen revision, not client overrides. A request binding is only an optimistic precondition. Never trust client publication, entitlement, scoring mode or cap.

### Routes to add, and existing routes to extend narrowly

| Candidate route | Strict request → response | Required boundary |
|---|---|---|
| `GET /api/listening/source-collections/blackeye-v5-upper/units/U1` | no body → `BlackEyeUnitPublic` | Auth/entitlement and published allowlisted projection. Inventory includes locked A8/A14/A19; no protected material |
| `GET /admin/cohorts/{cohort_id}/listening-source-catalog?collection_id=blackeye-v5-upper&unit_id=U1` | no body → same public inventory + eligible synthetic recipient IDs and explicit lookup errors | Authorized cohort admin; not real cohort under current task |
| `POST /admin/cohorts/{cohort_id}/listening-source-assignments` | `BlackEyeAssignmentCreate` → `BlackEyeAssignmentReceipt` | New narrow branch preserves existing generic programme rejection; canonical membership/readiness/revision checks; atomic request-id replay |
| `POST /api/listening/tests/{test_id}/attempts?class_item={id}` | existing start body plus `blackeye_binding: BlackEyeRevisionBinding` → `BlackEyeAttemptState` | New Black Eye-only admission branch; class_item mandatory for assigned, forbidden for standalone; no sitting; never force standalone for assignment |
| `POST /api/listening/tests/{test_id}/attempts?standalone=true` | same typed binding precondition → `BlackEyeAttemptState` | Same immutable revision and publication rules; no overwrite/retry of submitted first attempt |
| `PATCH /api/listening/tests/attempts/{attempt_id}/answers` | existing `{q_num:int,user_answer:string}` → existing ACK | Branch by server-owned verified binding; validate typed inner answer; map q_num to exactly one frozen source cell |
| `POST /api/listening/tests/attempts/{attempt_id}/submit` | no body, preserving existing route signature → `BlackEyeAttemptState` | Flush/save and blank confirmation in UI first; persisted finalize is the only completion boundary; exact canonical retry/readback |
| `GET /api/listening/tests/attempts/{attempt_id}` | no body → `BlackEyeAttemptState` for this programme | Owner, frozen identity; read-only recovery; no reference material |
| `GET /api/listening/tests/attempts/{attempt_id}/review` | no body → `BlackEyeActivityReview` for this programme | Owner + submitted + source/publication/frozen binding before private read/signing. Generic/global-admin policy must not become an arbitrary teacher grant |
| `GET /admin/cohorts/{cohort_id}/assignments/{assignment_id}/items/{item_id}/listening-review` | no body → same `BlackEyeActivityReview` | Authorized teacher/admin of exact cohort/assignment/item/owner; submitted only, no arbitrary attempt/backlink access |

The table is a **proposal requiring Coordinator freeze**; no frontend worker may implement against it until the amendment and any necessary authority are settled. Existing raw dict returns need explicit typed response registration and generated frontend API parity in PR1, not a handwritten TS-only claim. If sharing route response types proves incompatible, return for a narrow amended route contract rather than silently modifying generic clients.

### Public, attempt and protected response fields

`BlackEyeUnitPublic = {collection_id:'blackeye-v5-upper',unit_id:'U1',activities:BlackEyeActivityPublic[]}`. An activity has `binding:BlackEyeRevisionBinding`, `test_id:string|null`, `title:string`, `order:int`, `readiness:'locked'|'candidate'|'ready'`, `readiness_reasons:string[]`, `selectable:boolean`, `response_cell_count:int`, `scoring_policy:'report_only'`, `objective_denominator:0`, `dictation:{available:false,reason:'separate_release_required'}`, `items:BlackEyePublicItem[]`, `media_handle:string|null`. No direct raw private path/signature in inventory.

`BlackEyePublicItem = {source_item_id:string,q_num:int,source_display_number:string,interaction:'text'|'keep_change',prompt:string,instruction:string,givens:string[],group_id:string|null,row_id:string|null,column_id:string|null}`. All strings are approved public authoring projection only. Row/column/givens never generate additional response IDs. No reference, key, transcript, provenance quote or academic verdict in public DTO; a readiness reason contains no source answer.

`BlackEyeAttemptState = {attempt_id:string,test_id:string,binding:BlackEyeRevisionBinding,context:{kind:'standalone'|'assigned',class_assignment_item_id:string|null,assignment_id:string|null,cohort_id:string|null},status:'in_progress'|'submitted',answers:{q_num:int,source_item_id:string,user_answer:string}[],submitted_at:string|null,result_summary:{submitted:boolean,item_count:int,blank_count:int,unscored_count:int,objective_denominator:0,score:null,band_estimate:null}|null}`. New names are not existing response guarantees. Context IDs come from server joins. Abandoned/expired attempts use explicit refusal/error, not this active/result union. No whole-unit completion inferred from one activity.

`BlackEyeActivityReview = {attempt:BlackEyeAttemptState,items:BlackEyeReviewItem[],transcript:{text:string,start:number|null,end:number|null}[],audio:{url:string|null,granularity:'whole_activity',expires_in:int|null}}`. Define `BlackEyeReference = null | string | string[] | {version:'blackeye_keep_change_v1',action:'KEEP'|'CHANGE',correction_text:string}`. Every review item has `{source_item_id:string,q_num:int,saved_response:string,blank:boolean,source_status:'UNRESOLVED'|'CONFIRMED'|'DISAGREEMENT',scoring_mode:'SELF-CHECK',academic_verdict:'CONFIRMED'|'SUSPECT'|'AMBIGUOUS'|'UNRESOLVED',reference:BlackEyeReference,reference_provenance:'literal_key'|'derived'|'editorial',explanation_vi:string|null,limitation_vi:string|null,evidence_pointer:string|null}`. The reference union is the allowlist, **never arbitrary source JSON**; its actual authoring values remain OPEN until rights/academic grant. PR1 must encode exactly this union in OpenAPI, without treating null/missing material as incorrect. No raw staff bundle. Review failure returns a technical error, does not reset submission or mark incorrect; no measured timing means null windows, whole-activity replay label only.

Errors: unauthorized/mismatched owner/context/not-published → 403/404 without private details; wrong body/binding/locked activity → 422; stale revision/request-fingerprint conflict/non-submitted review → 409; unavailable snapshot/reference/lookup → 503. Do not change existing generic status codes globally. Review cache must be private/no-store; HTTP/SSR/RSC/preload/error leakage checks remain future mandatory work.

## 5. A3/A4 composite — lossless reuse candidate

Keep existing **string `user_answer`** in outer save/resume/result DTO and SQL RPC. Versioned inner JSON, not delimiter guessing, booleans or two scored items:

```json
{"version":"blackeye_keep_change_v1","action":"CHANGE","correction_text":"synthetic 001 | text"}
```

- Exact keys `version,action,correction_text`; extra keys forbidden. `version` literal above; `action:'KEEP'|'CHANGE'|null`; `correction_text:string`. `null` means no chosen action. Empty outer string is a wholly unanswered cell. Nonempty malformed/unknown-version payload must fail 422, never silently fall back to legacy text.
- Preserve correction text byte-for-byte as Unicode text, including leading/trailing spaces, newlines, zero prefixes, punctuation and delimiters. Do not erase it when action changes to KEEP. KEEP with nonempty text remains a saved pair; no automatic correctness. CHANGE with empty text remains an incomplete/blank component for confirmation, not an autosave error that destroys the draft.
- Encode with JSON.stringify/JSON serializer exactly once, parse strictly in this interaction only. Non-composite numeric strings remain strings; never apply this decoder to other programmes or multi-gap responses.
- `backend/migrations/224_active_player_resume_ttl.sql:376–404` shows text RPC input stored as a JSONB **string** value, not parsed or trimmed. That is storage feasibility from source, not DB execution. Outer HTTP JSON escaping and inner JSON round-trip passed synthetic local tests. It does not prove SQL/RPC/Pydantic/UI integration.
- Existing `frontend/lib/listening-source-responses.mjs:1–12` multi-gap helpers accept arbitrary string-valued maps; they have no version/action validation and must **not** be used as the composite codec. PR1/PR2 must add the strict shared definition + behavioral parity tests and prove save→reload→submit→review with fake data.
- No schema migration is selected for string transport. If any actual persistence path truncates/normalizes the typed pair, STOP per contract §4.2; do not silently widen to a generic platform.

## 6. A13 cap policy — exact scope, two observed obstacles

- Generic importer remains **MAX_FORM_ITEMS=40** (`backend/services/listening_package_import.py:46,926`). No runtime change in S0. Existing importer types exclude the new composite; suffix list excludes MP3 (:38–52). No audio acceptance inferred.
- Existing save route separately hardcodes **q_num<=40** (:8027). This is a second obstacle verified by extracted-body behavior for q=41,48. Import acceptance alone is insufficient.
- Freeze candidate: only a server-resolved exact `(programme_id='blackeye-v5-upper-listening', source_contract='blackeye_u1_v1', unit_id='U1')` binding may allow **1..48 items**, and each q_num must belong to its frozen activity cell map. A13 requires exactly 48 distinct source cells under one activity/submit boundary. Reject 49, duplicate/missing IDs, mismatched declared count, guessed q_num, unknown programme/contract/revision. Other programmes retain 40; no query/body cap override.
- Do not pack cells in multi-gap, drop/merge, split A13 into separately submitted activities, or increase a global MAX to 48. Future tests must cover generic 40 accepted/41 rejected and Black Eye 48 accepted/49 rejected through importer, save, finalize and review. These positives are **NOT RUN / OPEN**, not claimed by S0's structural constant test.

## 7. Assignment freeze candidate and missing work

`BlackEyeAssignmentCreate = {request_id:UUID,collection_id:'blackeye-v5-upper',unit_id:'U1',activities:BlackEyeRevisionBinding[],recipient_ids:string[],deadline_at:RFC3339,deadline_timezone:'Asia/Ho_Chi_Minh',replay_policy:'allowed'|'once'}`. Explicit eligible recipient IDs even for UI “all”; server compares canonical roster, errors on inactive/excluded/lookup failure, does not silently truncate. One activity per bound attempt, frozen ordered activity list in assignment config; no real cohort under this grant. “All” never includes locked/candidate/unready activities automatically.

`BlackEyeAssignmentReceipt = {assignment_id:string,request_id:UUID,activities:BlackEyeRevisionBinding[],recipient_ids:string[],completion_denominator:int,deadline_at:RFC3339,deadline_timezone:'Asia/Ho_Chi_Minh',replay_policy:'allowed'|'once'}`. Server freezes eligible activities/revisions/recipients/deadline/replay/count and idempotency fingerprint in one transaction. Same request+same body returns same receipt; same request+changed body 409; intentional reassignment uses a new request ID and assignment. Do not introduce a background worker. Underlying existing ledger may require one child item per recipient/activity; concrete transactional mapping is **not proven** and must be reconciled before PR1/PR2, with amendment if architecture expands. No caller-supplied completion/score.

Backlink derives from known assignment/cohort IDs into existing class navigation, never arbitrary redirect URL. Teacher roster reports server-submitted activity state immediately and on reload; score/self-review tick cannot gate completion. A8/A14/A19 visible locked and excluded from denominator, no attempt records minted. All Unit1 items SELF-CHECK: objective numerator and denominator excluded, no 0%/100%/band/mastery; CONFIRMED status alone does not promote scoring. Optional dictation remains locked, no flag change or legacy fallback.

## 8. Evidence, limits and next gate

Reproducible local suite: `evidence/blackeye-u1-s0/test_s0_characterization.py`; actual command/time/exit/output in `evidence/blackeye-u1-s0/tests.md`. It uses stdlib AST extraction of **unaltered function bodies** with fake collaborators; module imports/decorators/annotation evaluation are excluded. Positive review test stubs assembler and correction service explicitly. Socket connect is denied by test fixture; it is not a host security boundary. No `.env` read, app import/launch, real auth, DB, migration, live/paid request or dependency install.

**What PASS means:** source-level existing guard behavior and identified compatibility gaps; JSON string feasibility only. **What it does not mean:** FastAPI route registration/DI, Pydantic validation, true HTTP/cache/RLS authorization, DB transaction/concurrency/frozen integration, UI behavior or MV closure. No skipped integration is relabelled PASS.

NOT RUN / OPEN:

- MV1 complete Black Eye public/protected identity/revision/context enforcement, wrong programme/source/revision/cohort/teacher tests before private reads.
- MV2 complete assigned create/start/save/submit/lost-ACK/retry/reload/review + frozen sibling isolation; generic route presence is not closure.
- Backend full pytest/regression suites and actual FastAPI/Pydantic/OpenAPI generation: no dependencies installed. Repo has pinned `backend/requirements.txt` but no backend dependency lock discovered; no re-resolution attempted under lockfile-only install scope. Executed stdlib tests need none. Interpreter at initial `python3` probe is 3.9.6, unlike task's supplied environment description; canonical 3.12 is available and used for final receipt.
- Local Postgres integration/RLS/concurrency and snapshot admission proof: NOT RUN; no cluster created, schema migrations forbidden even local. Local Supabase unavailable by card; no substitute remote target.
- Frontend typecheck/React/build/route ownership/OpenAPI drift/E2E: NOT RUN; no frontend changes/app launch or dependency install. Pure string JSON feasibility is not React coverage.
- New composite codec/type validation, generic 40 positive and new 48/49 runtime boundary tests, all-zero objective aggregation, locked direct APIs and immutable retry under changed/unavailable catalog: future PR1/PR2 work.
- Existing 80-days guided, Listening assignments, dictation frozen history full regression suites: NOT RUN. Original files/flags unchanged is source preservation, not runtime regression PASS.
- AC01–AC12 specialist acceptance, live staging identity/frontend/backend/DB binding/CI, real content/rights/academic references/media and production: OPEN/not authorized. No book material in fixtures; all example text is synthetic.

No new migration, architecture execution, actual feature endpoint or real content selected by this artifact. No temporary service/cluster to clean up. Keep clone/branch and exact commit for reviewer. Team-root `evidence/blackeye-u1-s0/s0.patch` is generated **after** committing from `git diff 7243b3364cfd637dc1bd0cd464c810380e27d10e..HEAD`, outside its own committed diff to avoid recursion. Leader measures digest; web-reviewer independently reviews exact commit on child t_11cd7c26. Coordinator then freezes/reconciles S0 amendment before any implementation slice. No self-accept, push, PR, merge, deploy or automatic next slice. At most two fix rounds after review.
