# Release checklist: staging → main

Use a fresh copy of this checklist in each release record. Unchecked means
unverified; N/A needs a reason. Record UTC timestamps, operator, approval link,
full commit SHAs, deployment IDs and check URLs. Vinh is the release approver;
the operator owns execution and evidence.

**Every production step, including reads, smoke tests, rollback and use of a
production backup, is marked “cần anh Vinh duyệt”.** Record explicit approval
for the named environment, SHA, SQL and actions before execution. This document
does not grant production access or authorize a release. Never print tokens,
passwords, connection strings, activation codes, signed URLs or learner data.
Keep credentials in the approved secret store; disable shell tracing and
verbose HTTP logging. Reports contain only sanitized counts/statuses and IDs.

## Sources and release record

This checklist consolidates `/workspace/cc-jobs/promo-1027-plan.md` (2026-10-27,
§§2–8 and Appendices A–E) with the repository sources below. The external plan's
SHAs, ledger expectations, approvals and deployment timings are historical,
not current release evidence. Its Appendix E is an unreviewed rollback draft.
The procedure below is usable without that local file.

- [Staging-first release flow](../STAGING_FIRST_RELEASE_FLOW.md)
- [Agent workflow](../AGENT_WORKFLOW.md)
- [Migration policy and numbering](../../backend/migrations/README.md),
  [forward policy](../../backend/migrations/forward-policy.tsv),
  [runner](../../backend/scripts/apply_migrations.sh) and
  [locked helper](../../backend/scripts/apply_migration_locked.sql)
- [Promotion gate](../../.github/workflows/staging-promotion-gate.yml),
  [live staging smoke](../../.github/workflows/staging-release-smoke.yml) and
  [production drift monitor](../../.github/workflows/production-release-drift.yml)
- [326 migration](../../backend/migrations/326_student_archive.sql),
  [archive research and checks](../../specs/0029-student-archive/research.md),
  [archive rollout](../../specs/0029-student-archive/rollout.md) and
  [deployment rollback ADR](../adr/ADR-007-rollout-rollback.md)

| Field | Required evidence |
| --- | --- |
| Release and window | Release ID, operator, approver, UTC start/end, approval link |
| Frozen source | Full staging SHA `S`, promotion PR URL, reviewed commit/file diff |
| Integration | Exact-`S` staging push workflow/job URLs and deployment provenance |
| Database plan | Ordered pending filenames + SHA-256, feature opt-ins, pre/postconditions, compatibility class, reviewed repair SQL |
| Recovery baseline — cần anh Vinh duyệt | Previous main SHA, actual serving frontend/backend SHAs and deployment IDs, recoverable backup timestamp/ID |
| Outcome — cần anh Vinh duyệt | Resulting main merge SHA `M`, serving SHAs/deployment IDs, migration receipts, smoke results, rollback/deferral decisions |

## 1. Freeze and verify staging

- [ ] Fetch `origin/staging` and `origin/main`; review the complete promotion
  diff and migration dependencies. Normal work reaches `staging` through its
  own PR. Production receives only a PR from repository `staging` to `main`.
- [ ] Agree the freeze window and operator. Pause merges/pushes to `staging`
  through promotion and smoke. Record `S`; if staging moves, stop, review the
  new diff and repeat exact-SHA verification before proceeding.
- [ ] Reconcile staging's ledger with the files at `S` and the forward policy.
  Apply approved pending migrations under the advisory lock before dependent
  staging code, then deploy immediately for coupled changes. Preserve feature
  opt-ins; exclude retired migrations and `032_rollback.sql`. Never baseline
  an existing database to hide drift or infer pending files from the max number.
- [ ] Verify staging frontend and Railway backend both serve `S` and use
  Supabase staging. Use the provenance artifact from the live staging workflow;
  a successful build or a healthy `/health` alone is insufficient.
- [ ] Require successful **push** runs on branch `staging`, with `head_sha = S`,
  for every workflow/job listed in the promotion gate:

  | Workflow | Required jobs |
  | --- | --- |
  | `backend-tests.yml` | Backend (pytest + anchor drift); Frontend (node --test) |
  | `spec-governance.yml` | Spec and PR metadata |
  | `typecheck.yml` | TypeScript strict + legacy JSDoc; api.d.ts ↔ OpenAPI drift |
  | `route-manifest.yml` | Build + verify routes-manifest ownership |
  | `legacy-freeze.yml` | Public không chứa HTML legacy |
  | `staging-release-smoke.yml` | Staging release smoke, including exact frontend/backend provenance |

