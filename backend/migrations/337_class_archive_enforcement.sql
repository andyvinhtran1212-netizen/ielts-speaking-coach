-- Migration: 337_class_archive_enforcement.sql
--
-- A-10 / CLASSARCHIVE-0030 (specs/0030-class-archive, research.md §7, §7.1,
-- §11). cohorts.is_active=false ("Lưu trữ", 060) was a flag that no learner or
-- enrollment path enforced. An *archived* class (is_active = false AND
-- archived_at IS NOT NULL) now refuses new membership, class work and cohort
-- Writing gives. Archive and restore go through locked, audited,
-- service-role-only RPCs.
--
-- Classes that were already inactive before this file stay *legacy*
-- (archived_at NULL) and keep today's behaviour: nothing here backfills
-- archived_at, and the postcondition fails if the number of archived classes
-- changes (FR-009). An admin applies the rules to a legacy class only with
-- fn_archive_cohort ("Áp dụng lưu trữ", audit detail.legacy_upgrade = true).
--
-- There is no is_active-dependent CHECK. The trg_cohorts_archive_metadata
-- trigger normalises the metadata for every writer, so the old backend's
-- PATCH {is_active} keeps working in the deploy window and after a rollback
-- (FR-011). An old-backend archive is stamped (enforced) with no actor and no
-- audit row; the runbook asks admins not to archive or restore in that window.
--
-- Guards: SECURITY DEFINER with a pinned search_path. Each locks the class row
-- FOR SHARE, which conflicts with fn_archive_cohort's FOR UPDATE: an archive
-- that commits first refuses the waiting write, and a write that commits first
-- makes the archive wait and count it. The membership guard is an AFTER row
-- trigger, so an upsert of an already-active membership (the sync trigger
-- after a removal moves students.cohort_id to an archived class) is judged
-- active→active and passes. The class item guard is INSERT-only (T002a §11.1):
-- the reaper, retries and finalisers only UPDATE items. Lock order stays
-- students → memberships → cohorts; fn_cohort_archive_counts never locks.
--
-- fn_restore_student (326) skips archived classes (0029 FR-003 Revision 1). It
-- keeps its signature, SECURITY DEFINER, search_path, ACL and the literal
-- "students WHERE id = p_student_id FOR UPDATE".
-- No client grant is added. This file does not name, replace or bypass any
-- migration-331 object.
--
-- Order: apply before the A-10 backend (dormant until then: no class is
-- archived). Do not archive or restore classes between apply and deploy.
--
-- ROLLBACK (a new forward migration, never an edit of this file). Roll the
-- backend back first (specs/0030-class-archive/rollout.md).
-- ROLLBACK (light, preferred): drops the RPCs, the counts function and the four
-- guards. Keeps the columns, the metadata trigger, the audit table and the 337
-- fn_restore_student, so the old backend keeps working.
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   DROP FUNCTION IF EXISTS public.fn_archive_cohort(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.fn_restore_cohort(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.fn_cohort_archive_counts(uuid);
--   DROP TRIGGER IF EXISTS trg_guard_membership_cohort_active ON public.student_cohort_memberships;
--   DROP TRIGGER IF EXISTS trg_guard_class_assignment_cohort_active ON public.class_assignments;
--   DROP TRIGGER IF EXISTS trg_guard_class_item_cohort_active ON public.class_assignment_items;
--   DROP TRIGGER IF EXISTS trg_guard_writing_give_cohort_active ON public.writing_assignments;
--   DROP FUNCTION IF EXISTS public.fn_guard_membership_cohort_active();
--   DROP FUNCTION IF EXISTS public.fn_guard_class_assignment_cohort_active();
--   DROP FUNCTION IF EXISTS public.fn_guard_class_item_cohort_active();
--   DROP FUNCTION IF EXISTS public.fn_guard_writing_give_cohort_active();
--   COMMIT;
-- ROLLBACK (full): refused while audit rows or archived_by values exist (export
-- them first). Re-creates the 326 fn_restore_student BEFORE dropping the
-- columns, because the 337 body reads cohorts.archived_at.
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   DO $$
--   BEGIN
--       IF EXISTS (SELECT 1 FROM public.class_lifecycle_audit) THEN
--           RAISE EXCEPTION 'rollback_would_drop_class_audit';
--       END IF;
--       IF EXISTS (SELECT 1 FROM public.cohorts WHERE archived_by IS NOT NULL) THEN
--           RAISE EXCEPTION 'rollback_would_drop_archive_actor';
--       END IF;
--   END $$;
--   DROP FUNCTION IF EXISTS public.fn_archive_cohort(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.fn_restore_cohort(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.fn_cohort_archive_counts(uuid);
--   DROP TRIGGER IF EXISTS trg_guard_membership_cohort_active ON public.student_cohort_memberships;
--   DROP TRIGGER IF EXISTS trg_guard_class_assignment_cohort_active ON public.class_assignments;
--   DROP TRIGGER IF EXISTS trg_guard_class_item_cohort_active ON public.class_assignment_items;
--   DROP TRIGGER IF EXISTS trg_guard_writing_give_cohort_active ON public.writing_assignments;
--   DROP FUNCTION IF EXISTS public.fn_guard_membership_cohort_active();
--   DROP FUNCTION IF EXISTS public.fn_guard_class_assignment_cohort_active();
--   DROP FUNCTION IF EXISTS public.fn_guard_class_item_cohort_active();
--   DROP FUNCTION IF EXISTS public.fn_guard_writing_give_cohort_active();
--   -- Re-create the 326 fn_restore_student HERE: run the CREATE OR REPLACE
--   -- FUNCTION public.fn_restore_student statement of 326_student_archive.sql
--   -- verbatim (CREATE OR REPLACE keeps the grants; md5(prosrc) = bf721ebc664d8875de2b9b91ac4a878f).
--   DROP TRIGGER IF EXISTS trg_cohorts_archive_metadata ON public.cohorts;
--   DROP FUNCTION IF EXISTS public.fn_cohorts_archive_metadata();
--   DROP TABLE IF EXISTS public.class_lifecycle_audit;
--   ALTER TABLE public.cohorts DROP CONSTRAINT IF EXISTS chk_cohorts_archive_reason_length;
--   ALTER TABLE public.cohorts
--       DROP COLUMN IF EXISTS archive_reason,
--       DROP COLUMN IF EXISTS archived_by,
--       DROP COLUMN IF EXISTS archived_at;
--   COMMIT;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 0. Preconditions (abort if unsafe) and the FR-009 snapshot
DO $$
DECLARE
    v_before bigint := 0;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.users'::regclass
                      AND tgname = 'trg_users_guard_privileged_columns' AND tgenabled = 'O') THEN
        RAISE EXCEPTION 'migration_320_guard_missing';
    END IF;
    IF to_regprocedure('public.fn_restore_student(uuid,uuid,text,boolean,boolean)') IS NULL THEN
        RAISE EXCEPTION 'migration_326_missing';
    END IF;
    IF position('students WHERE id = p_student_id FOR UPDATE' IN
                (SELECT prosrc FROM pg_proc
                  WHERE oid = 'public.fn_restore_student(uuid,uuid,text,boolean,boolean)'::regprocedure)) = 0 THEN
        RAISE EXCEPTION 'fn_restore_student_lock_missing';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'cohorts'
                  AND ((column_name = 'archived_at'    AND data_type <> 'timestamp with time zone')
                    OR (column_name = 'archived_by'    AND data_type <> 'uuid')
                    OR (column_name = 'archive_reason' AND data_type <> 'text'))) THEN
        RAISE EXCEPTION 'cohorts_archive_columns_conflict';
    END IF;
    IF to_regclass('public.class_lifecycle_audit') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'class_lifecycle_audit'
                          AND column_name = 'detail') THEN
        RAISE EXCEPTION 'class_lifecycle_audit_conflict';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'cohorts'
                  AND column_name = 'archived_at') THEN
        EXECUTE 'SELECT count(*) FROM public.cohorts WHERE NOT is_active AND archived_at IS NOT NULL'
           INTO v_before;
    END IF;
    PERFORM set_config('m337.archived_before', v_before::text, true);
