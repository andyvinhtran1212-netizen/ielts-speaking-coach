---
name: db-migrate
description: Author an Aver Learning Supabase forward migration with schema, access-control, retention and staging rollout verification.
---

Read `AGENTS.md`, `backend/migrations/README.md`,
`backend/migrations/forward-policy.tsv` and the relevant existing schema.

- Schema changes are high-risk under `specs/README.md`; use the approved spec.
- Choose the next numeric prefix above the actual maximum. Preserve intentional
  gaps/suffixes; `032_rollback.sql` is not a forward migration. Do not rely on
  a cached “next number” in a document.
- Never edit an already applied migration to change hosted behavior. Add a
  forward correction and keep N-1 application compatibility during rollout.
- Inspect FK deletion behavior and immutable learner evidence before choosing
  CASCADE, SET NULL or RESTRICT. Use `gen_random_uuid()` for new UUID defaults
  and timezone-aware timestamps where appropriate.
- Plan indexes for actual query paths. Idempotent DDL alone does not make data
  rewrites safe to replay; account for the ledger and durable postconditions.
- Set table grants/RLS for intended access. Backend-only tables may deny all
  anon/authenticated operations. Client UPDATE policies need both visibility
  and new-row checks. Pin function `search_path`, privileges and security mode.
- Verify against an isolated test database and staging as required; document
  target, migration filename, postconditions, data retention and repair path.
  Do not execute a database mutation merely because this skill was invoked.
- Apply authorized forward changes with `backend/scripts/apply_migrations.sh`
  and its advisory lock/forward policy. Use the target-specific dry-run first.
  It may create the ledger table; it is not a universally read-only inspection.
  Do not baseline to hide drift or replay the directory manually.
- Follow `docs/STAGING_FIRST_RELEASE_FLOW.md`: staging schema before staging
  verification, production schema before dependent code promotion.
