-- G07-T31 / LEARNERCORE-0063 amendment 4, FR-106…FR-110 (plan "Migration T31").
-- 1. review_notes: one private note per (learner, skill, test, question) on the
--    Listening/Reading review pages. Backend-only (service role), like every
--    learner table since spec 0039: RLS on, no policy, client roles revoked.
-- 2. Two partial unique indexes on user_feedback so a per-question "flag" is
--    sent once per (attempt, question, sender): signed-in senders by
--    created_by, anonymous Reading share-link takers by anon_id. A whole-test
--    flag (q_num NULL) is once per attempt through coalesce(q_num, -1).
--    Practice/exercise flags (attempt_id NULL) stay outside the indexes.
--
-- The preflight stops (RAISE) when duplicate flag rows already exist inside
-- exactly the index scope; it never deletes anyone's feedback. Real duplicates
-- are archived only by scripts/archive_duplicate_feedback_flags.sql, a separate
-- run that needs anh Andy's typed DB-write approval.
--
-- Apply through the advisory-locked runner, staging first, after the read-only
-- duplicate count. Every apply needs anh Andy's own typed approval for that
-- window; this PR does not authorize any hosted apply.
-- Rollback: rollback/421_review_notes_flag_once.sql (drops the two indexes
-- only; review_notes is kept unless anh Andy approves losing learners' notes).

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.user_feedback
         WHERE type = 'flag' AND created_by IS NOT NULL AND attempt_id IS NOT NULL
         GROUP BY attempt_id, coalesce(q_num, -1), created_by
        HAVING count(*) > 1
    ) OR EXISTS (
        SELECT 1 FROM public.user_feedback
         WHERE type = 'flag' AND anon_id IS NOT NULL AND attempt_id IS NOT NULL
         GROUP BY attempt_id, coalesce(q_num, -1), anon_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'duplicate flag rows exist; resolve before applying (spec 0063 open question 14)';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_flag_user
    ON public.user_feedback (attempt_id, coalesce(q_num, -1), created_by)
    WHERE type = 'flag' AND created_by IS NOT NULL AND attempt_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_flag_anon
    ON public.user_feedback (attempt_id, coalesce(q_num, -1), anon_id)
    WHERE type = 'flag' AND anon_id IS NOT NULL AND attempt_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.review_notes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    skill text NOT NULL CHECK (skill IN ('listening', 'reading')),
    test_uuid uuid NOT NULL,
    q_num int NOT NULL CHECK (q_num > 0),
    body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT review_notes_one_per_question UNIQUE (user_id, skill, test_uuid, q_num)
);

ALTER TABLE public.review_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.review_notes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_notes TO service_role;

COMMENT ON TABLE public.review_notes IS
'LEARNERCORE-0063 (mig 421): private per-question review note of one learner for one test; backend-only, read and written by the owner only.';
COMMENT ON INDEX public.uq_feedback_flag_user IS
'LEARNERCORE-0063 FR-108 (mig 421): one flag per (attempt, question, signed-in sender).';
COMMENT ON INDEX public.uq_feedback_flag_anon IS
'LEARNERCORE-0063 FR-108 (mig 421): one flag per (attempt, question, anonymous Reading taker).';

COMMIT;