END $$;

-- 1. Archive metadata (no backfill, no is_active-dependent CHECK)
ALTER TABLE public.cohorts
    ADD COLUMN IF NOT EXISTS archived_at    timestamptz,
    ADD COLUMN IF NOT EXISTS archived_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS archive_reason text;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.cohorts'::regclass
                      AND conname = 'chk_cohorts_archive_reason_length') THEN
        ALTER TABLE public.cohorts ADD CONSTRAINT chk_cohorts_archive_reason_length
            CHECK (archive_reason IS NULL OR char_length(archive_reason) <= 500);
    END IF;
END $$;

COMMENT ON COLUMN public.cohorts.archived_at IS
    'CLASSARCHIVE-0030: archived class = is_active false AND archived_at NOT NULL. '
    'NULL on an inactive class = legacy (pre-337) inactive class with the old behaviour. '
    'Written by fn_archive_cohort / fn_restore_cohort and normalised by trg_cohorts_archive_metadata.';

-- 2. Metadata normaliser: runs for every writer (old backend, SQL editor, RPC)
CREATE OR REPLACE FUNCTION public.fn_cohorts_archive_metadata()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.is_active THEN
        NEW.archived_at := NULL;
    ELSIF TG_OP = 'INSERT' OR OLD.is_active THEN
        NEW.archived_at := COALESCE(NEW.archived_at, now());           -- every new archive is enforced
    ELSE
        NEW.archived_at := COALESCE(NEW.archived_at, OLD.archived_at);  -- cannot un-enforce
    END IF;
    IF NEW.archived_at IS NULL THEN
        NEW.archived_by := NULL;
        NEW.archive_reason := NULL;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_cohorts_archive_metadata() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_cohorts_archive_metadata
    BEFORE INSERT OR UPDATE ON public.cohorts
    FOR EACH ROW EXECUTE FUNCTION public.fn_cohorts_archive_metadata();

