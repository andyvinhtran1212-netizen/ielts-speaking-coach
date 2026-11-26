-- G09-T35 / ADMINIA-0074 FR-032 (plan 5.3 row 442, 5.4 care-notes routes).
-- Care notes on a learner: who wrote it, when, the note, an optional next
-- step and due day, and when it was marked done. A note can be edited or
-- removed (soft) only by its author for CARE_NOTE_EDIT_HOURS (Q16 default
-- 24); after that it can only be marked done. The API enforces that window
-- in the same UPDATE that changes the row, so it is not re-checked here.
--
-- `source` (GOI-13 G13-A12): 'manual' for a note an admin types, 'survey'
-- for the line the course-end survey writes. `students.persona_notes` is NOT
-- copied: the API shows it as a virtual "Ghi chú ban đầu" item at read time
-- (plan 5.4), so `is_initial` stays false for every row written today.
--
-- Apply through the advisory-locked runner, staging first. Every apply needs
-- anh Andy's own typed approval for that window; this PR does not authorize
-- any hosted apply. Rollback: rollback/442_learner_care_notes.sql (refuses
-- once a note exists).
--
-- Backend-only (spec 0039): RLS on, no policy, no grant to anon or
-- authenticated. service_role may SELECT, INSERT and UPDATE; there is no
-- DELETE (removal is `deleted_at`). A note belongs to the learner's profile
-- (`students`) and/or account (`users`) and goes with them when they are
-- removed, like the other per-student tables (mig 033, 177, 227).
-- `author_id`/`done_by` keep the staff id without a foreign key, so removing
-- a staff account never fails on this history (like mig 440, 452).

BEGIN;
SET LOCAL lock_timeout = '5s';
-- service_role can CREATE in public; exclude it from builtin resolution.
SET LOCAL search_path = pg_catalog, pg_temp;

CREATE TABLE IF NOT EXISTS public.learner_care_notes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id uuid REFERENCES public.students (id) ON DELETE CASCADE,
    user_id uuid REFERENCES public.users (id) ON DELETE CASCADE,
    author_id uuid NOT NULL,
    body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
    next_action text CHECK (next_action IS NULL OR char_length(btrim(next_action)) BETWEEN 1 AND 500),
    due_on date,
    done_at timestamptz,
    done_by uuid,
    is_initial boolean NOT NULL DEFAULT false,
    source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'survey')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT learner_care_notes_has_owner CHECK (student_id IS NOT NULL OR user_id IS NOT NULL),
    CONSTRAINT learner_care_notes_done_pair CHECK ((done_at IS NULL) = (done_by IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_learner_care_notes_student_created
    ON public.learner_care_notes (student_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_learner_care_notes_user_created
    ON public.learner_care_notes (user_id, created_at DESC) WHERE deleted_at IS NULL;
-- "Cần liên hệ hôm nay" (T06 care_due_today): open notes with a due day.
CREATE INDEX IF NOT EXISTS ix_learner_care_notes_due_open
    ON public.learner_care_notes (due_on) WHERE done_at IS NULL AND deleted_at IS NULL;

ALTER TABLE public.learner_care_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.learner_care_notes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.learner_care_notes TO service_role;

DO $postcondition$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class
                WHERE oid = 'public.learner_care_notes'::regclass AND NOT relrowsecurity) THEN
        RAISE EXCEPTION 'learner_care_notes_442_rls_disabled';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.learner_care_notes'::regclass) THEN
        RAISE EXCEPTION 'learner_care_notes_442_unexpected_policy';
    END IF;
    IF has_table_privilege('anon', 'public.learner_care_notes', 'SELECT')
       OR has_table_privilege('authenticated', 'public.learner_care_notes', 'SELECT')
       OR has_table_privilege('anon', 'public.learner_care_notes', 'INSERT')
       OR has_table_privilege('authenticated', 'public.learner_care_notes', 'INSERT')
       OR has_table_privilege('service_role', 'public.learner_care_notes', 'DELETE')
       OR has_table_privilege('service_role', 'public.learner_care_notes', 'TRUNCATE') THEN
        RAISE EXCEPTION 'learner_care_notes_442_unexpected_privilege';
    END IF;
END;
$postcondition$;

COMMIT;
