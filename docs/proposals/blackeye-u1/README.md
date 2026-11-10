# Black Eye U1 PR1 — unnumbered admission proposal / fix-round notes

Local-only synthetic backend slice; **not installed or executed anywhere**.
Authority: Andy uid `d9f3f92b774240dfb2a676d37f03e283` (2026-11-10
15:21:43 +07): “Để SQL370 ngoài thư mục migrations (đường proposal), CI không
chạy; đánh số khi anh duyệt chạy”. This supersedes the former numbered placement.

## R1: discovery boundary, not a migration reservation

`admission.sql` is an unnumbered proposal outside `backend/migrations/`.
The static source test is `backend/tests/test_blackeye_admission_proposal_static.py`.
No migration number is claimed. No migration README/forward-policy/runner,
trigger coverage exception or ACL postcondition is changed. Installation,
numbering and all PostgreSQL tests require a separate Andy execution decision.

Read-only searches of `.github/workflows`, `scripts` and `backend/scripts`
verified the discovery chain:

- `.github/workflows/backend-tests.yml:53ff` selects the PG17 test files,
  including `tests/test_client_write_invariant_postgres.py`.
- That test's `_forward_migrations` (`:79–88`) scans only
  `backend/migrations/[0-9][0-9][0-9]_*.sql`, excluding retired/rollback files.
  The new static test calls only this pure discovery function and asserts that
  the proposal is absent; it never invokes a DB/apply helper.
- `backend/scripts/apply_migrations.sh:31,104` resolves `../migrations` and
  loops over `$MIG_DIR/*.sql`; the locked applier receives only those paths.
- The workflow's other SQL references are explicit numbered migration paths.
  The top-level scripts' SQL references concern backup/restore fixtures, not
  repository-wide SQL discovery. No workflow or runnable script references
  `docs/proposals/blackeye-u1`, this proposal or the new RPC. The static test
  enforces this negative over those three workflow/script directories.

This proves exclusion from the current repository's migration discovery, not
that a future explicit/manual SQL command is harmless. No runner was invoked.

## R2–R6 / F1

- R2: revisionless legacy diagnostic attempts require **zero** new dispatch IO;
  missing test rows and partial generic attempt shapes reach their original
  404/409/422 guards instead of a Black Eye 500 or `KeyError`. Frozen dispatch
  reads namespace scalars once, not marking rows or the live catalog. A missing
  snapshot uses an optional identity probe; authoritative Black Eye reads still
  fail closed. `test_identity` explicitly accepts the service-role
  `supabase_admin` supplied by the routers; no JWT-scoped client or scanner
  exception is introduced. The existing migration-347 scanner remains intact.
- R3: every new blocking boundary/helper call in async handlers runs via
  `run_in_threadpool`. Start reuses the already selected trusted test row.
  Generic autosave/submit needs at most one namespace snapshot read when frozen,
  rather than a snapshot plus a catalog read. Existing unrelated sync sites are
  not broadened/refactored in this slice.
- Exactly **three stale allowlist rows are removed**, none added or expanded:
  `routers/listening.py::post_listening_attempt::routers.listening._resolve_attempt_target`,
  `routers/listening.py::get_listening_programme_guided_state::routers.listening._programme_guided_context`,
  `routers/listening.py::reveal_listening_programme_question::routers.listening._programme_guided_context`.
  Each formerly approved call is now awaited in the threadpool, leaving zero
  inline calls. Keeping these rows would fail the repo's stale-allowlist gate.
- R4/F1: content grading resolves only `content_id` / parent `test_id` identity
  before private content/exercise reads, grading or lazy exercise/attempt writes.
  Black Eye returns sanitized 422. HTTP negatives cover all four modes by
  content and by exercise, assert unchanged tables, no transcript/diff, no
  attempt IO or mutation, and identity-only reads. Generic dictation still
  grades/saves successfully.
- R5: `blackeye_invalid_inactive` is distinct sanitized 422,
  **“Black Eye attempt inactive.”** Server-authored revision/context mismatch
  is 503, not invalid learner binding. The inactive-attempt restriction is
  **interim fail-closed; Andy decides the restart policy before learner release**.
  Submitted history remains immutable. No restart capability is implied.
- R6: an HTTP generic-give negative pins the router's own 503 before generic
  validation and service dispatch; a forbidden-service spy prevents the service
  backstop from masking a missing router seam.

## Advisory carry-forward / PR2 boundaries

- Reviewer O1 fixed: guided private-read spies now fail on snapshot `*` as well
  as `marking_rows`, outside authorized review.
- Reviewer O2: import authoring must pin `metadata.blackeye_db_revisions` to the
  row's actual `mock_content_revision` / `policy_revision`. A metadata update
  bumps content revision itself (306), and child-source writes bump it (353).
  Therefore plan the final metadata write at current content revision +1 and
  re-pin after every source edit; validate readback in the eventual atomic
  importer. No live import/update protocol has been executed or accepted here.
- Reviewer O3: the assigned teacher-review positive is a **consumer-only fixture
  seam**. The standalone-only admission proposal cannot create that assigned
  context; approved PR2 mapping/catalog/create/receipt and T09/T10 remain open.
- Reviewer O4 fixed: generic importer count checks and its original form-id
  error are restored exactly; stricter type/duplicate/cell checks apply only
  to the separate Black Eye branch.
- Reviewer O5: **R1 positive player/playback DTOs deferred; interim O6 503
  retained until the security-reconciled player slice.**
- Security advisories O1–O5 stay for PR2: explicit admin authoring preview/audio
  policy, creator/cohort scope for admin answer detail, explicit practice-window
  and renderer-affinity policy, and the broader approved teacher mapping. No
  learner readiness or MV closure is claimed by these synthetic local tests.

Full command, real output and exact-head receipt are maintained externally in
team `evidence/blackeye-u1-pr1/tests.md`; no test outcome is invented in this
proposal. No push/PR, SQL, staging/prod contact, real book/audio or config change.
