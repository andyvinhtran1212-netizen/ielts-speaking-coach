-- MOCKORG-0086 G09-T33 (plan 5.5, migration table row 447).
-- Number 447 is from the G09 band 440-459 of the commercialization register.
-- No apply on merge: pending_feature mock_exam_events. Staging first under the
-- advisory lock with anh Andy's typed approval, after 445; production only at
-- an authorised staging-to-main promotion.
--
-- Additive only; no existing row changes:
--   * mock_exam_events: append-only timeline of one exam (room opened, section
--     started/collected, people added, extra time, room message, release,
--     score edit, window changed). The Nhật ký tab reads it, and the GOI-11
--     sweep turns some kinds into notifications (never inside the writer's
--     transaction). service_role may SELECT and INSERT only.
--   * mock_exam_sittings.extra_seconds: extra time per section for one person,
--     {"listening": 300, ...}; the self-paced timeline pushes later sections
--     back by it (plan 5.5 point 8).
--   * mock_exam_room_messages: messages the proctor sends to a live room.
-- All backend-only (spec 0039): RLS on, no policy.
-- Re-runnable; postconditions at the end.
-- Rollback: rollback/447_mock_exam_events.sql (refuses while any event, room
-- message or extra time exists).

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

-- 1. Extra time per section ------------------------------------------------
ALTER TABLE public.mock_exam_sittings
    ADD COLUMN IF NOT EXISTS extra_seconds jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $chk$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.mock_exam_sittings'::regclass
                      AND conname = 'mock_exam_sittings_extra_seconds_shape') THEN
        ALTER TABLE public.mock_exam_sittings ADD CONSTRAINT mock_exam_sittings_extra_seconds_shape
            CHECK (jsonb_typeof(extra_seconds) = 'object'
                   AND NOT (extra_seconds - ARRAY['listening', 'reading', 'writing', 'speaking']
                            <> '{}'::jsonb));
    END IF;
END;
$chk$;

-- 2. Exam timeline (append-only) -------------------------------------------
CREATE TABLE IF NOT EXISTS public.mock_exam_events (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id    uuid NOT NULL REFERENCES public.mock_exams(id) ON DELETE CASCADE,
    sitting_id uuid REFERENCES public.mock_exam_sittings(id) ON DELETE SET NULL,
    kind       text NOT NULL,
    payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
    actor_id   uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mock_exam_events_kind_shape CHECK (kind ~ '^[a-z][a-z_]{2,39}$'),
    CONSTRAINT mock_exam_events_payload_object CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_mock_exam_events_exam_time
    ON public.mock_exam_events (exam_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mock_exam_events_sitting
    ON public.mock_exam_events (sitting_id) WHERE sitting_id IS NOT NULL;

COMMENT ON TABLE public.mock_exam_events IS
'MOCKORG-0086 plan 5.5 / G09-T33: append-only timeline of one mock exam. kind is
a snake_case name (room_opened, section_started, section_collected,
room_closed, audience_added, extra_time, room_message, window_changed,
released, score_edited, makeup_granted). The GOI-11 sweep reads it; writers
never notify inside their transaction. Backend-only; no UPDATE or DELETE grant.';

-- 3. Room messages ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mock_exam_room_messages (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id uuid NOT NULL REFERENCES public.mock_exams(id) ON DELETE CASCADE,
    body    text NOT NULL,
    sent_by uuid,
    sent_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mock_exam_room_messages_body_len
        CHECK (char_length(btrim(body)) BETWEEN 1 AND 500)
);
CREATE INDEX IF NOT EXISTS idx_mock_exam_room_messages_exam_time
    ON public.mock_exam_room_messages (exam_id, sent_at DESC);

COMMENT ON TABLE public.mock_exam_room_messages IS
'MOCKORG-0086 FR-146 / G09-T33: messages a proctor sends to a live mock room
(live exams only, checked by the service). Backend-only.';

-- 4. Privileges -------------------------------------------------------------
ALTER TABLE public.mock_exam_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_exam_room_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mock_exam_events, public.mock_exam_room_messages
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.mock_exam_events, public.mock_exam_room_messages TO service_role;

-- 5. Postconditions ----------------------------------------------------------
DO $post$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['public.mock_exam_events', 'public.mock_exam_room_messages'] LOOP
        IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = t::regclass) THEN
            RAISE EXCEPTION 'mock_exam_447_rls_disabled: %', t;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = t::regclass) THEN
            RAISE EXCEPTION 'mock_exam_447_unexpected_policy: %', t;
        END IF;
        IF has_table_privilege('anon', t, 'SELECT') OR has_table_privilege('authenticated', t, 'SELECT') THEN
            RAISE EXCEPTION 'mock_exam_447_client_grant: %', t;
        END IF;
        IF has_table_privilege('service_role', t, 'UPDATE') OR has_table_privilege('service_role', t, 'DELETE') THEN
            RAISE EXCEPTION 'mock_exam_447_not_append_only: %', t;
        END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'mock_exam_sittings'
                      AND column_name = 'extra_seconds') THEN
        RAISE EXCEPTION 'mock_exam_447_extra_seconds_missing';
    END IF;
END;
$post$;

COMMIT;

NOTIFY pgrst, 'reload schema';
