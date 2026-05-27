-- Migration: 082_writing_tips.sql
-- Sprint 19.1B — Writing-Coach tips library (Cluster 19.x, Direction A).
--
-- Admin-authored, grammar-wiki-style writing tips that students browse
-- in the "Mẹo viết" tab on the writing dashboard. Markdown body is the
-- single source of truth (rendered + sanitized client-side, Pattern #39).
--
-- task_type uses a tips-specific 3-value enum {task_1, task_2, both} —
-- deliberately simpler than the prompts/essays {task1_academic,
-- task1_general, task2} model (Pattern #42 — Code authoritative): tips
-- are higher-level guidance and need a "both" bucket, and the 3 values
-- map 1:1 to the user-side filter chips (Task 1 / Task 2 / Cả hai).
--
-- UUID PK + created_by UUID FK match every other writing table (033/035/
-- 036) — the commission's SERIAL/TEXT suggestion was corrected to keep
-- the schema consistent.
--
-- Reuses the shared update_updated_at_column() trigger function from
-- migration 033 — no duplicate function declared here.

CREATE TABLE IF NOT EXISTS writing_tips (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    title         TEXT NOT NULL,
    -- Auto-generated from title by the admin router; admin may override.
    -- UNIQUE — collisions surface a 409 in the API (no auto-resolution,
    -- per commission scope: admin edits the slug manually).
    slug          TEXT NOT NULL UNIQUE,
    body_markdown TEXT NOT NULL,

    task_type     TEXT NOT NULL CHECK (task_type IN ('task_1', 'task_2', 'both')),
    category      TEXT,                                  -- optional, free-form

    published     BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INTEGER NOT NULL DEFAULT 0,

    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User-side hot path: published rows, filtered by task_type, ordered for
-- display. Partial index keeps it small (drafts excluded).
CREATE INDEX IF NOT EXISTS idx_writing_tips_published
    ON writing_tips (task_type, display_order, created_at DESC)
    WHERE published = TRUE;
-- Note: the UNIQUE(slug) constraint already provides the slug lookup index.

-- RLS: admin full-access (mirrors writing_prompts policy, migration 035)
-- plus authenticated read of PUBLISHED rows so a future client-direct
-- path is safe. The endpoints query through supabase_admin (service role)
-- and filter published=true explicitly — RLS here is defense-in-depth.
ALTER TABLE writing_tips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS writing_tips_admin_all ON writing_tips;
CREATE POLICY writing_tips_admin_all ON writing_tips
    FOR ALL TO authenticated
    USING      (public.is_current_user_admin())
    WITH CHECK (public.is_current_user_admin());

DROP POLICY IF EXISTS writing_tips_read_published ON writing_tips;
CREATE POLICY writing_tips_read_published ON writing_tips
    FOR SELECT TO authenticated
    USING (published = TRUE);

DROP TRIGGER IF EXISTS update_writing_tips_updated_at ON writing_tips;
CREATE TRIGGER update_writing_tips_updated_at
    BEFORE UPDATE ON writing_tips
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE  writing_tips IS
    'Admin-authored writing tips (grammar-wiki-style), browsed by students in the "Mẹo viết" tab. Markdown body rendered + sanitized client-side. Sprint 19.1B.';
COMMENT ON COLUMN writing_tips.task_type IS
    'task_1 | task_2 | both — maps 1:1 to the user-side filter chips.';
COMMENT ON COLUMN writing_tips.slug IS
    'URL-safe identifier, auto-generated from title (admin-overridable). UNIQUE — API returns 409 on collision.';
