---
id: WRITINGRATE-0025
title: Repair writing_grade_ratings drift so admin grade ratings key on the graded run
status: implementing
risk: high
owner: product
---

# Repair writing_grade_ratings drift so admin grade ratings key on the graded run

Approval: approved by Vinh on 2026-10-27 07:14 (UTC+7) (see
[`approval-decision.md`](approval-decision.md)). Locked migration number:
**321** (`321_writing_grade_ratings_feedback_version.sql`, PR #1727).
Implementation PR #1727 cites `WRITINGRATE-0025` as `high-risk` and merges
only after this approval is on `staging`.

## Problem

On staging, the admin Writing grade-quality rating fails with
`42703: column writing_grade_ratings.feedback_version does not exist`.
`essay_service.get_grade_rating` filters with `.eq("feedback_version", …)`.
`upsert_grade_rating` upserts with `on_conflict="essay_id,feedback_version"`.
Neither works against the hosted table.

The cause is schema drift from an early draft of migration 116 (commit
`df4fce621`). That draft created `writing_grade_ratings` with one rating per
essay: no `feedback_version` column, and `UNIQUE (essay_id)` (auto-named
`writing_grade_ratings_essay_id_key`). 116 was later revised to
`feedback_version int NOT NULL` + `UNIQUE (essay_id, feedback_version)`. But
116 uses `CREATE TABLE IF NOT EXISTS` and is already recorded in both
`_schema_migrations` ledgers. Re-running it is a no-op, so the revision can
never reach the hosted databases.

Read-only checks on 2026-10-26 (recorded on #1727) found the draft shape on
**both** staging and production, with **0 rows** in each. Both ledgers list
`116_writing_grade_ratings.sql`.

## Scope

- One forward migration, numbered 321 and owned by PR #1727, that converges
  either the drifted shape or the revised 116 shape to the revised 116 shape.
- Staging-first application with the advisory-locked runner, then production
  at release.

## Non-goals

- Any edit to migration 116 or the ledgers.
- Any change to `essay_service`, the admin router, the frontend or other UI;
  the existing code already targets the revised shape.
- RLS, policy or grant changes on `writing_grade_ratings` (it stays
  backend-only through service_role; migration 320 grants are respected).
- Re-applying 116 or dropping or recreating the table.
- Changing any other Writing table.
- Numbering for other in-flight migrations. Draft #1720 (AIOPS-0024) has
  renumbered its file to 322; 321 stays with #1727.

## Users and journeys

- Admin rating a Writing grade's quality: the rating saves, and it reloads for
  the graded run it was given on. A regraded essay can hold a separate rating
  for each run.
- Operator applying migrations: runs 321 with the locked runner, checks the
  shape with read-only queries, and can re-run it safely.

## Requirements

- **FR-001:** Migration 321 adds `writing_grade_ratings.feedback_version` as `int` (`ADD COLUMN IF NOT EXISTS`) when it is missing.
- **FR-002:** Migration 321 backfills every NULL `feedback_version` from the rated essay's `writing_essays.current_version`, using `COALESCE(…, 1)` only as a defensive floor. Each legacy rating therefore stays attached to the run the admin saw it next to.
- **FR-003:** After the backfill, migration 321 sets `feedback_version` `NOT NULL`.
- **FR-004:** Migration 321 drops every single-column `UNIQUE (essay_id)` constraint, by the name `writing_grade_ratings_essay_id_key` and by definition in `pg_constraint`. It adds `writing_grade_ratings_essay_id_feedback_version_key UNIQUE (essay_id, feedback_version)` unless a unique or primary-key constraint on exactly those two columns already exists. An existing equivalent constraint is reused, not duplicated.
- **FR-005:** Migration 321 is idempotent. Re-applying it changes nothing, and on a database where 116 already created the revised shape it leaves the table unchanged.
- **FR-006:** Migration 321 runs in one transaction. A postcondition aborts and rolls back everything, leaving no ledger row, unless all of these hold: `feedback_version` exists, is `integer` and is `NOT NULL`; no unique index on exactly `(essay_id)` survives; and the composite unique exists.
- **FR-007:** Migration 321 does not change RLS, policies or grants, and does not create, drop, truncate or delete from any table. No service, router or UI change accompanies it.
- **FR-008:** After 321, the service-style upsert `ON CONFLICT (essay_id, feedback_version)` re-rates the same run in place and accepts a separate rating for a later run of the same essay. Before 321, the drifted shape raises 42703.
- **FR-009:** 321 is applied to staging first with the advisory-locked runner and verified with read-only shape queries plus one admin rating round trip on staging. Only then is it applied to production with the locked runner at release, before or with the staging → main promotion.

## Acceptance scenarios

### Scenario 1 — drifted hosted table

- **Given** the draft-116 shape (no `feedback_version`, `UNIQUE (essay_id)`)
- **When** migration 321 is applied, and applied again
- **Then** `feedback_version` is `integer NOT NULL`, the only unique constraint
  is `writing_grade_ratings_essay_id_feedback_version_key UNIQUE (essay_id,
  feedback_version)`, RLS stays enabled, and the second run changes nothing

### Scenario 2 — admin rating after repair

- **Given** a graded essay on staging after 321
- **When** an admin rates the grade and reloads the admin grade page
- **Then** the stars persist and the backend logs show no 42703

### Scenario 3 — fresh database

- **Given** a database built from the current migration 116
- **When** migration 321 is applied
- **Then** the table shape is unchanged

### Scenario 4 — unexpected residue

- **Given** a standalone unique index on `(essay_id)` that 321 does not drop
- **When** migration 321 is applied
- **Then** the postcondition raises `writing_grade_ratings_single_essay_unique_survives`
  and the whole transaction rolls back

## Edge cases

- Legacy rows exist at apply time (0 today): each takes its essay's
  `current_version`. The draft `UNIQUE (essay_id)` allows at most one legacy
  row per essay, so the backfill cannot collide with the composite key.
- `UNIQUE (essay_id)` under a non-default name is dropped by definition.
- An equivalent composite under another name or column order is reused.
- Concurrent migration runs are serialized by the advisory-locked runner.

## Success criteria

- Staging and production `writing_grade_ratings` match the revised 116 shape.
  The read-only queries in [rollout.md](rollout.md) confirm it.
- An admin rating on staging persists across reload with no 42703.
- #1727's migration tests pass on PostgreSQL 16 (CI) and 17 (hosted major).

## Open questions

- None. Owner approval is recorded in [`approval-decision.md`](approval-decision.md).