- [ ] Review the current workflow definitions when using this list. Missing,
  skipped, cancelled or failed jobs block release. PR checks, another SHA and
  a manual-dispatch smoke do not replace the staging push evidence. Rerun an
  infrastructure-only failure only after its cause is resolved; persistent
  failures require a fix through staging, not repeated blind reruns.
- [ ] Verify affected journeys with synthetic staging accounts, including
  immediate state and reload/persisted state. Resolve actionable review findings
  and record local verification before pushing a consolidated patch.
- [ ] **cần anh Vinh duyệt** — Prepare the production recovery baseline and
  per-file migration plan, confirm backup recoverability, previous compatible
  frontend/backend targets and deployment access, and obtain the release go/no-go.

## 2. Production migration and promotion window

- [ ] **cần anh Vinh duyệt** — Open the promotion PR with head `staging`, base
  `main`, frozen head `S`. Require all applicable PR checks and **Staging
  promotion gate** to pass. Recheck the remote staging head immediately before
  the production window and merge. Do not bypass protection or merge a feature
  independently into `main`.
- [ ] **cần anh Vinh duyệt** — Confirm the intended production project against
  the runner's production guard, using a production-authorized Management API
  token supplied securely to the operator. Explicitly select the project ref;
  never infer it from a default CLI project or a staging session.
- [ ] **cần anh Vinh duyệt** — Run reviewed read-only global and per-migration
  preflight queries. Capture ledger filenames, schema/function fingerprints,
  constraints, indexes, grants/RLS, required triggers and aggregate row counts.
  Require no competing migration lock and no transactions older than the
  reviewed limit (60 seconds in the 1027 plan). Unexpected drift, missing
  prerequisites, duplicates or invalid indexes means stop and obtain a reviewed
  decision. Never silently dedupe, repair privileges or terminate a DB session.
- [ ] **cần anh Vinh duyệt** — Compare the exact pending filenames and SHA-256
  hashes with the approved list at `S`. Apply only that list, in reviewed numeric
  and dependency order. Missing earlier-numbered migrations can still be pending;
  the 1027 batch of 323–326 is not a permanent allowlist. A deferred migration
  needs an explicit compatibility decision and release-record entry.
- [ ] **cần anh Vinh duyệt** — Apply each ordinary pre-code migration through
  the locked runner, or its reviewed Management API equivalent below. Verify its
  schema/data postconditions and ledger receipt before moving to the next file.
  The shell runner processes the entire eligible pending queue; use per-file
  requests if that queue exceeds the approved batch or would apply 326 early.
  Honor migration-specific post-deploy activation steps; they do not belong in
  the pre-code batch. See, for example, the migration guide's 308 activation rule.
- [ ] **cần anh Vinh duyệt** — For a backend-coupled migration, execute the
  approved apply-and-deploy window below. Otherwise, after schema verification,
  merge the promotion PR with a merge commit and record resulting main SHA `M`.
  Vercel and Railway must deploy from `main`; `M` may differ from `S` because
  of the promotion merge commit.

### Management API equivalent of the advisory-locked runner

This is a request contract for reviewed operator SQL, not a new migration runner.
The psql helper contains backslash commands; its text cannot be sent directly
to the HTTP endpoint. Preserve the migration's transaction boundaries.

- [ ] **cần anh Vinh duyệt** — Prepare SQL locally from the frozen files, then
  send each reviewed request to
  `POST https://api.supabase.com/v1/projects/<approved-project-ref>/database/query`
  with JSON `{"query": "<reviewed SQL>"}` and a securely supplied bearer token.
  Do not paste credentials or raw responses into the PR.
- [ ] **cần anh Vinh duyệt** — For an ordinary file, keep these operations in
  one request/connection: acquire session lock `pg_advisory_lock(173204, 1)`;
  recheck that exact filename in `public._schema_migrations` under the lock;
  stop/skip if already applied; execute the reviewed file body; insert its
  filename into the ledger only after success; release with
  `pg_advisory_unlock(173204, 1)`. The final SELECT must return unlock status
  and the filename's `applied_at`. Require `migration_lock_released = true`
  and a non-null ledger timestamp. Rechecking only before the lock is unsafe.
