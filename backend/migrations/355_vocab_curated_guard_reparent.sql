-- Migration 355: VOCABGUARD-0040 FR-001 / PC-J267.
-- UPDATE must guard both the source and destination version of a review/task.
-- Lock parents in ascending UUID order, including when a child stays put.
-- No data, trigger, owner, grant or RLS changes. Re-runnable, one transaction.
-- Apply only after 234/235, staging first by the Leader under the advisory lock
-- and STAGING_FREEZE. Production needs separate owner approval at promotion.
-- Forward policy: pending_feature, group vocab_curated_guard_reparent.
--
-- Manual down script (restores the exact 234/235 bodies; reopens the bypass).
-- Run only with explicit rollback authorization, through the locked runner.
-- BEGIN DOWN
-- BEGIN;
-- SET LOCAL lock_timeout = '5s';
--
-- CREATE OR REPLACE FUNCTION fn_guard_published_vocab_review()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- SET search_path = public, pg_temp
-- AS $$
-- DECLARE
--     v_version_id UUID;
--     v_version_status TEXT;
-- BEGIN
--     IF TG_OP = 'DELETE' THEN
--         v_version_id := OLD.version_id;
--     ELSE
--         v_version_id := NEW.version_id;
--     END IF;
--     SELECT status INTO v_version_status
--       FROM vocab_unit_versions
--      WHERE id = v_version_id
--      FOR SHARE;
--     IF v_version_status = 'published' THEN
--         RAISE EXCEPTION 'published_vocab_review_is_immutable';
--     END IF;
--     IF TG_OP = 'DELETE' THEN
--         RETURN OLD;
--     END IF;
--     RETURN NEW;
-- END;
-- $$;
--
-- CREATE OR REPLACE FUNCTION fn_guard_published_vocab_task()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- SET search_path = public, pg_temp
-- AS $$
-- DECLARE
--     v_version_id UUID;
--     v_version_status TEXT;
-- BEGIN
--     IF TG_OP = 'DELETE' THEN
--         v_version_id := OLD.version_id;
--     ELSE
--         v_version_id := NEW.version_id;
--     END IF;
--     SELECT status INTO v_version_status
--       FROM vocab_unit_versions
--      WHERE id = v_version_id
--      FOR SHARE;
--     IF v_version_status = 'published' THEN
--         RAISE EXCEPTION 'published_vocab_task_is_immutable';
--     END IF;
--     IF TG_OP = 'DELETE' THEN
--         RETURN OLD;
--     END IF;
--     RETURN NEW;
-- END;
-- $$;
--
-- COMMIT;
-- END DOWN

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION fn_guard_published_vocab_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_version_ids UUID[];
    v_version_status TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_version_ids := ARRAY[OLD.version_id];
    ELSIF TG_OP = 'UPDATE' THEN
        v_version_ids := ARRAY[OLD.version_id, NEW.version_id];
    ELSE
        v_version_ids := ARRAY[NEW.version_id];
    END IF;

    -- ANY visits an unchanged parent once; ORDER BY fixes the lock order.
    FOR v_version_status IN
        SELECT status
          FROM vocab_unit_versions
         WHERE id = ANY(v_version_ids)
         ORDER BY id
         FOR SHARE
    LOOP
        IF v_version_status = 'published' THEN
            RAISE EXCEPTION 'published_vocab_review_is_immutable';
        END IF;
    END LOOP;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_guard_published_vocab_task()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_version_ids UUID[];
    v_version_status TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_version_ids := ARRAY[OLD.version_id];
    ELSIF TG_OP = 'UPDATE' THEN
        v_version_ids := ARRAY[OLD.version_id, NEW.version_id];
    ELSE
        v_version_ids := ARRAY[NEW.version_id];
    END IF;

    -- ANY visits an unchanged parent once; ORDER BY fixes the lock order.
    FOR v_version_status IN
        SELECT status
          FROM vocab_unit_versions
         WHERE id = ANY(v_version_ids)
         ORDER BY id
         FOR SHARE
    LOOP
        IF v_version_status = 'published' THEN
            RAISE EXCEPTION 'published_vocab_task_is_immutable';
        END IF;
    END LOOP;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

COMMIT;
