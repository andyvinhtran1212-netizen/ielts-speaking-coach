# Research: which functions rely on the default EXECUTE grant

Job PC-J364, 2026-10-31. Spec-only: no migration, no DB write. Evidence files
are under `/workspace/qa/pcj364/` (staging reads: `staging/*.sql` + `.json`;
local probes: `local-pg/*`; static scan: `scan_definers.*`).

## 1. Method

Two independent sources, then a reconciliation.

1. **Staging catalog, read-only.** Supabase Management API
   `POST /v1/projects/<ielts-coach-staging>/database/query` with
   `"read_only": true` (PG 17.6.1.105), catalog tables only, no user rows:
   - `q1_defacl`: every `pg_default_acl` row (owner, schema, object type, ACL);
   - `q2_funcs`: every function in a non-platform schema with owner, definer,
     kind, language, trigger flag, extension membership,
     `has_function_privilege` for anon/authenticated/service_role, PUBLIC in the
     ACL, and the raw ACL (272 functions, all owned by `postgres`);
   - `q3_reach`: every place where PostgreSQL checks EXECUTE against the
     client, found through `pg_depend` and not text search: RLS policies whose
     roles include PUBLIC, anon or authenticated (all schemas, so
     `storage.objects` policies are included), views and matviews, column
     defaults and generated columns, constraints, index expressions, and
     triggers on relations a client role can write;
   - `q4_nested`: app functions called by name from the body of every
     client-executable non-trigger function;
   - `d1_default_drift`, `d2_function_drift`: the FR-007 queries (baseline).
2. **Repository.** Every client-side call path that reaches PostgreSQL as
   anon or authenticated:
   - frontend: no `.rpc(` and no `/rest/v1/rpc` anywhere in `frontend/app`,
     `frontend/lib`, `frontend/components` or `frontend/public/js` (the
     browser talks to FastAPI; Supabase JS is used for Auth only);
   - backend: 105 `.rpc(` call sites. The only Supabase clients built with
     the anon key plus a learner JWT are `_user_sb` in
     `routers/flashcards.py:86`, `routers/vocabulary_bank.py:38`,
     `routers/dashboard.py:45` and `routers/exercises.py:57`. Of these, only
     `flashcards.py:1331` calls an RPC (`fn_apply_srs_review_idempotent`).
     Every other `.rpc(` uses `supabase_admin`, `thread_supabase_admin()`,
     `get_supabase_async()` (`services/ai_budget.py:391`,
     `services/admin_ai_dashboard.py:272`), `_service_sb()`
     (`exercises.py:252`), `_admin()`, or `database.supabase_admin as db`
     (`routers/vocabulary_sets.py:5`), all service-role.
     `services/grammar_quiz_session.py:111` calls only `*_service` RPCs,
     which staging shows are not client-executable;
   - migrations: the only non-`public` `CREATE FUNCTION` is
     `app_private.is_current_user_active()` (335); no auth hook function
     (`access_token_hook`, `supabase_auth_admin`) exists in the repo.

Why the catalog side is decisive: a function a client really calls but cannot
execute would already be failing in production paths. So the needed set is a
subset of what clients can execute today, and the repository says which of
those are actually called by a client.

## 2. Inventory (staging, 2026-10-31)

### 2.1 Client-callable registry (needed by clients)

| # | Function | Client roles today | Needed by | Explicit grant already in repo |
| --- | --- | --- | --- | --- |
| R1 | `fn_apply_srs_review_idempotent(uuid,uuid,text,integer,real,integer,timestamp with time zone,timestamp with time zone)` | anon, authenticated | `authenticated`: `backend/routers/flashcards.py:1331` (learner JWT) | yes: `212_flashcard_review_idempotency.sql:167` `GRANT EXECUTE … TO authenticated`. Its `REVOKE ALL … FROM PUBLIC` (`:164`) leaves anon on through the schema default |
| R2 | `app_private.is_current_user_active()` (SECURITY DEFINER) | authenticated | `authenticated`: RLS `require_active_account_{insert,update,delete}` on `user_vocabulary`, `flashcard_stacks`, `flashcard_cards`, `flashcard_reviews`, `flashcard_review_log`, `user_d1_questions` (`q3_reach`) | yes: `335_learner_writes_require_active.sql:138-140` |

**Answer to the ticket's question:** no function that anon or authenticated
needs relies only on the default. Both have an explicit GRANT to
`authenticated`, so changing the default alone breaks nothing that exists
today. FR-002 re-issues both grants in `NNN` anyway. That keeps the registry
and the catalog in step, removes anon from R1, and covers the `DROP` +
`CREATE` path.

### 2.2 Executable by clients only because of the default (not needed)

