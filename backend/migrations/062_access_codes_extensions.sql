-- Migration: 062_access_codes_extensions.sql
-- Sprint 12.2 — DEBT-ADMIN-IA-REFACTOR execution 2/8.
--
-- Extends the existing access_codes table (Migration 009 origin) with
-- three new columns required by the carved-out access codes admin
-- surface:
--   - code_type:  mass | direct | staff (discriminator for Andy's
--                 "code đại trà vs học viên trực tiếp" requirement).
--   - cohort_id:  FK to cohorts (Migration 060) — required for direct
--                 codes, NULL for mass and staff.
--   - notes:      free-text admin note (e.g. "Lớp 2026.05 evening").
--
-- IMPORTANT: existing rows automatically get code_type='mass' via the
-- DEFAULT. The 16-column original table is preserved verbatim — this
-- is an EXTEND not REPLACE migration per Sprint 12.0 Discovery §6.3.
--
-- Idempotent: re-running is a no-op (IF NOT EXISTS everywhere).

ALTER TABLE access_codes
    ADD COLUMN IF NOT EXISTS code_type TEXT NOT NULL DEFAULT 'mass'
        CHECK (code_type IN ('mass', 'direct', 'staff')),
    ADD COLUMN IF NOT EXISTS cohort_id UUID REFERENCES cohorts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_access_codes_cohort_id
    ON access_codes (cohort_id) WHERE cohort_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_access_codes_code_type
    ON access_codes (code_type);

COMMENT ON COLUMN access_codes.code_type IS
    'Sprint 12.2 — mass = bulk/public code | direct = direct-teaching '
    'student | staff = admin/instructor access. Discriminates Andy '
    '"code đại trà vs học viên trực tiếp". Validation: direct codes '
    'require cohort_id non-null (server-side 422 enforcement in admin.py).';

COMMENT ON COLUMN access_codes.cohort_id IS
    'Sprint 12.2 — FK to cohorts.id. Required when code_type=''direct''. '
    'NULL for mass and staff codes. ON DELETE SET NULL so cohort archive '
    'or hard-delete does not cascade-delete the access code row.';

COMMENT ON COLUMN access_codes.notes IS
    'Sprint 12.2 — free-text admin note. No length cap (TEXT). Visible '
    'only in admin UI; never surfaced to end users.';
