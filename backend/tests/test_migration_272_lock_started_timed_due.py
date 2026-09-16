from pathlib import Path


SQL = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "272_lock_started_timed_course_due.sql"
).read_text(encoding="utf-8")


def test_migration_persists_the_first_timed_start_on_the_assignment_row():
    assert "ADD COLUMN IF NOT EXISTS timed_started_at TIMESTAMPTZ" in SQL
    assert "AFTER UPDATE OF opened_at ON public.class_assignment_items" in SQL
    assert "OLD.opened_at IS NULL AND NEW.opened_at IS NOT NULL" in SQL
    assert "SET timed_started_at = CASE" in SQL
    assert "content_config ? 'time_limit_minutes'" in SQL


def test_migration_blocks_due_mutation_from_the_same_locked_row():
    assert "BEFORE UPDATE OF due_at ON public.class_assignments" in SQL
    assert "NEW.due_at IS DISTINCT FROM OLD.due_at" in SQL
    assert "OLD.timed_started_at IS NOT NULL" in SQL
    assert "timed_course_due_locked_after_start" in SQL
    assert "ERRCODE = '55000'" in SQL


def test_existing_started_timed_assignments_are_backfilled_before_the_guard():
    backfill = SQL.index("UPDATE public.class_assignments AS ca")
    guard = SQL.index("CREATE OR REPLACE FUNCTION public.guard_started_timed_course_due_change")
    assert backfill < guard
    assert "MIN(cai.opened_at) AS first_opened_at" in SQL
    assert "ca.timed_started_at IS NULL" in SQL
