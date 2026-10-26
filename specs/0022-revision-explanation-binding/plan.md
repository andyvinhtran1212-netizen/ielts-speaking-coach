# Implementation plan

## Architecture impact

- Database: `fn_approve_web_explanation_paper` (migration 260) is re-stated by
  migration 319 with only the refusal branch changed. Callers
  (`fn_create_scoped_exam_class_assignment`, mock approval) are untouched.
- Backend: `services/mock_correction_service.content_version_unavailable_message`
  and `services/class_assignment_service.create_class_assignment` already map the
  reason codes (#1689); no further service change.
- Operator tooling: new `backend/scripts/bind_revision_web_explanations.py`,
  run by an owner-approved session; no HTTP route, no scheduled job.
- Frontend: none (the homework form's 0-object guard shipped in #1689).

## Data and contracts

- Migration 319: `CREATE OR REPLACE FUNCTION public.fn_approve_web_explanation_paper`
  with the same signature, `SECURITY` mode, `REVOKE`/`GRANT`, inside one
  transaction. Refusals: `web_explanation_content_version_unavailable:none`,
  `…:multiple:<n>`, `…:pinned_not_current`. Additive and backward compatible:
  pre-319 code still matches the `web_explanation_content_version_unavailable`
  prefix.
- `web_explanation_objects` rows written by the tool satisfy the existing
  identity CHECK (`mock-<uuid>-<skill>-qNN`), the unique
  `(object_id, content_version)` and unique-current indexes, and the BOUND
  per-skill FK requirement (migrations 245/257/315/316). Source rows are read
  only. Rights/editorial statuses start pending; `is_current` true.
- Plan hash: SHA-256 over revision and source fingerprints (question, passage or
  section evidence; admin-only fields excluded) and the reviewed change list.
- Writes: one PostgREST insert of 40 rows; import batch id recorded; read-back
  paginated (PostgREST 1000-row cap).

## UI and interaction

- No new surface. Existing admin homework form messages are the only visible
  change and already ship.

## Work decomposition

1. Land this spec (approval) on staging.
2. #1692 re-targets REVEXPLAIN-0022 as `high-risk`, reconciles the migration
   number/README with in-flight migrations (#1699 uses 320), CI green.
3. Apply 319 to staging; run the Postgres reason tests and a staging approval
   check; merge #1692.
4. Apply 319 to production via the locked runner; promote.
5. Bind further papers only per owner request, each with staging rehearsal.

## Rollout and rollback

- See [rollout.md](rollout.md). Function rollback re-applies migration 260's
  body. Binding rollback for an unused revision sets its rows non-current after
  owner approval; rows referenced by a give or attempt are left in place.

## Verification strategy

- Unit: `backend/tests/test_bind_revision_web_explanations.py` (30 cases: plan,
  every refusal, canonical list, override, reviewed changes, SHA coverage,
  loader, staging prefix).
- Real PostgreSQL: `backend/tests/test_explanation_version_reason_postgres.py`
  (R+L × none / multiple / pinned / historical-only / single approved once);
  negative control fails against 260.
- Service: `test_scoped_exam_version_refusal_names_the_cause` (R+L × 4).
- Staging: approval call on QA copies before/after binding; double-bind refusal.
- Production: read-back of each binding; give success; unchanged learner tables.
