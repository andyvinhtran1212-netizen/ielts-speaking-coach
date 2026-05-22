-- Migration: 072_listening_content_cut_provenance_and_idempotency.sql
-- Mô tả: Sprint 13.6.3 Codex audit hotfix — truthful provenance + cut idempotency.
-- Sprint 13.6.4 amendment 2026-05-22: self-heal missing segment columns +
-- skip backfill UPDATE when those columns are absent. Original 13.6.3 file
-- assumed migration 071 had been applied; in production it had not, so the
-- partial UNIQUE index referenced non-existent columns and the migration
-- errored with 42703. The amended block below idempotently adds the
-- segment columns (re-creating 071's work if missing, no-op if present)
-- BEFORE any reference to them. All statements remain IF NOT EXISTS / DROP
-- IF EXISTS guarded so re-running on any partial-state environment is safe.
--
-- Codex audit 2026-05-22 raised two P0 falsifications against Sprint 13.6:
--
--   F1 (truthful provenance) — Sprint 13.6 added ``parent_content_id`` as a
--   self-FK on ``listening_content``, intending it to point at the source
--   row a cut was carved from. In practice no parent row ever exists for
--   ``full_premixed`` audio: the source MP3 lives on
--   ``listening_tests.full_audio_storage_path`` directly, NOT in a
--   ``listening_content`` row. The cut route therefore never wrote to
--   ``parent_content_id`` and the column was a misleading half-truth.
--   Sprint 13.6.3 replaces it with an explicit two-field contract:
--   ``source_test_id`` (FK to the originating test) +
--   ``source_audio_kind`` (enum-checked tag of the source kind).
--
--   F2 (cut idempotency) — re-clicking Export with the same regions on the
--   waveform would insert a fresh row each time, accumulating duplicate
--   storage objects + DB rows. The unique index added here makes the
--   ``(test_id, segment_label, segment_start_seconds, segment_end_seconds)``
--   tuple idempotent so the cut route can short-circuit to "reuse" semantics
--   instead of duplicating.
--
-- ``parent_content_id`` is NOT dropped — keeping it preserves the
-- existing Sprint 13.6 schema + sentinel test contract. The cut route
-- stops writing to it; readers should prefer ``source_test_id`` going
-- forward. Drop planned for a future Phase B migration after a grace
-- period.


-- ── Sprint 13.6.4 self-heal: segment columns from migration 071 ────────────
--
-- Production schema audit 2026-05-22 surfaced that migration 071's segment
-- columns (segment_label, segment_start_seconds, segment_end_seconds) had
-- never been applied. The Sprint 13.6 cut route writes to them anyway and
-- the original 072 below references them in a partial-unique index — both
-- broke at runtime. Re-asserting the columns here makes 072 self-contained
-- and idempotent under any partial-state combination:
--   * 071 fully applied + 072 not applied → no-op here, body below runs
--   * 071 not applied + 072 errored mid-way → adds segment cols, retries below
--   * Both fully applied → no-op everywhere (IF NOT EXISTS / DROP IF EXISTS)

ALTER TABLE listening_content
    ADD COLUMN IF NOT EXISTS segment_label         TEXT,
    ADD COLUMN IF NOT EXISTS segment_start_seconds NUMERIC,
    ADD COLUMN IF NOT EXISTS segment_end_seconds   NUMERIC;


-- ── Provenance (F1) ────────────────────────────────────────────────────────

ALTER TABLE listening_content
    ADD COLUMN IF NOT EXISTS source_test_id    UUID REFERENCES listening_tests(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_audio_kind TEXT;

-- Enum-style check. NULL is allowed because most listening_content rows
-- (uploads, renders, parts) are native and have no source.
-- Drop-and-recreate the constraint idempotently so re-running the
-- migration doesn't error on the existing constraint.
ALTER TABLE listening_content
    DROP CONSTRAINT IF EXISTS chk_listening_content_source_audio_kind;
ALTER TABLE listening_content
    ADD CONSTRAINT chk_listening_content_source_audio_kind
    CHECK (source_audio_kind IS NULL OR source_audio_kind IN (
        'test_full_premixed',
        'manual_upload',
        'api_generation'
    ));

-- Index for "list all cuts of test X" lookups in the admin panel.
CREATE INDEX IF NOT EXISTS idx_listening_content_source_test_id
    ON listening_content(source_test_id)
    WHERE source_test_id IS NOT NULL;

-- Backfill: any existing cut rows (segment_label NOT NULL) were
-- carved out of the test's full_premixed audio. Populate the new
-- source fields so the historical data matches the new contract.
UPDATE listening_content
SET source_test_id    = test_id,
    source_audio_kind = 'test_full_premixed'
WHERE segment_label IS NOT NULL
  AND source_test_id IS NULL;

COMMENT ON COLUMN listening_content.source_test_id IS
    'Sprint 13.6.3 (Codex audit F1): when this row is a cut, points at the originating listening_tests row. NULL for native rows. Supersedes parent_content_id, which was misleading because full_premixed audio lives on listening_tests, not on a listening_content parent row.';
COMMENT ON COLUMN listening_content.source_audio_kind IS
    'Sprint 13.6.3 (Codex audit F1): enum-checked kind of source audio — test_full_premixed | manual_upload | api_generation. NULL for native rows.';


-- ── Idempotency (F2) ───────────────────────────────────────────────────────

-- Partial unique index on the cut fingerprint. Two active cut rows
-- with identical (test_id, segment_label, segment_start_seconds,
-- segment_end_seconds) are forbidden. Archived rows are excluded so
-- Andy can re-cut at the same boundaries after archiving an earlier
-- attempt without colliding.
CREATE UNIQUE INDEX IF NOT EXISTS uq_listening_content_cut_active_fingerprint
    ON listening_content(
        test_id,
        segment_label,
        segment_start_seconds,
        segment_end_seconds
    )
    WHERE segment_label             IS NOT NULL
      AND segment_start_seconds     IS NOT NULL
      AND segment_end_seconds       IS NOT NULL
      AND COALESCE(status, 'draft') != 'archived';
