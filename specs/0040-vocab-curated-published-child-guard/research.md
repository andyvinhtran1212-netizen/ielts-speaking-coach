# Research

## Current guard behaviour

- `backend/migrations/234_vocab_curated_identity_and_editorial.sql:186-217`
  `fn_guard_published_vocab_review()` and
  `backend/migrations/235_vocab_curated_tasks_attempts_mastery.sql:81-112`
  `fn_guard_published_vocab_task()` pick one version id: `OLD.version_id` on
  DELETE, otherwise `NEW.version_id`. On UPDATE the current (old) version is
  never read, so `UPDATE … SET version_id = <draft>` on a child of a published
  version passes.
- The migrations date from #1327 (2026-08-27), before spec governance; no
  existing spec covers curated vocabulary 234–238
  (`git grep "vocab_curated|vocab_unit|23[4-8]_vocab" specs/` only finds
  `general/UI-IMPROVEMENTS.md:523`, not an FR).

## Discovery

- PC-J260 PostgreSQL test (`backend/tests/test_vocab_curated_postgres.py`,
  commit `2c8d28a7a`, branch `codex/pc-j260-curated-vocab-pg`, not yet on
  `staging`) case
  `test_published_children_cannot_be_moved_to_draft_version` exposes the
  bypass for both tables.
- No sign that the bypass has been used; the read-only staging check is in the
  PC-J267 ticket.

## Governance

- Migration 355 is a high-risk path (`backend/scripts/validate_specs.py`
  `HIGH_RISK_PATH_RE`), so the implementation PR needs an approved FR on its
  merge base whose text matches exactly; this spec provides FR-001.
