-- Migration: 346_class_archive_update_guards.sql
--
-- PC-J153 / CLASSARCHIVE-0030 FR-003 (specs/0030-class-archive/research.md
-- §11.4; audit PC-J106 F4). Migration 337 refuses class work and cohort
-- Writing gives *created* for an archived class, but its three work guards are
-- BEFORE INSERT only. An UPDATE that moves existing work into an archived
-- class still passed:
--   - class_assignments.cohort_id      → an archived class;
--   - writing_assignments.cohort_id    → an archived class (NULL → class too);
--   - class_assignment_items.assignment_id → an assignment of an archived class.
-- No client can write these tables and no backend path changes these columns
-- today, so this closes a service-role / SQL-editor path only.
--
-- This file adds three BEFORE UPDATE OF <column> row triggers that call the
-- unchanged 337 guard functions, only when the column value really changes
-- (WHEN NEW.<column> IS DISTINCT FROM OLD.<column>). The 337 functions read
-- only NEW and never TG_OP, so they judge the destination class the same way
-- for an UPDATE as for an INSERT: lock it FOR SHARE, raise `cohort_archived`
-- (DETAIL = class id) if it is archived. A move out of a class, to NULL, or to
-- an active or legacy-inactive class passes.
--
-- Why separate triggers and not "INSERT OR UPDATE OF …" on the 337 ones:
--   - a WHEN clause cannot read OLD on a trigger that also fires on INSERT, and
--     without it any UPDATE that merely names the column (SET cohort_id =
--     cohort_id, an upsert's DO UPDATE) would lock and judge the class;
--   - the 337 triggers, their INSERT-only postcondition (tgtype = 7) and a
--     re-apply of 337 stay untouched (research.md §11.1 still holds for them);
--   - every UPDATE the reaper, full retry, timed start and the Advanced
--     Vocabulary / grammar finalisers send (opened_at, state, mastery,
--     passed_at, status, due_at, content_config, …) does not name the guarded
--     column, so these triggers never fire for them.
-- Trigger order (BEFORE ROW triggers fire in name order): the item guard runs
-- before the timed-course snapshot and updated_at triggers; the give guard runs
-- after the migration-331 learner guard, so student_archived still wins.
-- No function, grant or data changes; no client grant is added.
--
-- Order: needs 337 (aborts without its guard functions and INSERT triggers).
-- Group `class_archive` in forward-policy.tsv: apply with
-- MIGRATION_FEATURES=class_archive through the advisory-locked runner, on
-- staging first, production only at an authorised staging→main promotion.
--
-- ROLLBACK (a new forward migration, never an edit of this file). Roll this
-- back BEFORE any 337 rollback: the 337 rollbacks drop the guard functions,
-- which these triggers depend on.
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   DROP TRIGGER IF EXISTS trg_guard_class_assignment_cohort_move ON public.class_assignments;
--   DROP TRIGGER IF EXISTS trg_guard_class_item_cohort_move ON public.class_assignment_items;
--   DROP TRIGGER IF EXISTS trg_guard_writing_give_cohort_move ON public.writing_assignments;
--   COMMIT;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 0. Preconditions: the 337 guard functions and INSERT triggers are in place.
DO $$
DECLARE
    v_trigger text;
    v_table   regclass;
    v_fn      regprocedure;
BEGIN
    IF to_regprocedure('public.fn_guard_class_assignment_cohort_active()') IS NULL
       OR to_regprocedure('public.fn_guard_class_item_cohort_active()') IS NULL
       OR to_regprocedure('public.fn_guard_writing_give_cohort_active()') IS NULL THEN
        RAISE EXCEPTION 'migration_337_missing';
    END IF;
    FOR v_trigger, v_table, v_fn IN
        SELECT * FROM (VALUES
            ('trg_guard_class_assignment_cohort_active', 'public.class_assignments'::regclass,
             'public.fn_guard_class_assignment_cohort_active()'::regprocedure),
            ('trg_guard_class_item_cohort_active', 'public.class_assignment_items'::regclass,
             'public.fn_guard_class_item_cohort_active()'::regprocedure),
            ('trg_guard_writing_give_cohort_active', 'public.writing_assignments'::regclass,
             'public.fn_guard_writing_give_cohort_active()'::regprocedure)) AS g(t, r, f)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_trigger
                        WHERE tgrelid = v_table AND tgname = v_trigger AND tgfoid = v_fn
                          AND tgenabled = 'O' AND tgtype = 7) THEN
            RAISE EXCEPTION 'migration_337_guard_missing: %', v_trigger;
        END IF;
    END LOOP;
