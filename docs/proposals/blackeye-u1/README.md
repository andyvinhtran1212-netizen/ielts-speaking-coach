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
not a forward-runner input. It drops the two service RPCs and replaces the guard
function with a deny-all Black Eye guard, keeping the enabled trigger, widened
CHECK constraints, attempts and snapshots. It refuses to run while any
Black Eye package/lesson/test is published or any Black Eye test is public;
archive/hide or remove the content under separate authorization first. The check
holds SHARE table locks through guard replacement to prevent concurrent publication;
a local 5-second lock timeout bounds lock waits. The retained guard rejects every
Black Eye INSERT with `blackeye_unavailable`, including metadata-only Black Eye
papers and content published after rollback; other Listening INSERTs pass. Roll back
application code with it; do not enable generic Black Eye delivery. No historical
rows are rewritten. Reapplying after rollback requires a separately reviewed
migration-ledger decision. Migration 376 replaces its trigger with transactional
DROP/CREATE rather than requiring PostgreSQL 14+ syntax; repository CI images
are PG16/17, but neither live database version is established here. Before
commit, catalog postconditions require the enabled trigger to target the guard
and all three functions to remain SECURITY DEFINER with exactly
`search_path = pg_catalog, pg_temp` and no PUBLIC/anon/authenticated EXECUTE.
The disposable PG17 suite covers apply, repeated rollback, deny-all/generic
INSERT behavior, re-apply with catalog equality, and unsafe-catalog rejection.

Static verification: `backend/tests/test_blackeye_admission_proposal_static.py`.
Local HTTP contracts and all fixtures are synthetic. No book content, answers,
audio uploads, staging/prod writes, live migration runs or environment changes are
part of this PR. Catalog/grant runtime checks, independent SA review, and MV1
closure remain release gates; static tests do not prove live database behavior.
