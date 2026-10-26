# Rollout and rollback

## Preconditions

This spec is approved by the owner and present on staging. #1692 cites it as
`high-risk` and is green. The migration number is reconciled with in-flight
migrations (#1699 proposes 320; 319 must remain unique and ordered). No other
session is moving `fn_approve_web_explanation_paper`. Binding further papers
needs a separate owner approval per paper.

## Staging

1. Apply migration 319 with the advisory-locked runner
   (`backend/scripts/apply_migrations.sh` / `apply_migration_locked.sql`).
2. Verify the three reason codes on staging QA copies and an unchanged success
   path (approval of an already-bound paper returns the same result as before).
3. Merge #1692; confirm integrated staging CI and release smoke on the exact SHA.

## Production

1. Apply migration 319 to production with the locked runner immediately before
   promotion; confirm the function body and grants.
2. Promote staging to main through the exact-SHA gate.
3. Bind a REV paper only on owner request: dry run, owner reviews the changed
   questions, staging rehearsal on a QA copy, production commit with the
   reviewed plan SHA, read-back, then the give.

## Rollback and repair

- Function: re-apply the migration 260 body through the locked runner; callers
  keep working because the error prefix is unchanged.
- Binding: if a bound revision has no give or attempt referencing it, set its
  rows `is_current = false` after owner approval. Rows already used by a give or
  attempt stay; fix forward with a reviewed new binding. Never delete source
  rows or rewrite learner history.

## Observability

- Admin and API errors carry the reason code; the class-give message names it.
- Each binding prints the plan SHA, import batch id and read-back counts,
  recorded in the PR or task log.
- Production release drift and staging release smoke stay green after each step.
