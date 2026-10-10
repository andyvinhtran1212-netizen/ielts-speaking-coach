# Verification

Implementation is merged and staging acceptance is complete. Production migration
314 is applied and verified; production code promotion, the 79 pending bank
publications, and final per-GA production acceptance remain outstanding. No human
acceptance or production learner submission is claimed.

## Implementation and staging evidence

PR 1623 implements the independently approved bundle. PR 1625 fixes a real
publication/writer wait cycle using the same guarded owner transactions in
request-scoped execution and typed batch cloning. Neither the timeout repair nor
this ledger update changes the reviewed article/question/label source bytes.

Staging release `28b524e84e8f9d86d8e547c2715588a59e64f5a4` passed all
integrated push checks: Tests run 38057137358, type/OpenAPI 38057137419,
spec 38057137357, build 38057137420, legacy guard 38057137505, Next browser
38057137395, and live staging smoke 38057137361. The smoke artifact confirms
matching frontend/backend release markers and Supabase staging identity.

On this release, actual HTTP readback verified all 79 published revisions and
retained the 11 earlier revisions. The 90 current canonical bank payloads and all
137 complete article documents were read; every rendered article equals its
reviewed source, including summary, tables, anchors and learning blocks. README
admin preview returns 404 and the article catalog contains 137 lessons. Isolated
real-engine replay on staging GET payloads passed 2248 authored answers and 101
audit controls. This is not a live learner session/progress/end/reset operation.
The Singular/Plural exercise endpoint returns the current bank and four concepts,
matching its four item keys. Deployed Admin Read/Preview both return 200 on the
three-bank LSU chain. All 24 pre-existing staging banks retain identical question
rows and learner-history fingerprints; the staging seed copied no learner rows.

Local implementation evidence includes 440 actual PostgreSQL cases without skips,
13018 frontend contract cases, 510 React cases and native managed/history/admin
fixtures. For the timeout repair, 234 actual PG preservation/race/batch cases and
30 actual PG route/publication cases passed; final wire scheduling checks passed
27 cases with two optional PG cases skipped only in that wire-only run (covered
by the actual PG run). Mandatory backend pre-push passed 9980 cases with 786
environment/provider skips. Exact feature CI passed before both implementation
merges. Preserve these scopes rather than presenting fixture replay as live writes.

## Source review and production boundary

On 10 October the authorized independent content review identified incomplete
theory sections and two punctuation targets needing the existing bank-owned exact
policy. The final source scope is 131 articles, 79 banks/134 changed qids and three
labels; only oa_cc_i3 and app_punct_i1 gain exact policy entries. No global matcher
change is introduced. The independent technical review approved the bounded90-code
design and the final timeout repair. Complete source coverage tracks all 589 GA
finding groups, including already-fixed and context-dependent conclusions; they
are not 589 confirmed defects. These reviews establish source approval and do
not establish production acceptance.

A read-only repeatable-read production snapshot covers148 physical banks/3262
questions and fingerprints194 sessions/718 stats/1978 attempts. No question has
nonempty why_wrong. Eleven unchanged previously approved0015 sources were published
using the deployed owner; this is separate from the new audit bundle. Their learner
catalog readback passed; local engine replay on live payload passed265 canonical
answers and15 audit cases. No learner session/progress was submitted for acceptance.
Migration 314 was applied to both environments with the advisory-locked runner:
one matching ledger row, unchanged historical single-argument binding, denied
private-helper grants and unchanged bank/question/learner counts. The production
snapshot remains 148 physical banks and 3262 questions before the 79 cutovers.

## Requirement coverage

| Requirement | Evidence required | Result |
| --- | --- | --- |
| FR-001 | reviewer=Codex; environment=staging; date=2026-10-10; observed=All 589 IDs covered by independent review; current per-ID disposition and final environment proof. SOURCE/STAGING COMPLETE; final production reconciliation pending | MANUAL |
| FR-002 | reviewer=Codex; environment=staging; date=2026-10-10; observed=Real submit/credit cases; all six current-frame negative controls, distinguishing old literals made valid by repaired frames. LOCAL/STAGING PASS; production served-engine replay pending | MANUAL |
| FR-003 | reviewer=Codex; environment=staging; date=2026-10-10; observed=Whole-lesson semantic review and full rendered equality for all 137 articles; qualified context/band/Task 1 claims. SOURCE/STAGING PASS; final production readback pending | MANUAL |
| FR-004 | reviewer=Codex; environment=staging; date=2026-10-10; observed=Frozen source/qid/field approval; 79 owner publications and 11 prior revisions with complete extras/readback. LOCAL/STAGING PASS; 79 production publications pending | MANUAL |
| FR-005 | reviewer=Codex; environment=staging; date=2026-10-10; observed=Actual PG preservation/races/rollback; before/after staging original question/history equality. LOCAL/STAGING PASS; production cutover receipts and final preserved-history comparison pending | MANUAL |
| FR-006 | reviewer=Codex; environment=staging; date=2026-10-10; observed=Complete production predecessor snapshot, reviewed 78-bank staging seed, all original 24 banks preserved, no learner copy. PASS | MANUAL |
| FR-007 | reviewer=Codex; environment=staging; date=2026-10-10; observed=Actual PG original/revised/follow-up/continuation/reset/receipt tests and deployed staging three-bank LSU chain. LOCAL/STAGING PASS; production final first cutover pending | MANUAL |
| FR-008 | reviewer=Codex; environment=staging; date=2026-10-10; observed=Generated OpenAPI/runtime validation, native managed/legacy/conflict/history fixtures; staging Read/Preview and four-concept CTA. LOCAL/STAGING PASS; production served labels/CTA/current availability pending | MANUAL |
| FR-009 | reviewer=Codex; environment=staging; date=2026-10-10; observed=Local and actual PG evidence, both migrations, exact integrated CI and staging live provenance. COMPLETE THROUGH STAGING AND PRODUCTION MIGRATION; promotion and live production acceptance pending | MANUAL |
