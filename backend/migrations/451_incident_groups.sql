-- G09-T07 / ADMINIA-0074 FR-070, FR-071 (plan 5.3 row 451, 5.4 "Nội dung, sự cố").
-- Status of an incident group in the admin incident inbox, plus an
-- append-only note log.
--
-- Groups themselves are computed when they are read (services/
-- error_log_grouping.py) from error_logs, failed Speaking sessions/responses
-- and user_feedback; this migration stores only what a person decides about
-- a group: Mới · Đang xem · Đã xử lý · Bỏ qua, who claimed it, when it was
-- closed, and the notes. A group with no row here reads as 'new'. A closed
-- group (resolved/ignored) whose newest record is newer than last_seen_at
-- (the newest record the closing person's request was checked against, not
-- the time of the click) reads as 'new' again and keeps its notes and claimer.
--
-- Apply through the advisory-locked runner, staging first. Every apply needs
-- anh Andy's own typed approval for that window; this PR does not authorize
-- any hosted apply. Rollback: rollback/451_incident_groups.sql (refuses once
-- a person has acted on a group).
--
-- Both tables are backend-only (spec 0039): RLS on, no policy for
-- anon/authenticated. service_role changes a group only through
-- fn_incident_group_transition, which writes the new state and its automatic
-- note in one transaction.

BEGIN;
SET LOCAL lock_timeout = '5s';
-- service_role can CREATE in public; exclude it from builtin resolution.
SET LOCAL search_path = pg_catalog, pg_temp;