Every function below has `{=X, postgres=X, anon=X, authenticated=X,
service_role=X}`, the untouched default (raw ACLs in `q2_funcs.json`). All
are SECURITY INVOKER. None is referenced from a client-evaluated context
(`q3_reach`), and none is called from a client-executable function body
(`q4_nested` returned zero rows). FR-003 removes client EXECUTE from all of
them and keeps `service_role`.

| # | Function | Caller (repo) |
| --- | --- | --- |
| N02 | `fn_apply_srs_review(uuid,uuid,integer,real,integer,timestamp with time zone,timestamp with time zone)` | none (superseded by R1, 212) |
| N03 | `fn_completed_session_counts(uuid[])` | `backend/services/access_code_permissions.py:481` service_role |
| N04 | `fn_create_session_daily_capped_v2(uuid,uuid,text,integer,text,timestamp with time zone,integer)` | `backend/routers/sessions.py:642,678` service_role |
| N05 | `fn_create_session_daily_capped(uuid,text,integer,text,timestamp with time zone,integer)` | `backend/routers/sessions.py:644,678` service_role |
| N06 | `fn_dashboard_daily_practices(timestamp with time zone)` | `backend/services/admin_dashboard.py:266,299` service_role |
| N07 | `fn_dashboard_daily_tokens(timestamp with time zone)` | `backend/services/admin_dashboard.py:266,321` service_role |
| N08 | `fn_dashboard_daily_visitors(timestamp with time zone)` | `backend/services/admin_dashboard.py:266,272` service_role |
| N09 | `fn_dashboard_tokens_called(timestamp with time zone)` | `backend/services/admin_dashboard.py:176` service_role |
| N10 | `fn_dashboard_visitors(timestamp with time zone)` | `backend/services/admin_dashboard.py:108` service_role |
| N11 | `fn_total_grading_minutes()` | `backend/services/admin_dashboard.py:154` service_role |
| N12 | `fn_upsert_kp_mastery(uuid,uuid,numeric,text,integer,timestamp with time zone,timestamp with time zone)` | `backend/services/kp_evidence.py:165` service_role |
| N13 | `increment_session_tokens(uuid,integer)` | `backend/routers/grading.py:1654` service_role |
| N14 | `quiz_admin_student_rollup(text)` | `backend/services/quiz_service.py:6429` service_role |
| N15 | `quiz_item_error_rates(uuid)` | `backend/services/quiz_service.py:6408` service_role |
| N16 | `quiz_skill_error_rates(uuid)` | `backend/services/quiz_service.py:6410` service_role |
| N17 | `quiz_user_bank_progress(uuid)` | `backend/services/quiz_service.py:6803` service_role |

Trigger functions (EXECUTE is not checked when a trigger fires, verified in
`probe_e.out` E5). None is attached to a relation a client role can write
(`q3_reach`, context `trigger-on-client-writable`: zero rows):

| # | Function |
| --- | --- |
| T01 | `fn_class_action_log_append_only()` |
| T02 | `fn_guard_published_vocab_review()` |
| T03 | `fn_guard_published_vocab_task()` |
| T04 | `fn_guard_published_vocab_version()` |
| T05 | `fn_protect_listening_package_child()` |
| T06 | `fn_protect_listening_package_identity()` |
| T07 | `guard_started_timed_course_due_change()` |
| T08 | `guard_started_timed_course_duration_change()` |
| T09 | `mark_timed_course_assignment_started()` |
| T10 | `prevent_completed_grammar_session_mutation()` |
| T11 | `prevent_grammar_evidence_mutation()` |
| T12 | `prevent_grammar_release_content_mutation()` |
| T13 | `prevent_validated_grammar_release_rewrite()` |
| T14 | `protect_advanced_vocab_bank()` |
| T15 | `protect_advanced_vocab_item_evidence()` |
| T16 | `set_speaking_full_test_attempt_id()` |
| T17 | `snapshot_timed_course_item_cutoff()` |
| T18 | `update_band_conversion_tables_updated_at()` |
| T19 | `update_instructor_reviews_updated_at()` |
| T20 | `update_listening_exercises_updated_at()` |
| T21 | `update_mock_exam_reviews_updated_at()` |
| T22 | `update_mock_exam_sittings_updated_at()` |
| T23 | `update_mock_exams_updated_at()` |
| T24 | `update_updated_at_column()` |

### 2.3 Everything else

- The other 230 of the 272 functions (133 definer non-trigger, 40 definer
  trigger, 38 invoker non-trigger, 19 invoker trigger; `q2_funcs.json`) are
  already not executable by any client role. They need nothing.
  272 = 230 + 42 client-executable (R1, R2, N02–N17, T01–T24).
- 0 SECURITY DEFINER functions are client-executable except R2. This matches
  the PC-J94 invariant (c) and 320's postcondition. The SA risk is therefore
  about **future** definers, which FR-001 and FR-005 address.