- [ ] **cần anh Vinh duyệt** — After success **or failure**, use a separate
  read-only query to verify no lock remains in `pg_locks` for
  `locktype = 'advisory' AND classid = 173204 AND objid = 1`. The staging-tested
  API returns only the last result set; combine preflight fields into one final
  SELECT. An SQL error skips later statements, including explicit unlock, so
  never assume cleanup happened. A retained lock blocks further work; session
  termination requires a separate reviewed approval.
- [ ] **cần anh Vinh duyệt** — On error, timeout or a missing receipt, stop and
  reconcile schema, ledger and lock state before retrying. A file with its own
  COMMIT or nontransactional DDL may have changed schema before a later failure;
  do not claim the whole request rolled back. Never replay blindly or add a
  ledger row merely to make an uncertain run appear successful.

### Concurrent-index exception: migration 325 style

`CREATE INDEX CONCURRENTLY` needs a standalone request. A Management API
session lock cannot be assumed to survive across HTTP requests. This is an
explicit deviation from the persistent-connection runner, requiring an exclusive
operator window and no other runner. The
[325 research](../../specs/0028-access-code-unique-canonical/research.md)
defines the preconditions; no data cleanup is implicit in this checklist.

- [ ] **cần anh Vinh duyệt** — Record whether `access_codes_code_key` already
  exists and is valid. Send a locked ledger recheck + full data precheck + unlock.
  Any duplicate/noncanonical/empty-code count above zero blocks 325. Deduping
  requires a separate reviewed dry-run-first plan; defer 325 only if explicitly
  approved as compatible with the release.
