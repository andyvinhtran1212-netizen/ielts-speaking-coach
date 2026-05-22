-- Migration: 071_listening_content_segment_tracking.sql
-- Mô tả: Sprint 13.6 audio cutter — track segment cuts derived from a
--        full pre-mixed source so the admin "Hình map" / parts grid
--        can render origin info, and so cascade behaviour preserves
--        the cut rows when the parent source is removed.
--
-- New columns on ``listening_content``:
--   * parent_content_id      — points at the full-premixed row this
--                              cut was carved from. NULL for native
--                              rows (uploads, renders, parts).
--   * segment_label          — admin-supplied label per cut
--                              (e.g. "Section 1", "Q1-10").
--   * segment_start_seconds  — offset into the parent audio where
--                              the segment begins.
--   * segment_end_seconds    — offset where the segment ends.
--
-- The FK uses ``ON DELETE SET NULL`` rather than CASCADE so deleting
-- the source full-premixed row leaves the cut rows in place
-- (they have their own storage object and may already be linked into
-- a published test).

ALTER TABLE listening_content
    ADD COLUMN IF NOT EXISTS parent_content_id     UUID REFERENCES listening_content(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS segment_label         TEXT,
    ADD COLUMN IF NOT EXISTS segment_start_seconds NUMERIC,
    ADD COLUMN IF NOT EXISTS segment_end_seconds   NUMERIC;

-- Index on the FK so the admin panel can list "cuts derived from this
-- content" in O(log N) per parent.
CREATE INDEX IF NOT EXISTS idx_listening_content_parent_content_id
    ON listening_content(parent_content_id)
    WHERE parent_content_id IS NOT NULL;

COMMENT ON COLUMN listening_content.parent_content_id IS
    'Cluster 13.x Sprint 13.6: when this row was carved out of a full pre-mixed audio via the audio cutter UI, points at the source row. NULL for native uploads.';
COMMENT ON COLUMN listening_content.segment_label IS
    'Sprint 13.6: admin-supplied label per cut, e.g. "Section 1" or "Q1-10".';
COMMENT ON COLUMN listening_content.segment_start_seconds IS
    'Sprint 13.6: offset into parent audio where this cut begins.';
COMMENT ON COLUMN listening_content.segment_end_seconds IS
    'Sprint 13.6: offset into parent audio where this cut ends.';
