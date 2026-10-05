# Verification

## Requirement coverage

| Requirement | Local evidence and remaining hosted gate | Result |
| --- | --- | --- |
| FR-001 | Reviewed v2 catalog has 30 rows, 12 questions each; missing-package and flag-off cases remain blocked; C4 refused. Hosted flag-on catalog pending. | PENDING |
| FR-002 | Course 5 subset fan-out, give fingerprint, lost-response retry and explicit repeat pass. Hosted recipient/retry check pending. | PENDING |
| FR-003 | Actual PostgreSQL 312 RPCs enforce owner, active membership, publication, deadline and missing-config rejection. Hosted authorization check pending. | PENDING |
| FR-004 | Built Next UI exercises all 30 lesson notes/objectives and 360 questions; start waits for auth bootstrap and old-account responses are discarded. Hosted UI check pending. | PENDING |
| FR-005 | All 30 senior approvals match exact teaching/practice hashes. Offline reserved-ID/prompt/family check has zero overlaps; senior semantic screening has zero remaining candidates. Hosted diagnostic independence pending. | PENDING |
| FR-006 | Actual PostgreSQL completes the item with artifact, 11/12 correct and 91.7% formative mastery; score remains NULL. Reload and educator report contracts pass. Hosted roster check pending. | PENDING |
| FR-007 | Same learner/cohort may receive a new assignment with an independent frozen attempt; retries preserve the old snapshot. Hosted repeat check pending. | PENDING |
| FR-008 | Native browser covers desktop, 390px dark mobile, keyboard, read 503/retry and no page overflow. Hosted affected journey pending. | PENDING |
| FR-009 | Full local suites and production build pass. Default-off rollout and completed-history preservation are tested. Exact-SHA staging/production verification pending. | PENDING |

## Reviewed content

- [Independent senior report](content-review.md): 30 notes, 360 newly authored MCQs and 1,440 options read in full. Every lesson contains 12 formative questions and its own reviewed teaching. Approval does not certify all 100 questions in each canonical bank or estimate an IELTS band.
- Package file SHA256: `b2addb2ae15f93d80d7882847b03805e7fd3742dfd3374de90434807fafc6591`. Canonical JSON package SHA256: `bd4dad0f45088766105df3e606565fbcd7012dd4080e3343ee12587c648f0fa3`.
- [Approval manifest](../../backend/content/master30-assigned-practice/v2-review.json) is byte-identical to the independent gate, SHA256 `acf970a0dccc16a39867f601c97bb59c098913e6c29bc3bf0f491bc2bb534917`. Each approval hashes title, focus, lesson_notes, learning_objectives, questions and coverage_review. Later edits or partial releases are rejected.
- [Review evidence](../../backend/content/master30-assigned-practice/v2-review-evidence.json) records exact author inputs, closed findings, original 30-lesson curriculum alignment, semantic review and integrated package identity. Source_kind and optional article are integration metadata outside the six reviewed fields.
- Automated source check protects 1,032 current status/runtime IDs plus declared families/parallel sets. Senior review additionally screens the historical/family union: 1,234 protected IDs, 1,229 MCQs with text. Authored prompts, all options and teaching examples have zero remaining similarity candidates after contextual review. String/hash checks alone are not semantic proof.
- `v1.json` remains unchanged and readable for historical assignments. Current default became v2 only after all 30 exact senior approvals passed. Assignments capture their content revision and hash; attempts retain frozen teaching, questions and feedback.
- Original library remains untouched: 3,100 source items across all 30 lessons. B02/B07/B18 each already had an ACTIVE 100-item bank; the earlier gap was a missing reviewed assignment practice package. Diagnostic import continues to hold 30 metadata rows and 733 runtime items independently.
- Original 100-item bank SPEC quotas, including three distinct N labels, are not a formative pool quota in FR-005. Senior approval requires plausible distractors with accurate different error/meaning paths; a taxonomy label can repeat where accurate.

## Local contract evidence (2026-10-05)

