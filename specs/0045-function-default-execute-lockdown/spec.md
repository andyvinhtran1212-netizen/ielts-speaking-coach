---
id: FNEXEC-0045
title: A new database function cannot be called by anonymous or signed-in clients unless a migration grants it explicitly, and only the two functions clients really use stay callable
status: draft
risk: high
owner: product
---

# A new database function cannot be called by anonymous or signed-in clients unless a migration grants it explicitly, and only the two functions clients really use stay callable

Status: **draft, chưa duyệt**. Job PC-J364 (1gz) chỉ viết spec, không viết
migration và không ghi DB. Chỉ mở phiếu migration (T001) sau khi anh Vinh
trả lời các câu hỏi ở mục *Open questions* (Leader chuyển).
Spec number 0045 is provisional (0041–0044 are taken by open PRs); the Leader
may renumber. The migration number is assigned by the Leader when T001 is
opened and is written `NNN` below.
Origin: Security Auditor note in `reviews/PR-2060.md` round 1 P3-1 (SA, PR
#2060, 2026-10-30 16:04 UTC+7), named as **PC-J364** in round 2 P3-R2-3 and in
SVCPRIV-0042 Q-J357-3. The SA observed that the default ACL of `postgres` in
`public` is `f {anon=X, authenticated=X, service_role=X}`, so a SECURITY
DEFINER function whose migration forgets its REVOKE is callable by anon and
authenticated. Step 7 of migration 320 only revoked the definer **trigger**
functions that existed at the time.

## Tóm tắt (tiếng Việt)

Người dùng không thấy thay đổi gì. Học viên, giáo viên và admin vẫn làm mọi
việc như cũ. Ôn flashcard, thêm từ vựng, tạo phiên Speaking, chấm bài và
dashboard admin vẫn chạy như hiện nay.

Thay đổi nằm ở quyền gọi hàm trong database. Hiện mỗi hàm mới mà `postgres`
tạo trong `public` **tự động** gọi được bởi `anon` (khách chưa đăng nhập, chỉ
cần anon key công khai) và `authenticated` (mọi học viên đã đăng nhập), qua
`/rest/v1/rpc/<tên hàm>`. Nếu đó là hàm SECURITY DEFINER mà migration quên
REVOKE, thì hàm chạy dưới quyền owner cho bất kỳ ai gọi. Việc này đã xảy ra
một lần: migration 282 để lọt 7 hàm guard definer (lỗi F14), đến 320 mới sửa.

Spec đề xuất:

1. **Đổi quyền mặc định** để hàm tạo sau này không còn tự gọi được bởi
   PUBLIC, anon và authenticated. Phát hiện quan trọng: câu lệnh như phiếu ghi
   (`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE
   ON FUNCTIONS FROM PUBLIC, anon, authenticated`) **không có tác dụng**.
   Quyền EXECUTE cho PUBLIC đến từ mặc định toàn cục có sẵn của PostgreSQL. Một
   lệnh REVOKE chỉ trong một schema không gỡ được nó. Đã thử trên PG 16 và 17:
   hàm mới vẫn gọi được bởi anon. Phải REVOKE ở mức toàn cục (không có
   `IN SCHEMA`) cho PUBLIC, rồi REVOKE trong `public` cho anon và authenticated.
2. **Danh sách hàm client thật sự cần**: đã kiểm từ repo và catalog staging
   (chỉ đọc). Chỉ có **hai** hàm:
   `fn_apply_srs_review_idempotent` (backend gọi bằng JWT học viên khi ôn
   flashcard) và `app_private.is_current_user_active()` (dùng trong RLS của
   flashcard/từ vựng). Cả hai **đã có GRANT tường minh** trong repo (212, 335).
   Vì vậy không hàm nào client cần mà chỉ dựa vào mặc định. Migration vẫn GRANT
   lại cho chắc và ghi vào một danh sách (registry) trong repo.
3. **Dọn phần thừa**: trên staging còn 41 hàm khác mà anon/authenticated gọi
   được chỉ nhờ mặc định cũ (16 RPC backend gọi bằng `service_role`, 1 hàm cũ
   không ai gọi và 24 hàm trigger), cộng quyền anon thừa trên hàm ôn flashcard.
   Đề xuất thu quyền client trên các hàm đó và giữ nguyên quyền `service_role`.
   Việc này cần anh Vinh chọn (Q-J364-2).
4. **Guard tĩnh trong CI**: mọi `CREATE FUNCTION … SECURITY DEFINER` trong
   migration mới phải có REVOKE và GRANT EXECUTE tường minh trong cùng file.
   GRANT cho anon/authenticated chỉ được phép với hàm có trong registry.
5. **Hậu điều kiện và câu truy vấn drift** (có cột owner, chạy được trên PG
   15–17) để SA kiểm định kỳ trên staging và production.

Rủi ro chính: một migration sau này DROP rồi CREATE lại một trong hai hàm
client mà quên GRANT. Khi đó ôn flashcard sẽ lỗi. Guard tĩnh và test invariant
chặn trường hợp này trước khi merge.

## Problem

- PostgreSQL gives EXECUTE on a new function to PUBLIC through the built-in
  default (`acldefault('f', owner)`). On staging (read-only catalog read,
  2026-10-31, `/workspace/qa/pcj364/staging/q1_defacl.json`), `postgres` also
  has the schema-scoped default `public f {anon=X, authenticated=X,
  service_role=X}` and no global (`defaclnamespace = 0`) row. So every function
  `postgres` creates in `public` starts as
  `{=X, postgres=X, anon=X, authenticated=X, service_role=X}`.
- PostgREST exposes every function in `public` at `/rest/v1/rpc/<name>`. The
  anon key is public (it is shipped to browsers). So a function that keeps the
  default ACL is callable by anyone, and a SECURITY DEFINER function runs as
  its owner `postgres` for that caller.
- A migration must remember `REVOKE … FROM PUBLIC, anon, authenticated` for
  every definer it adds. A prototype scan of the current tree
  (`/workspace/qa/pcj364/scan_definers.out`) finds 272 SECURITY DEFINER
  `CREATE` statements in 95 migration files. For 94 of them (24 files), the
  same file has no literal REVOKE naming that function for all three of
  PUBLIC, anon and authenticated. Some are covered by a dynamic `DO` loop
  (e.g. 309:1173) or by a later migration. Seven are the 282 trigger guards
  that shipped client-executable (F14) until 320 step 7 revoked them. 212
  and 335 revoke only `FROM PUBLIC` (335 also revokes from `anon`), so anon
  keeps EXECUTE on `fn_apply_srs_review_idempotent` through the schema
  default.
- The CI invariant `backend/tests/test_client_write_invariant_postgres.py`
  (PC-J94, check (c)) already fails if a migration numbered 320 or later
  leaves a definer client-executable on its harness. It does not cover
  functions created outside migrations (Studio/SQL editor as `postgres`). It
  does not check the default ACL itself, SECURITY INVOKER functions, or the
  real staging/production catalog. It does not see migrations before 320 or
  objects missing from its synthetic pre-320 shape.
- The ticket proposes `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA
  public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated`. The
  PostgreSQL documentation says a per-schema REVOKE only reverses a per-schema
  GRANT; it cannot remove privileges granted globally (including the built-in
  default). Verified on PG 17.11 and PG 16.2
  (`/workspace/qa/pcj364/local-pg/probe_a.out`, case A). After that statement
  a new function gets `{=X/postgres, postgres=X/postgres,
  service_role=X/postgres}`, and `has_function_privilege('anon', …,
  'EXECUTE')` is still `true`. The statement as written changes nothing for
  anon or authenticated.

## Scope

- The default function ACL of every owner role the migration runner can act
  for (superuser, or member of that role): `postgres`, the runner itself and
  every role that owns a `public` function or holds a global or `public`
  function default ACL. Global layer: no EXECUTE for PUBLIC. `public` layer:
  no EXECUTE for PUBLIC, anon or authenticated, while `service_role` keeps
  its EXECUTE (FR-001).
- A repository registry of the functions that anon or authenticated must be
  able to execute, with explicit grants in `NNN` (FR-002).
- Removal of client EXECUTE from every other existing app function, keeping
  `service_role` exactly as today (FR-003, subject to Q-J364-2).
- A fail-closed postcondition in `NNN` (FR-004), a static migration guard
  (FR-005), an extension of the PC-J94 invariant (FR-006) and read-only drift
  queries with an owner column that run on PG 15–17 (FR-007).

## Non-goals

- No change to any function body, owner, `search_path`, security mode
  (definer/invoker), language or volatility. No trigger, table, sequence,
  schema or RLS change. Pinning `search_path` is SVCPRIV-0042 FR-010 (358),
  service_role table privileges are SVCPRIV-0042 FR-001..FR-009.
- No change to `service_role` EXECUTE on any function (it neither gains nor
  loses), except that new functions in schemas other than `public` no longer
  get it through PUBLIC (see Edge cases and Q-J364-3).
- Default ACLs of roles the runner cannot act for (`supabase_admin` on hosted
  Supabase) and of other schemas (`storage`, where `postgres` holds
  `f {postgres, anon, authenticated, service_role = X}`; `graphql`,
  `graphql_public`). Reported, not changed (Q-J364-5).
- Extension member functions (`pg_depend.deptype = 'e'`). Their ACL is
  managed by the extension; they keep `NULL` (built-in PUBLIC) even after the
  default changes (verified with `pg_trgm`, `probe_a.out` case B).
- Functions in Supabase platform schemas (`auth`, `storage`, `realtime`,
  `extensions`, `graphql`, `graphql_public`, `vault`, `pgsodium`, `net`,
  `cron`, `supabase_functions`, `supabase_migrations`, `pgbouncer`).
- The DR restore path (`scripts/backup/restore_into_project.sh`) re-opening
  client EXECUTE. That is a pre-existing gap for every function, including the
  320 definer revokes (Edge cases, Q-J364-6). This spec only requires the
  drift check after a restore.

## Users and journeys

- An anonymous visitor who has the public anon key calls
  `POST /rest/v1/rpc/<function>` for any app function. Today this works for
  the 41 residue functions (FR-003) and for any future function on the
  default. After `NNN` they all get `permission denied for function`
  (SQLSTATE 42501).
- A signed-in learner reviews a flashcard. The backend calls
  `fn_apply_srs_review_idempotent` with the learner's JWT
  (`backend/routers/flashcards.py:1331`, `_user_sb`, role `authenticated`).
  This keeps working.
- A signed-in learner adds or edits Vocabulary/flashcard rows through the
  backend's learner-JWT clients. The RESTRICTIVE policies of 335 call
  `app_private.is_current_user_active()` as `authenticated`. This keeps
  working.
- Every other backend RPC uses the service-role client (`supabase_admin`,
  `thread_supabase_admin()`, `get_supabase_async()`, `_service_sb()`,
  `_admin()`) and keeps working unchanged.
- A developer adds a new migration with a SECURITY DEFINER function and
  forgets the REVOKE. CI fails with the file, line and function name (FR-005).
  Even if it were merged, anon and authenticated could not execute it
  (FR-001).

## Requirements

- **FR-001:** Migration `NNN` changes the function default ACL so that a
  function created later by any owner role the runner can act for is not
  executable by PUBLIC, anon or authenticated, and stays executable by
  `service_role` when it is created in `public`. For each such role `R` it
  runs, in this order:
  `ALTER DEFAULT PRIVILEGES FOR ROLE R REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`
  (global layer, **no** `IN SCHEMA`, the only form that removes the built-in
  PUBLIC grant);
  `ALTER DEFAULT PRIVILEGES FOR ROLE R IN SCHEMA public REVOKE EXECUTE ON
  FUNCTIONS FROM PUBLIC, anon, authenticated`;
  `ALTER DEFAULT PRIVILEGES FOR ROLE R IN SCHEMA public GRANT EXECUTE ON
  FUNCTIONS TO service_role`.
  `R` ranges over `postgres`, `current_user`, every owner of a `public`
  function and every role with a function default ACL row in the global or
  `public` layer, filtered to roles where the runner is superuser or
  `pg_has_role(current_user, R, 'MEMBER')` (the 320 step 2 rule). `FUNCTIONS`
  covers procedures. The per-schema-only form in the ticket must not be used
  on its own. The FR-004 postcondition rejects it (Scenario 8).

- **FR-002:** The repository keeps a client-callable function registry
  `backend/migrations/client-callable-functions.tsv` with the columns
  `signature` (the `regprocedure` text, schema-qualified outside `public`),
  `roles` (subset of `anon`, `authenticated`), `kind` (`rpc` / `rls-helper`
  / `view` / `default` / `check`), `caller` (file:line or policy name) and
  `reason`. At `NNN` it contains exactly:
  `fn_apply_srs_review_idempotent(uuid,uuid,text,integer,real,integer,timestamp with time zone,timestamp with time zone)`
  for `authenticated`, kind `rpc`, caller `backend/routers/flashcards.py:1331`;
  and `app_private.is_current_user_active()` for `authenticated`, kind
  `rls-helper`, caller the six `require_active_account_*` policy sets of 335.
  `NNN` runs, before FR-001 and FR-003, `REVOKE ALL ON FUNCTION <f> FROM
  PUBLIC, anon` and `GRANT EXECUTE ON FUNCTION <f> TO authenticated` for each
  entry (and keeps `service_role` where it has it today), so each registry
  function is executable by exactly its listed client roles. That removes
  anon from `fn_apply_srs_review_idempotent` (Q-J364-4). The full
  cross-check behind this list is in `research.md` §2.

- **FR-003:** Migration `NNN` removes client EXECUTE from every existing
  function in a non-platform schema that is not an extension member and is not
  in the registry. For each such function `f` that anon or authenticated can
  execute: if `has_function_privilege('service_role', f, 'EXECUTE')` is true
  beforehand, `GRANT EXECUTE ON FUNCTION f TO service_role`; then `REVOKE
  EXECUTE ON FUNCTION f FROM PUBLIC, anon, authenticated`. On staging
  (2026-10-31) this is the 41 functions N02–N17 and T01–T24 in
  `research.md` §2. A function that `service_role` cannot execute today (for
  example the 309 loop that revokes `service_role`) gets no grant. The set is
  computed from the catalog at apply time, never hard-coded, and T002/T003
  must list it read-only before the apply (rollout.md). If Vinh defers this FR
  (Q-J364-2), FR-004 (c) and FR-006 must allow-list these 41 by signature
  until a follow-up migration removes them.

- **FR-004:** `NNN` ends with a postcondition that aborts the transaction
  (`RAISE EXCEPTION`, stable error codes below) unless all of these hold:
  (a) `client_default_execute_survives`: for each owner role `R` the runner can
  act for, `SET LOCAL ROLE R` and creating a probe function
  `public.__nnn_default_probe()` gives `has_function_privilege` false for anon
  and authenticated and true for `service_role`. The probe is dropped in the
  same transaction. The role is then restored **by name** to the runner
  captured at the start (`SET LOCAL ROLE <runner>`), never with `RESET ROLE`:
  the CI harness and `apply_migration_locked.sql` run the file after `SET
  ROLE <runner>` from a superuser session, and `RESET ROLE` would run the
  rest of the migration as that superuser. An owner `R` without CREATE on
  `public` is checked with the DRIFT-1 computation for `R` instead of a probe.
  A default ACL has no `has_*` function, so this effective test is required;
  reading `pg_default_acl` rows alone is not enough (case A of `probe_a.out`).
  (b) `client_callable_registry_mismatch`: every registry entry exists and is
  executable by exactly its listed client roles (missing function, missing
  role or an extra client role fails).
  (c) `client_executable_function_outside_registry`: no other function in a
  non-platform schema, extension members excluded, is executable by anon or
  authenticated, whether directly, through PUBLIC or through role membership.
  (d) `service_role_execute_changed`: the set of functions `service_role` can
  execute, recorded at the start of `NNN`, is unchanged.
  An owner role the runner cannot act for whose global or `public` function
  default still reaches anon or authenticated (including the built-in PUBLIC
  grant when it has no global row) raises
  `WARNING client_default_execute_not_revocable_by_runner: <role>:<layer>,…`,
  not an exception (320 precedent). It only affects functions that role
  creates later, which app migrations never do. Existing functions of every
  owner are still checked strictly by (b) and (c). A second apply is a no-op
  and passes.

- **FR-005:** A static guard
  (`backend/tests/test_function_execute_acl_guard.py`) runs in CI on every
  forward migration numbered above `NNN`, every file in
  `backend/migrations/rollback/` and every `backend/scripts/**/*.sql`. SQL
  comments (`--` and `/* */`) are stripped first. The guard fails with file,
  line and function name when:
  (1) a `CREATE [OR REPLACE] FUNCTION|PROCEDURE <name>(…)` whose header says
  `SECURITY DEFINER`, or an `ALTER FUNCTION|PROCEDURE|ROUTINE <name> … SECURITY
  DEFINER`, has no literal `REVOKE {ALL|EXECUTE} [PRIVILEGES] ON
  {FUNCTION|PROCEDURE|ROUTINE} <name>` in the same file whose grantee lists
  together cover PUBLIC, anon and authenticated;
  (2) such a definer has no explicit `GRANT EXECUTE ON … <name> TO <role>` in
  the same file, unless the file carries the marker
  `-- execute-acl: owner-only <name> <reason>` (a definer that only other
  definers or triggers call);
  (3) any file grants EXECUTE on a function (definer or invoker, by name or by
  `ALL FUNCTIONS IN SCHEMA`) to PUBLIC, anon or authenticated, or alters a
  function default ACL with `GRANT … TO PUBLIC|anon|authenticated`, unless the
  function and role are a registry row and the file carries
  `-- execute-acl: client-callable <name>` (rollback files: never);
  (4) a file `CREATE`s (with or without `OR REPLACE`) a function that is in
  the registry and does not re-run its registry `GRANT` in the same file (the
  `DROP` + `CREATE` case, Scenario 4);
  (5) a dynamic statement (`EXECUTE`/`format(…)`, heredoc or Python string in
  a `.sql` file) builds `CREATE … FUNCTION` with `SECURITY DEFINER`, unless
  the test's explicit allow-list names the file with a written reason.
  A dynamic same-file REVOKE loop does not satisfy rule (1) except for files on
  the test's explicit allow-list, each with a written reason. At `NNN` the
  list is exactly `backend/migrations/rollback/339_grammar_quiz_followup_codes.sql`:
  its 4 definers (`grammar_quiz_audit_chain`, `grammar_quiz_guard_bank`,
  `grammar_quiz_validate_receipt_envelope`, `grammar_quiz_receipt_data`) are
  covered by the loop at `:413-415`, which revokes ALL from PUBLIC, anon,
  authenticated and service_role on the grammar-quiz functions. No
  `backend/scripts/**/*.sql` file contains a definer, a client EXECUTE grant
  or a default-ACL change today, so there are no other exceptions.
  Names match by schema (unqualified = `public`) and function name. When the
  REVOKE/GRANT carries an argument list it must match the created
  signature after type normalisation (`timestamptz` = `timestamp with time
  zone`, `int` = `integer`, …), so an overload is not covered by another
  overload's REVOKE. Mutation fixtures in the test prove every rule fires and
  that the safe forms pass: REVOKE in a different file, REVOKE only `FROM
  PUBLIC` (the 212 form), a commented-out REVOKE, a same-prefix name
  (`fn_a` vs `fn_ab`), the wrong overload, multi-statement REVOKE that
  together covers all three grantees (335 form), and ALTER to definer.

- **FR-006:** `backend/tests/test_client_write_invariant_postgres.py` is
  extended. After the whole chain (320 → latest, including `NNN`) on its
  hosted-Supabase harness, (i) the set of `(function, client role)` pairs
  executable by anon or authenticated in non-platform schemas equals the
  registry exactly (any kind, not only definers; this replaces check (c)'s
  definer allow-list); (ii) a probe function created as the runner is not
  client-executable. New negative controls: a `GRANT EXECUTE` to anon on an
  invoker function, a registry function recreated without its grant, a
  re-added schema default `GRANT EXECUTE ON FUNCTIONS TO anon`, and the
  per-schema-only REVOKE of the ticket. Each must be reported. Runs on PG 16
  (CI) and PG 17 (advisory job).

- **FR-007:** `rollout.md` §Observability carries two read-only drift queries,
  DRIFT-1 (default ACL) and DRIFT-2 (existing functions). Both return an
  `owner` column, run unchanged on PG 15, 16 and 17 (they use only
  `pg_default_acl`, `aclexplode`, `acldefault`, `has_function_privilege`,
  `pg_has_role` and `pg_proc.prokind`; no `MAINTAIN` keyword, so no version
  gate), and use effective privilege functions so membership and PUBLIC are
  counted. Expected after `NNN`: DRIFT-2 returns zero rows, and DRIFT-1 returns
  only rows for owners the runner cannot act for (`supabase_admin`). The SA
  runs both on staging and production as a recurring check, after every
  migration that creates or replaces functions, and after every restore or DR
  drill.

- **FR-008:** `NNN` changes only `pg_proc.proacl` of the functions named in
  FR-002/FR-003 and the function rows (`defaclobjtype = 'f'`) of
  `pg_default_acl` for the actable owner roles. Every function body, owner,
  `proconfig`, `prosecdef`, every trigger, relation ACL, sequence ACL, schema
  ACL, RLS policy and every non-function `pg_default_acl` row is identical
  before and after. The probe function does not survive the transaction. The
  migration takes no data lock beyond the catalog updates. It carries a
  `pending_feature` forward-policy entry, so it is applied only by explicit
  authorization (staging first, under the advisory lock).

## Acceptance scenarios

### Scenario 1: a forgotten REVOKE fails CI and cannot leak

- **Given** a new forward migration numbered above `NNN` that creates
  `public.fn_x()` `SECURITY DEFINER` with no REVOKE
- **When** CI runs
- **Then** `test_function_execute_acl_guard.py` fails naming the file, line
  and `public.fn_x`; and on a database where the file is applied anyway,
  `has_function_privilege('anon', 'public.fn_x()', 'EXECUTE')` and the same for
  `authenticated` are false

### Scenario 2: flashcard review keeps working

- **Given** `NNN` is applied
- **When** a signed-in active learner reviews a flashcard (backend calls
  `fn_apply_srs_review_idempotent` with the learner JWT)
- **Then** the review is persisted and the receipt returned as before;
  calling the same RPC with only the anon key returns 401/42501

### Scenario 3: learner Vocabulary writes keep passing the active check

- **Given** `NNN` is applied
- **When** an active learner adds a word to `user_vocabulary` and an inactive
  learner tries the same
- **Then** the active learner succeeds and the inactive learner is still
  rejected by the 335 policy (the helper keeps `authenticated` EXECUTE)

### Scenario 4: recreating a registry function without its grant is caught

- **Given** a migration that `DROP`s and `CREATE`s
  `fn_apply_srs_review_idempotent` with a new signature or body and no `GRANT`
- **When** CI runs
- **Then** FR-005 rule (4) and the FR-006 invariant fail. Without them, after
  `NNN` the recreated function would have `{postgres=X, service_role=X}` only
  and flashcard review would fail for every learner (verified locally:
  `nc2.sql`, error `client_callable_registry_mismatch`)

### Scenario 5: service-role RPCs are unaffected

- **Given** `NNN` is applied
- **When** the admin dashboard loads, a Speaking session is created, a
  response is graded (token increment), a quiz bank's error rates are shown
  and KP mastery is updated
- **Then** each works as before; FR-004 (d) proved `service_role`'s
  executable set did not change

### Scenario 6: anonymous RPC calls are refused

- **Given** `NNN` is applied
- **When** `POST /rest/v1/rpc/fn_total_grading_minutes` (or any N02–N17
  function) is called with only the anon key, and again with a learner JWT
- **Then** both get `permission denied for function` (42501); before `NNN`
  both executed

### Scenario 7: an owner the runner cannot act for warns

- **Given** a production-like database where `supabase_admin` holds a `public`
  function default ACL and the runner `postgres` is not superuser and not a
  member of `supabase_admin`
- **When** `NNN` is applied
- **Then** it commits with exactly one
  `WARNING client_default_execute_not_revocable_by_runner` naming
  `supabase_admin`, and DRIFT-1 lists only `supabase_admin` rows

### Scenario 8: the ticket's per-schema-only statement is rejected

- **Given** a variant of `NNN` that runs only `ALTER DEFAULT PRIVILEGES FOR
  ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,
  anon, authenticated`
- **When** it is applied
- **Then** the postcondition aborts with `client_default_execute_survives:
  owner postgres acl {=X/postgres,postgres=X/postgres,service_role=X/postgres}`
  (verified locally on PG 17: `nc1_ticket_wording.sql`)

### Scenario 9: second apply and service_role snapshot

- **Given** `NNN` was applied
- **When** it is applied again, as the hosted NOSUPERUSER runner, on PG 16 and
  PG 17
- **Then** it commits with no change to any ACL and the same WARNING set

### Scenario 10: drift after a restore is detected and repaired

- **Given** a restore through `restore_into_project.sh` into a project with
  stock Supabase defaults
- **When** DRIFT-1 and DRIFT-2 run
- **Then** they report the re-opened defaults and functions; re-applying `NNN`
  (idempotent) and 320 clears them

## Edge cases

- **Contexts where EXECUTE is checked against the client.** Verified locally
  (`probe_e.out`): RLS policy expressions, column `DEFAULT`s, `CHECK`
  constraints and generated columns, plain views and `security_invoker` views
  (PostgreSQL checks functions in a view against the querying user), and
  functions called from inside an invoker trigger body or an invoker RPC.
  Not checked: the trigger function itself when it fires, and calls made inside
  a SECURITY DEFINER body (they run as the owner). The staging read
  (`q3_reach.json`, `q4_nested.json`) shows that the only function referenced
  from a client-evaluated context is `app_private.is_current_user_active()`.
  Policies that still call the revoked `is_current_user_admin()` /
  `is_current_user_instructor()` are already non-executable for clients and
  are removed by RLSCLEANUP-0039 (migration 344). No view, default, constraint,
  index expression or trigger on a client-writable relation references an app
  function. The two registry entries call no other app function.
- **`CREATE OR REPLACE` keeps the ACL; `DROP` + `CREATE` takes the new
  default** (`probe_a.out` case B). So existing functions are unaffected by
  FR-001, and FR-005 (4) covers the recreate path.
- **Overloads.** Grants are per signature. A new overload of a registry
  function is not callable until the registry gains a row and the migration
  grants it.
- **Other schemas.** The global REVOKE applies to functions the owner creates
  in any schema. A new function in `app_private` (or any non-`public` schema)
  gets `{postgres=X}` only, so `service_role` can no longer call it through
  PUBLIC. Today no `service_role` path depends on that: the only
  `app_private` function is the definer helper, whose ACL is
  `{postgres=X, authenticated=X}`. A future backend RPC outside `public` must
  grant `service_role` explicitly (Q-J364-3).
- **`storage` schema.** `postgres` has its own `storage f {anon, authenticated
  = X}` default. FR-001 does not touch it. App migrations create no function
  there (repo grep: the only non-`public` `CREATE FUNCTION` is
  `app_private.is_current_user_active`). Reported under Q-J364-5.
- **Functions created outside migrations.** Studio and the SQL editor run as
  `postgres`, so FR-001 covers them. FR-005 does not. DRIFT-2 detects them.
- **Extensions.** `CREATE EXTENSION` by `postgres` after `NNN` leaves member
  functions with `NULL` ACL (built-in PUBLIC). Verified with `pg_trgm`.
  FR-003/FR-004 exclude extension members, so a trusted extension keeps
  working.
- **Functions added between this spec and `NNN`.** FR-003 computes its set at
  apply time, so a function added by an intervening migration that a client
  really needs would be revoked. T001 re-runs the `research.md` §2
  cross-check on its base. T002/T003 list the to-be-revoked set read-only
  before applying, and any client need found then becomes a registry row
  first.
- **Pending feature groups.** Production has fewer functions than staging
  (some `pending_feature` migrations are staging-only), so the production set
  is a subset to be listed in T003. If a feature group is applied after `NNN`,
  its functions get the new default. Before such a group is applied, FR-005
  (3)/(4) and the PC-J94 chain test show whether any of its functions needs a
  registry row.
- **PostgREST cache.** Privileges are checked by PostgreSQL at call time. No
  schema-cache reload is required for the change to take effect.
- **DR restore** (verified locally with the flags of
  `restore_into_project.sh`): `pg_dump` writes function ACLs as differences
  from the built-in default (`REVOKE … FROM PUBLIC; GRANT … TO …`). Restoring
  into a project with stock Supabase defaults re-adds anon and authenticated to
  **every** restored function, including ones that had an explicit `REVOKE …
  FROM PUBLIC, anon, authenticated`. The `--schema=public` pre-data restore
  does not bring back `pg_default_acl` rows either. This already affects the
  320 and later definer revokes today. Rollout requires DRIFT-1/DRIFT-2 after
  every restore, plus re-applying `NNN` and 320 (Q-J364-6).
- **Concurrency.** `ALTER DEFAULT PRIVILEGES`, `GRANT` and `REVOKE` take
  catalog locks only. A concurrent `CREATE FUNCTION` in another session uses
  whichever default is committed at its own creation time. FR-004 (c) runs
  last in the same transaction.

## Success criteria

- On staging after `NNN`: DRIFT-2 returns zero rows, and DRIFT-1 returns no row
  for `postgres` (before: 4 `postgres` rows and 2 `supabase_admin` rows; after:
  only the `supabase_admin` built-in PUBLIC rows, which the runner cannot
  change).
- Exactly two `(function, role)` pairs are client-executable in app schemas:
  the registry.
- The flashcard review, Vocabulary write, Speaking session creation, grading,
  admin dashboard and quiz statistics journeys pass on staging with no new
  `permission denied for function` in Railway logs for 24 h.
- CI rejects every FR-005 mutation fixture and passes on the current tree
  above `NNN` (no false positive).

## Open questions

Answers come from Vinh through the Leader. T000 records them verbatim and sets
`status: approved`; no migration ticket before that.

- **Q-J364-1 (global REVOKE).** Approve the global `ALTER DEFAULT PRIVILEGES
  FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` (all schemas)?
  It is the only way to stop new functions being callable through PUBLIC; the
  `IN SCHEMA public` form in the ticket has no effect on anon/authenticated.
  Recommendation: **yes**.
- **Q-J364-2 (residue cleanup, FR-003).** Also revoke client EXECUTE from the
  41 existing staging functions that no client uses (16 service-role RPCs, 1
  uncalled legacy RPC, 24 trigger functions), in the same migration?
  Recommendation: **yes, same migration**. Triggers do not need EXECUTE, and
  `service_role` keeps exactly its current rights (FR-004 (d)). If deferred,
  FR-004 (c)/FR-006 allow-list the 41 signatures until a follow-up.
- **Q-J364-3 (service_role default outside `public`).** Keep `service_role`
  EXECUTE only through the `public` per-schema default (recommended; new
  functions in other schemas need an explicit grant, consistent with
  SVCPRIV-0042's narrowing), or add a global `GRANT EXECUTE ON FUNCTIONS TO
  service_role` so its reach stays as today in every schema?
- **Q-J364-4 (anon on the flashcard RPC).** Remove `anon` from
  `fn_apply_srs_review_idempotent`? The backend always calls it with a learner
  JWT (role `authenticated`), and an anon call can do nothing useful.
  Recommendation: **yes** (FR-002).
- **Q-J364-5 (out-of-reach defaults).** `supabase_admin` function defaults
  (built-in PUBLIC on staging; a `public` row on production per the 320
  header, to confirm read-only in T003) and the `postgres` default in
  `storage` stay as they are. Should they go to a Supabase support request and
  the SVCPRIV-0042 Q-J357-3 list (with SA P3-5), or to a separate ticket?
- **Q-J364-6 (DR restore).** The restore path re-opens client EXECUTE on
  every function (and the 320 table defaults). Open a separate ticket so
  `restore_into_project.sh` / `restore_drill.sh` re-apply the privilege
  migrations and run DRIFT-1/DRIFT-2 automatically? Recommendation: **yes,
  separate ticket**; this spec only adds the manual check to rollout.
