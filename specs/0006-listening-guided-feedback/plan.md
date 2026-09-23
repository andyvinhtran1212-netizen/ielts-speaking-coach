# Plan

## Architecture impact

Reuse the report-only attempt and answer-save RPC. Add a narrow authenticated
reveal route and a revealed-state read route; do not overload diagnostic
`/check`. Persist only immutable per-question reveal evidence. Assisted status
is derived from that evidence. Keep the existing player layout and place a
first-answer → reference → revised-answer strip directly below the active
question; desktop audio/progress remains nearby, mobile audio stays above the
question. Use existing `--av-*` tokens and Listening styles.

## Data and contracts

Proposed migration 296 adds a service-written reveal ledger keyed by
`(attempt_id, q_num)` with first-answer snapshot and timestamp, referencing the
existing attempt. The reveal operation locks/checks attempt ownership, status,
TTL, source/policy, question membership, and saved nonblank answer before one
atomic insert. Idempotent retries read the same row. Revealed-state reads
return protected feedback only for ledger rows. Existing student test payload
and answer-save response remain unchanged. New FastAPI schemas generate the
frontend types. Reuse the report-only grader's objective comparison logic;
never use the diagnostic `/check` write path.

## Rollout and rollback

Land and approve this spec on `staging` before implementation. Consolidate
the previously reviewed player UI work into one implementation PR so the
backend and frontend contract can be verified at one SHA. Apply the additive
migration to staging before deploying that SHA. The player checks the guided
state endpoint before offering reveal; if the endpoint is unavailable, it
keeps the existing answer-and-submit flow usable and visibly disables
per-question comparison. Verify protected boundaries immediately after deploy.
Rollback hides the affordance first; retained reveal records preserve audit
truth for already-assisted attempts and remain readable by the old code.

## Verification strategy

Test authorization and leakage, save/reveal races, duplicate requests,
answer revision, resume, mixed item types, once-only replay, and submit/history
truth on disposable PostgreSQL. Regenerate OpenAPI types, run relevant backend
and frontend suites, then visually check both themes at 375/768/1440px with
keyboard and screen-reader names. Staging must validate the exact migration,
API, frontend SHA, and protected-content sentinel before promotion.
