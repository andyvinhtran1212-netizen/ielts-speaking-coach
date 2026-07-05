-- ============================================================================
-- Migration 132 — fn_upsert_kp_mastery (review P2: atomic, non-regressing upsert)
-- ============================================================================
--
-- services/kp_evidence.recompute_mastery does read-all-evidence → compute →
-- upsert. Two concurrent evidence writes for the same (user, kp) — e.g. rapid
-- duplicate flashcard reviews — can interleave so a compute over FEWER rows
-- finishes last and overwrites the aggregate computed over MORE rows, leaving
-- user_kp_mastery stale.
--
-- Guard: evidence is append-only per (user, kp), so evidence_count is monotonic —
-- a larger count is strictly more recent knowledge. This RPC upserts but only
-- overwrites when the incoming evidence_count is >= the stored one, so a stale
-- (smaller-count) compute can never clobber a fresher aggregate. On equal counts
-- the values are identical, so last-writer-wins is harmless.
--
-- Idempotent: CREATE OR REPLACE. Apply by hand in the Supabase SQL editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_upsert_kp_mastery(
    p_user   uuid,
    p_kp     uuid,
    p_score  numeric,
    p_status text,
    p_count  integer,
    p_last   timestamptz,
    p_now    timestamptz
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO user_kp_mastery
        (user_id, kp_id, score, status, evidence_count, last_evidence_at, updated_at)
    VALUES
        (p_user, p_kp, p_score, p_status, p_count, p_last, p_now)
    ON CONFLICT (user_id, kp_id) DO UPDATE
        SET score            = EXCLUDED.score,
            status           = EXCLUDED.status,
            evidence_count   = EXCLUDED.evidence_count,
            last_evidence_at = EXCLUDED.last_evidence_at,
            updated_at       = EXCLUDED.updated_at
        -- Never let an aggregate computed over fewer rows overwrite a fresher one.
        WHERE user_kp_mastery.evidence_count <= EXCLUDED.evidence_count;
END;
$$;
