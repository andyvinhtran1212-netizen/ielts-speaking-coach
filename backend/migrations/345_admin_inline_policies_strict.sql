-- Migration: 345_admin_inline_policies_strict.sql
--
-- SECURITY (PC-J119; Security Auditor 2026-10-29 F1 (P2) and I3 (P3), PC-J74
-- F5; spec ADMINAAL2-0032, which puts every admin permission behind AAL2).
-- Tracker rows RLS-ADMIN-INLINE-AAL2 and GRAMMAR-FN-SEARCHPATH.
--
-- Part A. Seven permissive RLS policies in public check only
--   EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
-- (021, 063, 100, 138, 220 and the dashboard-created access_codes
-- "Admin only", which is not in the repo):
--   dictation_sessions        "admins read dictation sessions"        SELECT
--   dictation_attempts        "admins read dictation attempts"        SELECT
--   dictation_attempt_answers "admins read dictation attempt answers" SELECT
--   user_feedback             "admins read feedback"                  SELECT
--   lemma_overrides           "Admins manage lemma overrides"         ALL
--   vocabulary_exercises      vocab_exercises_admin_write             ALL
--   vocabulary_exercises      vocab_exercises_select (admin OR branch) SELECT
--   access_codes              "Admin only"                            ALL
-- anon and authenticated hold SELECT on all of these tables, so an admin JWT
-- read every dictation transcript, every learner feedback row, every draft
-- exercise and (once 344 drops the policies that raise 42501) every access
-- code through /rest/v1/. That held at AAL1 (password only), after
-- deactivation and for up to 3600 s after suspension (the old token), even
-- with ADMIN_AAL2_ENFORCE=true: services/staff_guard.py guards only FastAPI.
--
-- Nobody needs that path. The frontend makes no PostgREST table call on these
-- tables, and FastAPI reads and writes them with service_role (BYPASSRLS):
-- routers/listening.py, admin_overview.py, feedback.py, admin.py,
-- services/lemmatizer.py, cohort_progress_aggregator.py, student_service.py and
-- core_attempt_outcomes.py. The only JWT-scoped reader is routers/exercises.py
-- (_user_sb): it reads vocabulary_exercises for learners, filters or 404s
-- anything not published, and its pre-211 snapshot fallback only looks up
-- exercises the session already served from the published pool. So admin
-- access goes through the backend only (service_role + the 0032 staff
-- guard), as with 344, and no strict admin helper is created.
--
-- This migration:
--   1. drops the seven admin-only policies (the learner own-row policies
--      "users read own dictation sessions/attempts/attempt answers" are left
--      exactly as they are);
--   2. narrows vocab_exercises_select to status = 'published' with ALTER
--      POLICY (name, roles and command unchanged; learners and anon keep
--      reading published exercises, drafts are now invisible to every JWT);
--   3. revokes every client privilege from PUBLIC, anon and authenticated on
--      user_feedback and lemma_overrides, which now have no policy and no JWT
--      reader (same as 344). The dictation tables keep SELECT so the learner
--      own-row policies stay live; vocabulary_exercises keeps SELECT for
--      routers/exercises.py; access_codes grants belong to 344;
--   4. Part B (I3): pins search_path = public, pg_temp on the four SECURITY
--      INVOKER grammar trigger functions of 283
--      (prevent_grammar_evidence_mutation, prevent_completed_grammar_session_mutation,
--      prevent_grammar_release_content_mutation, prevent_validated_grammar_release_rewrite).
--      Bodies are unchanged; they name grammar_content_releases and
--      grammar_diagnostic_reports unqualified, so a caller's search_path could
--      otherwise resolve another schema's table inside the immutability guard.
--
-- Every step is skipped for an object that does not exist (the PC-J94
-- client-write invariant harness applies every migration since 320 to a
-- shape without these tables), and every postcondition is checked on what
-- does exist.
--
-- Postconditions (catalog-driven, not list-driven where it matters):
--   · no policy in public has the string literal 'admin' in USING or WITH
--     CHECK (any inline role check: =, IN, ANY, casts, JWT claims). A later
--     admin policy must go through a function that also checks AAL2 and the
--     active, non-suspended account;
--   · every other public policy is byte-identical before and after;
--   · vocab_exercises_select is status = 'published' only; RLS is on for
--     every table that held one of the changed policies (removing a policy
--     from a table without RLS would protect nothing);
--   · no client privilege on user_feedback / lemma_overrides;
--   · the four grammar functions carry search_path=public, pg_temp;
--   · the row count of every target table is unchanged.
--
-- One transaction, lock_timeout 5s; the target tables are locked ACCESS
-- EXCLUSIVE in name order up front (DROP POLICY needs it anyway), then counted.
-- No row is written. Re-runnable. No backend deploy needed.
--
-- Rollout: staging first under the advisory lock (group rls_admin_inline in
-- forward-policy.tsv), production only at an authorised staging→main
-- promotion. Read-only verification after apply:
--   SELECT c.relname, p.polname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
--    WHERE c.relnamespace = 'public'::regnamespace
--      AND concat_ws(' ', pg_get_expr(p.polqual, p.polrelid),
--                    pg_get_expr(p.polwithcheck, p.polrelid)) ~* '''admin''';
--   -- must return zero rows
--   SELECT p.oid::regprocedure, p.proconfig FROM pg_proc p
--    WHERE p.proname LIKE 'prevent_%grammar%';
--   -- four rows, each {"search_path=public, pg_temp"}
--
-- Rollback (forward migration). It REOPENS F1: every admin JWT, AAL1,
-- deactivated or suspended, reads these tables through /rest/v1/ again.
-- Definitions copied from the staging catalog on 2026-10-29.
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   CREATE POLICY "admins read dictation sessions" ON public.dictation_sessions
--       FOR SELECT USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));
--   CREATE POLICY "admins read dictation attempts" ON public.dictation_attempts
--       FOR SELECT USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));
--   CREATE POLICY "admins read dictation attempt answers" ON public.dictation_attempt_answers
--       FOR SELECT USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));
--   CREATE POLICY "admins read feedback" ON public.user_feedback
--       FOR SELECT USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));
--   CREATE POLICY "Admins manage lemma overrides" ON public.lemma_overrides
--       FOR ALL USING (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role = 'admin'));
--   CREATE POLICY vocab_exercises_admin_write ON public.vocabulary_exercises
--       FOR ALL USING (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role = 'admin'))
--       WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role = 'admin'));
--   ALTER POLICY vocab_exercises_select ON public.vocabulary_exercises
--       USING (status = 'published' OR EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role = 'admin'));
--   CREATE POLICY "Admin only" ON public.access_codes
--       FOR ALL USING (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role = 'admin'));
--   GRANT SELECT ON public.user_feedback, public.lemma_overrides TO anon, authenticated;
--   ALTER FUNCTION public.prevent_grammar_evidence_mutation() RESET search_path;
--   ALTER FUNCTION public.prevent_completed_grammar_session_mutation() RESET search_path;
--   ALTER FUNCTION public.prevent_grammar_release_content_mutation() RESET search_path;
--   ALTER FUNCTION public.prevent_validated_grammar_release_rewrite() RESET search_path;
--   COMMIT;
-- (Leave out the access_codes line once 344 is applied: it revokes client
-- access to that table, so the policy would only be dead weight.)

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
    -- (table, policy) for every admin-only inline policy this file drops.
    admin_policies CONSTANT TEXT[] := ARRAY[
        ['dictation_sessions',        'admins read dictation sessions'],
        ['dictation_attempts',        'admins read dictation attempts'],
        ['dictation_attempt_answers', 'admins read dictation attempt answers'],
        ['user_feedback',             'admins read feedback'],
        ['lemma_overrides',           'Admins manage lemma overrides'],
        ['vocabulary_exercises',      'vocab_exercises_admin_write'],
        ['access_codes',              'Admin only']];
    revoked_tables CONSTANT TEXT[] := ARRAY['user_feedback', 'lemma_overrides'];
    grammar_functions CONSTANT TEXT[] := ARRAY[
        'prevent_grammar_evidence_mutation',
        'prevent_completed_grammar_session_mutation',
        'prevent_grammar_release_content_mutation',
        'prevent_validated_grammar_release_rewrite'];
    -- md5 of every public policy this file must not touch.
    other_policies CONSTANT TEXT := $q$
        SELECT md5(COALESCE(string_agg(concat_ws('|', c.relname, p.polname, p.polpermissive,
                                                 p.polcmd, p.polroles::text,
                                                 pg_get_expr(p.polqual, p.polrelid),
                                                 pg_get_expr(p.polwithcheck, p.polrelid)),
                                       E'\n' ORDER BY c.relname, p.polname), ''))
          FROM pg_policy p
          JOIN pg_class c ON c.oid = p.polrelid
         WHERE c.relnamespace = 'public'::regnamespace
           AND NOT (c.relname = 'vocabulary_exercises' AND p.polname = 'vocab_exercises_select')
           AND NOT EXISTS (SELECT 1 FROM generate_subscripts($1, 1) i
                            WHERE $1[i][1] = c.relname AND $1[i][2] = p.polname)
    $q$;
    target_tables TEXT[];
    touched_tables TEXT[];
    t TEXT;
    f TEXT;
    n BIGINT;
    other_before TEXT;
    other_after TEXT;
    counts_before JSONB := '{}';
    counts_after JSONB := '{}';
    gaps TEXT;