- Client-evaluated references to revoked helpers (`is_current_user_admin()`,
  `is_current_user_instructor()`) in 29 policies on `access_codes`,
  `cohorts`, `students`, `writing_*`, etc. are already non-executable for
  clients and are removed by RLSCLEANUP-0039 (migration 344). This spec leaves
  them alone.

### 2.4 Default ACL (`q1_defacl`)

| Owner | Layer | Type | ACL |
| --- | --- | --- | --- |
| postgres | (none global) | f | built-in `{=X/postgres, postgres=X/postgres}` |
| postgres | public | f | `{anon=X, authenticated=X, service_role=X}` |
| postgres | storage | f | `{postgres=X, anon=X, authenticated=X, service_role=X}` |
| supabase_admin | (none global) | f | built-in PUBLIC |
| supabase_admin | extensions / graphql / graphql_public / realtime | f | platform, out of scope |
| supabase_auth_admin | auth | f | platform, out of scope |

Staging has no `supabase_admin` function default in `public`. The 320 header
records `public` client-write defaults for `supabase_admin` on production
(tables/sequences). Whether production also has an `f` row is unread
(production is out of scope for this job) and is part of T003's read-only
pre-apply.

## 3. PostgreSQL behaviour that shapes the FRs (local probes)

Local disposable clusters: PG 17.11 and PG 16.2. SCRAM auth, 127.0.0.1 only,
stopped after use. Shape: bootstrap superuser `supabase_admin`, NOSUPERUSER
runner `postgres`, roles anon/authenticated/service_role, and the staging
default ACL. Full transcript: `local-pg/results-20261031.txt`.

| Probe | Result |
| --- | --- |
| A: ticket statement only (`IN SCHEMA public REVOKE … FROM PUBLIC, anon, authenticated`) | new function `{=X, postgres=X, service_role=X}`; anon/authenticated **can still execute** |
| B: global `REVOKE … FROM PUBLIC` + `IN SCHEMA public REVOKE … FROM anon, authenticated` | new function `{postgres=X, service_role=X}`; anon/auth cannot execute; procedures same |
| Existing function after B | unchanged; `CREATE OR REPLACE` keeps its ACL; `DROP` + `CREATE` takes the new default |
| New function in another schema after B | `{postgres=X}` (no service_role) |
| `CREATE EXTENSION pg_trgm` after B | member functions keep `NULL` ACL (PUBLIC can execute) |
| E: where EXECUTE is checked for the client | policy, DEFAULT, CHECK, generated column, plain view, security_invoker view, nested call in trigger body or invoker RPC: **checked**; trigger function itself and calls inside a definer: **not checked** |
| Prototype `NNN` (FR-001..FR-004) as NOSUPERUSER runner, twice, PG 16 and 17 | commits; one WARNING for `supabase_admin:public`; afterwards DRIFT-2 = 0 rows, DRIFT-1 = `supabase_admin` rows only; service_role kept on residue; 309-style definer stays `{postgres=X}` |
| Negative control: ticket statement + postcondition | `client_default_execute_survives: owner postgres acl {=X/postgres,postgres=X/postgres,service_role=X/postgres}` |
| Negative control: R1 `DROP` + `CREATE` without grant after `NNN` | ACL `{postgres=X, service_role=X}`; `client_callable_registry_mismatch …:missing:authenticated` |
| Manual rollback statements | `pg_default_acl` back to the staging pre-state; global row removed |
| `pg_dump` → `pg_restore --no-owner --section=pre-data --schema=public` into stock defaults | every restored function ends with anon=X, authenticated=X, even one with explicit `REVOKE … FROM PUBLIC, anon, authenticated`; default ACL rows not restored |

The prototype SQL (`local-pg/nnn_proto.sql`) is evidence only. It is not the
`NNN` implementation, and T001 writes and tests its own.

## 4. Static guard calibration

`scan_definers.py` is a prototype of FR-005 rule (1), run on the current tree.
It finds 272 definer `CREATE` statements in 95 files, and 94 (in 24 files)
without a same-file literal REVOKE covering all three grantees. That is why
FR-005 applies only to files numbered above `NNN` (plus all rollback files and
scripts), and why it accepts a REVOKE split across statements (335 form).
Dynamic loops (309:1173) are not accepted for new files (rule 5), because a
static reader cannot tell which functions they cover.

The same prototype on `backend/migrations/rollback/` (one file today) finds
the 4 definers of `rollback/339_grammar_quiz_followup_codes.sql`, covered only
by its dynamic loop at `:413-415`. FR-005 therefore names that file as the
single allow-listed exception. `backend/scripts/**/*.sql` has no definer, no
client EXECUTE grant and no default-ACL change.
