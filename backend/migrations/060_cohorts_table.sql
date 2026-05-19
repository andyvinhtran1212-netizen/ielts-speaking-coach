-- Migration: 060_cohorts_table.sql
-- Sprint 12.2 — DEBT-ADMIN-IA-REFACTOR execution 2/8.
--
-- Cohort schema: groups students for direct-teaching workflows. A
-- student belongs to AT MOST one cohort (NULL = mass-code flow per
-- Andy's "code đại trà"). Cohort UI for management is deferred to
-- Phase B per Sprint 12.0 Discovery pre-lock; Sprint 12.2 ships only
-- the schema + stub CRUD endpoints so the access-codes UI can wire a
-- cohort picker dropdown without a backend gap.
--
-- Idempotent: re-running is a no-op (IF NOT EXISTS everywhere).

CREATE TABLE IF NOT EXISTS cohorts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    code_prefix   TEXT,
    description   TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cohorts_is_active
    ON cohorts (is_active) WHERE is_active = TRUE;

ALTER TABLE students
    ADD COLUMN IF NOT EXISTS cohort_id UUID
    REFERENCES cohorts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_students_cohort_id ON students(cohort_id);

ALTER TABLE cohorts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read all cohorts" ON cohorts;
CREATE POLICY "Admins read all cohorts" ON cohorts
    FOR SELECT USING (is_current_user_admin());

DROP POLICY IF EXISTS "Admins manage cohorts" ON cohorts;
CREATE POLICY "Admins manage cohorts" ON cohorts
    FOR ALL USING (is_current_user_admin());

COMMENT ON TABLE cohorts IS
    'Sprint 12.2 — direct-teaching cohort groups. NULL students.cohort_id '
    'means the student joined via a mass code (Andy "code đại trà"); '
    'NOT NULL means they belong to a teaching cohort. Soft-archive via '
    'is_active=false (no hard delete — students survive cohort archive '
    'because the FK is ON DELETE SET NULL).';

COMMENT ON COLUMN students.cohort_id IS
    'NULL = mass code flow (Andy "code đại trà"); NOT NULL = direct '
    'teaching cohort. UI for cohort management deferred to Phase B per '
    'Sprint 12.0 Discovery.';
