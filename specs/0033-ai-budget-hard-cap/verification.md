# Verification

All rows are PENDING. The spec is approved (2026-10-28, decisions of
09:11/09:13 and 09:35), but nothing has been implemented yet. The tests named below are defined in `plan.md` §Verification
strategy. V-queries are read-only.

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_ai_budget_gate.py (every provider SDK call or endpoint in backend/ is inside a guarded wrapper; every SDK client sets max_retries=0; allow-list seeded from research.md §1) | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_333_ai_budget.py (4N racing reservations from two connections grant exactly N; month and day, total and provider scopes; all-or-nothing bundle; two concurrent calls with the same request key → one granted, one replay, exactly one provider stub call; replay of a settled, released or expired key grants nothing; PostgreSQL 16 and 17) | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_ai_budget_service.py (cap parsing; defaults total 200 soft, Anthropic 100 soft, Google / Azure / OpenAI / ElevenLabs 20 hard; daily = monthly ÷ 30 × 2; every variable unset → defaults with no config_invalid and a paid call granted; a set 0/negative/unparseable hard value → config_invalid refuses that scope only; a set invalid Anthropic or total value shows config_invalid and refuses nothing; total counts every provider, Anthropic included) | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_ai_budget_service.py (estimate ≥ actual for each catalog model at max_tokens; an unpriced model is refused; release only when not sent; settle at estimate on timeout and cancel) plus kind=query; ref=plan.md V3 ratio on staging | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_ai_budget_service.py (RPC raise, timeout, bad shape, missing function → refuse with zero stub calls; settle failure leaves the reservation open; ledger outage does not affect decisions) | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_ai_budget_quotas.py (grading, TTS and gist count errors refuse; caps ≤ 0 → config_invalid; runtime_flags on_error=False for paid-AI gates; non-AI flags unchanged) | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_ai_budget_service.py (on/true/1/garbage refuse, off/false/0/empty allow, no DB call when on) plus kind=journey; ref=rollout.md S3 kill switch on staging (V6) | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_ai_budget_fallback.py (each refusal reason stops with_fallback, the orchestrator, the JSON-repair rerun and each custom chain with zero further stub calls) | PENDING |
| FR-009 | kind=test; ref=backend/tests/test_ai_budget_fallback.py (402 billing_error and insufficient_quota fixtures close the scope for the day with no fallback; 429, 529, 5xx and timeout still fall back with their own reservations) | PENDING |
| FR-010 | kind=test; ref=backend/tests/test_ai_budget_status_api.py (503 detail shape on each synchronous AI route passes safe_detail; reason redacted for non-admins; distinct from 429 rate_limit_exceeded) | PENDING |
| FR-011 | kind=test; ref=backend/tests/test_ai_budget_speaking_deferred.py and backend/tests/test_ai_budget_writing_deferred.py (recording stored and row awaiting_budget before any provider call; Writing job deferred without using an attempt; reaper skips it; a Writing drain killed after claim is reclaimed after budget_lease_until, its stale commit returns lease_lost, and attempt_count is unchanged; storage failure → recording_storage_unavailable with work_saved false) | PENDING |
| FR-012 | kind=test; ref=backend/tests/test_ai_budget_speaking_deferred.py (no grading_attempts row for a deferred submission or its drain; same submission_id replay creates no second job, reservation or quota row; a granted bundle followed by a refused fallback reservation, and a mid-pipeline 402, each give one deferred job, no grading_attempts row and no second Whisper call in the drain) | PENDING |
| FR-013 | kind=test; ref=backend/tests/test_ai_budget_speaking_deferred.py (drain in enqueue order, SKIP LOCKED lease, max 2 concurrent, stops at the first refusal, superseded revision not graded, aggregate recomputed, crash window retried once; one grade needing JSON repair and two separately graded revisions pass V5, while a forced second commit for one revision returns duplicate and V5(b) flags a manufactured duplicate; a drain interrupted after the provider response but before fn_ai_deferred_commit is reclaimed after lease expiry and a later run commits exactly one complete result; a worker killed right after claim leaves the job `running`, a later sweep reclaims it with `attempts + 1` and a new request key (no replay), and the stale worker's commit returns lease_lost; a worker killed right after a committed result for a completed session leaves the refresh owed, and the next sweep writes the new band; two jobs for one session with interleaved refreshes: the refresh that read before the second commit returns stale, and the final band includes both results once nothing is owed; PATCH /complete interleaved with a drain commit between its response read and its session write: the write returns stale, completion recomputes, and the persisted band includes the deferred result with nothing owed and no further submission; three forced stale attempts still complete the session with the row owed, and the next sweep writes the band including the result; a commit on an in_progress session moves generation but is not refreshed by the sweeper) plus kind=query; ref=plan.md V5 on staging | PENDING |
| FR-014 | kind=test; ref=backend/tests/test_ai_budget_alerts_sweeper.py (expiry settles at estimate, dispatch backoff, heartbeat, non-zero exit when the DB is down) plus kind=query; ref=plan.md V4 on staging | PENDING |
| FR-015 | kind=test; ref=backend/tests/test_migration_333_ai_budget.py and backend/tests/test_ai_budget_alerts_sweeper.py (exactly one alert per scope, period and threshold under concurrent crossing; Anthropic monthly thresholds 80/100 only; sends use Resend with sender alerts@averlearning.com and no other transport; an unverified-domain rejection is retried and never marked sent; committed just below the cap with an estimate larger than the remainder → one 100% alert across repeated refusals; provider spend-limit closure alerts once; new period re-arms; email has no learner data) plus kind=query; ref=plan.md V7 on staging | PENDING |
| FR-016 | kind=test; ref=backend/tests/test_ai_budget_status_api.py (/ai/status false on lookup failure; admin shape including lookup_failed, queue, sweeper; admin refused paid AI; non-AI admin routes unaffected) | PENDING |
| FR-017 | kind=journey; ref=frontend/tooling/verify-ai-budget-*.mjs (Speaking, results, Writing, AI helpers, instructor banner and admin panel: paused, reload and error states; keyboard, mobile and desktop, light and dark) plus vitest for the Speaking classifier branch | PENDING |
| FR-018 | kind=test; ref=backend/tests/test_migration_333_ai_budget.py (catalog, RLS, no anon/authenticated privileges, SECURITY DEFINER search_path, idempotent re-apply, N-1 backend unaffected, guarded down script) plus kind=query; ref=plan.md V2 on staging and production | PENDING |
| FR-019 | kind=check; ref=rollout.md Preconditions (Anthropic Console $200 workspace limit and other provider caps or waivers recorded by Vinh, no key shown) | PENDING |
| FR-020 | kind=test; ref=backend/tests/test_ai_budget_status_api.py (question generation, course Writing, course pronunciation, Advanced Vocabulary rewrite, gist and TTS refused with no attempt, quota row or session slot used; D1 background generation skipped and logged) | PENDING |
| FR-021 | kind=test; ref=backend/tests/test_ai_budget_service.py and backend/tests/test_migration_333_ai_budget.py (AC10: Anthropic over its $100 monthly and daily budget is called and settled with one 80%, one 100% monthly and one 100% daily alert and no 50% alert; total over $200 alerts and refuses nothing; soft-only request proceeds with allow_unrecorded on an RPC failure while hard and mixed requests are refused; kill switch and 402 still refuse; soft spend not in total) plus kind=journey; ref=rollout.md S3 soft-budget check | PENDING |
| FR-022 | kind=test; ref=backend/tests/test_ai_budget_raise.py and backend/tests/test_migration_333_ai_budget.py (AC12: AAL2 always required, every caller refused while the 0032 reader is absent; amount up to 100% of the base cap, 1–24 hours, reason, hard scopes only, one-active and three-a-month limits; append-only events; one alert and email per grant, end and expiry; effective cap reverts at expires_at without the sweeper; RPC failure writes nothing) plus kind=journey; ref=frontend/tooling/verify-ai-budget-raise.mjs and rollout.md S3 raise rehearsal plus kind=query; ref=plan.md V8 | PENDING |
| FR-023 | kind=test; ref=backend/tests/test_ai_budget_speaking_deferred.py (AC13: the S0 Azure row prices the estimate at MAX_AUDIO_DURATION_SECONDS and settles at the real duration; Azure line refused for cap, missing price row or budget_unavailable → graded at once with no 503 and no job, pronunciation_status skipped_budget, band_p null, test-mode overall = ielts_round(mean(FC, LR, GRA)), practice band unchanged; kill switch still defers; a drained job can also skip P) plus kind=journey; ref=frontend/tooling/verify-ai-budget-*.mjs (P5/P5b exact text and the "Điểm tổng tính trên 3 tiêu chí" band label before and after reload; T1 label on the instructor matrix and admin Speaking session view; reason shown to admins only) plus kind=journey; ref=rollout.md S3 Azure skip | PENDING |
| FR-024 | kind=test; ref=backend/tests/test_ai_budget_speaking_deferred.py and backend/tests/test_migration_333_ai_budget.py (AC14: admin regrade-response interleaved between a refresh's response read and write → refresh stale, final band is the regraded one, nothing owed; drain commit interleaved inside an admin write, update_session_bands, regrade-session, rebuild-summary and _complete_session_internal → stale and recompute; the trigger advances generation once per band-bearing write and not on rollback; response writes raced with fn_ai_session_bands_write never deadlock; admin regrade of an awaiting_budget response → 409 grading_deferred) | PENDING |

## Contract evidence

- OpenAPI/type drift: new `GET /ai/status`, `GET /admin/ai/budget`,
  `POST /admin/ai/budget/raises` and `POST /admin/ai/budget/raises/{id}/end`
  schemas, the 503 detail model, and additive `grading_status` and
  `grading_pending` fields. `frontend/types/api.d.ts` must be regenerated
  in T009.
- Backward compatibility: an old frontend treats the new 503 as
  `ambiguous_commit` and reads back the saved row. Writing submit is
  unchanged. The 333 objects are unused by the N-1 backend.

## Data evidence

- Migration/schema query: V2 after S1 (staging) and P2 (production).
  V3/V4 during S2–S4 and P4.
- Immediate state versus full reload: AC6. A pending item shows
  "Đang chờ chấm" immediately and after a reload, then the grade after the
  drain.

## UI evidence

- Viewports/themes/input methods: each `ui-states.md` row at desktop and
  mobile widths, light and dark, keyboard only (T009 verifiers, S3 manual
  check).

## Release evidence

- Staging SHA and checks: pending T010.
- Production verification: pending T011, including the 7-day
  reconciliation.