END $$;

-- 1. Move guards (BEFORE ROW UPDATE OF the class-binding column, value changed)
CREATE OR REPLACE TRIGGER trg_guard_class_assignment_cohort_move
    BEFORE UPDATE OF cohort_id ON public.class_assignments
    FOR EACH ROW
    WHEN (NEW.cohort_id IS DISTINCT FROM OLD.cohort_id)
    EXECUTE FUNCTION public.fn_guard_class_assignment_cohort_active();

CREATE OR REPLACE TRIGGER trg_guard_class_item_cohort_move
    BEFORE UPDATE OF assignment_id ON public.class_assignment_items
    FOR EACH ROW
    WHEN (NEW.assignment_id IS DISTINCT FROM OLD.assignment_id)
    EXECUTE FUNCTION public.fn_guard_class_item_cohort_active();

CREATE OR REPLACE TRIGGER trg_guard_writing_give_cohort_move
    BEFORE UPDATE OF cohort_id ON public.writing_assignments
    FOR EACH ROW
    WHEN (NEW.cohort_id IS DISTINCT FROM OLD.cohort_id)
    EXECUTE FUNCTION public.fn_guard_writing_give_cohort_active();

-- 2. Postconditions
DO $$
DECLARE
    v_trigger text;
    v_table   regclass;
    v_fn      regprocedure;
    v_column  text;
    v_insert  text;
BEGIN
    -- tgtype bits: ROW 1, BEFORE 2, INSERT 4, UPDATE 16. 19 = BEFORE ROW UPDATE
    -- only; tgattr = exactly the guarded column; the WHEN clause compares it.
    FOR v_trigger, v_table, v_fn, v_column, v_insert IN
        SELECT * FROM (VALUES
            ('trg_guard_class_assignment_cohort_move', 'public.class_assignments'::regclass,
             'public.fn_guard_class_assignment_cohort_active()'::regprocedure, 'cohort_id',
             'trg_guard_class_assignment_cohort_active'),
            ('trg_guard_class_item_cohort_move', 'public.class_assignment_items'::regclass,
             'public.fn_guard_class_item_cohort_active()'::regprocedure, 'assignment_id',
             'trg_guard_class_item_cohort_active'),
            ('trg_guard_writing_give_cohort_move', 'public.writing_assignments'::regclass,
             'public.fn_guard_writing_give_cohort_active()'::regprocedure, 'cohort_id',
             'trg_guard_writing_give_cohort_active')) AS g(t, r, f, c, i)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_trigger t
             WHERE t.tgrelid = v_table AND t.tgname = v_trigger AND t.tgfoid = v_fn
               AND t.tgenabled = 'O' AND t.tgtype = 19
               AND (SELECT array_agg(a ORDER BY a) FROM unnest(t.tgattr::smallint[]) AS a)
                   = ARRAY[(SELECT attnum FROM pg_attribute
                             WHERE attrelid = v_table AND attname = v_column AND NOT attisdropped)]
               AND position(format('WHEN ((new.%1$s IS DISTINCT FROM old.%1$s))', v_column)
                            IN pg_get_triggerdef(t.oid)) > 0) THEN
            RAISE EXCEPTION 'class_archive_move_guard_wrong: %', v_trigger;
        END IF;
        -- The 337 INSERT guard on the same table is unchanged (T002a §11.1).
        IF NOT EXISTS (SELECT 1 FROM pg_trigger
                        WHERE tgrelid = v_table AND tgname = v_insert AND tgfoid = v_fn
                          AND tgenabled = 'O' AND tgtype = 7) THEN
            RAISE EXCEPTION 'class_archive_insert_guard_changed: %', v_insert;
        END IF;
    END LOOP;

    -- The reused 337 functions are still pinned definers with no client EXECUTE.
    FOREACH v_fn IN ARRAY ARRAY[
        'public.fn_guard_class_assignment_cohort_active()'::regprocedure,
        'public.fn_guard_class_item_cohort_active()'::regprocedure,
        'public.fn_guard_writing_give_cohort_active()'::regprocedure]
    LOOP
        IF NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']
                  FROM pg_proc WHERE oid = v_fn)
           OR has_function_privilege('anon', v_fn, 'EXECUTE')
           OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
            RAISE EXCEPTION 'class_archive_guard_function_wrong: %', v_fn;
        END IF;
    END LOOP;
END $$;

COMMIT;