CREATE TABLE IF NOT EXISTS public.incident_groups (
    source text NOT NULL CHECK (source IN ('errors', 'grading', 'feedback')),
    fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{40}$'),
    status text NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'in_review', 'resolved', 'ignored')),
    claimed_by uuid,
    claimed_at timestamptz,
    -- When the group was last closed (resolved OR ignored); NULL while open.
    resolved_by uuid,
    resolved_at timestamptz,
    -- Watermark: the newest record of the group the deciding request was
    -- checked against. A closed group reopens on a record newer than this.
    last_seen_at timestamptz,
    -- Latest note a person wrote (the full history is incident_group_notes).
    note text CHECK (note IS NULL OR char_length(note) <= 2000),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source, fingerprint),
    CHECK ((status IN ('resolved', 'ignored')) = (resolved_at IS NOT NULL)),
    CHECK (status NOT IN ('resolved', 'ignored') OR last_seen_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_incident_groups_status
    ON public.incident_groups (status, source);

CREATE TABLE IF NOT EXISTS public.incident_group_notes (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source text NOT NULL,
    fingerprint text NOT NULL,
    body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
    auto boolean NOT NULL DEFAULT false,
    actor_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (source, fingerprint) REFERENCES public.incident_groups (source, fingerprint)
);
CREATE INDEX IF NOT EXISTS ix_incident_group_notes_group
    ON public.incident_group_notes (source, fingerprint, created_at DESC, id DESC);

-- Append-only like admin_settings_log (mig 440): no UPDATE, DELETE or
-- TRUNCATE, enforced by triggers as well as by the missing privileges.
CREATE OR REPLACE FUNCTION public.fn_incident_group_notes_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE =
        'incident_group_notes chỉ THÊM: không sửa, không xoá (mig 451).';
END;
$$;
REVOKE ALL ON FUNCTION public.fn_incident_group_notes_append_only()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE TRIGGER trg_incident_group_notes_append_only
    BEFORE UPDATE OR DELETE ON public.incident_group_notes
    FOR EACH ROW EXECUTE FUNCTION public.fn_incident_group_notes_append_only();
CREATE OR REPLACE TRIGGER trg_incident_group_notes_no_truncate
    BEFORE TRUNCATE ON public.incident_group_notes
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_incident_group_notes_append_only();

ALTER TABLE public.incident_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_group_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.incident_groups FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.incident_group_notes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.incident_groups TO service_role;
GRANT SELECT, INSERT ON public.incident_group_notes TO service_role;

-- Apply one action to one group, in one transaction:
--   claim  : Mới → Đang xem (claimed_by/at = actor, now)
--   resolve: → Đã xử lý      ignore: → Bỏ qua      reopen: Đã xử lý/Bỏ qua → Mới
-- The current status is the stored one, except that a closed group whose
-- p_last_seen (newest record of the snapshot the caller checked) is after the
-- stored watermark last_seen_at is 'new' (auto-reopen); acting on such a
-- group first logs the reopen. Closing (resolve, ignore, or a first row with
-- p_closed_before) needs p_last_seen and stores it as the watermark, so a
-- record written after the caller's check reopens the group. Every
-- change adds one auto note; p_note, when given, adds a person's note even
-- when the action changes nothing. Returns {status, changed, reopened}.
CREATE OR REPLACE FUNCTION public.fn_incident_group_transition(
    p_source text, p_fingerprint text, p_action text, p_actor uuid,
    p_last_seen timestamptz, p_note text DEFAULT NULL, p_closed_before boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    g public.incident_groups%ROWTYPE;
    current_status text;
    target text;
    reopened boolean := false;
    clean_note text := NULLIF(pg_catalog.btrim(COALESCE(p_note, '')), '');
BEGIN
    IF p_action NOT IN ('claim', 'resolve', 'ignore', 'reopen') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'incident_group_action_invalid';
    END IF;
    IF p_last_seen IS NULL AND (p_closed_before OR p_action IN ('resolve', 'ignore')) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'incident_group_watermark_required';
    END IF;
    INSERT INTO public.incident_groups AS ig (source, fingerprint, status, resolved_at, last_seen_at)
    VALUES (p_source, p_fingerprint,
            CASE WHEN p_closed_before THEN 'resolved' ELSE 'new' END,
            CASE WHEN p_closed_before THEN pg_catalog.now() END,
            p_last_seen)
    ON CONFLICT (source, fingerprint) DO NOTHING;
    SELECT * INTO g FROM public.incident_groups
     WHERE source = p_source AND fingerprint = p_fingerprint FOR UPDATE;

    current_status := g.status;
    IF g.status IN ('resolved', 'ignored') AND p_last_seen IS NOT NULL
       AND p_last_seen > g.last_seen_at THEN
        current_status := 'new';
        reopened := true;
    END IF;

    target := CASE p_action
        WHEN 'claim' THEN CASE WHEN current_status = 'new' THEN 'in_review' END
        WHEN 'resolve' THEN CASE WHEN current_status <> 'resolved' THEN 'resolved' END
        WHEN 'ignore' THEN CASE WHEN current_status <> 'ignored' THEN 'ignored' END
        WHEN 'reopen' THEN CASE WHEN current_status IN ('resolved', 'ignored') THEN 'new' END
    END;

    IF reopened AND target IS NOT NULL THEN
        INSERT INTO public.incident_group_notes (source, fingerprint, body, auto, actor_id)
        VALUES (p_source, p_fingerprint,
                'Tự mở lại: có ghi nhận mới sau khi nhóm được đóng.', true, NULL);
    END IF;

    IF target IS NOT NULL THEN
        UPDATE public.incident_groups SET
            status = target,
            claimed_by = CASE WHEN target = 'in_review' THEN p_actor ELSE claimed_by END,
            claimed_at = CASE WHEN target = 'in_review' THEN pg_catalog.now() ELSE claimed_at END,
            resolved_by = CASE WHEN target IN ('resolved', 'ignored') THEN p_actor
                               WHEN target = 'new' THEN NULL ELSE resolved_by END,
            resolved_at = CASE WHEN target IN ('resolved', 'ignored') THEN pg_catalog.now()
                               ELSE NULL END,
            last_seen_at = GREATEST(last_seen_at, p_last_seen),
            updated_at = pg_catalog.now()
         WHERE source = p_source AND fingerprint = p_fingerprint;
        INSERT INTO public.incident_group_notes (source, fingerprint, body, auto, actor_id)
        VALUES (p_source, p_fingerprint, CASE target
                    WHEN 'in_review' THEN 'Nhận xử lý.'
                    WHEN 'resolved' THEN 'Đánh dấu đã xử lý.'
                    WHEN 'ignored' THEN 'Bỏ qua nhóm.'
                    ELSE 'Mở lại nhóm.' END,
                true, p_actor);
    END IF;

    IF clean_note IS NOT NULL THEN
        UPDATE public.incident_groups SET note = clean_note, updated_at = pg_catalog.now()
         WHERE source = p_source AND fingerprint = p_fingerprint;
        INSERT INTO public.incident_group_notes (source, fingerprint, body, auto, actor_id)
        VALUES (p_source, p_fingerprint, clean_note, false, p_actor);
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'status', COALESCE(target, current_status),
        'changed', target IS NOT NULL,
        'reopened', reopened);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_incident_group_transition(text, text, text, uuid, timestamptz, text, boolean)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_incident_group_transition(text, text, text, uuid, timestamptz, text, boolean)
    TO service_role;

DO $postcondition$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class
                WHERE oid IN ('public.incident_groups'::regclass, 'public.incident_group_notes'::regclass)
                  AND NOT relrowsecurity) THEN
        RAISE EXCEPTION 'incident_groups_451_rls_disabled';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy
                WHERE polrelid IN ('public.incident_groups'::regclass, 'public.incident_group_notes'::regclass)) THEN
        RAISE EXCEPTION 'incident_groups_451_unexpected_policy';
    END IF;
    IF has_table_privilege('anon', 'public.incident_groups', 'SELECT')
       OR has_table_privilege('authenticated', 'public.incident_groups', 'SELECT')
       OR has_table_privilege('anon', 'public.incident_group_notes', 'SELECT')
       OR has_table_privilege('authenticated', 'public.incident_group_notes', 'SELECT')
       OR has_table_privilege('service_role', 'public.incident_groups', 'DELETE')
       OR has_table_privilege('service_role', 'public.incident_group_notes', 'UPDATE')
       OR has_table_privilege('service_role', 'public.incident_group_notes', 'DELETE') THEN
        RAISE EXCEPTION 'incident_groups_451_unexpected_privilege';
    END IF;
END;
$postcondition$;

COMMIT;