-- 3. Append-only audit (no FK: it survives a hard delete of the class)
CREATE TABLE IF NOT EXISTS public.class_lifecycle_audit (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cohort_id     uuid NOT NULL,
    action        text NOT NULL CHECK (action IN ('archive', 'restore')),
    actor_user_id uuid NOT NULL,
    reason        text,
    detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_class_lifecycle_audit_cohort
    ON public.class_lifecycle_audit (cohort_id, created_at DESC);
ALTER TABLE public.class_lifecycle_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.class_lifecycle_audit FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.class_lifecycle_audit FROM service_role;
GRANT SELECT, INSERT ON public.class_lifecycle_audit TO service_role;

-- 4. Counts and RPCs (SECURITY DEFINER, service_role only)
-- Plain, non-locking reads (T002a §11.2): a FOR SHARE here would take
-- memberships after fn_archive_cohort's class lock and could deadlock with a
-- concurrent fan-out or enroll, which lock memberships first.
CREATE OR REPLACE FUNCTION public.fn_cohort_archive_counts(p_cohort_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.cohorts WHERE id = p_cohort_id) THEN
        RETURN NULL;                                   -- caller 404s
    END IF;
    RETURN jsonb_build_object(
        'active_members',
            (SELECT count(*) FROM public.student_cohort_memberships m
              WHERE m.cohort_id = p_cohort_id AND m.is_active),
        'open_writing_gives',
            (SELECT count(*) FROM public.writing_assignments w
              WHERE w.cohort_id = p_cohort_id AND w.status IN ('pending', 'in_progress')),
        'open_class_items',
            (SELECT count(*) FROM public.class_assignment_items i
               JOIN public.class_assignments a ON a.id = i.assignment_id
              WHERE a.cohort_id = p_cohort_id AND a.status <> 'archived'
                AND i.state IN ('assigned', 'opened')),
        'unused_class_codes',
            (SELECT count(*) FROM public.access_codes c
              WHERE c.cohort_id = p_cohort_id AND c.is_active
                AND NOT COALESCE(c.is_used, false) AND NOT COALESCE(c.is_revoked, false)));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_archive_cohort(
    p_cohort_id uuid,
    p_actor     uuid,
    p_reason    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_c      public.cohorts%ROWTYPE;
    v_reason text := NULLIF(btrim(p_reason), '');
    v_legacy boolean;
    v_counts jsonb;
    v_at     timestamptz;
BEGIN
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'archive_actor_required';
    END IF;
    IF char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'archive_reason_too_long' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_c FROM public.cohorts WHERE id = p_cohort_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;                                   -- caller 404s
    END IF;
    IF NOT v_c.is_active AND v_c.archived_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'already_archived', 'archived_at', v_c.archived_at);
    END IF;

    v_legacy := NOT v_c.is_active;                     -- "Áp dụng lưu trữ" on a legacy class
    v_counts := public.fn_cohort_archive_counts(p_cohort_id);

    UPDATE public.cohorts
       SET is_active = false, archived_at = now(), archived_by = p_actor,
           archive_reason = v_reason, updated_at = now()
     WHERE id = p_cohort_id
    RETURNING archived_at INTO v_at;

    INSERT INTO public.class_lifecycle_audit (cohort_id, action, actor_user_id, reason, detail)
    VALUES (p_cohort_id, 'archive', p_actor, v_reason,
            v_counts || jsonb_build_object('legacy_upgrade', v_legacy));

    RETURN jsonb_build_object('status', 'archived', 'archived_at', v_at,
                              'counts', v_counts, 'legacy_upgrade', v_legacy);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_restore_cohort(
    p_cohort_id uuid,
    p_actor     uuid,
    p_reason    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_c          public.cohorts%ROWTYPE;
    v_reason     text := NULLIF(btrim(p_reason), '');
    v_was_legacy boolean;
    v_counts     jsonb;
BEGIN
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'restore_actor_required';
    END IF;
    IF char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'archive_reason_too_long' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_c FROM public.cohorts WHERE id = p_cohort_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    IF v_c.is_active THEN
        RETURN jsonb_build_object('status', 'not_archived');
    END IF;

    v_was_legacy := v_c.archived_at IS NULL;
    v_counts := public.fn_cohort_archive_counts(p_cohort_id);

    -- The metadata trigger clears archived_at/by/reason.
    UPDATE public.cohorts SET is_active = true, updated_at = now() WHERE id = p_cohort_id;

    INSERT INTO public.class_lifecycle_audit (cohort_id, action, actor_user_id, reason, detail)
    VALUES (p_cohort_id, 'restore', p_actor, v_reason,
            v_counts || jsonb_build_object('was_legacy', v_was_legacy,
                                           'previous_archived_at', v_c.archived_at,
                                           'previous_archived_by', v_c.archived_by,
                                           'previous_archive_reason', v_c.archive_reason));

    RETURN jsonb_build_object('status', 'restored', 'counts', v_counts, 'was_legacy', v_was_legacy);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_cohort_archive_counts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_archive_cohort(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_restore_cohort(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cohort_archive_counts(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_archive_cohort(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_restore_cohort(uuid, uuid, text) TO service_role;

-- 5. Guards (SECURITY DEFINER: the FOR SHARE row lock needs UPDATE privilege on
-- cohorts, which clients do not have; the lock must hold whoever writes)

-- 5a. Membership. AFTER, not BEFORE: for INSERT … ON CONFLICT DO UPDATE,
-- PostgreSQL fires BEFORE INSERT before it resolves the conflict, but AFTER
-- INSERT only for a row actually inserted and AFTER UPDATE (with the real OLD)
-- for the conflict update. A new row, an inactive→active change or a cohort_id
-- change into an archived class is refused; an upsert of an already-active row
-- passes. Raising here still aborts the whole statement (a bulk add is refused
-- as a whole), and the 326 student_archived checks raise earlier.
CREATE OR REPLACE FUNCTION public.fn_guard_membership_cohort_active()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_is_active   boolean;
    v_archived_at timestamptz;
BEGIN
    IF NEW.is_active AND (TG_OP = 'INSERT' OR NOT OLD.is_active
                          OR NEW.cohort_id IS DISTINCT FROM OLD.cohort_id) THEN
        SELECT is_active, archived_at INTO v_is_active, v_archived_at
          FROM public.cohorts WHERE id = NEW.cohort_id
           FOR SHARE;
        IF FOUND AND NOT v_is_active AND v_archived_at IS NOT NULL THEN
            RAISE EXCEPTION 'cohort_archived'
                USING DETAIL = NEW.cohort_id::text,
                      HINT = 'CLASSARCHIVE-0030: restore the class before adding learners.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- 5b. Class assignment (BEFORE INSERT only)
CREATE OR REPLACE FUNCTION public.fn_guard_class_assignment_cohort_active()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_is_active   boolean;
    v_archived_at timestamptz;
BEGIN
    SELECT is_active, archived_at INTO v_is_active, v_archived_at
      FROM public.cohorts WHERE id = NEW.cohort_id
       FOR SHARE;
    IF FOUND AND NOT v_is_active AND v_archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'cohort_archived'
            USING DETAIL = NEW.cohort_id::text,
                  HINT = 'CLASSARCHIVE-0030: restore the class before giving class work.';
    END IF;
    RETURN NEW;
END;
$$;

-- 5c. Class item (BEFORE INSERT only: the reaper, full retry, timed start and
-- the Advanced Vocabulary / grammar finalisers only UPDATE existing items)
CREATE OR REPLACE FUNCTION public.fn_guard_class_item_cohort_active()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_cohort_id   uuid;
    v_is_active   boolean;
    v_archived_at timestamptz;
BEGIN
    SELECT c.id, c.is_active, c.archived_at INTO v_cohort_id, v_is_active, v_archived_at
      FROM public.class_assignments a
      JOIN public.cohorts c ON c.id = a.cohort_id
     WHERE a.id = NEW.assignment_id
       FOR SHARE OF c;
    IF FOUND AND NOT v_is_active AND v_archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'cohort_archived'
            USING DETAIL = v_cohort_id::text,
                  HINT = 'CLASSARCHIVE-0030: restore the class before giving class work.';
    END IF;
    RETURN NEW;
END;
$$;

-- 5d. Cohort Writing give (BEFORE INSERT only; individual gives keep
-- cohort_id NULL and pass). A replayed idempotent request returns its stored
-- receipt before any insert, so it never reaches this guard.
CREATE OR REPLACE FUNCTION public.fn_guard_writing_give_cohort_active()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_is_active   boolean;
    v_archived_at timestamptz;
BEGIN
    IF NEW.cohort_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT is_active, archived_at INTO v_is_active, v_archived_at
      FROM public.cohorts WHERE id = NEW.cohort_id
       FOR SHARE;
    IF FOUND AND NOT v_is_active AND v_archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'cohort_archived'
            USING DETAIL = NEW.cohort_id::text,
                  HINT = 'CLASSARCHIVE-0030: restore the class before giving Writing work.';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_guard_membership_cohort_active() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_guard_class_assignment_cohort_active() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_guard_class_item_cohort_active() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_guard_writing_give_cohort_active() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_guard_membership_cohort_active
    AFTER INSERT OR UPDATE OF is_active, cohort_id ON public.student_cohort_memberships
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_membership_cohort_active();

CREATE OR REPLACE TRIGGER trg_guard_class_assignment_cohort_active
    BEFORE INSERT ON public.class_assignments
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_class_assignment_cohort_active();

CREATE OR REPLACE TRIGGER trg_guard_class_item_cohort_active
    BEFORE INSERT ON public.class_assignment_items
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_class_item_cohort_active();

-- Sorts after the migration-331 learner guard (BEFORE ROW triggers fire in
-- name order), so student_archived still wins for a give.
CREATE OR REPLACE TRIGGER trg_guard_writing_give_cohort_active
    BEFORE INSERT ON public.writing_assignments
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_writing_give_cohort_active();

-- 6. fn_restore_student: the 326 body, plus (0029 FR-003 Revision 1)
--    - the candidate classes are locked FOR SHARE in id order before their
--      archive state is read. An archive that committed first is then seen by
--      the later statements (fresh READ COMMITTED snapshots) and the class is
--      skipped; an archive that starts later waits for this restore and counts
--      the restored membership. Without the lock, an archive committing between
--      the EXISTS read and the membership guard would abort the restore (500);
--    - memberships in archived classes are not reactivated (legacy inactive
--      classes are, as before) and are reported as skipped_archived_cohort_ids
--      in the audit detail and the receipt.
--    The primary pointer only takes a restored class, so it never points at an
--    archived one. Lock order stays students → cohorts.
CREATE OR REPLACE FUNCTION public.fn_restore_student(
    p_student_id         uuid,
    p_actor              uuid,
    p_reason             text DEFAULT NULL,
    p_restore_cohorts    boolean DEFAULT true,
    p_reactivate_account boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_s        public.students%ROWTYPE;
    v_detail   jsonb;
    v_cohorts  uuid[] := '{}';
    v_restored uuid[] := '{}';
    v_skipped  uuid[] := '{}';
    v_primary  uuid;
    v_reactivated boolean := false;
BEGIN
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'restore_actor_required';
    END IF;
    SELECT * INTO v_s FROM public.students WHERE id = p_student_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    IF v_s.archived_at IS NULL THEN
        RETURN jsonb_build_object('status', 'not_archived');
    END IF;

    SELECT detail INTO v_detail FROM public.student_lifecycle_audit
     WHERE student_id = p_student_id AND action = 'archive'
     ORDER BY created_at DESC LIMIT 1;

    IF p_restore_cohorts AND v_detail ? 'ended_cohort_ids' THEN
        SELECT COALESCE(array_agg(x::uuid), '{}') INTO v_cohorts
          FROM jsonb_array_elements_text(v_detail -> 'ended_cohort_ids') AS x;
        PERFORM 1 FROM public.cohorts c WHERE c.id = ANY (v_cohorts)
         ORDER BY c.id FOR SHARE;
        SELECT COALESCE(array_agg(c.id ORDER BY c.id), '{}') INTO v_skipped
          FROM public.cohorts c
         WHERE c.id = ANY (v_cohorts) AND NOT c.is_active AND c.archived_at IS NOT NULL;
        WITH back AS (
            UPDATE public.student_cohort_memberships m
               SET is_active = true, left_at = NULL, updated_at = now()
             WHERE m.student_id = p_student_id AND m.cohort_id = ANY (v_cohorts)
               AND NOT m.is_active
               AND EXISTS (SELECT 1 FROM public.cohorts c WHERE c.id = m.cohort_id
                              AND (c.is_active OR c.archived_at IS NULL))
            RETURNING m.cohort_id
        )
        SELECT COALESCE(array_agg(cohort_id), '{}') INTO v_restored FROM back;
        v_primary := CASE
            WHEN (v_detail ->> 'previous_cohort_id')::uuid = ANY (v_restored)
                THEN (v_detail ->> 'previous_cohort_id')::uuid
            ELSE v_restored[1] END;
    END IF;

    UPDATE public.students
       SET archived_at = NULL, archived_by = NULL, archive_reason = NULL,
           cohort_id = COALESCE(v_primary, cohort_id)
     WHERE id = p_student_id;

    IF p_reactivate_account AND v_s.user_id IS NOT NULL THEN
        UPDATE public.users SET is_active = true WHERE id = v_s.user_id AND NOT is_active;
        v_reactivated := FOUND;
    END IF;

    INSERT INTO public.student_lifecycle_audit
        (student_id, user_id, action, actor_user_id, reason, detail)
    VALUES (p_student_id, v_s.user_id, 'restore', p_actor, p_reason,
            jsonb_build_object('restored_cohort_ids', to_jsonb(v_restored),
                               'skipped_archived_cohort_ids', to_jsonb(v_skipped),
                               'account_reactivated', v_reactivated));

    RETURN jsonb_build_object('status', 'restored', 'restored_cohort_ids', to_jsonb(v_restored),
                              'skipped_archived_cohort_ids', to_jsonb(v_skipped),
                              'account_reactivated', v_reactivated);
END;
$$;

-- 7. Postconditions
DO $$
DECLARE
    v_fn      regprocedure;
    v_src     text;
    v_attnums smallint[];
BEGIN
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'cohorts'
           AND column_name IN ('archived_at', 'archived_by', 'archive_reason')) <> 3 THEN
        RAISE EXCEPTION 'cohorts_archive_columns_missing';
    END IF;

    -- Triggers: enabled, bound to their function, with the exact timing/events.
    -- tgtype bits: ROW 1, BEFORE 2, INSERT 4, UPDATE 16.
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.cohorts'::regclass AND tgname = 'trg_cohorts_archive_metadata'
                      AND tgfoid = 'public.fn_cohorts_archive_metadata()'::regprocedure
                      AND tgenabled = 'O' AND tgtype = 23 AND tgattr = ''::int2vector) THEN
        RAISE EXCEPTION 'cohorts_archive_metadata_trigger_wrong';
    END IF;
    SELECT array_agg(attnum ORDER BY attnum) INTO v_attnums FROM pg_attribute
     WHERE attrelid = 'public.student_cohort_memberships'::regclass
       AND attname IN ('is_active', 'cohort_id');
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.student_cohort_memberships'::regclass
                      AND tgname = 'trg_guard_membership_cohort_active'
                      AND tgfoid = 'public.fn_guard_membership_cohort_active()'::regprocedure
                      AND tgenabled = 'O' AND tgtype = 21
                      AND (SELECT array_agg(a ORDER BY a) FROM unnest(tgattr::smallint[]) AS a) = v_attnums) THEN
        RAISE EXCEPTION 'membership_guard_trigger_wrong';    -- AFTER ROW INSERT OR UPDATE OF is_active, cohort_id
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.class_assignments'::regclass
                      AND tgname = 'trg_guard_class_assignment_cohort_active'
                      AND tgfoid = 'public.fn_guard_class_assignment_cohort_active()'::regprocedure
                      AND tgenabled = 'O' AND tgtype = 7) THEN
        RAISE EXCEPTION 'class_assignment_guard_trigger_wrong';   -- BEFORE ROW INSERT only
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.class_assignment_items'::regclass
                      AND tgname = 'trg_guard_class_item_cohort_active'
                      AND tgfoid = 'public.fn_guard_class_item_cohort_active()'::regprocedure
                      AND tgenabled = 'O' AND tgtype = 7) THEN
        RAISE EXCEPTION 'class_item_guard_trigger_wrong';         -- BEFORE ROW INSERT only (T002a)
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.writing_assignments'::regclass
                      AND tgname = 'trg_guard_writing_give_cohort_active'
                      AND tgfoid = 'public.fn_guard_writing_give_cohort_active()'::regprocedure
                      AND tgenabled = 'O' AND tgtype = 7) THEN
        RAISE EXCEPTION 'writing_give_guard_trigger_wrong';       -- BEFORE ROW INSERT only
    END IF;

    -- Every 337 function and fn_restore_student: pinned definer, no client EXECUTE.
    FOREACH v_fn IN ARRAY ARRAY[
        'public.fn_cohorts_archive_metadata()'::regprocedure,
        'public.fn_cohort_archive_counts(uuid)'::regprocedure,
        'public.fn_archive_cohort(uuid,uuid,text)'::regprocedure,
        'public.fn_restore_cohort(uuid,uuid,text)'::regprocedure,
        'public.fn_guard_membership_cohort_active()'::regprocedure,
        'public.fn_guard_class_assignment_cohort_active()'::regprocedure,
        'public.fn_guard_class_item_cohort_active()'::regprocedure,
        'public.fn_guard_writing_give_cohort_active()'::regprocedure,
        'public.fn_restore_student(uuid,uuid,text,boolean,boolean)'::regprocedure]
    LOOP
        IF NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']
                  FROM pg_proc WHERE oid = v_fn) THEN
            RAISE EXCEPTION 'class_archive_function_not_pinned_security_definer: %', v_fn;
        END IF;
        IF has_function_privilege('anon', v_fn, 'EXECUTE')
           OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
           OR (SELECT proacl IS NULL
                   OR EXISTS (SELECT 1 FROM aclexplode(proacl) a
                               WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
                 FROM pg_proc WHERE oid = v_fn) THEN
            RAISE EXCEPTION 'class_archive_function_client_executable: %', v_fn;
        END IF;
    END LOOP;
    FOREACH v_fn IN ARRAY ARRAY[
        'public.fn_cohort_archive_counts(uuid)'::regprocedure,
        'public.fn_archive_cohort(uuid,uuid,text)'::regprocedure,
        'public.fn_restore_cohort(uuid,uuid,text)'::regprocedure,
        'public.fn_restore_student(uuid,uuid,text,boolean,boolean)'::regprocedure]
    LOOP
        IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
            RAISE EXCEPTION 'class_archive_service_grant_missing: %', v_fn;
        END IF;
    END LOOP;

    SELECT prosrc INTO v_src FROM pg_proc
     WHERE oid = 'public.fn_restore_student(uuid,uuid,text,boolean,boolean)'::regprocedure;
    IF position('students WHERE id = p_student_id FOR UPDATE' IN v_src) = 0
       OR position('ORDER BY c.id FOR SHARE' IN v_src) = 0
       OR position('(c.is_active OR c.archived_at IS NULL)' IN v_src) = 0
       OR position('skipped_archived_cohort_ids' IN v_src) = 0 THEN
        RAISE EXCEPTION 'fn_restore_student_archive_skip_missing';
    END IF;

    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.class_lifecycle_audit'::regclass)
       OR has_table_privilege('anon', 'public.class_lifecycle_audit', 'SELECT, INSERT, UPDATE, DELETE')
       OR has_table_privilege('authenticated', 'public.class_lifecycle_audit', 'SELECT, INSERT, UPDATE, DELETE')
       OR has_table_privilege('service_role', 'public.class_lifecycle_audit', 'UPDATE, DELETE, TRUNCATE')
       OR NOT has_table_privilege('service_role', 'public.class_lifecycle_audit', 'SELECT')
       OR NOT has_table_privilege('service_role', 'public.class_lifecycle_audit', 'INSERT') THEN
        RAISE EXCEPTION 'class_lifecycle_audit_privileges_wrong';
    END IF;
    IF has_table_privilege('anon', 'public.cohorts', 'INSERT, UPDATE')
       OR has_table_privilege('authenticated', 'public.cohorts', 'INSERT, UPDATE')
       OR has_table_privilege('anon', 'public.student_cohort_memberships', 'SELECT, INSERT, UPDATE, DELETE')
       OR has_table_privilege('authenticated', 'public.student_cohort_memberships', 'SELECT, INSERT, UPDATE, DELETE') THEN
        RAISE EXCEPTION 'class_tables_client_writable';       -- 227/320 invariants
    END IF;

    -- FR-009: no archived class is created (or lost) by applying this file.
    IF (SELECT count(*) FROM public.cohorts WHERE NOT is_active AND archived_at IS NOT NULL)
       <> current_setting('m337.archived_before')::bigint THEN
        RAISE EXCEPTION 'm337_archived_class_created';
    END IF;
END $$;

COMMIT;
