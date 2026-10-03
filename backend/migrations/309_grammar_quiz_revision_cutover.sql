-- GRAMMARCUTOVER-0014: additive boundaries only. No bank enrollment/cutover,
-- publication, learner-purpose backfill, historical score/progress mutation.
BEGIN;

ALTER TABLE public.quiz_banks
  ADD COLUMN IF NOT EXISTS grammar_canonical_code TEXT,
  ADD COLUMN IF NOT EXISTS grammar_revision TEXT,
  ADD COLUMN IF NOT EXISTS grammar_is_current BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS grammar_predecessor_bank_id UUID REFERENCES public.quiz_banks(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS grammar_retired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grammar_new_starts_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.quiz_sessions
  ADD COLUMN IF NOT EXISTS grammar_revision TEXT,
  ADD COLUMN IF NOT EXISTS grammar_admission_kind TEXT,
  ADD COLUMN IF NOT EXISTS grammar_predecessor_session_id UUID REFERENCES public.quiz_sessions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS grammar_mastery_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grammar_reset_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.grammar_quiz_allowed_code(p_code TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
  SELECT COALESCE(p_code IN ('G-parts-of-speech-verbs',
    'G-sentence-structures-passive-voice','G-tenses-past-continuous',
    'G-tenses-present-continuous','G-tenses-present-perfect-continuous',
    'G-tenses-present-simple','G-grammar-for-reading-participle-clauses',
    'G-grammar-for-reading-long-sentence-untangling',
    'G-grammar-for-reading-reduced-relative-clauses','G-tenses-past-perfect',
    'G-foundations-phrase-vs-clause','G-error-clinic-dangling-modifiers'), FALSE)
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.quiz_banks'::regclass AND conname='quiz_banks_grammar_revision_shape') THEN
    ALTER TABLE public.quiz_banks ADD CONSTRAINT quiz_banks_grammar_revision_shape CHECK (
      (grammar_canonical_code IS NULL AND grammar_revision IS NULL AND NOT grammar_is_current
        AND grammar_predecessor_bank_id IS NULL AND grammar_retired_at IS NULL)
      OR (public.grammar_quiz_allowed_code(grammar_canonical_code) AND skill_area='grammar'
        AND topic_id IS NOT NULL AND course_id IS NULL AND lesson_no IS NULL
        AND grammar_revision IS NOT NULL AND grammar_revision ~ '^[0-9a-f]{64}$'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.quiz_sessions'::regclass AND conname='quiz_sessions_grammar_revision_shape') THEN
    ALTER TABLE public.quiz_sessions ADD CONSTRAINT quiz_sessions_grammar_revision_shape CHECK (
      (grammar_revision IS NULL AND grammar_admission_kind IS NULL AND grammar_predecessor_session_id IS NULL)
      OR (grammar_revision IS NOT NULL AND grammar_admission_kind IS NOT NULL
        AND grammar_revision ~ '^[0-9a-f]{64}$' AND grammar_admission_kind IN ('run','review','continuation')));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_banks_grammar_current
  ON public.quiz_banks(grammar_canonical_code) WHERE grammar_is_current;
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_grammar_completion
  ON public.quiz_sessions(bank_id,user_id) WHERE grammar_mastery_completed_at IS NOT NULL;

-- BEFORE STATEMENT precedes tuple/FK locks, including direct table writes.
-- Ordinary quiz statements share this gate. Rare bounded cutover acquires its
-- exclusive form FIRST. Unrelated quiz writes only wait during that cutover.
CREATE OR REPLACE FUNCTION public.grammar_quiz_shared_write_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(306, 1);
  IF TG_OP='TRUNCATE' AND (
      EXISTS (SELECT 1 FROM public.quiz_banks WHERE grammar_canonical_code IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.governance_audit WHERE action='grammar_quiz_revision_cutover')) THEN
    RAISE EXCEPTION 'grammar_managed_history_retained' USING ERRCODE='55000';
  END IF;
  RETURN NULL;
END $$;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['content_topics','quiz_banks','quiz_questions','quiz_sessions','quiz_attempts','quiz_word_stats','governance_audit'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS grammar_quiz_statement_gate ON public.%I',t);
    EXECUTE format('CREATE TRIGGER grammar_quiz_statement_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.grammar_quiz_shared_write_gate()',t);
  END LOOP;
END $$;
-- Parent erasure must also precede the managed code/session locks. Otherwise
-- progress can own a session while waiting on its next INSERT's owner FK,
-- while erasure owns that parent and waits on the same session's cascade.
-- A statement trigger has no selected-owner transition table before DELETE;
-- lock the exact twelve bounded codes in one deterministic order, without
-- blocking unrelated unmanaged writes behind the global exclusive gate.
CREATE OR REPLACE FUNCTION public.grammar_quiz_account_erasure_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE code TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(306,1);
  FOREACH code IN ARRAY ARRAY['G-error-clinic-dangling-modifiers','G-foundations-phrase-vs-clause',
    'G-grammar-for-reading-long-sentence-untangling','G-grammar-for-reading-participle-clauses',
    'G-grammar-for-reading-reduced-relative-clauses','G-parts-of-speech-verbs',
    'G-sentence-structures-passive-voice','G-tenses-past-continuous','G-tenses-past-perfect',
    'G-tenses-present-continuous','G-tenses-present-perfect-continuous','G-tenses-present-simple'] LOOP
    PERFORM pg_advisory_xact_lock(306,hashtext(code));
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS grammar_quiz_account_erasure_gate ON auth.users;
CREATE TRIGGER grammar_quiz_account_erasure_gate BEFORE DELETE ON auth.users
FOR EACH STATEMENT EXECUTE FUNCTION public.grammar_quiz_account_erasure_scope();

CREATE OR REPLACE FUNCTION public.grammar_quiz_erased_owner(p_user UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT p_user IS NOT NULL AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user)
$$;

-- The operation context is transaction-local, internal, and binds exact actor,
-- code, bank and session/operation IDs. It is NOT a blanket mutation switch.
-- No authenticated/anon SQL role can manufacture a context to write a managed
-- row; service-only lifecycle RPCs establish it after ownership/revision checks.
CREATE OR REPLACE FUNCTION public.grammar_quiz_operation_context()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v JSONB; r TEXT := current_setting('role',true);
BEGIN
  IF r IN ('anon','authenticated') THEN RETURN NULL; END IF;
  BEGIN v := NULLIF(current_setting('aver.grammar_quiz_context',true),'')::JSONB;
  EXCEPTION WHEN invalid_text_representation THEN RETURN NULL; END;
  IF jsonb_typeof(v)<>'object' OR NOT public.grammar_quiz_allowed_code(v->>'code')
     OR COALESCE(v->>'action','') NOT IN ('cutover','start','progress','end','reset','pause_starts') THEN
    RETURN NULL;
  END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.grammar_quiz_guard_bank()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c JSONB := public.grammar_quiz_operation_context();
  fields TEXT[] := ARRAY['grammar_canonical_code','grammar_revision','grammar_is_current',
    'grammar_predecessor_bank_id','grammar_retired_at','grammar_new_starts_enabled'];
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.grammar_canonical_code IS NOT NULL THEN
      RAISE EXCEPTION 'grammar_managed_bank_immutable' USING ERRCODE='55000';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.grammar_canonical_code IS NOT NULL AND NOT COALESCE((
      c->>'action'='cutover' AND c->>'code'=NEW.grammar_canonical_code
      AND c->>'bank'=NEW.id::TEXT AND c->>'old_bank'=NEW.grammar_predecessor_bank_id::TEXT
      AND NEW.code=NEW.grammar_canonical_code || '~' || left(c->>'source_sha256',16)
      AND NEW.grammar_revision=c->>'new_revision'
      AND c->>'source_sha256' ~ '^[0-9a-f]{64}$'
      AND EXISTS(SELECT 1 FROM public.quiz_banks old_bank WHERE old_bank.id=NEW.grammar_predecessor_bank_id
        AND old_bank.grammar_canonical_code=NEW.grammar_canonical_code
        AND old_bank.topic_id=NEW.topic_id AND old_bank.code=NEW.grammar_canonical_code
        AND old_bank.grammar_revision=c->>'old_revision' AND old_bank.grammar_retired_at IS NOT NULL
        AND old_bank.grammar_predecessor_bank_id IS NULL)
      AND NEW.grammar_is_current AND NEW.grammar_retired_at IS NULL),FALSE) THEN
      RAISE EXCEPTION 'grammar_managed_bank_context_invalid' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.grammar_canonical_code IS NULL AND NEW.grammar_canonical_code IS NULL THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW)-fields-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-fields-'updated_at') THEN
    RAISE EXCEPTION 'grammar_managed_bank_immutable' USING ERRCODE='55000';
  END IF;
  IF c->>'action'='cutover' AND c->>'old_bank'=OLD.id::TEXT
    AND OLD.grammar_canonical_code IS NULL
    AND NEW.grammar_canonical_code=c->>'code'
    AND NEW.code=NEW.grammar_canonical_code
    AND NOT NEW.grammar_is_current AND NEW.grammar_predecessor_bank_id IS NULL
    AND NEW.grammar_revision=c->>'old_revision' AND NEW.grammar_retired_at IS NOT NULL
    AND NEW.grammar_new_starts_enabled=OLD.grammar_new_starts_enabled THEN
    NEW.updated_at := OLD.updated_at; RETURN NEW;
  END IF;
  IF c->>'action'='pause_starts' AND c->>'bank'=OLD.id::TEXT
    AND c->>'code'=OLD.grammar_canonical_code
    AND (to_jsonb(NEW)-'grammar_new_starts_enabled'-'updated_at')=(to_jsonb(OLD)-'grammar_new_starts_enabled'-'updated_at')
    AND NOT NEW.grammar_new_starts_enabled THEN
    NEW.updated_at := OLD.updated_at; RETURN NEW;
  END IF;
  RAISE EXCEPTION 'grammar_managed_bank_immutable' USING ERRCODE='55000';
END $$;
DROP TRIGGER IF EXISTS zz_grammar_quiz_bank_guard ON public.quiz_banks;
CREATE TRIGGER zz_grammar_quiz_bank_guard BEFORE INSERT OR UPDATE OR DELETE ON public.quiz_banks
FOR EACH ROW EXECUTE FUNCTION public.grammar_quiz_guard_bank();

CREATE OR REPLACE FUNCTION public.grammar_quiz_guard_question()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.quiz_banks%ROWTYPE; c JSONB := public.grammar_quiz_operation_context(); bid UUID;
BEGIN
  bid := CASE WHEN TG_OP='DELETE' THEN OLD.bank_id ELSE NEW.bank_id END;
  IF TG_OP='UPDATE' AND NEW.bank_id<>OLD.bank_id AND EXISTS(
      SELECT 1 FROM public.quiz_banks WHERE id=OLD.bank_id AND grammar_canonical_code IS NOT NULL) THEN
    RAISE EXCEPTION 'grammar_managed_questions_immutable' USING ERRCODE='55000';
  END IF;
  SELECT * INTO b FROM public.quiz_banks WHERE id=bid;
  IF b.grammar_canonical_code IS NOT NULL AND NOT COALESCE((
    TG_OP='INSERT' AND c->>'action'='cutover' AND c->>'bank'=bid::TEXT
    AND c->>'code'=b.grammar_canonical_code
    AND c->>'old_bank'=b.grammar_predecessor_bank_id::TEXT),FALSE) THEN
    RAISE EXCEPTION 'grammar_managed_questions_immutable' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS grammar_quiz_question_guard ON public.quiz_questions;
CREATE TRIGGER grammar_quiz_question_guard BEFORE INSERT OR UPDATE OR DELETE ON public.quiz_questions
FOR EACH ROW EXECUTE FUNCTION public.grammar_quiz_guard_question();

CREATE OR REPLACE FUNCTION public.grammar_quiz_guard_topic()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.quiz_banks WHERE topic_id=OLD.id AND grammar_canonical_code IS NOT NULL)
     AND (TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW.skill_area<>OLD.skill_area) THEN
    RAISE EXCEPTION 'grammar_managed_topic_retained' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS grammar_quiz_topic_guard ON public.content_topics;
CREATE TRIGGER grammar_quiz_topic_guard BEFORE UPDATE OR DELETE ON public.content_topics
FOR EACH ROW EXECUTE FUNCTION public.grammar_quiz_guard_topic();

CREATE OR REPLACE FUNCTION public.grammar_quiz_retain_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c JSONB := public.grammar_quiz_operation_context();
BEGIN
  IF TG_OP<>'INSERT' AND OLD.action='grammar_quiz_revision_cutover' THEN
    RAISE EXCEPTION 'grammar_cutover_receipt_retained' USING ERRCODE='55000';
  END IF;
  IF TG_OP<>'DELETE' AND NEW.action='grammar_quiz_revision_cutover' AND NOT COALESCE((
      TG_OP='INSERT' AND c->>'action'='cutover'
      AND NEW.admin_id::TEXT=c->>'actor' AND NEW.target_instructor IS NULL
      AND octet_length(NEW.detail)<=1048576),FALSE) THEN
    RAISE EXCEPTION 'grammar_cutover_receipt_context_invalid' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS grammar_quiz_receipt_guard ON public.governance_audit;
CREATE TRIGGER grammar_quiz_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON public.governance_audit
FOR EACH ROW EXECUTE FUNCTION public.grammar_quiz_retain_receipt();

-- Preserve the original parser/import implementation, but its lower functions
-- are now private to these fixed service-only wrappers. Gate acquisition MUST
-- happen before the 294 implementation obtains a topic lock.
DO $$ BEGIN
  IF to_regprocedure('public.import_quiz_bank_unmanaged_306(jsonb,jsonb,text)') IS NULL THEN
    ALTER FUNCTION public.import_quiz_bank_atomic(JSONB,JSONB,TEXT) RENAME TO import_quiz_bank_unmanaged_306;
  END IF;
  IF to_regprocedure('public.quiz_replace_unmanaged_306(uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.quiz_replace_questions(UUID,JSONB) RENAME TO quiz_replace_unmanaged_306;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.import_quiz_bank_unmanaged_306(JSONB,JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.quiz_replace_unmanaged_306(UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.import_quiz_bank_atomic(p_payload JSONB,p_rows JSONB,p_publish_state TEXT DEFAULT 'preserve')
RETURNS TABLE(bank_id UUID,written INTEGER,is_published BOOLEAN,action TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(306,1);
  IF COALESCE(p_payload->'meta' ? 'text_match_by_qid',FALSE)
    AND p_payload->'meta'->'text_match_by_qid' IS DISTINCT FROM '{}'::JSONB THEN
    RAISE EXCEPTION 'grammar_mapped_import_requires_cutover' USING ERRCODE='55000';
  END IF;
  IF EXISTS(SELECT 1 FROM public.quiz_banks b WHERE b.grammar_canonical_code IS NOT NULL
    AND b.skill_area=p_payload->>'skill_area'
    AND b.topic_id=NULLIF(p_payload->>'topic_id','')::UUID AND b.code=p_payload->>'code') THEN
    RAISE EXCEPTION 'grammar_managed_bank_immutable' USING ERRCODE='55000';
  END IF;
  RETURN QUERY SELECT * FROM public.import_quiz_bank_unmanaged_306(p_payload,p_rows,p_publish_state);
END $$;
CREATE OR REPLACE FUNCTION public.quiz_replace_questions(p_bank_id UUID,p_rows JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(306,1);
  IF EXISTS(SELECT 1 FROM public.quiz_banks WHERE id=p_bank_id AND grammar_canonical_code IS NOT NULL) THEN
    RAISE EXCEPTION 'grammar_managed_questions_immutable' USING ERRCODE='55000';
  END IF;
  RETURN public.quiz_replace_unmanaged_306(p_bank_id,p_rows);
END $$;
REVOKE ALL ON FUNCTION public.import_quiz_bank_atomic(JSONB,JSONB,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.import_quiz_bank_atomic(JSONB,JSONB,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.quiz_replace_questions(UUID,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_replace_questions(UUID,JSONB) TO service_role;

-- Lifecycle helpers/RPCs follow below. All scopes acquire shared gate then
-- per-code scope BEFORE bank/session/stat/attempt row locks.
CREATE OR REPLACE FUNCTION public.grammar_quiz_unique_json(p_value JSON)
RETURNS VOID LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE e RECORD; seen TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF json_typeof(p_value)='object' THEN
    FOR e IN SELECT key,value FROM json_each(p_value) LOOP
      IF e.key=ANY(seen) THEN RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000'; END IF;
      seen := array_append(seen,e.key);
      PERFORM public.grammar_quiz_unique_json(e.value);
    END LOOP;
  ELSIF json_typeof(p_value)='array' THEN
    FOR e IN SELECT value FROM json_array_elements(p_value) LOOP
      PERFORM public.grammar_quiz_unique_json(e.value);
    END LOOP;
  END IF;
END $$;

-- Derived from actual approved004ce parser/source bytes. This immutable private
-- manifest holds only twelve hashes/META/allowed fields, never duplicated questions.
CREATE OR REPLACE FUNCTION public.grammar_quiz_reviewed_binding(p_code TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE STRICT SET search_path=public,pg_temp AS $binding$
  SELECT $reviewed${"G-error-clinic-dangling-modifiers":{"allowed_fields":{"dm_clause_a2":["explain","prompt"],"dm_clause_b1":["explain","prompt"],"dm_clause_b2":["explain","prompt"],"dm_clause_i1":["explain","prompt"],"dm_clause_i2":["accept","explain","prompt"],"dm_part_a1":["explain"],"dm_part_b2":["explain","prompt"],"dm_part_i2":["explain","prompt"],"dm_subj_a2":["explain","prompt"],"dm_subj_b2":["explain","prompt"],"dm_subj_i1":["explain"],"dm_subj_i2":["explain","prompt"],"dm_toinf_a1":["explain","prompt"],"dm_toinf_a2":["explain","prompt"],"dm_toinf_b1":["explain"],"dm_toinf_b2":["explain","prompt"],"dm_toinf_i2":["explain","prompt"]},"manifest_sha256":"477ae949146cb4343d997d709280e69428bb2bf4baed0771fbe2cf62c03f46f7","metadata":{"code":"G-error-clinic-dangling-modifiers","course_id":null,"lesson_no":null,"meta":{"cooldown":2,"correct_to_master":2,"grading":"instant","mode":"adaptive_mastery","require_distinct_skill":true,"require_production_to_master":true,"shuffle_options":true,"text_match_by_qid":{"dm_clause_i2":"exact","dm_subj_i2":"exact","dm_toinf_i2":"exact"}},"skill_area":"grammar","source":"authored-2026-07","title":"Quick Check — Dangling Modifiers","version":1,"words_count":4},"source_sha256":"8606094f523bdd1a95666ebeb6139a3e71d1efd6f712aecba06e5bfebd20dec4"},"G-foundations-phrase-vs-clause":{"allowed_fields":{"pvc_dang_i2":["accept","explain","prompt"],"pvc_frag_a1":["explain"],"pvc_frag_i1":["explain","prompt"],"pvc_frag_i2":["explain","prompt"],"pvc_pc_a1":["explain","prompt"],"pvc_pc_b1":["explain","prompt"],"pvc_pc_b2":["explain","prompt"],"pvc_pc_i2":["explain"],"pvc_run_i2":["prompt"]},"manifest_sha256":"c336148456499027f89fb349aaf87fc18039395108292c03657ef8255e45f35d","metadata":{"code":"G-foundations-phrase-vs-clause","course_id":null,"lesson_no":null,"meta":{"cooldown":2,"correct_to_master":2,"grading":"instant","mode":"adaptive_mastery","require_distinct_skill":true,"require_production_to_master":true,"shuffle_options":true,"text_match_by_qid":{"pvc_dang_i2":"exact","pvc_frag_i2":"exact"}},"skill_area":"grammar","source":"authored-2026-07","title":"Quick Check — Phrase vs. Clause","version":1,"words_count":4},"source_sha256":"66dfacf3a82258a91252cb33c3624967183c9313291b958b02ef64648a619dd9"},"G-grammar-for-reading-long-sentence-untangling":{"allowed_fields":{"lsu_main_a1":["explain"],"lsu_main_a2":["explain","prompt"],"lsu_main_b1":["explain","prompt"],"lsu_main_b2":["explain","prompt"],"lsu_main_i1":["explain"],"lsu_main_i2":["explain","prompt"],"lsu_pitfall_a2":["explain"],"lsu_pitfall_i3":["accept","explain","prompt"],"lsu_strip_a1":["explain","prompt"],"lsu_strip_a2":["explain","prompt"],"lsu_strip_b1":["explain","prompt"],"lsu_strip_b2":["explain","prompt"],"lsu_strip_i1":["explain","prompt"],"lsu_strip_i2":["accept","explain","prompt"]},"manifest_sha256":"8c0a7a893647ecb8b72379d50f5fbc1b045b4fd13a86365c89f0a76e1b0792bc","metadata":{"code":"G-grammar-for-reading-long-sentence-untangling","course_id":null,"lesson_no":null,"meta":{"cooldown":2,"correct_to_master":2,"grading":"instant","mode":"adaptive_mastery","require_distinct_skill":true,"require_production_to_master":true,"shuffle_options":true},"skill_area":"grammar","source":"authored-2026-07","title":"Quick Check — Long Sentence Untangling","version":1,"words_count":3},"source_sha256":"f272f1d183cb766746c269510f0d226bf88036606dbdb2c3dfa246b716c6fcf0"},"G-grammar-for-reading-participle-clauses":{"allowed_fields":{"pc_having_b1":["explain","prompt"],"pc_having_i1":["explain","prompt"],"pc_having_i2":["prompt"],"pc_meaning_a1":["explain","prompt"],"pc_meaning_b1":["explain"],"pc_meaning_i2":["explain","prompt"],"pc_v3_b1":["explain","prompt"],"pc_v3_i1":["explain","prompt"],"pc_v3_i2":["explain","prompt"],"pc_ving_b1":["explain","prompt"],"pc_ving_i1":["explain","prompt"],"pc_ving_i2":["explain","prompt"]},"manifest_sha256":"85e04eb57d0a0ad72c44dddaf3d3584ba6c2a0d106330245c917b26645eee133","metadata":{"code":"G-grammar-for-reading-participle-clauses","course_id":null,"lesson_no":null,"meta":{"cooldown":2,"correct_to_master":2,"grading":"instant","mode":"adaptive_mastery","require_distinct_skill":true,"require_production_to_master":true,"shuffle_options":true,"text_match_by_qid":{"pc_having_i2":"exact","pc_v3_i2":"exact","pc_ving_i2":"exact"}},"skill_area":"grammar","source":"authored-2026-07","title":"Quick Check — Participle Clauses","version":1,"words_count":4},"source_sha256":"f63edb03e73d2e657a82d16b4adfff004b01b9bf2e7bb9f2a93b3a6e3eb4a730"},"G-grammar-for-reading-reduced-relative-clauses":{"allowed_fields":{"rrc_main_a1":["explain"],"rrc_main_i2":["explain","prompt"],"rrc_v3_a1":["explain"],"rrc_v3_b1":["explain","prompt"],"rrc_v3_i1":["explain","prompt"],"rrc_v3_i2":["accept","explain","prompt"],"rrc_ving_b1":["explain","prompt"],"rrc_ving_i1":["explain","options"],"rrc_ving_i2":["explain","prompt"]},"manifest_sha256":"bb08f18af7392830fac4aa0dc1f88e1fc69d49fc37275f42b25776f2b973e7b0","metadata":{"code":"G-grammar-for-reading-reduced-relative-clauses","course_id":null,"lesson_no":null,"meta":{"cooldown":2,"correct_to_master":2,"grading":"instant","mode":"adaptive_mastery","require_distinct_skill":true,"require_production_to_master":true,"shuffle_options":true,"text_match_by_qid":{"rrc_main_i2":"exact","rrc_v3_i2":"exact","rrc_ving_i2":"exact"}},"skill_area":"grammar","source":"authored-2026-07","title":"Quick Check — Reduced Relative Clauses","version":1,"words_count":3},"source_sha256":"f9c0cab2ce4292531dfeda4d8353f6044d5d77d55d38068e8567f83730d3884d"},"G-parts-of-speech-verbs":{"allowed_fields":{"verb_stat_a1":["answer","explain","prompt"],"verb_stat_b1":["explain"],"verb_stat_b2":["explain","prompt"],"verb_stat_i1":["explain","prompt"],"verb_stat_i2":["explain","prompt"]},"manifest_sha256":"e43ebcca9b399eadfa4b030434fdb4d91fd1b9bef2326b4c4d10836ea5843ed5","metadata":{"code":"G-parts-of-speech-verbs","course_id":null,"lesson_no":null,"meta":{"cooldown":2,"correct_to_master":2,"grading":"instant","mode":"adaptive_mastery","require_distinct_skill":true,"require_production_to_master":true,"shuffle_options":true,"text_match_by_qid":{"verb_pp_i2":"exact","verb_stat_i2":"exact","verb_sva_i2":"exact"}},"skill_area":"grammar","source":"authored-2026-07","title":"Quick Check — Verbs","version":1,"words_count":4},"source_sha256":"36e8b94fa47dfb8fc2316a1e1cab6003d79639e1e593f7c42d2d660b258afc9d"},"G-sentence-structures-passive-voice":{"allowed_fields":{"pv_err_a1":["explain","prompt"],"pv_err_i1":["explain"],"pv_err_i2":["prompt"],"pv_form_b2":["explain"],"pv_intr_i2":["prompt"],"pv_use_i2":["explain"]},"manifest_sha256":"4d29060817b67b558767e3a9111c926df00eb184294506f9e6accdd772323ddd","metadata":{"code":"G-sentence-structures-passive-voice","course_id":null,"lesson_no":null,"meta":{"cooldown":2,"correct_to_master":2,"grading":"instant","mode":"adaptive_mastery","require_distinct_skill":true,"require_production_to_master":true,"shuffle_options":true,"text_match_by_qid":{"pv_err_i2":"exact","pv_form_i2":"exact","pv_intr_i2":"exact","pv_use_a1":"exact"}},"skill_area":"grammar","source":"authored-2026-07","title":"Quick Check — Passive Voice","version":1,"words_count":4},"source_sha256":"2299da1f37da6ab306821c0eb34dc5735837156dfac4a7a8a480e3861fe5d866"},"G-tenses-past-continuous":{"allowed_fields":{"pc_form_b1":["explain","prompt"],"pc_form_b2":["explain","prompt"],"pc_form_i1":["explain","prompt"],"pc_form_i2":["explain","prompt"],"pc_form_i3":["prompt"],"pc_interrupt_a1":["answer","explain","prompt"],"pc_interrupt_b1":["explain","prompt"],"pc_interrupt_b2":["explain","prompt"],"pc_interrupt_i1":["explain","prompt"],"pc_interrupt_i2":["explain","prompt"],"pc_interrupt_i3":["explain","prompt"],"pc_stative_a1":["answer","explain","prompt"],"pc_stative_a2":["explain"],"pc_stative_b1":["explain"],"pc_stative_b2":["explain","prompt"],"pc_stative_i1":["explain"],"pc_stative_i2":["explain","prompt"],"pc_stative_i3":["explain","prompt"],"pc_while_a1":["explain","prompt"],"pc_while_b1":["explain","prompt"],"pc_while_b2":["explain","prompt"],"pc_while_i1":["explain","options","prompt"],"pc_while_i2":["explain","prompt"],"pc_while_i3":["explain","prompt"]},"manifest_sha256":"719d77f2f13ca1f67fcbcd6ae82c0b1351cdb1aca8bd7106c081cc16ac68d0db","metadata":{"code":"G-tenses-past-continuous","course_id":null,"lesson_no":null,"meta":{"cooldown":2,"correct_to_master":2,"grading":"instant","mode":"adaptive_mastery","require_distinct_skill":true,"require_production_to_master":true,"shuffle_options":true,"text_match_by_qid":{"pc_form_i2":"exact","pc_form_i3":"exact","pc_interrupt_i2":"exact","pc_interrupt_i3":"exact","pc_stative_i2":"exact","pc_stative_i3":"exact","pc_while_i2":"exact","pc_while_i3":"exact"}},"skill_area":"grammar","source":"authored-2026-07","title":"Quick Check — Past Continuous","version":1,"words_count":4},"source_sha256":"1d75f48d70c9e476423383ec269f2a55fcc9eb8ca01307c45c4050c861bb11a6"},"G-tenses-past-perfect":{"allowed_fields":{"pqp_bytime_a1":["explain","prompt"],"pqp_bytime_b1":["explain","prompt"],"pqp_bytime_i1":["explain","prompt"],"pqp_bytime_i2":["explain","prompt"],"pqp_cond3_b1":["prompt"],"pqp_cond3_i1":["prompt"],"pqp_cond3_i2":["prompt"],"pqp_form_b2":["explain","prompt"],"pqp_form_i1":["explain","prompt"],"pqp_form_i2":["prompt"],"pqp_reported_a1":["explain","prompt"],"pqp_reported_b1":["explain","prompt"],"pqp_reported_i1":["explain","prompt"],"pqp_reported_i2":["explain","prompt"],"pqp_seq_a2":["explain","prompt"],"pqp_seq_i2":["explain","prompt"]},"manifest_sha256":"dc18875c1ada1a3e72c05db2b67267cfb7cb2c64abd4402ec53c01aa42b3bc85","metadata":{"code":"G-tenses-past-perfect","course_id":null,"lesson_no":null,"meta":{"cooldown":2,"correct_to_master":2,"grading":"instant","mode":"adaptive_mastery","require_distinct_skill":true,"require_production_to_master":true,"shuffle_options":true,"text_match_by_qid":{"pqp_bytime_i2":"exact","pqp_cond3_i2":"exact","pqp_form_i2":"exact","pqp_reported_i2":"exact","pqp_seq_i2":"exact"}},"skill_area":"grammar","source":"authored-2026-07","title":"Quick Check — Past Perfect","version":1,"words_count":5},"source_sha256":"297a5ae369e3bc727601e4c39157b32f43b759d2e33872201cc1df8e58222183"},"G-tenses-present-continuous":{"allowed_fields":{"pc_form_a2":["explain"],"pc_form_b1":["explain","prompt"],"pc_form_i1":["explain","prompt"],"pc_form_i2":["prompt"],"pc_ing_i2":["prompt"],"pc_stative_a1":["answer","explain","prompt"],"pc_stative_a2":["explain","prompt"],"pc_stative_b1":["explain"],"pc_stative_b2":["explain","prompt"],"pc_stative_i1":["explain"],"pc_stative_i2":["explain","prompt"],"pc_temp_a1":["explain","prompt"],"pc_temp_a2":["explain","options","prompt"],"pc_temp_b1":["explain","prompt"],"pc_temp_i1":["explain","prompt"],"pc_temp_i2":["explain","prompt"],"pc_trend_a1":["explain"],"pc_trend_a2":["explain"],"pc_trend_b1":["explain","prompt"],"pc_trend_i1":["explain","prompt"],"pc_trend_i2":["explain","prompt"]},"manifest_sha256":"140828a526bfe896663156422e7a0488490bb4289f25d2e310853e3cfe31c5b1","metadata":{"code":"G-tenses-present-continuous","course_id":null,"lesson_no":null,"meta":{"cooldown":2,"correct_to_master":2,"grading":"instant","mode":"adaptive_mastery","require_distinct_skill":true,"require_production_to_master":true,"shuffle_options":true,"text_match_by_qid":{"pc_form_i2":"exact","pc_ing_i2":"exact","pc_stative_i2":"exact","pc_temp_i2":"exact","pc_trend_i2":"exact"}},"skill_area":"grammar","source":"authored-2026-07","title":"Quick Check — Present Continuous","version":1,"words_count":5},"source_sha256":"711e42becddee32bfee93f6d0b691a318403b1b4ffef01302d28d2dbed1c037a"},"G-tenses-present-perfect-continuous":{"allowed_fields":{"ppc_form_b1":["explain","prompt"],"ppc_form_i1":["explain","prompt"],"ppc_form_i2":["prompt"],"ppc_forsince_i2":["explain","prompt"],"ppc_stative_a1":["explain"],"ppc_stative_a2":["answer","explain"],"ppc_stative_b1":["explain"],"ppc_stative_i1":["explain","options","prompt"],"ppc_stative_i2":["explain","prompt"],"ppc_vspc_a1":["explain","prompt"],"ppc_vspc_a2":["explain","prompt"],"ppc_vspc_b1":["explain","prompt"],"ppc_vspc_i2":["prompt"],"ppc_vspp_a1":["explain"],"ppc_vspp_a2":["explain","prompt"],"ppc_vspp_b1":["explain","prompt"],"ppc_vspp_i1":["explain","prompt"],"ppc_vspp_i2":["explain","prompt"]},"manifest_sha256":"1520fc1a79b33814b518901fc674b2c287d31a7946bb4d924d5312cfb5586c36","metadata":{"code":"G-tenses-present-perfect-continuous","course_id":null,"lesson_no":null,"meta":{"cooldown":2,"correct_to_master":2,"grading":"instant","mode":"adaptive_mastery","require_distinct_skill":true,"require_production_to_master":true,"shuffle_options":true,"text_match_by_qid":{"ppc_form_i2":"exact","ppc_stative_i2":"exact","ppc_vspc_i2":"exact","ppc_vspp_i2":"exact"}},"skill_area":"grammar","source":"authored-2026-07","title":"Quick Check — Present Perfect Continuous","version":1,"words_count":5},"source_sha256":"67ffbc97e73fdb1d43a88644a77d0ebfbb93b845b8f2dd6c8575dec93d84ef3a"},"G-tenses-present-simple":{"allowed_fields":{"ps_3s_b1":["explain","prompt"],"ps_3s_i2":["prompt"],"ps_3s_i3":["prompt"],"ps_adv_a1":["answer","explain","prompt"],"ps_adv_i1":["explain","prompt"],"ps_adv_i2":["prompt"],"ps_adv_i3":["explain","prompt"],"ps_dd_i2":["prompt"],"ps_dd_i3":["prompt"],"ps_truth_a1":["explain","prompt"],"ps_truth_b1":["explain","prompt"],"ps_truth_i1":["explain"],"ps_truth_i2":["prompt"],"ps_truth_i3":["prompt"],"ps_vspc_a1":["answer","explain","prompt"],"ps_vspc_a2":["answer","explain","prompt"],"ps_vspc_b1":["explain"],"ps_vspc_i1":["explain","prompt"],"ps_vspc_i2":["prompt"]},"manifest_sha256":"cc5f490add6a475b8638fcf2866f5e07987e7eebd46edfa1e3c9674ef753651c","metadata":{"code":"G-tenses-present-simple","course_id":null,"lesson_no":null,"meta":{"cooldown":2,"correct_to_master":2,"grading":"instant","mode":"adaptive_mastery","require_distinct_skill":true,"require_production_to_master":true,"shuffle_options":true,"text_match_by_qid":{"ps_3s_i2":"exact","ps_3s_i3":"exact","ps_adv_i2":"exact","ps_adv_i3":"exact","ps_dd_i2":"exact","ps_dd_i3":"exact","ps_truth_i2":"exact","ps_truth_i3":"exact","ps_vspc_i2":"exact"}},"skill_area":"grammar","source":"authored-2026-07","title":"Quick Check — Present Simple","version":1,"words_count":5},"source_sha256":"97d6af8d735ff80ca24c7e499a7443c53218444d804273e28d6c304eb6634670"}}$reviewed$::JSONB -> p_code
$binding$;

-- Compact UTF-8 JSON matches the producer's exact Decimal encoder. Only private
-- proof/source owners call this helper; grants are revoked with all helpers below.
-- No new META cap: inputs are the existing bounded source/receipt/200-question
-- owner scope, and unrelated immutable META values remain part of the evidence.
CREATE OR REPLACE FUNCTION public.grammar_quiz_evidence_json(p_value JSONB)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=public,pg_temp AS $$
DECLARE result TEXT; kind TEXT:=jsonb_typeof(p_value);
BEGIN
  IF kind='object' THEN
    SELECT '{'||COALESCE(string_agg(to_jsonb(key)::TEXT||':'||public.grammar_quiz_evidence_json(value),
      ',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(p_value);
  ELSIF kind='array' THEN
    SELECT '['||COALESCE(string_agg(public.grammar_quiz_evidence_json(value),',' ORDER BY ordinal),'')||']'
      INTO result FROM jsonb_array_elements(p_value) WITH ORDINALITY AS a(value,ordinal);
  ELSE result:=p_value::TEXT;
  END IF;
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.grammar_quiz_evidence_hash(p_value JSONB)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT SET search_path=public,pg_temp AS $$
  SELECT encode(sha256(convert_to(public.grammar_quiz_evidence_json(p_value),'UTF8')),'hex')
$$;
CREATE OR REPLACE FUNCTION public.grammar_quiz_evidence_timestamp(p_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE sql IMMUTABLE STRICT SET search_path=public,pg_temp AS $$
  SELECT to_jsonb((to_jsonb(p_value AT TIME ZONE 'UTC') #>> '{}')||'+00:00')
$$;
CREATE OR REPLACE FUNCTION public.grammar_quiz_bank_evidence(p_value public.quiz_banks)
RETURNS JSONB LANGUAGE sql STABLE STRICT SET search_path=public,pg_temp AS $$
  SELECT to_jsonb(p_value)||jsonb_build_object(
    'created_at',public.grammar_quiz_evidence_timestamp(p_value.created_at),
    'updated_at',public.grammar_quiz_evidence_timestamp(p_value.updated_at),
    'grammar_retired_at',public.grammar_quiz_evidence_timestamp(p_value.grammar_retired_at))
$$;
CREATE OR REPLACE FUNCTION public.grammar_quiz_question_evidence(p_value public.quiz_questions)
RETURNS JSONB LANGUAGE sql STABLE STRICT SET search_path=public,pg_temp AS $$
  SELECT to_jsonb(p_value)||jsonb_build_object('created_at',public.grammar_quiz_evidence_timestamp(p_value.created_at))
$$;

CREATE OR REPLACE FUNCTION public.grammar_quiz_validate_receipt_envelope(p_data JSONB,p_bank UUID,p_actor UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.quiz_banks%ROWTYPE; n public.quiz_banks%ROWTYPE; binding JSONB;
  old_bank JSONB; new_bank JSONB; old_questions JSONB; new_questions JSONB;
  old_q JSONB; new_q JSONB; before_q JSONB; after_q JSONB; reviewed_questions JSONB:='[]';
  fields JSONB; changes JSONB:='[]'; key TEXT; candidate BOOLEAN; pre JSONB; initial_old JSONB;
  expected TEXT; preview TEXT; committed TEXT; original TEXT; manifest TEXT; corrected TEXT; matches INTEGER:=0;
  stamp TIMESTAMPTZ; count_old INTEGER; count_new INTEGER; i INTEGER;
  sha_keys TEXT[]:=ARRAY['payload_sha256','source_sha256','manifest_sha256','preview_fingerprint',
    'expected_revision','committed_revision','original_revision','corrected_revision',
    'original_questions_sha256','original_metadata_sha256','original_history_sha256','integrity_sha256'];
  uuid_keys TEXT[]:=ARRAY['actor_id','operation_id','topic_id','original_bank_id','corrected_bank_id'];
  grammar_fields TEXT[]:=ARRAY['grammar_canonical_code','grammar_revision','grammar_is_current',
    'grammar_predecessor_bank_id','grammar_retired_at','grammar_new_starts_enabled'];
  q_fields TEXT[]:=ARRAY['qid','item_key','type','subtype','input','skill','pair','counts_toward_mastery',
    'prompt','hint','options','answer','accept','segments','mask','pairs','explain','points','audio_url','grammar_article_slug','order'];
BEGIN
  IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_data))<>21
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('schema_version','canonical_code',
      'cohort','created_at') AND k<>ALL(sha_keys) AND k<>ALL(uuid_keys))
    OR jsonb_typeof(p_data->'schema_version') IS DISTINCT FROM 'number' OR p_data->>'schema_version'<>'1'
    OR jsonb_typeof(p_data->'canonical_code') IS DISTINCT FROM 'string'
    OR NOT public.grammar_quiz_allowed_code(p_data->>'canonical_code')
    OR jsonb_typeof(p_data->'created_at') IS DISTINCT FROM 'string'
    OR COALESCE(p_data->>'created_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
    OR jsonb_typeof(p_data->'cohort') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
  END IF;
  FOREACH key IN ARRAY sha_keys LOOP
    IF jsonb_typeof(p_data->key) IS DISTINCT FROM 'string' OR COALESCE(p_data->>key,'') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
    END IF;
  END LOOP;
  FOREACH key IN ARRAY uuid_keys LOOP
    IF jsonb_typeof(p_data->key) IS DISTINCT FROM 'string'
      OR COALESCE(p_data->>key,'') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
    END IF;
  END LOOP;
  BEGIN stamp:=(p_data->>'created_at')::TIMESTAMPTZ;
  EXCEPTION WHEN data_exception THEN
    RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
  END;
  SELECT * INTO b FROM public.quiz_banks WHERE id=p_bank;
  SELECT * INTO n FROM public.quiz_banks WHERE id=(p_data->>'corrected_bank_id')::UUID;
  binding:=public.grammar_quiz_reviewed_binding(b.grammar_canonical_code);
  IF binding IS NULL OR p_data->>'actor_id' IS DISTINCT FROM p_actor::TEXT
    OR p_data->>'original_bank_id' IS DISTINCT FROM b.id::TEXT
    OR p_data->>'topic_id' IS DISTINCT FROM b.topic_id::TEXT
    OR p_data->>'canonical_code' IS DISTINCT FROM b.code OR b.code IS DISTINCT FROM b.grammar_canonical_code
    OR b.skill_area<>'grammar' OR n.skill_area<>'grammar' OR NOT b.is_published OR NOT n.is_published
    OR b.grammar_is_current OR b.grammar_predecessor_bank_id IS NOT NULL
    OR b.course_id IS NOT NULL OR b.lesson_no IS NOT NULL
    OR n.grammar_canonical_code IS DISTINCT FROM b.grammar_canonical_code OR NOT n.grammar_is_current
    OR n.grammar_predecessor_bank_id IS DISTINCT FROM b.id OR n.topic_id IS DISTINCT FROM b.topic_id
    OR n.code IS DISTINCT FROM b.code||'~'||left(binding->>'source_sha256',16)
    OR n.version IS DISTINCT FROM b.version+1 OR n.grammar_retired_at IS NOT NULL
    OR b.grammar_retired_at IS DISTINCT FROM stamp OR n.created_at IS DISTINCT FROM stamp OR n.updated_at IS DISTINCT FROM stamp
    OR NOT EXISTS(SELECT 1 FROM public.content_topics WHERE id=b.topic_id AND skill_area='grammar')
    OR p_data->>'source_sha256' IS DISTINCT FROM binding->>'source_sha256'
    OR p_data->>'manifest_sha256' IS DISTINCT FROM binding->>'manifest_sha256'
    OR jsonb_typeof(b.meta) IS DISTINCT FROM 'object' OR jsonb_typeof(n.meta) IS DISTINCT FROM 'object'
    OR (b.meta ? 'text_match_by_qid' AND b.meta->'text_match_by_qid' IS DISTINCT FROM '{}'::JSONB) THEN
    RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
  END IF;
  old_bank:=public.grammar_quiz_bank_evidence(b); new_bank:=public.grammar_quiz_bank_evidence(n);
  IF (new_bank-grammar_fields-ARRAY['id','code','version','created_at','updated_at','meta'])
      IS DISTINCT FROM (old_bank-grammar_fields-ARRAY['id','code','version','created_at','updated_at','meta'])
    OR n.meta IS DISTINCT FROM (b.meta||CASE WHEN binding->'metadata'->'meta' ? 'text_match_by_qid'
      THEN jsonb_build_object('text_match_by_qid',binding->'metadata'->'meta'->'text_match_by_qid') ELSE '{}'::JSONB END) THEN
    RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
  END IF;
  FOREACH key IN ARRAY ARRAY['code','title','skill_area','source','words_count','course_id','lesson_no','version'] LOOP
    IF old_bank->key IS DISTINCT FROM binding->'metadata'->key THEN
      RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
    END IF;
  END LOOP;
  FOR key IN SELECT jsonb_object_keys((binding->'metadata'->'meta')-'text_match_by_qid') LOOP
    IF b.meta->key IS DISTINCT FROM binding->'metadata'->'meta'->key THEN
      RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
    END IF;
  END LOOP;
  SELECT count(*),jsonb_agg(public.grammar_quiz_question_evidence(q) ORDER BY "order",id)
    INTO count_old,old_questions FROM (SELECT * FROM public.quiz_questions WHERE bank_id=b.id ORDER BY "order",id LIMIT 201) q;
  SELECT count(*),jsonb_agg(public.grammar_quiz_question_evidence(q) ORDER BY "order",id)
    INTO count_new,new_questions FROM (SELECT * FROM public.quiz_questions WHERE bank_id=n.id ORDER BY "order",id LIMIT 201) q;
  IF count_old<1 OR count_old>200 OR count_new<>count_old THEN
    RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
  END IF;
  FOR i IN 0..count_old-1 LOOP
    old_q:=old_questions->i;new_q:=new_questions->i;
    SELECT jsonb_object_agg(k,old_q->k) INTO before_q FROM unnest(q_fields) k;
    SELECT jsonb_object_agg(k,new_q->k) INTO after_q FROM unnest(q_fields) k;
    SELECT COALESCE(jsonb_agg(k ORDER BY k COLLATE "C"),'[]'::JSONB) INTO fields
      FROM jsonb_each(before_q) AS e(k,v) WHERE v IS DISTINCT FROM after_q->k;
    IF before_q->'qid' IS DISTINCT FROM after_q->'qid'
      OR before_q->'order' IS DISTINCT FROM after_q->'order'
      OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(fields) f
        WHERE NOT COALESCE(binding->'allowed_fields'->(after_q->>'qid') ? f,FALSE))
      OR new_q->'created_at' IS DISTINCT FROM new_bank->'created_at'
      OR (new_q-ARRAY['id','bank_id','created_at']) IS DISTINCT FROM
        ((old_q-q_fields-ARRAY['id','bank_id','created_at'])||after_q)
      OR (old_q->'why_wrong' IS DISTINCT FROM 'null'::JSONB AND jsonb_typeof(old_q->'why_wrong') IS DISTINCT FROM 'object')
      OR (old_q->'why_wrong' IS DISTINCT FROM 'null'::JSONB AND old_q->'why_wrong' IS DISTINCT FROM '{}'::JSONB
        AND fields ?| ARRAY['answer','options','accept']) THEN
      RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
    END IF;
    reviewed_questions:=reviewed_questions||jsonb_build_array(after_q);
    IF jsonb_array_length(fields)>0 THEN changes:=changes||jsonb_build_array(jsonb_build_object(
      'qid',after_q->>'qid','fields',fields,'before_sha256',public.grammar_quiz_evidence_hash(before_q),
      'after_sha256',public.grammar_quiz_evidence_hash(after_q))); END IF;
  END LOOP;
  manifest:=public.grammar_quiz_evidence_hash(jsonb_build_object('metadata',binding->'metadata','questions',reviewed_questions));
  original:=public.grammar_quiz_evidence_hash(jsonb_build_object('bank',old_bank-grammar_fields-'updated_at','questions',old_questions));
  corrected:=public.grammar_quiz_evidence_hash(jsonb_build_object('manifest_sha256',manifest,'original_revision',original));
  IF manifest IS DISTINCT FROM binding->>'manifest_sha256'
    OR original IS DISTINCT FROM b.grammar_revision OR original IS DISTINCT FROM p_data->>'original_revision'
    OR corrected IS DISTINCT FROM n.grammar_revision OR corrected IS DISTINCT FROM p_data->>'corrected_revision'
    OR public.grammar_quiz_evidence_hash(old_questions) IS DISTINCT FROM p_data->>'original_questions_sha256'
    OR public.grammar_quiz_evidence_hash(b.meta) IS DISTINCT FROM p_data->>'original_metadata_sha256'
    OR public.grammar_quiz_evidence_hash(jsonb_build_object('code',b.code,'source_sha256',binding->>'source_sha256',
      'expected_revision',p_data->>'expected_revision','preview_fingerprint',p_data->>'preview_fingerprint',
      'operation_id',p_data->>'operation_id')) IS DISTINCT FROM p_data->>'payload_sha256' THEN
    RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
  END IF;
  FOREACH candidate IN ARRAY ARRAY[FALSE,TRUE] LOOP
    initial_old:=old_bank||jsonb_build_object('grammar_new_starts_enabled',candidate);
    pre:=initial_old||jsonb_build_object('grammar_canonical_code',NULL,'grammar_revision',NULL,
      'grammar_is_current',FALSE,'grammar_predecessor_bank_id',NULL,'grammar_retired_at',NULL);
    expected:=public.grammar_quiz_evidence_hash(jsonb_build_object('original',pre,'current',pre,
      'questions',old_questions,'current_questions',old_questions));
    preview:=public.grammar_quiz_evidence_hash(jsonb_build_object('code',b.code,'expected_revision',expected,
      'source_sha256',binding->>'source_sha256','manifest_sha256',manifest,'proposed_revision',corrected,'changes',changes));
    committed:=public.grammar_quiz_evidence_hash(jsonb_build_object('original',initial_old,
      'current',new_bank||jsonb_build_object('grammar_new_starts_enabled',TRUE),
      'questions',old_questions,'current_questions',new_questions));
    IF expected=p_data->>'expected_revision' AND preview=p_data->>'preview_fingerprint'
      AND committed=p_data->>'committed_revision' THEN matches:=matches+1; END IF;
  END LOOP;
  IF matches<>1 THEN RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000'; END IF;
  -- Historical learner values are mutable/erasable: strict SHA/type + immutable
  -- retained receipt/cohort provenance only. Never hash today's history here.
END $$;

CREATE OR REPLACE FUNCTION public.grammar_quiz_receipt_data(p_bank UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.quiz_banks%ROWTYPE; row_data RECORD; data JSONB; candidates INTEGER := 0;
  owner JSONB; refs JSONB; ref_key TEXT; seen_owners TEXT[] := ARRAY[]::TEXT[];
  session_refs INTEGER; stat_refs INTEGER; attempt_refs INTEGER;
  matched_refs INTEGER; wrong_scope BOOLEAN;
  uuid_pattern TEXT := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  SELECT * INTO b FROM public.quiz_banks WHERE id=p_bank;
  IF b.grammar_canonical_code IS NULL OR b.grammar_predecessor_bank_id IS NOT NULL
     OR b.grammar_retired_at IS NULL THEN
    RAISE EXCEPTION 'grammar_cutover_proof_unavailable' USING ERRCODE='55000';
  END IF;
  FOR row_data IN SELECT admin_id,target_instructor,detail FROM public.governance_audit
    WHERE action='grammar_quiz_revision_cutover'
      AND detail ~ ('"canonical_code"[[:space:]]*:[[:space:]]*"'||b.grammar_canonical_code||'"')
      AND detail ~ ('"original_bank_id"[[:space:]]*:[[:space:]]*"'||b.id::TEXT||'"')
    ORDER BY id LIMIT 2 LOOP
    candidates := candidates+1;
    IF candidates>1 OR octet_length(row_data.detail)>1048576 THEN
      RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
    END IF;
    BEGIN
      PERFORM public.grammar_quiz_unique_json(row_data.detail::JSON);
      IF json_typeof(row_data.detail::JSON->'schema_version') IS DISTINCT FROM 'number'
        OR row_data.detail::JSON->>'schema_version' IS DISTINCT FROM '1' THEN
        RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
      END IF;
      data := row_data.detail::JSONB;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
    END;
    IF jsonb_typeof(data) IS DISTINCT FROM 'object'
      OR jsonb_typeof(data->'cohort') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
    END IF;
    IF data->'schema_version' IS DISTINCT FROM '1'::JSONB
      OR data->>'canonical_code' IS DISTINCT FROM b.grammar_canonical_code
      OR data->>'original_bank_id' IS DISTINCT FROM b.id::TEXT
      OR data->>'original_revision' IS DISTINCT FROM b.grammar_revision
      OR data->>'actor_id' IS DISTINCT FROM row_data.admin_id::TEXT
      OR row_data.target_instructor IS NOT NULL
      OR jsonb_array_length(data->'cohort')>128
      OR data->>'integrity_sha256' IS DISTINCT FROM encode(sha256(convert_to((data-'integrity_sha256')::TEXT,'UTF8')),'hex')
      OR NOT EXISTS (SELECT 1 FROM public.quiz_banks n WHERE n.id::TEXT=data->>'corrected_bank_id'
        AND n.grammar_predecessor_bank_id=b.id AND n.topic_id=b.topic_id
        AND n.grammar_canonical_code=b.grammar_canonical_code
        AND n.grammar_revision=data->>'corrected_revision') THEN
      RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
    END IF;
    PERFORM public.grammar_quiz_validate_receipt_envelope(data,p_bank,row_data.admin_id);
    -- Validate the entire bounded cohort, not only the requested owner's row.
    -- Deleted owners/references remain immutable evidence after authorized
    -- account erasure; structural validation never reconstructs their rows.
    session_refs := 0; stat_refs := 0; attempt_refs := 0;
    FOR owner IN SELECT value FROM jsonb_array_elements(data->'cohort') LOOP
      IF jsonb_typeof(owner) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
      END IF;
      IF (SELECT count(*) FROM jsonb_object_keys(owner))<>7
        OR EXISTS(SELECT 1 FROM jsonb_object_keys(owner) k WHERE k NOT IN ('user_id','eligible',
          'classification','predecessor_session_id','session_ids','stat_ids','attempt_ids'))
        OR jsonb_typeof(owner->'user_id') IS DISTINCT FROM 'string'
        OR COALESCE(owner->>'user_id','') !~ uuid_pattern
        OR owner->>'user_id'=ANY(seen_owners)
        OR jsonb_typeof(owner->'predecessor_session_id') IS DISTINCT FROM 'string'
        OR COALESCE(owner->>'predecessor_session_id','') !~ uuid_pattern
        OR jsonb_typeof(owner->'eligible') IS DISTINCT FROM 'boolean'
        OR jsonb_typeof(owner->'classification') IS DISTINCT FROM 'string'
        OR COALESCE(owner->>'classification','') NOT IN ('provably_unfinished_in_progress',
          'provably_unfinished_paused','provably_unfinished_completed_with_carryover',
          'provably_unfinished_terminal_carryover','genuinely_mastered','never_started')
        OR owner->'eligible' IS DISTINCT FROM to_jsonb(owner->>'classification' IN (
          'provably_unfinished_in_progress','provably_unfinished_paused',
          'provably_unfinished_completed_with_carryover','provably_unfinished_terminal_carryover')) THEN
        RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
      END IF;
      seen_owners := array_append(seen_owners,owner->>'user_id');
      FOREACH ref_key IN ARRAY ARRAY['session_ids','stat_ids','attempt_ids'] LOOP
        refs := owner->ref_key;
        IF jsonb_typeof(refs) IS DISTINCT FROM 'array' THEN
          RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
        END IF;
        IF jsonb_array_length(refs)>(CASE ref_key WHEN 'session_ids' THEN 2048
            WHEN 'stat_ids' THEN 8192 ELSE 32768 END)
          OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(refs))<>jsonb_array_length(refs)
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(refs) r WHERE jsonb_typeof(r)<>'string'
            OR COALESCE(r #>> '{}','') !~ uuid_pattern) THEN
          RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
        END IF;
        WITH expected AS (SELECT (value #>> '{}')::UUID AS id FROM jsonb_array_elements(refs)),
          stored AS (
            SELECT id,user_id,bank_id FROM public.quiz_sessions WHERE ref_key='session_ids' AND id IN (SELECT id FROM expected)
            UNION ALL SELECT id,user_id,bank_id FROM public.quiz_word_stats WHERE ref_key='stat_ids' AND id IN (SELECT id FROM expected)
            UNION ALL SELECT id,user_id,bank_id FROM public.quiz_attempts WHERE ref_key='attempt_ids' AND id IN (SELECT id FROM expected))
          SELECT count(*),COALESCE(bool_or(user_id::TEXT IS DISTINCT FROM owner->>'user_id' OR bank_id<>p_bank),FALSE)
            INTO matched_refs,wrong_scope FROM stored;
        IF wrong_scope OR (NOT public.grammar_quiz_erased_owner((owner->>'user_id')::UUID)
            AND matched_refs<>jsonb_array_length(refs)) THEN
          RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
        END IF;
      END LOOP;
      IF NOT owner->'session_ids' ? (owner->>'predecessor_session_id') THEN
        RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
      END IF;
      session_refs := session_refs+jsonb_array_length(owner->'session_ids');
      stat_refs := stat_refs+jsonb_array_length(owner->'stat_ids');
      attempt_refs := attempt_refs+jsonb_array_length(owner->'attempt_ids');
    END LOOP;
    IF session_refs>2048 OR stat_refs>8192 OR attempt_refs>32768
      OR session_refs<>(SELECT count(DISTINCT r.value) FROM jsonb_array_elements(data->'cohort') o
        CROSS JOIN LATERAL jsonb_array_elements(o->'session_ids') r)
      OR stat_refs<>(SELECT count(DISTINCT r.value) FROM jsonb_array_elements(data->'cohort') o
        CROSS JOIN LATERAL jsonb_array_elements(o->'stat_ids') r)
      OR attempt_refs<>(SELECT count(DISTINCT r.value) FROM jsonb_array_elements(data->'cohort') o
        CROSS JOIN LATERAL jsonb_array_elements(o->'attempt_ids') r) THEN
      RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
    END IF;
  END LOOP;
  IF candidates<>1 THEN RAISE EXCEPTION 'grammar_cutover_proof_unavailable' USING ERRCODE='55000'; END IF;
  RETURN data;
END $$;

CREATE OR REPLACE FUNCTION public.grammar_quiz_owner_proof(p_user UUID,p_bank UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE proof JSONB := public.grammar_quiz_receipt_data(p_bank); entry JSONB; n INTEGER;
BEGIN
  IF public.grammar_quiz_erased_owner(p_user) THEN RETURN NULL; END IF;
  SELECT count(*),jsonb_agg(value)->0 INTO n,entry
    FROM jsonb_array_elements(proof->'cohort') WHERE value->>'user_id'=p_user::TEXT;
  IF n>1 THEN RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000'; END IF;
  IF n=0 THEN RETURN NULL; END IF;
  IF jsonb_typeof(entry)<>'object' OR jsonb_typeof(entry->'eligible') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(entry->'session_ids') IS DISTINCT FROM 'array'
    OR jsonb_typeof(entry->'stat_ids') IS DISTINCT FROM 'array'
    OR jsonb_typeof(entry->'attempt_ids') IS DISTINCT FROM 'array'
    OR NOT EXISTS(SELECT 1 FROM public.quiz_sessions WHERE id::TEXT=entry->>'predecessor_session_id'
        AND user_id=p_user AND bank_id=p_bank)
    OR (entry->'eligible'='true'::JSONB AND COALESCE(entry->>'classification','') NOT IN (
      'provably_unfinished_in_progress','provably_unfinished_paused',
      'provably_unfinished_completed_with_carryover','provably_unfinished_terminal_carryover')) THEN
    RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
  END IF;
  RETURN entry;
END $$;

CREATE OR REPLACE FUNCTION public.grammar_quiz_mastery(p_user UUID,p_bank UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.quiz_banks%ROWTYPE; total INTEGER; mastered INTEGER; invalid BOOLEAN;
BEGIN
  SELECT * INTO b FROM public.quiz_banks WHERE id=p_bank;
  IF b.id IS NULL OR b.skill_area<>'grammar' OR jsonb_typeof(b.meta) IS DISTINCT FROM 'object'
    OR b.meta->'correct_to_master' IS DISTINCT FROM '2'::JSONB
    OR b.meta->'require_distinct_skill' IS DISTINCT FROM 'true'::JSONB
    OR b.meta->'require_production_to_master' IS DISTINCT FROM 'true'::JSONB THEN
    RAISE EXCEPTION 'grammar_mastery_state_unavailable' USING ERRCODE='55000';
  END IF;
  WITH q AS (SELECT item_key,skill FROM public.quiz_questions WHERE bank_id=p_bank
      AND input IN ('choice','text','boolean','syllable')),
    pool AS (SELECT DISTINCT item_key FROM q WHERE btrim(item_key)<>''),
    w AS (SELECT * FROM public.quiz_word_stats WHERE user_id=p_user AND bank_id=p_bank),
    checked AS (SELECT w.*,ls.id AS session_exists,ls.user_id AS owner,ls.bank_id AS own_bank,
      (SELECT count(DISTINCT value) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.skills_passed)='array'
        THEN w.skills_passed ELSE '[]'::JSONB END)) AS distinct_skills,
      EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.skills_passed)='array'
        THEN w.skills_passed ELSE '[]'::JSONB END) v WHERE jsonb_typeof(v)<>'string'
        OR btrim(v #>> '{}')='' OR NOT EXISTS(SELECT 1 FROM q WHERE q.item_key=w.item_key AND q.skill=(v #>> '{}'))) AS invalid_skills
      FROM w LEFT JOIN public.quiz_sessions ls ON ls.id=w.last_session_id)
  SELECT (SELECT count(*) FROM pool),
    (SELECT count(*) FROM pool p JOIN checked w USING(item_key)
      WHERE distinct_skills>=2 AND production_done),
    EXISTS(SELECT 1 FROM checked w WHERE jsonb_typeof(w.skills_passed) IS DISTINCT FROM 'array'
      OR w.invalid_skills OR w.credit_count<0 OR w.correct_count<0 OR w.wrong_count<0
      OR w.status NOT IN ('testing','provisional','mastered','carried_over')
      OR w.session_exists IS NULL OR w.owner<>p_user OR w.own_bank<>p_bank
      OR NOT EXISTS(SELECT 1 FROM pool WHERE pool.item_key=w.item_key))
    INTO total,mastered,invalid;
  IF total=0 OR invalid THEN RAISE EXCEPTION 'grammar_mastery_state_unavailable' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('total',total,'mastered',mastered,'remaining',total-mastered,
    'completion_recorded',EXISTS(SELECT 1 FROM public.quiz_sessions WHERE user_id=p_user AND bank_id=p_bank
      AND grammar_mastery_completed_at IS NOT NULL
      AND (NOT b.grammar_is_current OR grammar_reset_at IS NULL
        AND grammar_revision=b.grammar_revision AND grammar_admission_kind IN ('run','continuation'))));
END $$;

-- Exact Python strip whitespace used only for eligibility, never grading.
CREATE OR REPLACE FUNCTION public.grammar_quiz_python_strip(p_text TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
  SELECT btrim(p_text,chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(28)||chr(29)||chr(30)||chr(31)||
    chr(32)||chr(133)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||
    chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||
    chr(8239)||chr(8287)||chr(12288))
$$;

CREATE OR REPLACE FUNCTION public.grammar_quiz_text_policy(p_bank UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.quiz_banks%ROWTYPE; policy JSONB; entries INTEGER; eligible INTEGER; compact TEXT;
BEGIN
  SELECT * INTO b FROM public.quiz_banks WHERE id=p_bank;
  IF b.id IS NULL OR jsonb_typeof(b.meta) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'grammar_text_policy_unavailable' USING ERRCODE='55000';
  END IF;
  IF NOT b.meta ? 'text_match_by_qid' THEN RETURN NULL; END IF;
  policy := b.meta->'text_match_by_qid';
  IF jsonb_typeof(policy) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'grammar_text_policy_unavailable' USING ERRCODE='55000';
  END IF;
  SELECT count(*) INTO entries FROM jsonb_each(policy);
  IF entries>200 OR entries>0 AND (b.grammar_canonical_code IS NULL OR b.skill_area<>'grammar'
      OR NOT public.grammar_quiz_allowed_code(b.grammar_canonical_code)) THEN
    RAISE EXCEPTION 'grammar_text_policy_unavailable' USING ERRCODE='55000';
  END IF;
  WITH q AS (SELECT qid FROM public.quiz_questions WHERE bank_id=p_bank AND input='text'
      AND type IN ('gap_text','spelling','missing_letters') AND jsonb_typeof(accept)='array'
      AND jsonb_array_length(CASE WHEN jsonb_typeof(accept)='array' THEN accept ELSE '[]'::JSONB END)>0
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(accept)='array'
          THEN accept ELSE '[]'::JSONB END) a WHERE jsonb_typeof(a)<>'string'
          OR public.grammar_quiz_python_strip(a #>> '{}')=''))
    SELECT count(*) INTO eligible FROM q;
  IF entries>eligible OR EXISTS(SELECT 1 FROM jsonb_each(policy) e WHERE
      e.key IN ('__proto__','prototype','constructor') OR e.key=''
      OR jsonb_typeof(e.value)<>'string' OR (e.value #>> '{}') NOT IN ('exact','typo_tolerant')
      OR NOT EXISTS(SELECT 1 FROM public.quiz_questions q WHERE q.bank_id=p_bank AND q.qid=e.key
        AND q.input='text' AND q.type IN ('gap_text','spelling','missing_letters')
        AND jsonb_typeof(q.accept)='array'
        AND jsonb_array_length(CASE WHEN jsonb_typeof(q.accept)='array' THEN q.accept ELSE '[]'::JSONB END)>0
        AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(q.accept)='array'
            THEN q.accept ELSE '[]'::JSONB END) a WHERE jsonb_typeof(a)<>'string'
            OR public.grammar_quiz_python_strip(a #>> '{}')=''))) THEN
    RAISE EXCEPTION 'grammar_text_policy_unavailable' USING ERRCODE='55000';
  END IF;
  -- JSONB text inserts separator spaces. Build the canonical compact map
  -- without stripping whitespace inside labels; UTF-8 bytes, not characters.
  SELECT '{'||COALESCE(string_agg(to_jsonb(key)::TEXT||':'||value::TEXT,',' ORDER BY key),'')||'}'
    INTO compact FROM jsonb_each(policy);
  IF octet_length(convert_to(compact,'UTF8'))>16384 THEN
    RAISE EXCEPTION 'grammar_text_policy_unavailable' USING ERRCODE='55000';
  END IF;
  RETURN policy;
END $$;

CREATE OR REPLACE FUNCTION public.grammar_quiz_current_predecessor(p_user UUID,p_bank UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.quiz_banks%ROWTYPE; mastery JSONB; predecessor UUID;
BEGIN
  SELECT * INTO b FROM public.quiz_banks WHERE id=p_bank;
  IF NOT b.grammar_is_current OR public.grammar_quiz_erased_owner(p_user) THEN RETURN NULL; END IF;
  mastery := public.grammar_quiz_mastery(p_user,p_bank);
  IF (mastery->>'remaining')::INTEGER=0 OR (mastery->>'completion_recorded')::BOOLEAN THEN RETURN NULL; END IF;
  SELECT id INTO predecessor FROM public.quiz_sessions WHERE user_id=p_user AND bank_id=p_bank
    AND grammar_revision=b.grammar_revision AND grammar_admission_kind IN ('run','continuation')
    AND grammar_reset_at IS NULL ORDER BY started_at DESC,id DESC LIMIT 1;
  RETURN predecessor;
END $$;

CREATE OR REPLACE FUNCTION public.grammar_quiz_guard_session()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.quiz_banks%ROWTYPE; c JSONB := public.grammar_quiz_operation_context(); s public.quiz_sessions%ROWTYPE;
  bid UUID; immutable TEXT[] := ARRAY['id','user_id','bank_id','code','class_assignment_item_id','kind',
    'started_at','created_at','grammar_revision','grammar_admission_kind','grammar_predecessor_session_id','grammar_reset_at'];
BEGIN
  bid := CASE WHEN TG_OP='DELETE' THEN OLD.bank_id ELSE NEW.bank_id END;
  SELECT * INTO b FROM public.quiz_banks WHERE id=bid;
  IF TG_OP='UPDATE' AND OLD.bank_id<>NEW.bank_id AND EXISTS(
    SELECT 1 FROM public.quiz_banks WHERE id=OLD.bank_id AND grammar_canonical_code IS NOT NULL) THEN
    RAISE EXCEPTION 'grammar_managed_session_immutable' USING ERRCODE='55000';
  END IF;
  IF b.grammar_canonical_code IS NULL THEN
    IF TG_OP='INSERT' AND COALESCE(b.meta ? 'text_match_by_qid',FALSE) THEN
      PERFORM public.grammar_quiz_text_policy(bid);
    END IF;
    IF TG_OP<>'DELETE' AND (NEW.grammar_revision IS NOT NULL OR NEW.grammar_admission_kind IS NOT NULL
        OR NEW.grammar_predecessor_session_id IS NOT NULL OR NEW.grammar_mastery_completed_at IS NOT NULL
        OR NEW.grammar_reset_at IS NOT NULL) THEN
      RAISE EXCEPTION 'grammar_session_scope_invalid' USING ERRCODE='55000';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    IF public.grammar_quiz_erased_owner(OLD.user_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'grammar_managed_history_retained' USING ERRCODE='55000';
  END IF;
  IF NOT COALESCE(c->>'bank'=bid::TEXT AND c->>'code'=b.grammar_canonical_code AND c->>'actor'=NEW.user_id::TEXT,FALSE) THEN
    RAISE EXCEPTION 'grammar_managed_write_required' USING ERRCODE='55000';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NOT COALESCE(c->>'action'='start' AND NEW.grammar_revision=b.grammar_revision
      AND NEW.grammar_admission_kind=c->>'admission_kind' AND NEW.kind='run'
      AND NEW.class_assignment_item_id IS NULL AND NEW.grammar_mastery_completed_at IS NULL
      AND NEW.grammar_reset_at IS NULL
      AND NEW.ended_at IS NULL AND NEW.ended_by IS NULL
      AND NEW.total_questions=0 AND NEW.total_correct=0 AND NEW.total_wrong=0
      AND NEW.accuracy IS NULL AND NEW.words_mastered=0 AND NEW.words_carried_over=0,FALSE) THEN
      RAISE EXCEPTION 'grammar_session_admission_invalid' USING ERRCODE='55000';
    END IF;
    PERFORM public.grammar_quiz_receipt_data(CASE WHEN b.grammar_is_current THEN b.grammar_predecessor_bank_id ELSE b.id END);
    IF COALESCE(public.grammar_quiz_text_policy(bid),'{}'::JSONB)<>'{}'::JSONB
      AND c->>'text_match_policy' IS DISTINCT FROM 'qid-exact-v1' THEN
      RAISE EXCEPTION 'grammar_text_match_policy_required' USING ERRCODE='55000';
    END IF;
    IF NEW.grammar_predecessor_session_id IS NOT NULL THEN
      SELECT * INTO s FROM public.quiz_sessions WHERE id=NEW.grammar_predecessor_session_id;
      IF s.id IS NULL OR s.user_id<>NEW.user_id OR s.bank_id<>NEW.bank_id THEN
        RAISE EXCEPTION 'grammar_session_predecessor_invalid' USING ERRCODE='55000';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF c->>'action'='reset' AND b.grammar_is_current
    AND OLD.grammar_reset_at IS NULL AND NEW.grammar_reset_at=transaction_timestamp()
    AND (to_jsonb(NEW)-'grammar_reset_at')=(to_jsonb(OLD)-'grammar_reset_at') THEN
    RETURN NEW;
  END IF;
  IF c->>'session' IS DISTINCT FROM NEW.id::TEXT OR
    (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(NEW)) WHERE key=ANY(immutable)) IS DISTINCT FROM
    (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(OLD)) WHERE key=ANY(immutable)) THEN
    RAISE EXCEPTION 'grammar_managed_session_immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.grammar_mastery_completed_at IS NOT NULL AND NEW.grammar_mastery_completed_at IS DISTINCT FROM OLD.grammar_mastery_completed_at THEN
    RAISE EXCEPTION 'grammar_mastery_completion_retained' USING ERRCODE='55000';
  END IF;
  IF c->>'action'='progress' AND OLD.grammar_reset_at IS NULL AND OLD.ended_at IS NULL AND OLD.ended_by IS NULL
    AND OLD.grammar_mastery_completed_at IS NULL AND NEW.grammar_mastery_completed_at IS NOT NULL
    AND (to_jsonb(NEW)-'grammar_mastery_completed_at')=(to_jsonb(OLD)-'grammar_mastery_completed_at')
    AND (public.grammar_quiz_mastery(NEW.user_id,NEW.bank_id)->>'remaining')::INTEGER=0 THEN
    RETURN NEW;
  END IF;
  IF c->>'action'='end' AND OLD.ended_at IS NULL AND OLD.ended_by IS NULL
    AND NEW.ended_at IS NOT NULL AND NEW.ended_by IN ('completed','paused','time_cap')
    AND NEW.grammar_mastery_completed_at IS NOT DISTINCT FROM OLD.grammar_mastery_completed_at
    AND (to_jsonb(NEW)-ARRAY['ended_at','ended_by','duration_sec','total_questions','total_correct',
      'total_wrong','accuracy','words_mastered','words_carried_over'])=
      (to_jsonb(OLD)-ARRAY['ended_at','ended_by','duration_sec','total_questions','total_correct',
      'total_wrong','accuracy','words_mastered','words_carried_over']) THEN
    IF OLD.grammar_admission_kind='review' AND (NEW.total_questions<>0 OR NEW.total_correct<>0
      OR NEW.total_wrong<>0 OR NEW.accuracy IS NOT NULL OR NEW.words_mastered<>0 OR NEW.words_carried_over<>0) THEN
      RAISE EXCEPTION 'grammar_review_read_only' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'grammar_managed_history_retained' USING ERRCODE='55000';
END $$;
DROP TRIGGER IF EXISTS grammar_quiz_session_guard ON public.quiz_sessions;
CREATE TRIGGER grammar_quiz_session_guard BEFORE INSERT OR UPDATE OR DELETE ON public.quiz_sessions
FOR EACH ROW EXECUTE FUNCTION public.grammar_quiz_guard_session();

CREATE OR REPLACE FUNCTION public.grammar_quiz_guard_progress()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.quiz_banks%ROWTYPE; s public.quiz_sessions%ROWTYPE;
  c JSONB := public.grammar_quiz_operation_context(); bid UUID; uid UUID; sid UUID;
BEGIN
  bid := CASE WHEN TG_OP='DELETE' THEN OLD.bank_id ELSE NEW.bank_id END;
  uid := CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  SELECT * INTO b FROM public.quiz_banks WHERE id=bid;
  IF TG_OP='UPDATE' AND (NEW.bank_id<>OLD.bank_id OR NEW.user_id<>OLD.user_id)
    AND EXISTS(SELECT 1 FROM public.quiz_banks WHERE id=OLD.bank_id AND grammar_canonical_code IS NOT NULL) THEN
    RAISE EXCEPTION 'grammar_managed_progress_immutable' USING ERRCODE='55000';
  END IF;
  IF b.grammar_canonical_code IS NULL THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
  -- The owner FK is immediate/validated. Its absence separates the existing
  -- account cascade from an arbitrary child write with a live account.
  IF TG_OP='DELETE' AND public.grammar_quiz_erased_owner(uid) THEN RETURN OLD; END IF;
  IF TG_TABLE_NAME='quiz_word_stats' AND TG_OP='UPDATE' THEN
    IF public.grammar_quiz_erased_owner(OLD.user_id)
      AND NEW.last_session_id IS NULL AND OLD.last_session_id IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.quiz_sessions WHERE id=OLD.last_session_id)
      AND (to_jsonb(NEW)-'last_session_id'-'updated_at')=(to_jsonb(OLD)-'last_session_id'-'updated_at') THEN
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN
    IF TG_TABLE_NAME='quiz_word_stats' AND b.grammar_is_current
      AND COALESCE(c->>'action'='reset' AND c->>'bank'=bid::TEXT AND c->>'code'=b.grammar_canonical_code
        AND c->>'actor'=uid::TEXT,FALSE) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'grammar_managed_progress_retained' USING ERRCODE='55000';
  END IF;
  IF TG_TABLE_NAME='quiz_attempts' AND TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'grammar_managed_attempt_immutable' USING ERRCODE='55000';
  END IF;
  sid := CASE WHEN TG_TABLE_NAME='quiz_attempts' THEN (to_jsonb(NEW)->>'session_id')::UUID
    ELSE (to_jsonb(NEW)->>'last_session_id')::UUID END;
  SELECT * INTO s FROM public.quiz_sessions WHERE id=sid;
  IF s.id IS NULL OR s.user_id<>uid OR s.bank_id<>bid OR s.ended_at IS NOT NULL OR s.ended_by IS NOT NULL
    OR s.grammar_admission_kind='review' OR NOT COALESCE(c->>'action'='progress'
      AND c->>'bank'=bid::TEXT AND c->>'code'=b.grammar_canonical_code
      AND c->>'actor'=uid::TEXT AND c->>'session'=sid::TEXT,FALSE) THEN
    RAISE EXCEPTION 'grammar_managed_progress_not_admitted' USING ERRCODE='55000';
  END IF;
  IF s.grammar_reset_at IS NOT NULL THEN
    RAISE EXCEPTION 'grammar_reset_stale' USING ERRCODE='55000';
  END IF;
  PERFORM public.grammar_quiz_receipt_data(CASE WHEN b.grammar_is_current THEN b.grammar_predecessor_bank_id ELSE b.id END);
  PERFORM public.grammar_quiz_text_policy(bid);
  IF TG_TABLE_NAME='quiz_word_stats' THEN
    IF NEW.correct_count<0 OR NEW.wrong_count<0 OR NEW.credit_count<0
      OR NEW.status NOT IN ('testing','provisional','mastered','carried_over')
      OR jsonb_typeof(NEW.skills_passed) IS DISTINCT FROM 'array'
      OR NOT EXISTS(SELECT 1 FROM public.quiz_questions WHERE bank_id=bid AND item_key=NEW.item_key
        AND input IN ('choice','text','boolean','syllable'))
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.skills_passed)='array'
        THEN NEW.skills_passed ELSE '[]'::JSONB END) v WHERE jsonb_typeof(v)<>'string'
        OR btrim(v #>> '{}')='' OR NOT EXISTS(SELECT 1 FROM public.quiz_questions
          WHERE bank_id=bid AND item_key=NEW.item_key AND skill=(v #>> '{}')
            AND input IN ('choice','text','boolean','syllable'))) THEN
      RAISE EXCEPTION 'grammar_progress_payload_invalid' USING ERRCODE='22023';
    END IF;
    IF TG_OP='UPDATE' AND c->'retain_mastery'='true'::JSONB THEN RETURN OLD; END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.quiz_questions q WHERE q.bank_id=bid AND q.qid=NEW.qid
      AND q.item_key=NEW.item_key AND q.skill=NEW.skill AND q.type=NEW.type
      AND (NEW.question_id IS NULL OR q.id=NEW.question_id)) THEN
      RAISE EXCEPTION 'grammar_progress_payload_invalid' USING ERRCODE='22023';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS grammar_quiz_attempt_guard ON public.quiz_attempts;
CREATE TRIGGER grammar_quiz_attempt_guard BEFORE INSERT OR UPDATE OR DELETE ON public.quiz_attempts
FOR EACH ROW EXECUTE FUNCTION public.grammar_quiz_guard_progress();
DROP TRIGGER IF EXISTS zz_grammar_quiz_stats_guard ON public.quiz_word_stats;
CREATE TRIGGER zz_grammar_quiz_stats_guard BEFORE INSERT OR UPDATE OR DELETE ON public.quiz_word_stats
FOR EACH ROW EXECUTE FUNCTION public.grammar_quiz_guard_progress();
CREATE OR REPLACE FUNCTION public.grammar_quiz_lock_bank(p_bank UUID)
RETURNS public.quiz_banks LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.quiz_banks%ROWTYPE; code TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(306,1);
  SELECT grammar_canonical_code INTO code FROM public.quiz_banks WHERE id=p_bank;
  IF code IS NULL THEN RAISE EXCEPTION 'grammar_bank_scope_invalid' USING ERRCODE='55000'; END IF;
  PERFORM pg_advisory_xact_lock(306,hashtext(code));
  SELECT * INTO b FROM public.quiz_banks WHERE id=p_bank FOR SHARE;
  IF b.grammar_canonical_code IS DISTINCT FROM code THEN
    RAISE EXCEPTION 'grammar_bank_scope_invalid' USING ERRCODE='55000';
  END IF;
  RETURN b;
END $$;

CREATE OR REPLACE FUNCTION public.grammar_quiz_state(p_user UUID,p_bank UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.quiz_banks%ROWTYPE; current_bank public.quiz_banks%ROWTYPE;
  proof JSONB; mastery JSONB; policy JSONB; eligible BOOLEAN := FALSE; current_eligible BOOLEAN := FALSE;
BEGIN
  SELECT * INTO b FROM public.quiz_banks WHERE id=p_bank;
  IF b.grammar_canonical_code IS NULL THEN RETURN NULL; END IF;
  b := public.grammar_quiz_lock_bank(p_bank);
  SELECT * INTO current_bank FROM public.quiz_banks
    WHERE grammar_canonical_code=b.grammar_canonical_code AND grammar_is_current;
  IF current_bank.id IS NULL OR NOT current_bank.is_published THEN
    RAISE EXCEPTION 'grammar_revision_mapping_unavailable' USING ERRCODE='55000';
  END IF;
  PERFORM public.grammar_quiz_receipt_data(CASE WHEN b.grammar_is_current THEN b.grammar_predecessor_bank_id ELSE b.id END);
  mastery := public.grammar_quiz_mastery(p_user,p_bank);
  policy := public.grammar_quiz_text_policy(p_bank);
  IF NOT b.grammar_is_current THEN
    proof := public.grammar_quiz_owner_proof(p_user,p_bank);
    eligible := COALESCE(proof->'eligible'='true'::JSONB,FALSE)
      AND NOT (mastery->>'completion_recorded')::BOOLEAN AND (mastery->>'remaining')::INTEGER>0;
  ELSE
    current_eligible := public.grammar_quiz_current_predecessor(p_user,p_bank) IS NOT NULL;
  END IF;
  RETURN jsonb_build_object('canonical_code',b.grammar_canonical_code,'bank_id',b.id,'bank_revision',b.grammar_revision,
    'content_state',CASE WHEN b.grammar_is_current THEN 'current' ELSE 'legacy' END,
    'new_starts_enabled',b.grammar_new_starts_enabled,'can_continue_legacy',eligible,
    'can_continue_current',current_eligible,'mastery_retained',FALSE,
    'current_bank_id',current_bank.id,'current_bank_revision',current_bank.grammar_revision)
    || CASE WHEN COALESCE(policy,'{}'::JSONB)<>'{}'::JSONB
      THEN jsonb_build_object('text_match_policy','qid-exact-v1') ELSE '{}'::JSONB END;
END $$;

CREATE OR REPLACE FUNCTION public.grammar_quiz_start_service(
  p_user UUID,p_bank UUID,p_revision TEXT,p_admission_kind TEXT,p_text_match_policy TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.quiz_banks%ROWTYPE := public.grammar_quiz_lock_bank(p_bank);
  proof JSONB; mastery JSONB; policy JSONB; admission TEXT; predecessor UUID; sid UUID; resume JSONB; previous_context TEXT;
BEGIN
  IF public.grammar_quiz_erased_owner(p_user) THEN RAISE EXCEPTION 'grammar_session_not_owned' USING ERRCODE='42501'; END IF;
  IF p_text_match_policy IS NOT NULL AND p_text_match_policy<>'qid-exact-v1' THEN
    RAISE EXCEPTION 'grammar_text_match_policy_invalid' USING ERRCODE='22023';
  END IF;
  IF NOT b.is_published OR p_admission_kind IS NOT NULL AND p_admission_kind NOT IN ('run','review') THEN
    RAISE EXCEPTION 'grammar_session_admission_invalid' USING ERRCODE='22023';
  END IF;
  PERFORM public.grammar_quiz_receipt_data(CASE WHEN b.grammar_is_current THEN b.grammar_predecessor_bank_id ELSE b.id END);
  mastery := public.grammar_quiz_mastery(p_user,p_bank);
  policy := public.grammar_quiz_text_policy(p_bank);
  IF COALESCE(policy,'{}'::JSONB)<>'{}'::JSONB AND p_text_match_policy IS DISTINCT FROM 'qid-exact-v1' THEN
    RAISE EXCEPTION 'grammar_text_match_policy_required' USING ERRCODE='55000';
  END IF;
  IF b.grammar_is_current THEN
    IF p_revision IS DISTINCT FROM b.grammar_revision THEN RAISE EXCEPTION 'grammar_content_revised' USING ERRCODE='55000'; END IF;
    predecessor := public.grammar_quiz_current_predecessor(p_user,p_bank);
    IF NOT b.grammar_new_starts_enabled THEN
      IF predecessor IS NULL OR p_admission_kind='review' THEN
        RAISE EXCEPTION 'grammar_new_starts_paused' USING ERRCODE='55000';
      END IF;
      admission := 'continuation';
    ELSE
      admission := CASE WHEN p_admission_kind='review' THEN 'review'
        WHEN predecessor IS NOT NULL THEN 'continuation' ELSE 'run' END;
    END IF;
  ELSE
    proof := public.grammar_quiz_owner_proof(p_user,p_bank);
    IF p_admission_kind='review' THEN
      IF proof IS NULL OR p_revision IS DISTINCT FROM b.grammar_revision THEN
        RAISE EXCEPTION 'grammar_content_revised' USING ERRCODE='55000';
      END IF;
      admission := 'review';
    ELSE
      IF proof IS NULL OR proof->'eligible' IS DISTINCT FROM 'true'::JSONB
        OR (mastery->>'completion_recorded')::BOOLEAN OR (mastery->>'remaining')::INTEGER=0
        OR p_revision IS NOT NULL AND p_revision IS DISTINCT FROM b.grammar_revision THEN
        RAISE EXCEPTION 'grammar_content_revised' USING ERRCODE='55000';
      END IF;
      -- An N-1 {bank_id} request derives continuation and frozen revision here.
      admission := 'continuation';
      SELECT id INTO predecessor FROM public.quiz_sessions WHERE user_id=p_user AND bank_id=p_bank
        AND (grammar_admission_kind IN ('run','continuation') AND grammar_revision=b.grammar_revision
          OR id::TEXT=proof->>'predecessor_session_id')
        ORDER BY started_at DESC,id DESC LIMIT 1;
    END IF;
  END IF;
  IF admission='review' THEN predecessor := NULL; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('item_key',item_key,'correct_count',correct_count,
    'wrong_count',wrong_count,'first_try_correct',first_try_correct,'attempts_to_master',attempts_to_master,
    'status',status,'is_difficult',is_difficult,'skills_passed',skills_passed,'provisional_skill',provisional_skill,
    'production_done',production_done,'credit_count',credit_count) ORDER BY item_key),'[]'::JSONB)
    INTO resume FROM public.quiz_word_stats WHERE user_id=p_user AND bank_id=p_bank;
  previous_context := current_setting('aver.grammar_quiz_context',true);
  PERFORM set_config('aver.grammar_quiz_context',jsonb_build_object('action','start','actor',p_user,
    'code',b.grammar_canonical_code,'bank',p_bank,'admission_kind',admission,
    'text_match_policy',p_text_match_policy)::TEXT,TRUE);
  INSERT INTO public.quiz_sessions(user_id,bank_id,code,kind,grammar_revision,grammar_admission_kind,
    grammar_predecessor_session_id) VALUES(p_user,p_bank,b.code,'run',b.grammar_revision,admission,predecessor)
    RETURNING id INTO sid;
  PERFORM set_config('aver.grammar_quiz_context',COALESCE(previous_context,''),TRUE);
  RETURN jsonb_build_object('session_id',sid,'resume',resume,'grammar',public.grammar_quiz_state(p_user,p_bank));
END $$;

-- Exact old arity/default compatibility; the sole admission owner above also
-- checks old calls, so a mapped bank cannot bypass ACK through this wrapper.
CREATE OR REPLACE FUNCTION public.grammar_quiz_start_service(
  p_user UUID,p_bank UUID,p_revision TEXT DEFAULT NULL,p_admission_kind TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT public.grammar_quiz_start_service(p_user,p_bank,p_revision,p_admission_kind,NULL::TEXT)
$$;

CREATE OR REPLACE FUNCTION public.grammar_quiz_progress_service(
  p_user UUID,p_session UUID,p_attempts JSONB,p_word_stats JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE sid_bank UUID; b public.quiz_banks%ROWTYPE; s public.quiz_sessions%ROWTYPE; mastery JSONB;
  retain BOOLEAN; previous_context TEXT; r RECORD; inserted INTEGER := 0; written INTEGER := 0; n INTEGER;
  inserted_row JSONB; inserted_rows JSONB := '[]'::JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(306,1);
  SELECT bank_id INTO sid_bank FROM public.quiz_sessions WHERE id=p_session AND user_id=p_user;
  IF sid_bank IS NULL THEN RAISE EXCEPTION 'grammar_session_not_owned' USING ERRCODE='42501'; END IF;
  b := public.grammar_quiz_lock_bank(sid_bank);
  SELECT * INTO s FROM public.quiz_sessions WHERE id=p_session AND user_id=p_user FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'grammar_session_not_owned' USING ERRCODE='42501'; END IF;
  IF s.grammar_reset_at IS NOT NULL THEN
    RAISE EXCEPTION 'grammar_reset_stale' USING ERRCODE='55000';
  END IF;
  PERFORM public.grammar_quiz_receipt_data(CASE WHEN b.grammar_is_current THEN b.grammar_predecessor_bank_id ELSE b.id END);
  PERFORM public.grammar_quiz_text_policy(sid_bank);
  IF s.ended_at IS NOT NULL OR s.ended_by IS NOT NULL THEN
    RAISE EXCEPTION 'grammar_session_closed' USING ERRCODE='55000';
  END IF;
  IF s.grammar_admission_kind='review' THEN RAISE EXCEPTION 'grammar_review_read_only' USING ERRCODE='55000'; END IF;
  IF jsonb_typeof(p_attempts) IS DISTINCT FROM 'array' OR jsonb_typeof(p_word_stats) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'grammar_progress_payload_invalid' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_attempts)>200 OR jsonb_array_length(p_word_stats)>200 THEN
    RAISE EXCEPTION 'grammar_progress_batch_too_large' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_attempts) v WHERE jsonb_typeof(v)<>'object'
      OR jsonb_typeof(v->'is_correct') IS DISTINCT FROM 'boolean')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_word_stats) v WHERE jsonb_typeof(v)<>'object'
      OR jsonb_typeof(v->'skills_passed') IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'grammar_progress_payload_invalid' USING ERRCODE='22023';
  END IF;
  mastery := public.grammar_quiz_mastery(p_user,sid_bank);
  retain := (mastery->>'remaining')::INTEGER=0
    OR NOT b.grammar_is_current AND (mastery->>'completion_recorded')::BOOLEAN;
  previous_context := current_setting('aver.grammar_quiz_context',true);
  PERFORM set_config('aver.grammar_quiz_context',jsonb_build_object('action','progress','actor',p_user,
    'code',b.grammar_canonical_code,'bank',sid_bank,'session',p_session,'retain_mastery',retain)::TEXT,TRUE);
  FOR r IN SELECT * FROM jsonb_to_recordset(p_attempts) AS x(client_id UUID,item_key TEXT,qid TEXT,
    skill TEXT,type TEXT,subtype TEXT,is_correct BOOLEAN,answer_given TEXT,response_time_ms INTEGER,attempt_no INTEGER) LOOP
    IF r.item_key IS NULL OR r.qid IS NULL OR r.skill IS NULL OR r.type IS NULL THEN
      RAISE EXCEPTION 'grammar_progress_payload_invalid' USING ERRCODE='22023';
    END IF;
    IF r.client_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.quiz_attempts WHERE client_id=r.client_id
        AND (user_id<>p_user OR session_id<>p_session OR bank_id<>sid_bank)) THEN
      RAISE EXCEPTION 'grammar_attempt_identity_conflict' USING ERRCODE='55000';
    END IF;
    INSERT INTO public.quiz_attempts(user_id,bank_id,session_id,client_id,item_key,qid,skill,type,subtype,
      is_correct,answer_given,response_time_ms,attempt_no,question_id)
      SELECT p_user,sid_bank,p_session,r.client_id,r.item_key,r.qid,r.skill,r.type,r.subtype,r.is_correct,
        r.answer_given,r.response_time_ms,r.attempt_no,q.id FROM public.quiz_questions q
      WHERE q.bank_id=sid_bank AND q.qid=r.qid AND q.item_key=r.item_key AND q.skill=r.skill AND q.type=r.type
      ON CONFLICT(client_id) DO NOTHING RETURNING to_jsonb(quiz_attempts) INTO inserted_row;
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n=0 AND NOT EXISTS(SELECT 1 FROM public.quiz_attempts WHERE client_id=r.client_id
        AND user_id=p_user AND session_id=p_session AND bank_id=sid_bank) THEN
      RAISE EXCEPTION 'grammar_progress_payload_invalid' USING ERRCODE='22023';
    END IF;
    inserted := inserted+n;
    IF n>0 THEN inserted_rows := inserted_rows || jsonb_build_array(inserted_row); END IF;
  END LOOP;
  FOR r IN SELECT * FROM jsonb_to_recordset(p_word_stats) AS x(item_key TEXT,correct_count INTEGER,
    wrong_count INTEGER,first_try_correct BOOLEAN,attempts_to_master INTEGER,status TEXT,is_difficult BOOLEAN,
    skills_passed JSONB,provisional_skill TEXT,production_done BOOLEAN,credit_count INTEGER) LOOP
    IF NULLIF(btrim(r.item_key),'') IS NULL THEN RAISE EXCEPTION 'grammar_progress_payload_invalid' USING ERRCODE='22023'; END IF;
    INSERT INTO public.quiz_word_stats(user_id,bank_id,last_session_id,item_key,correct_count,wrong_count,
      first_try_correct,attempts_to_master,status,is_difficult,skills_passed,provisional_skill,production_done,credit_count)
    VALUES(p_user,sid_bank,p_session,r.item_key,COALESCE(r.correct_count,0),COALESCE(r.wrong_count,0),
      r.first_try_correct,r.attempts_to_master,COALESCE(r.status,'testing'),COALESCE(r.is_difficult,FALSE),
      r.skills_passed,r.provisional_skill,COALESCE(r.production_done,FALSE),COALESCE(r.credit_count,0))
    ON CONFLICT(user_id,bank_id,item_key) DO UPDATE SET last_session_id=EXCLUDED.last_session_id,
      correct_count=EXCLUDED.correct_count,wrong_count=EXCLUDED.wrong_count,first_try_correct=EXCLUDED.first_try_correct,
      attempts_to_master=EXCLUDED.attempts_to_master,status=EXCLUDED.status,is_difficult=EXCLUDED.is_difficult,
      skills_passed=EXCLUDED.skills_passed,provisional_skill=EXCLUDED.provisional_skill,
      production_done=EXCLUDED.production_done,credit_count=EXCLUDED.credit_count;
    GET DIAGNOSTICS n=ROW_COUNT; written := written+n;
  END LOOP;
  mastery := public.grammar_quiz_mastery(p_user,sid_bank);
  IF (mastery->>'remaining')::INTEGER=0 AND s.grammar_mastery_completed_at IS NULL THEN
    UPDATE public.quiz_sessions SET grammar_mastery_completed_at=clock_timestamp() WHERE id=p_session;
  END IF;
  PERFORM set_config('aver.grammar_quiz_context',COALESCE(previous_context,''),TRUE);
  RETURN jsonb_build_object('ok',TRUE,'attempts',inserted,'word_stats',written,
    'newly_inserted_attempts',inserted_rows,
    'grammar',public.grammar_quiz_state(p_user,sid_bank)||jsonb_build_object('mastery_retained',retain));
END $$;

CREATE OR REPLACE FUNCTION public.grammar_quiz_end_service(p_user UUID,p_session UUID,p_summary JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE sid_bank UUID; b public.quiz_banks%ROWTYPE; s public.quiz_sessions%ROWTYPE;
  total INTEGER; correct INTEGER; previous_context TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(306,1);
  SELECT bank_id INTO sid_bank FROM public.quiz_sessions WHERE id=p_session AND user_id=p_user;
  IF sid_bank IS NULL THEN RAISE EXCEPTION 'grammar_session_not_owned' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM public.quiz_sessions WHERE id=p_session AND user_id=p_user;
  IF s.ended_at IS NOT NULL OR s.ended_by IS NOT NULL THEN RETURN to_jsonb(s); END IF;
  b := public.grammar_quiz_lock_bank(sid_bank);
  SELECT * INTO s FROM public.quiz_sessions WHERE id=p_session AND user_id=p_user FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'grammar_session_not_owned' USING ERRCODE='42501'; END IF;
  IF s.ended_at IS NOT NULL OR s.ended_by IS NOT NULL THEN
    RETURN to_jsonb(s);
  END IF;
  PERFORM public.grammar_quiz_receipt_data(CASE WHEN b.grammar_is_current THEN b.grammar_predecessor_bank_id ELSE b.id END);
  IF jsonb_typeof(p_summary) IS DISTINCT FROM 'object' OR COALESCE(p_summary->>'ended_by','') NOT IN ('completed','paused','time_cap') THEN
    RAISE EXCEPTION 'grammar_progress_payload_invalid' USING ERRCODE='22023';
  END IF;
  total := COALESCE((p_summary->>'total_questions')::INTEGER,0);
  correct := COALESCE((p_summary->>'total_correct')::INTEGER,0);
  IF total<0 OR correct<0 OR correct>total OR COALESCE((p_summary->>'total_wrong')::INTEGER,0)<0 THEN
    RAISE EXCEPTION 'grammar_progress_payload_invalid' USING ERRCODE='22023';
  END IF;
  previous_context := current_setting('aver.grammar_quiz_context',true);
  PERFORM set_config('aver.grammar_quiz_context',jsonb_build_object('action','end','actor',p_user,
    'code',b.grammar_canonical_code,'bank',sid_bank,'session',p_session)::TEXT,TRUE);
  UPDATE public.quiz_sessions SET ended_at=clock_timestamp(),ended_by=p_summary->>'ended_by',
    duration_sec=(p_summary->>'duration_sec')::INTEGER,total_questions=total,total_correct=correct,
    total_wrong=COALESCE((p_summary->>'total_wrong')::INTEGER,0),accuracy=CASE WHEN total>0 THEN (correct::DOUBLE PRECISION/total)::REAL ELSE NULL END,
    words_mastered=COALESCE((p_summary->>'words_mastered')::INTEGER,0),
    words_carried_over=COALESCE((p_summary->>'words_carried_over')::INTEGER,0)
    WHERE id=p_session RETURNING * INTO s;
  PERFORM set_config('aver.grammar_quiz_context',COALESCE(previous_context,''),TRUE);
  RETURN to_jsonb(s)||jsonb_build_object('grammar',public.grammar_quiz_state(p_user,sid_bank));
END $$;

CREATE OR REPLACE FUNCTION public.grammar_quiz_reset_service(p_user UUID,p_bank UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.quiz_banks%ROWTYPE := public.grammar_quiz_lock_bank(p_bank); previous_context TEXT;
BEGIN
  IF NOT b.grammar_is_current THEN RAISE EXCEPTION 'grammar_legacy_reset_forbidden' USING ERRCODE='55000'; END IF;
  IF public.grammar_quiz_erased_owner(p_user) THEN RAISE EXCEPTION 'grammar_session_not_owned' USING ERRCODE='42501'; END IF;
  PERFORM public.grammar_quiz_receipt_data(b.grammar_predecessor_bank_id);
  previous_context := current_setting('aver.grammar_quiz_context',true);
  PERFORM public.grammar_quiz_text_policy(p_bank);
  PERFORM set_config('aver.grammar_quiz_context',jsonb_build_object('action','reset','actor',p_user,
    'code',b.grammar_canonical_code,'bank',p_bank)::TEXT,TRUE);
  UPDATE public.quiz_sessions SET grammar_reset_at=transaction_timestamp()
    WHERE user_id=p_user AND bank_id=p_bank AND grammar_reset_at IS NULL;
  DELETE FROM public.quiz_word_stats WHERE user_id=p_user AND bank_id=p_bank;
  PERFORM set_config('aver.grammar_quiz_context',COALESCE(previous_context,''),TRUE);
  RETURN jsonb_build_object('ok',TRUE,'grammar',public.grammar_quiz_state(p_user,p_bank));
END $$;

-- Trigger helpers/proof contain private identifiers: no direct public RPC.
DO $$ DECLARE f RECORD; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'grammar_quiz_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.grammar_quiz_start_service(UUID,UUID,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.grammar_quiz_start_service(UUID,UUID,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.grammar_quiz_progress_service(UUID,UUID,JSONB,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.grammar_quiz_end_service(UUID,UUID,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.grammar_quiz_reset_service(UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.grammar_quiz_state(UUID,UUID) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
