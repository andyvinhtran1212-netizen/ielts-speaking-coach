# Black Eye U1 admission

The source proposal `admission.sql` remains outside forward discovery. The
BLACKEYE-0052 rebuild job explicitly reserves migration **376**; its numbered
copy is `backend/migrations/376_blackeye_admission.sql`. Their executable SQL
must match. This supersedes the earlier unnumbered-only placement decision.
Neither file has been executed in this job. Running either needs separate owner
authorization, Security Auditor review and the advisory-locked migration runner.

Both definer functions pin `search_path = pg_catalog, pg_temp`; all application
objects are schema-qualified. Client roles have no EXECUTE grant. Existing
snapshot/RLS rules remain unchanged. Missing admission RPC fails closed with 503.
Admission remains standalone-only; PR2 must open the class assignment seam.

`backend/migrations/rollback/376_blackeye_admission.sql` is manual rollback SQL,
not a forward-runner input. It removes only the new trigger/functions and keeps
widened CHECK constraints, attempts, snapshots and published content. Roll back
application code with it; do not enable generic Black Eye delivery. No historical
rows are rewritten. Reapplying after rollback requires a separately reviewed
migration-ledger decision.

Static verification: `backend/tests/test_blackeye_admission_proposal_static.py`.
Local HTTP contracts and all fixtures are synthetic. No book content, answers,
audio uploads, staging/prod writes, migration runs or environment changes are
part of this PR. Catalog/grant runtime checks, independent SA review, and MV1
closure remain release gates; static tests do not prove live database behavior.
