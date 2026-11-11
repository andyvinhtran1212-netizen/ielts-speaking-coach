# Black Eye U1 admission

The source proposal `admission.sql` remains outside forward discovery. The
BLACKEYE-0052 rebuild job explicitly reserves migration **376**; its numbered
copy is `backend/migrations/376_blackeye_admission.sql`. Their executable SQL
must match. This supersedes the earlier unnumbered-only placement decision.
Migration 376 is `pending_feature` (`blackeye_admission`) in forward-policy.tsv:
No apply on merge. It has only been executed on disposable local PostgreSQL
for tests. Neither staging nor production has executed it in this job. A live
run needs separate owner authorization, Security Auditor review and the
advisory-locked migration runner (staging first; production only at T014).

All three definer functions pin `search_path = pg_catalog, pg_temp`; all application
objects are schema-qualified. Client roles have no EXECUTE grant. Existing
snapshot/RLS rules remain unchanged. The service-only
`fn_submit_blackeye_attempt(uuid,uuid,jsonb,jsonb)` locks the attempt and checks
owner, status, expiry and exact expected answers before storing the server
report. Expected answers travel in the POST body, never the URL. Missing admission RPC fails closed with 503.
Admission remains standalone-only; PR2 must open the class assignment seam.

`backend/migrations/rollback/376_blackeye_admission.sql` is manual rollback SQL,
not a forward-runner input. It removes only the new trigger/functions and keeps
widened CHECK constraints, attempts, snapshots and published content. Roll back
application code with it; do not enable generic Black Eye delivery. No historical
rows are rewritten. Reapplying after rollback requires a separately reviewed
migration-ledger decision.

Static verification: `backend/tests/test_blackeye_admission_proposal_static.py`.
Local HTTP contracts and all fixtures are synthetic. No book content, answers,
audio uploads, staging/prod writes, live migration runs or environment changes are
part of this PR. Catalog/grant runtime checks, independent SA review, and MV1
closure remain release gates; static tests do not prove live database behavior.

Migration **377**, `backend/migrations/377_blackeye_course2_grants.sql`, is the
unexecuted grant-list-only file for FR-027 (`pending_feature`, `blackeye_grants`).
No apply on merge; separate SA review and Vinh run approval, staging first under
the advisory lock; production only at T014. It seeds no grants. CV-1 remains
open: no grant/revoke route or UI exists. Creator-only authorization remains.
The grant and audit tables store append-only grant/revoke events; old events
cannot be updated, deleted or truncated. Self-grants fail. Manual rollback
refuses to remove existing history. The next new migration remains **378**,
after checking `/workspace/cc-jobs/migrations-register.md`.