BEGIN
    -- ── 1. Preconditions ─────────────────────────────────────────────────────
    IF to_regprocedure('auth.uid()') IS NULL THEN
        RAISE EXCEPTION 'auth_uid_missing';
    END IF;
    IF to_regclass('public.vocabulary_exercises') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pg_policy
         WHERE polrelid = to_regclass('public.vocabulary_exercises')
           AND polname = 'vocab_exercises_select') THEN
        RAISE EXCEPTION 'vocab_exercises_select_missing';
    END IF;
    FOREACH f IN ARRAY grammar_functions LOOP
        IF EXISTS (SELECT 1 FROM pg_proc
                    WHERE proname = f AND pronamespace = 'public'::regnamespace)
           AND NOT EXISTS (SELECT 1 FROM pg_proc
                            WHERE oid = to_regprocedure('public.' || f || '()')
                              AND prorettype = 'trigger'::regtype AND NOT prosecdef) THEN
            RAISE EXCEPTION 'grammar_function_signature_drift: %', f;
        END IF;
    END LOOP;

    SELECT COALESCE(array_agg(DISTINCT admin_policies[i][1] ORDER BY admin_policies[i][1]), '{}')
      INTO target_tables
      FROM generate_subscripts(admin_policies, 1) i
     WHERE to_regclass('public.' || admin_policies[i][1]) IS NOT NULL;

    FOREACH t IN ARRAY target_tables LOOP
        EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', t);
    END LOOP;
    FOREACH t IN ARRAY target_tables LOOP
        EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
        counts_before := counts_before || jsonb_build_object(t, n);
    END LOOP;
    EXECUTE other_policies INTO other_before USING admin_policies;
    -- Tables that really hold one of the policies changed below.
    SELECT COALESCE(array_agg(DISTINCT c.relname ORDER BY c.relname), '{}')
      INTO touched_tables
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'public'::regnamespace
       AND ((c.relname = 'vocabulary_exercises' AND p.polname = 'vocab_exercises_select')
            OR EXISTS (SELECT 1 FROM generate_subscripts(admin_policies, 1) i
                        WHERE admin_policies[i][1] = c.relname AND admin_policies[i][2] = p.polname));

    -- ── 2. Drop the admin-only inline policies ───────────────────────────────
    IF to_regclass('public.dictation_sessions') IS NOT NULL THEN
        DROP POLICY IF EXISTS "admins read dictation sessions" ON public.dictation_sessions;
    END IF;
    IF to_regclass('public.dictation_attempts') IS NOT NULL THEN
        DROP POLICY IF EXISTS "admins read dictation attempts" ON public.dictation_attempts;
    END IF;
    IF to_regclass('public.dictation_attempt_answers') IS NOT NULL THEN
        DROP POLICY IF EXISTS "admins read dictation attempt answers" ON public.dictation_attempt_answers;
    END IF;
    IF to_regclass('public.user_feedback') IS NOT NULL THEN
        DROP POLICY IF EXISTS "admins read feedback" ON public.user_feedback;
    END IF;
    IF to_regclass('public.lemma_overrides') IS NOT NULL THEN
        DROP POLICY IF EXISTS "Admins manage lemma overrides" ON public.lemma_overrides;
    END IF;
    IF to_regclass('public.vocabulary_exercises') IS NOT NULL THEN
        DROP POLICY IF EXISTS vocab_exercises_admin_write ON public.vocabulary_exercises;
        -- ── 3. Learners keep published exercises; the admin branch goes ──────
        ALTER POLICY vocab_exercises_select ON public.vocabulary_exercises
            USING (status = 'published');
    END IF;
    IF to_regclass('public.access_codes') IS NOT NULL THEN
        DROP POLICY IF EXISTS "Admin only" ON public.access_codes;
    END IF;

    -- ── 4. No client privilege where no policy and no JWT reader is left ────
    FOREACH t IN ARRAY revoked_tables LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
            EXECUTE format('REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
                           ' ON public.%I FROM PUBLIC, anon, authenticated', t);
            IF current_setting('server_version_num')::int >= 170000 THEN
                EXECUTE format('REVOKE MAINTAIN ON public.%I FROM PUBLIC, anon, authenticated', t);
            END IF;
        END IF;
    END LOOP;

    -- ── 5. Part B: pin search_path on the grammar trigger functions ─────────
    IF to_regprocedure('public.prevent_grammar_evidence_mutation()') IS NOT NULL THEN
        ALTER FUNCTION public.prevent_grammar_evidence_mutation() SET search_path = public, pg_temp;
    END IF;
    IF to_regprocedure('public.prevent_completed_grammar_session_mutation()') IS NOT NULL THEN
        ALTER FUNCTION public.prevent_completed_grammar_session_mutation() SET search_path = public, pg_temp;
    END IF;
    IF to_regprocedure('public.prevent_grammar_release_content_mutation()') IS NOT NULL THEN
        ALTER FUNCTION public.prevent_grammar_release_content_mutation() SET search_path = public, pg_temp;
    END IF;
    IF to_regprocedure('public.prevent_validated_grammar_release_rewrite()') IS NOT NULL THEN
        ALTER FUNCTION public.prevent_validated_grammar_release_rewrite() SET search_path = public, pg_temp;
    END IF;

    -- ── 6. Postconditions ────────────────────────────────────────────────────
    SELECT string_agg(format('%I.%I', c.relname, p.polname), ', ' ORDER BY c.relname, p.polname)
      INTO gaps
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'public'::regnamespace
       AND concat_ws(' ', pg_get_expr(p.polqual, p.polrelid),
                     pg_get_expr(p.polwithcheck, p.polrelid)) ~* '''admin''';
    IF gaps IS NOT NULL THEN
        RAISE EXCEPTION 'inline_admin_policy_remains: %', gaps;
    END IF;

    EXECUTE other_policies INTO other_after USING admin_policies;
    IF other_after IS DISTINCT FROM other_before THEN
        RAISE EXCEPTION 'non_target_policy_changed';
    END IF;

    IF to_regclass('public.vocabulary_exercises') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pg_policy p
         WHERE p.polrelid = to_regclass('public.vocabulary_exercises')
           AND p.polname = 'vocab_exercises_select' AND p.polpermissive AND p.polcmd = 'r'
           AND p.polwithcheck IS NULL
           AND pg_get_expr(p.polqual, p.polrelid) ~ '^\(*status\)?(::\w+)? = ''published''::text\)*$') THEN
        RAISE EXCEPTION 'vocab_exercises_select_not_published_only';
    END IF;

    SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO gaps
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relname = ANY (touched_tables) AND NOT c.relrowsecurity;
    IF gaps IS NOT NULL THEN
        RAISE EXCEPTION 'rls_disabled: %', gaps;
    END IF;

    SELECT string_agg(format('%s:%s:%s', c.relname, r, priv), ', ' ORDER BY c.relname, r, priv)
      INTO gaps
      FROM pg_class c
     CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated']) r
     CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                             'REFERENCES', 'TRIGGER']) priv
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relname = ANY (revoked_tables)
       AND has_table_privilege(r, c.oid, priv);
    IF gaps IS NOT NULL THEN
        RAISE EXCEPTION 'client_privilege_remains: %', gaps;
    END IF;

    SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO gaps
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = ANY (grammar_functions)
       AND NOT COALESCE(p.proconfig @> ARRAY['search_path=public, pg_temp'], false);
    IF gaps IS NOT NULL THEN
        RAISE EXCEPTION 'grammar_function_search_path_not_pinned: %', gaps;
    END IF;

    FOREACH t IN ARRAY target_tables LOOP
        EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
        counts_after := counts_after || jsonb_build_object(t, n);
    END LOOP;
    IF counts_after IS DISTINCT FROM counts_before THEN
        RAISE EXCEPTION 'row_count_changed: % -> %', counts_before, counts_after;
    END IF;
END $$;

COMMIT;