- Full backend after consolidated review fixes: **10,466 passed, 30 skipped**. Real local PostgreSQL ran the CI Reading/Dictation/Grammar revision integrations and this task's 312 migration/RPC tests. Skips require separate live/paid credentials; they are not proof of those unrelated integrations.
- Full frontend contracts: **10,595 passed, 1 skipped**, with the retired-fixture loader used in CI. Full React: **429 passed** with two workers; the first concurrent build/test run timed out on the unchanged Listening source-render test, and the complete rerun passed without changing any test or timeout. Strict TypeScript, legacy JSDoc boundary, generated OpenAPI types, spec governance and Next production build passed.
- Native verification uses real v2 content and built Next pages with synthetic intercepted HTTP. It proves UI behavior, not hosted DB or deployment identity. Admin homework regression: **25/25 checks**. All-30 assignment UI: **553 checks**, including lost-response retry, single learner selection, explicit repeat, corrections and reload, plus teacher report cold-load/read-failure/retry/reload. The report fixture includes the email required by the existing admin identity contract.
- Offline release validator: 30 lessons, 360 practice prompts, zero exact overlaps. Runtime-bank SHA256 `5b06d0e8b2636caad70326674b9caab7f9d842fb582311e5e6cb9c1115be0841`; q-matrix SHA256 `626b6f06ecbb10d292b52a86a38c6a23f58202748d0c23316315cc811f5e7983`.
- Root cause fixed, **Medium**: learner `AssignedGrammarLesson` fetched through `window.api` before auth/bootstrap was ready. It now waits for signed-in state, clears private state on logout/account changes and rejects old responses. Verification covers cold start without an API bridge, logout and an actually resolved stale-account response.
- Root cause fixed, **Medium**: SQL comparisons with NULL could accept missing assignment subtype/config. Migration 312 uses `IS DISTINCT FROM`; actual PostgreSQL missing-field tests fail closed without creating an attempt.
- Root cause fixed, **Low**: a Markdown review record inside `backend/content` was counted as a Wiki article. Review Markdown now lives in this spec folder; grammar-only audit scope stays 137. Teaching lives only inside approved practice JSON.
- Review round 1, **Medium**: `class_student._display_config` omitted assignment_type, lesson_id and lesson_title, so the real My Class payload lost the lesson discriminator and completed/expired-opened review action. The allowlist now exposes only those safe labels; real HTTP route tests cover immediate and repeated reads and keep questions/answers private. Hosted My Class reopening remains a release gate.
- Review round 1 documentation: restored the separately approved unready-lesson acceptance scenario verbatim and linked the senior report to the committed evidence JSON. Reviewed content and approval hashes remain unchanged.
- Full-contract audit, **Medium**, `GrammarLessonReport`: teacher report reads could run before authentication settled and could expose a prior account's late response. Reads now wait for signed-in identity, store results by account/attempt, discard stale responses and offer a retry after read failure. Verification: three React interaction cases and the built teacher report journey. Hosted report/reload remains a release gate.
- Full-contract audit, **Medium**, `assignment_tally` and `normalizeTally`: a failed grammar-attempt lookup was converted into zero answered questions, making a real hand-in appear untouched. The backend now returns unknown progress and the frontend preserves it, labels the unavailable value and retains the canonical review link. Verification: four tally cases distinguish failed lookup, untouched, partial and completed work; model tests distinguish unknown progress/result from zero and from 11/12. Hosted roster checks remain a release gate.
- Bundled Node 24.19.0 was used because shared system Node has a missing dynamic library. Shared runtime and other worktrees were preserved.

## Schema and release evidence

- Candidate 307 was never in either hosted ledger and its attempt table did not exist. Concurrent deployed revisions occupied 306–311, so the unapplied candidate became 312 before hosted application. No applied ledger was renamed. Concurrent Grammar quiz revision 309 is deployed on both environments.
- Staging 312 applied with `apply_migrations.sh` and its advisory-locked helper after the forward queue contained only this file. SQL SHA256 `12006e94b8bcbff3306acffe218eb2d288d97f6d53e51c12232862ed7ca2850e`.
- Direct staging verification: ledger 312 present, attempt-table RLS enabled, anon/authenticated have neither table SELECT nor start RPC EXECUTE, service_role has both. Assignment feature flag remains **FALSE** until the deployment gate.
- Staging code/release: **PENDING**. Feature [PR #1569](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1569) targets staging. Task branch is `codex/grammar-lesson-assignments`, synchronized with staging `c5952885327bd99751517700e3f54669a691f159` in merge `63ea62117c2e61d852323a1a7dfe70edb99538be`.
- Production schema, promotion and affected journey: **PENDING**. No production readiness claim is made.
- Temporary logs, identity credentials and verification helpers stay under the task-specific `/tmp/master30-ready-2026-10-05` folder and are not committed. Live acceptance uses new task-owned identities and a synthetic Course 5 class; real learners are not deployment test subjects.