- [ ] **cần anh Vinh duyệt** — Send only the file's `CREATE UNIQUE INDEX
  CONCURRENTLY ...` statement as the second request, without BEGIN/COMMIT or
  lock statements. This phase is not protected by the session advisory lock;
  retain the exclusive window and check for competing work.
- [ ] **cần anh Vinh duyệt** — In the third request, reacquire the same lock,
  recheck the ledger, execute the complete file except the concurrent-index
  statement (including the repeated data precheck, invalid-index refusal,
  constraint attachment, CHECK validation and postconditions), then ledger and
  unlock. Verify the final index is valid/unique and the canonical CHECK holds.
  A failed build requires reviewed cleanup; never drop an index/constraint that
  predates this migration. An intermediate index is not proof of completion.

### Backend-coupled window: migration 326 style

326 adds archive columns rejected by the old backend's student-list model
(`extra="forbid"`), so old `GET /admin/students` can return 500 after apply.
The new backend requires those columns for `/auth/activate`; deploying it first
breaks learner activation. The safe order is **apply, then deploy immediately**.

- [ ] **cần anh Vinh duyệt** — Before applying, have the promotion gate green,
  release operator ready to merge, both deployment paths ready, and reviewed
  repair SQL available. Announce the admin student-operation freeze (adds,
  deletes, archive/restore); record its expected brief admin-list interruption.
  Verify prerequisites such as migration 320's enabled guard, function-body
  fingerprints and unchanged baseline counts. Do not apply and leave for later.
- [ ] **cần anh Vinh duyệt** — Give one explicit go for **apply 326 → verify
  the receipt/critical postconditions → merge immediately**, within the same
  minute as targeted by the 1027 plan. Keep the frontend/backend deployment
  watch active. Do not insert unrelated migrations or documentation commits
  between apply and merge. If apply fails, do not merge; reconcile state first.
- [ ] **cần anh Vinh duyệt** — Verify the new Railway backend and Vercel release
  promptly. If the backend cannot serve `M` within the approved deadline
  (10 minutes was the 1027 plan's escalation threshold), keep the admin freeze
  and use the rollback decision below. A queued deployment is not recovery.

## 3. Post-deploy smoke and release closure

- [ ] **cần anh Vinh duyệt** — Check the production frontend's
  `/js/runtime-config.js` release marker equals `M`. Check Railway's deployment
  metadata and authorized admin `/health/runtime` provenance for backend SHA
  `M`, branch/environment `main`/production, plus healthy `/health`. Check
  frontend API/Supabase targets belong to production. Do not print the full
  runtime config or health payload; retain only approved provenance fields.
- [ ] **cần anh Vinh duyệt** — Run post-migration checks: exact ledger receipts,
  no leftover migration lock, valid constraints/indexes, expected function
  fingerprints and grants/RLS, and unchanged learner-evidence counts where no
  row changes were intended. For 326, verify archive columns/audit table exist,
  audit RLS is enabled and archive/restore RPCs remain service-role-only.
- [ ] **cần anh Vinh duyệt** — With named synthetic or Vinh-designated accounts,
  verify login/refresh, role-appropriate dashboard and an affected learner journey.
  For grading/persistence releases, submit the designated test attempt, then
  compare result, session summary and history after reload. Paid provider calls
  and account mutations must be included in the approval; reuse existing
  persisted test results if only a read check was authorized.
- [ ] **cần anh Vinh duyệt** — For 0029, verify admin student list returns 200;
  archive returns 204 with learner work preserved and the learner hidden;
  while archived, the learner cannot enter Writing, activate a code or regain
  membership; then restore returns 200 and the UI/reload agrees with persisted
  state. Test only the named learner; preserve the append-only audit history.
  For other release changes, use the applicable spec's acceptance checks (for example,
  role update 200, draft-protected assignment deletion 409, code mint 201).
- [ ] **cần anh Vinh duyệt** — Verify `/docs`, `/redoc`, `/openapi.json` remain
  404 with API docs disabled; inspect sanitized logs for unexpected 5xx on
  `/auth/activate`, `/admin/students`, grading and affected routes. Check private
  recording playback still requires authorization; never make its bucket public.
- [ ] **cần anh Vinh duyệt** — Require the **Production release drift** check
  against current main, plus affected journey evidence on `M`. If a new main
  release appears, stop attributing its result to this release. Record historical
  failures separately from current failures. Close the release and lift the
  admin/staging freeze only after the required checks pass; record pending
  acceptance honestly. Add durable spec/evidence updates through a later staging PR.

## 4. Rollback and compensating migration policy

- [ ] **cần anh Vinh duyệt** — Declare the incident, freeze new release actions
  and affected writes, record the serving frontend/backend SHAs, and select a
  recovery build compatible with the **current** schema and persisted data.
  Prefer a focused forward repair through staging when an old build is unsafe.
  Frontend and backend can roll back separately only after contract verification.
- [ ] **cần anh Vinh duyệt** — For a compatible frontend target, use Vercel
  Deployments → selected previous production deployment → **Instant Rollback**;
  alternatively redeploy the reviewed previous commit/configuration and promote
  that deployment. Verify the selected ID, domains and serving release marker.
  Neither option restores database state. See
  [Vercel's rollback procedure](https://vercel.com/docs/instant-rollback).
- [ ] **cần anh Vinh duyệt** — For a compatible backend target, use Railway's
  production service → Deployments → selected previous successful deployment →
  **Rollback** or **Redeploy**. Confirm the selected source SHA and configuration,
  including variables without revealing their values; wait for it to become
  healthy and verify serving provenance. A restart of the current container does
  not select old code. Retention can limit rollback availability; see
  [Railway deployment actions](https://docs.railway.com/deployments/deployment-actions).
- [ ] **cần anh Vinh duyệt** — Before any 326-related rollback, read both
  archived-learner count and lifecycle-audit count. Earlier text suggesting a
  plain revert with zero archived learners is incomplete: the old backend also
  rejects the new columns, and an archive followed by restore leaves audit rows.
  Apply the following decision table; review the entire recovery pair first.

  | State | Permitted recovery — all rows cần anh Vinh duyệt |
  | --- | --- |
  | Compatible migrations such as 323–325 applied; release aborted before 326 | Leave them in place unless a concrete defect requires a reviewed compensating change. |
  | 326 apply failed or outcome uncertain | Do not merge/deploy dependent code; reconcile schema/ledger/lock before choosing recovery. |
  | 326 applied; deployment stuck | First recover the new Railway build. A schema reversal is an option only when both guarded counts below are zero. |
  | Zero archived learners **and** zero audit rows | A reviewed compensating migration may restore the exact pre-326 membership function bodies/grants and remove 326 objects, then immediately redeploy the compatible old backend/UI. Freeze affected operations across the pair; never leave the new backend serving the removed schema. |
  | Any archived learner **or** any audit row | Do not drop archive columns/audit or deploy the pre-0029 backend. Ship an archive-compatible forward repair retaining archive semantics, Writing/activation refusals and membership guards, or escalate to Vinh. Restoring learners does not empty the audit. |

- [ ] **cần anh Vinh duyệt** — Treat migration “down” SQL as a reviewed,
  guarded **new forward compensating migration**, with the next available
  unreserved number from the current migration guide. Rehearse on an isolated
  copy, define lost capabilities/data and pre/postconditions, apply under the
  same advisory lock and append its own ledger row. Never edit an applied file,
  delete a ledger row, run `032_rollback.sql` as a generic undo, clear audit rows
  or broadly restore revoked privileges. The external Appendix E is not approved
  executable rollback SQL. A whole-DB restore is a separate disaster-recovery
  decision with explicit downtime and accepted data loss, not routine rollback.
- [ ] **cần anh Vinh duyệt** — Repeat health, provenance and affected journey
  smoke against the selected recovery SHAs. Record intentional drift from `main`
  as an incident, not a green release. Repair Git through staging → main;
  do not reset protected branches. After a verified repair is ready, use Vercel
  **Undo Rollback**/promote to re-enable automatic production-domain assignment
  and verify drift clears; another Instant Rollback is not the undo operation.

## 5. Monthly Supabase backup and restore verification

Owner: Vinh; execution: approved operator, during the first week of each month.
Monthly verification supplements the configured backup schedule; it does not
replace daily backups/PITR. Actual plan, retention and recovery availability
must be checked. Database backups omit Storage file bytes; those need a separate
recoverable copy. See [Supabase database backups](https://supabase.com/docs/guides/platform/backups).

- [ ] **cần anh Vinh duyệt** — Open the monthly drill record with operator,
  approved budget, data handling/retention, recovery-point objective (RPO: maximum
  accepted data loss) and recovery-time objective (RTO: time to verified recovery).
  Confirm source project and a disposable, access-restricted target distinct
  from production and shared staging. Do not restore over either live database.
- [ ] **cần anh Vinh duyệt** — In Supabase Database → Backups, verify recent
  successful backups or the actual PITR recoverable range, retention, and any
  failures/gaps. Select a timestamp/backup ID; record its age and whether it meets
  the approved RPO. Record the separate Storage backup's timestamp, inventory
  and consistency with that point. Missing/stale/unrecoverable backups fail the
  check and need an owner decision, not an assumed pass.
- [ ] **cần anh Vinh duyệt** — Choose a supported restore method: **Restore to
  a New Project** when the source's plan and physical backups support it, or a
  separately verified logical export restored into the disposable Supabase
  project using the official
  [backup/restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
  Verify logical coverage of roles, schema/data, auth records, custom auth/storage
  policies/triggers and `public._schema_migrations`; a public-only dump is not a
  full application recovery. Store export files encrypted outside Git and check
  their hashes. Never assume a physical backup is downloadable as SQL.
- [ ] **cần anh Vinh duyệt** — Review restored external side effects **before**
  starting: cron jobs, webhooks, network extensions, queues, email and paid AI.
  A physical clone can start copied extension jobs immediately and cannot omit
  them; use a reviewed containment method or an inspected logical restore that
  disables them before execution if isolation cannot be guaranteed. Keep the
  drill application disconnected until its targets/settings are checked. See
  [Supabase restore-to-new-project limitations](https://supabase.com/docs/guides/platform/clone-project).
- [ ] **cần anh Vinh duyệt** — Restore the chosen backup, measure elapsed time
  and check errors. Restore required Storage files separately into private drill
  buckets, then reconcile metadata/path, object counts and sampled content hashes.
  Configure drill-only Auth/API credentials, redirects and required settings;
  database recovery alone does not recreate the whole Supabase service setup.
  Production domains, clients and jobs must continue targeting production.
- [ ] **cần anh Vinh duyệt** — On the isolated target, compare schema, ledger,
  representative table counts and integrity checks with the baseline for the
  **selected backup point**, not today's changing production database. Verify
  session/result/history consistency, Writing drafts, assignment weights,
  access-code redemption history, archive/audit evidence and FK/orphan checks.
  Verify RLS/grants and service-only RPC restrictions; authenticate only a
  designated test user and check authorized private recording playback plus
  refusal for another user. Preserve learner privacy in all evidence.
- [ ] **cần anh Vinh duyệt** — Record PASS/FAIL with backup ID/time, target ID,
  sanitized integrity/Storage results, measured RPO/RTO versus approved targets,
  gaps, owner and next drill date. An available backup without a successful
  restore is not verified recovery. Missing coverage or failed checks keeps
  the drill open; no production failover follows automatically.
- [ ] **cần anh Vinh duyệt** — Remove the disposable project and sensitive
  temporary exports under the approved retention decision after evidence is
  retained securely. Preserve production and the required backup copies. An
  in-place production restore/failover requires its own approval, write freeze,
  accepted data-loss window and complete post-restore smoke.
