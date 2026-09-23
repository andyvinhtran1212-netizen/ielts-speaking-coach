# Rollout and rollback

## Preconditions

- Approved spec is merged to `staging` before any implementation commit in the
  release branch.
- Affected local backend, contract, browser, TypeScript, and build suites pass.
- Migrations 297–299 remain additive and compatible with currently deployed code.
- The legacy exam-content and Writing array routes stay unchanged; new page
  routes do not collide with parameterized legacy paths. Deployment-order tests
  cover old frontend/new backend and new frontend/old backend fallback behavior.
- Staging and production service roles exist; neither routine is executable by
  public, anon, or authenticated roles.
- Both `SECURITY DEFINER` routines have fixed `pg_catalog, public` search paths and
  schema-qualified relations/built-ins; Security Advisor reports no mutable
  search-path finding.

## Staging

- Dry-run and then apply migrations 297–299 with the advisory-locked repository runner.
- Re-run the runner to prove ledger/idempotent behavior; inspect both routines'
  owners, ACLs, `pg_proc.proconfig`, schema-qualified bodies and indexes. Check
  Writing exact total/order/zero-result and Review eligibility against direct
  sitting/review rows, including open actionable, archived actionable, and
  released-only exams.
- Verify a forced content-source failure marks its subtotal incomplete, and a
  forced page-route 404 activates the visible legacy compatibility warning.
  The content fallback must preserve `kind`, `course_level`, `cohort_id`,
  `exam_only`, and `is_public`, then apply `q` plus attention before local
  paging, including a matching record beyond page 1. Both paths must search
  ID, code, title, and course level with trimmed, 100-character, case-insensitive
  literal matching, including `%`, `_`, and punctuation. A level appearing only
  beyond the first content page must be offered in the
  selector; a failed level scan must name its source and mark `levels_complete`
  false independently of the exact content total. With Writing `q` and
  overdue active together, every fallback row must satisfy both predicates
  using literal query matching and the earliest non-null assignment deadline,
  while the total remains explicitly incomplete.
- Verify tied Writing timestamps sort by `id DESC` after shuffled enrichment,
  with stable adjacent pages. Force a Writing page-route 404 beyond the bounded
  legacy snapshot and confirm the requested offset remains in the URL; verify
  an exact complete total still corrects an invalid page.
- Merge the implementation PR to `staging`, record its exact SHA, require
  integrated CI and live Staging E2E on that SHA, then exercise Manage/Create/
  Content, Live empty/open, Review sequential-actionable versus released-only/open-retake/
  archived-actionable/empty/
  old-backend-unknown/explicit-link,
  and Writing page-2 save-return journeys.

## Production

- Confirm `staging` has not moved since the green exact-SHA evidence.
- Dry-run and apply migrations 297–299 with `ALLOW_PROD=1` through the
  advisory-locked runner before dependent code promotion. Verify the retake
  eligibility routine's owner, service-role-only ACL, fixed search path, and
  representative actionable/archived-actionable/released-only results in production.
- Open only the `staging` to `main` promotion PR, require the Staging promotion
  gate, merge without diverging feature commits, and verify deployed backend and
  frontend revisions equal the promoted SHA.
- Smoke the admin Mock Test landing, Review retake selection, bounded
  content-bank query, and a read-only Writing queue filter without mutating
  exam or grading state.

## Rollback and repair

- Revert application code to the previous production SHA if a UI or service
  regression occurs; both additive routines/indexes may remain safely installed.
- Do not drop either routine or index in the same rollback. A later migration may
  remove them only after every deployed caller is absent.
- If routine results disagree with direct canonical queries, block promotion,
  capture filter parameters plus ordered IDs/counts, fix the routine, rerun
  reconciliation, and only then resume.
- No data rewrite is part of this change; repair must not alter essay status,
  grading results, cohort membership, or exam lifecycle truth.

## Observability

- Monitor backend 4xx/5xx and latency for exam list, exam-content, and Writing queue routes,
  PostgreSQL routine errors, Vercel page errors, and Railway health after each
  environment deployment.
- Treat a count/page mismatch, unauthorized routine execution, missing filtered
  record, repeated stale-readback warning, or failed live E2E as a release block.
- Release owner: product/engineering operator performing the staging-first
  promotion and exact-SHA verification.
