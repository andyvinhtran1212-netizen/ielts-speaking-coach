-- Rollback: 369_grammar_quiz_definer_search_path.sql
-- PC-J620 / SA-2209: restores the exact four 339 bodies and their
-- search_path = public, pg_temp. This REOPENS the public-search_path
-- owner-execution risk for these four definers.
-- Guarded repair only: needs 339 in the ledger, refuses planted public shadows
-- and unexpected body drift, preserves owner/ACL/SECURITY DEFINER by catalog diff.
-- Run before any rollback of 339. No data, trigger, grant or owner change.
-- Staging first after SA review under the advisory lock; production only at
-- an explicitly authorised staging -> main promotion. No apply on merge.

BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
    catalog_functions CONSTANT text[] := ARRAY['aclexplode', 'array_agg', 'array_append', 'array_to_string', 'bool_or', 'convert_to', 'count', 'encode', 'has_function_privilege', 'json_typeof', 'jsonb_agg', 'jsonb_array_elements', 'jsonb_array_elements_text', 'jsonb_array_length', 'jsonb_build_array', 'jsonb_build_object', 'jsonb_each', 'jsonb_object_agg', 'jsonb_object_keys', 'jsonb_set', 'jsonb_typeof', 'left', 'md5', 'octet_length', 'sha256', 'string_agg', 'to_jsonb', 'to_regclass', 'to_regprocedure', 'unnest'];
    catalog_operators CONSTANT text[] := ARRAY['=', '<>', '<', '>', '+', '-', '~', '!~', '||', '?', '?|', '->', '->>', '#>>'];
    v_wrong text;
BEGIN
    IF pg_catalog.to_regclass('public._schema_migrations') IS NULL THEN
        RAISE EXCEPTION 'migration_369_prerequisite_missing: no ledger row';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public._schema_migrations m
                    WHERE m.filename OPERATOR(pg_catalog.=) '339_grammar_quiz_followup_codes.sql') THEN
        RAISE EXCEPTION 'migration_369_prerequisite_missing: no ledger row';
    END IF;
    IF pg_catalog.to_regclass('public.quiz_banks') IS NULL
       OR pg_catalog.to_regclass('public.governance_audit') IS NULL
       OR pg_catalog.to_regprocedure('public.grammar_quiz_followup_pair(text)') IS NULL
       OR EXISTS (SELECT 1 FROM (VALUES ('public.grammar_quiz_audit_chain(text)'), ('public.grammar_quiz_guard_bank()'), ('public.grammar_quiz_validate_receipt_envelope(jsonb,uuid,uuid)'), ('public.grammar_quiz_receipt_data(uuid)')) f(sig)
                   WHERE pg_catalog.to_regprocedure(f.sig) IS NULL) THEN
        RAISE EXCEPTION 'migration_369_prerequisite_missing: objects';
    END IF;
    SELECT pg_catalog.string_agg(k.kind OPERATOR(pg_catalog.||) ' ' OPERATOR(pg_catalog.||) k.name, ', '
                                 ORDER BY k.kind, k.name) INTO v_wrong
      FROM (SELECT 'function'::text, p.proname::text FROM pg_catalog.pg_proc p
             WHERE p.pronamespace OPERATOR(pg_catalog.=) 'public'::regnamespace
               AND p.proname::text OPERATOR(pg_catalog.=) ANY (catalog_functions)
            UNION
            SELECT 'operator'::text, o.oprname::text FROM pg_catalog.pg_operator o
             WHERE o.oprnamespace OPERATOR(pg_catalog.=) 'public'::regnamespace
               AND o.oprname::text OPERATOR(pg_catalog.=) ANY (catalog_operators)) k(kind, name);
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'catalog_name_shadowed_in_public: %', v_wrong;
    END IF;
    -- Fail rather than overwrite an unexpected later implementation. Accept
    -- only the 339 source or this file's catalog-qualified equivalent.
    SELECT pg_catalog.string_agg(f.sig, ', ' ORDER BY f.sig) INTO v_wrong
      FROM (VALUES ('public.grammar_quiz_audit_chain(text)', 'ffbfbfbd73d66246369cc4980219cbec', '1a3d52ef50d66565c9e2abb1b597dc55'),
                   ('public.grammar_quiz_guard_bank()', '8a48c803a25b91658876a34b8c25245c', '7bc1faa8d3d04328042590249e7aaead'),
                   ('public.grammar_quiz_validate_receipt_envelope(jsonb,uuid,uuid)', 'dad931cd7e1fb3e03958e767b9b1e2e5', 'ecda7c8f5b762809e6c771404dab5dca'),
                   ('public.grammar_quiz_receipt_data(uuid)', '30ee07b67df6b53155eba485a635b62b', '1fd63bf5cd3707a515359e8d4cca2c39')) f(sig, old_hash, new_hash)
      JOIN pg_catalog.pg_proc p ON p.oid OPERATOR(pg_catalog.=) f.sig::regprocedure
     WHERE pg_catalog.md5(p.prosrc) OPERATOR(pg_catalog.<>) f.old_hash
       AND pg_catalog.md5(p.prosrc) OPERATOR(pg_catalog.<>) f.new_hash;
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'grammar_quiz_source_drift: %', v_wrong;
    END IF;
END $$;

-- Catalog only: no bank, question, session, attempt or receipt row is read or changed.
CREATE TEMP TABLE m369_function_identity ON COMMIT DROP AS
SELECT p.oid, p.proowner, p.proacl, p.prosecdef
  FROM pg_catalog.pg_proc p
 WHERE p.oid OPERATOR(pg_catalog.=) ANY (ARRAY[
               'public.grammar_quiz_audit_chain(text)',
               'public.grammar_quiz_guard_bank()',
               'public.grammar_quiz_validate_receipt_envelope(jsonb,uuid,uuid)',
               'public.grammar_quiz_receipt_data(uuid)']::regprocedure[]);

CREATE OR REPLACE FUNCTION public.grammar_quiz_audit_chain(p_code TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.quiz_banks%ROWTYPE; m public.quiz_banks%ROWTYPE; n public.quiz_banks%ROWTYPE; total INTEGER; pair RECORD;
BEGIN
  SELECT count(*) INTO total FROM (SELECT 1 FROM public.quiz_banks WHERE grammar_canonical_code=p_code LIMIT 4) bounded;
  SELECT * INTO pair FROM public.grammar_quiz_followup_pair(p_code);
  IF total NOT IN (2,3) OR total=3 AND pair.final_source IS NULL THEN RETURN FALSE; END IF;
  SELECT * INTO r FROM public.quiz_banks WHERE code=p_code AND grammar_canonical_code=p_code AND grammar_predecessor_bank_id IS NULL;
  SELECT * INTO n FROM public.quiz_banks WHERE grammar_canonical_code=p_code AND grammar_is_current;
  IF r.id IS NULL OR n.id IS NULL OR r.grammar_is_current OR r.grammar_retired_at IS NULL OR n.grammar_retired_at IS NOT NULL
      OR r.topic_id IS DISTINCT FROM n.topic_id OR NOT r.is_published OR NOT n.is_published THEN RETURN FALSE; END IF;
  IF total=2 THEN RETURN n.grammar_predecessor_bank_id=r.id AND n.version=r.version+1
    AND (p_code='G-error-clinic-dangling-modifiers' AND n.code IN ('G-error-clinic-dangling-modifiers~8606094f523bdd1a') OR p_code='G-foundations-phrase-vs-clause' AND n.code IN ('G-foundations-phrase-vs-clause~66dfacf3a82258a9') OR p_code='G-grammar-for-reading-long-sentence-untangling' AND n.code IN ('G-grammar-for-reading-long-sentence-untangling~f272f1d183cb7667','G-grammar-for-reading-long-sentence-untangling~436d207e7bee05ab') OR p_code='G-grammar-for-reading-participle-clauses' AND n.code IN ('G-grammar-for-reading-participle-clauses~f63edb03e73d2e65') OR p_code='G-grammar-for-reading-reduced-relative-clauses' AND n.code IN ('G-grammar-for-reading-reduced-relative-clauses~f9c0cab2ce429253') OR p_code='G-parts-of-speech-verbs' AND n.code IN ('G-parts-of-speech-verbs~36e8b94fa47dfb8f') OR p_code='G-sentence-structures-passive-voice' AND n.code IN ('G-sentence-structures-passive-voice~2299da1f37da6ab3') OR p_code='G-tenses-past-continuous' AND n.code IN ('G-tenses-past-continuous~1d75f48d70c9e476') OR p_code='G-tenses-past-perfect' AND n.code IN ('G-tenses-past-perfect~297a5ae369e3bc72') OR p_code='G-tenses-present-continuous' AND n.code IN ('G-tenses-present-continuous~711e42becddee32b') OR p_code='G-tenses-present-perfect-continuous' AND n.code IN ('G-tenses-present-perfect-continuous~67ffbc97e73fdb1d') OR p_code='G-tenses-present-simple' AND n.code IN ('G-tenses-present-simple~97d6af8d735ff80c') OR p_code='G-error-clinic-affect-vs-effect' AND n.code IN ('G-error-clinic-affect-vs-effect~c87d4fdd24ddea27') OR p_code='G-error-clinic-article-errors' AND n.code IN ('G-error-clinic-article-errors~ad23d089ac41be88') OR p_code='G-error-clinic-do-vs-make' AND n.code IN ('G-error-clinic-do-vs-make~d3bad9f382acd708') OR p_code='G-error-clinic-double-subject-errors' AND n.code IN ('G-error-clinic-double-subject-errors~6e31b44046023040') OR p_code='G-error-clinic-economic-vs-economical' AND n.code IN ('G-error-clinic-economic-vs-economical~d5ef23a64adb05c7') OR p_code='G-error-clinic-historic-vs-historical' AND n.code IN ('G-error-clinic-historic-vs-historical~e37a2aa249f48e4d') OR p_code='G-error-clinic-overusing-i-think' AND n.code IN ('G-error-clinic-overusing-i-think~729c6ea364a059b1') OR p_code='G-error-clinic-preposition-errors' AND n.code IN ('G-error-clinic-preposition-errors~bb15a6eea5d32ac5') OR p_code='G-error-clinic-run-on-sentences' AND n.code IN ('G-error-clinic-run-on-sentences~b13dc26591c4b0a9') OR p_code='G-error-clinic-say-tell-speak-talk' AND n.code IN ('G-error-clinic-say-tell-speak-talk~0137d9256446cb89') OR p_code='G-error-clinic-sentence-fragments' AND n.code IN ('G-error-clinic-sentence-fragments~cc149ba1de3b9af3') OR p_code='G-error-clinic-subject-verb-agreement' AND n.code IN ('G-error-clinic-subject-verb-agreement~d6a17aea3de6b71e') OR p_code='G-error-clinic-tense-consistency' AND n.code IN ('G-error-clinic-tense-consistency~9b6e57bb43b9ebe6') OR p_code='G-error-clinic-wrong-pronoun-reference' AND n.code IN ('G-error-clinic-wrong-pronoun-reference~1b07c73439006faa') OR p_code='G-foundations-articles-a-an-sound-rules' AND n.code IN ('G-foundations-articles-a-an-sound-rules~5cbbc221550a722e') OR p_code='G-foundations-countable-vs-uncountable' AND n.code IN ('G-foundations-countable-vs-uncountable~96999469be5dd4e2') OR p_code='G-foundations-few-a-few-little-a-little' AND n.code IN ('G-foundations-few-a-few-little-a-little~f758a20763833a2a','G-foundations-few-a-few-little-a-little~1b865d8c11f69d26') OR p_code='G-foundations-noun-phrase-basics' AND n.code IN ('G-foundations-noun-phrase-basics~74d7cb25cb8a26c7') OR p_code='G-foundations-parts-of-speech' AND n.code IN ('G-foundations-parts-of-speech~035e374045b88f92') OR p_code='G-foundations-singular-vs-plural' AND n.code IN ('G-foundations-singular-vs-plural~01cc637857209ce2') OR p_code='G-foundations-this-that-these-those-in-use' AND n.code IN ('G-foundations-this-that-these-those-in-use~57c8cad7292c5c33') OR p_code='G-foundations-word-order' AND n.code IN ('G-foundations-word-order~e614a6cb55122036') OR p_code='G-foundations-zero-article' AND n.code IN ('G-foundations-zero-article~472eebd3f37717ee') OR p_code='G-grammar-for-meaning-although-though-even-though' AND n.code IN ('G-grammar-for-meaning-although-though-even-though~bf7547e6b7e2999a') OR p_code='G-grammar-for-meaning-comparison' AND n.code IN ('G-grammar-for-meaning-comparison~5274e87f8a94a878') OR p_code='G-grammar-for-meaning-conditionals' AND n.code IN ('G-grammar-for-meaning-conditionals~51d2ef966d9e2cfd') OR p_code='G-grammar-for-meaning-discourse-markers-spoken' AND n.code IN ('G-grammar-for-meaning-discourse-markers-spoken~f6ce136dea45e415') OR p_code='G-grammar-for-meaning-discourse-markers' AND n.code IN ('G-grammar-for-meaning-discourse-markers~47cfee66e50e7546') OR p_code='G-grammar-for-meaning-hedging-language' AND n.code IN ('G-grammar-for-meaning-hedging-language~3264b356119d2a01') OR p_code='G-grammar-for-meaning-so-vs-such' AND n.code IN ('G-grammar-for-meaning-so-vs-such~ebc0759afa69a230') OR p_code='G-grammar-for-reading-appositives-and-parentheticals' AND n.code IN ('G-grammar-for-reading-appositives-and-parentheticals~2af8326d139cf2e5') OR p_code='G-grammar-for-reading-comparison-structures-in-reading' AND n.code IN ('G-grammar-for-reading-comparison-structures-in-reading~5a6f43ad27098d1c') OR p_code='G-grammar-for-reading-complex-noun-phrases' AND n.code IN ('G-grammar-for-reading-complex-noun-phrases~e2c89ef24c1240be') OR p_code='G-grammar-for-reading-ellipsis-and-substitution' AND n.code IN ('G-grammar-for-reading-ellipsis-and-substitution~b92735365b32e22c') OR p_code='G-grammar-for-reading-hedging-and-certainty-in-reading' AND n.code IN ('G-grammar-for-reading-hedging-and-certainty-in-reading~005186e363281a62') OR p_code='G-grammar-for-reading-logical-connectors-in-reading' AND n.code IN ('G-grammar-for-reading-logical-connectors-in-reading~7ac19bcb484a52fb') OR p_code='G-grammar-for-reading-nominalization' AND n.code IN ('G-grammar-for-reading-nominalization~b51eae5adf40cdc3') OR p_code='G-grammar-for-reading-paraphrase-patterns' AND n.code IN ('G-grammar-for-reading-paraphrase-patterns~702623fa07727be0') OR p_code='G-grammar-for-reading-punctuation-as-meaning-signals' AND n.code IN ('G-grammar-for-reading-punctuation-as-meaning-signals~6e1bd1a2c81a848b') OR p_code='G-grammar-for-reading-reference-and-cohesion' AND n.code IN ('G-grammar-for-reading-reference-and-cohesion~e98445f11298010a') OR p_code='G-grammar-for-writing-cohesion-devices-in-writing' AND n.code IN ('G-grammar-for-writing-cohesion-devices-in-writing~c01a066e0dd5de4b') OR p_code='G-grammar-for-writing-complex-sentences-for-task2' AND n.code IN ('G-grammar-for-writing-complex-sentences-for-task2~802a179ad772010e') OR p_code='G-grammar-for-writing-grammar-in-task1' AND n.code IN ('G-grammar-for-writing-grammar-in-task1~b494b874fc49d79b','G-grammar-for-writing-grammar-in-task1~d95ee61534f3bf2c') OR p_code='G-grammar-for-writing-parallel-structure' AND n.code IN ('G-grammar-for-writing-parallel-structure~6977f5e4620e153c') OR p_code='G-grammar-for-writing-punctuation-for-writing' AND n.code IN ('G-grammar-for-writing-punctuation-for-writing~cf2590a9ed2169a2') OR p_code='G-grammar-for-writing-relative-clauses-in-writing' AND n.code IN ('G-grammar-for-writing-relative-clauses-in-writing~3637757595463ac2') OR p_code='G-grammar-for-writing-task1-trend-grammar' AND n.code IN ('G-grammar-for-writing-task1-trend-grammar~ade836a076dd1d99') OR p_code='G-ielts-grammar-lab-adding-contrast-naturally' AND n.code IN ('G-ielts-grammar-lab-adding-contrast-naturally~91a6480dc33966a6') OR p_code='G-ielts-grammar-lab-adding-reasons-clearly' AND n.code IN ('G-ielts-grammar-lab-adding-reasons-clearly~e124444c6115fbd1') OR p_code='G-ielts-grammar-lab-agreeing-and-disagreeing-naturally' AND n.code IN ('G-ielts-grammar-lab-agreeing-and-disagreeing-naturally~e5daf7310f044f3c') OR p_code='G-ielts-grammar-lab-avoiding-repetitive-sentence-openings' AND n.code IN ('G-ielts-grammar-lab-avoiding-repetitive-sentence-openings~da3d33f0c4b486aa') OR p_code='G-ielts-grammar-lab-balanced-arguments-grammar' AND n.code IN ('G-ielts-grammar-lab-balanced-arguments-grammar~1a8a5333cf951483') OR p_code='G-ielts-grammar-lab-comparing-ideas-in-speaking' AND n.code IN ('G-ielts-grammar-lab-comparing-ideas-in-speaking~85612e2011df6937') OR p_code='G-ielts-grammar-lab-conditionals-in-speaking' AND n.code IN ('G-ielts-grammar-lab-conditionals-in-speaking~f00da5b9ed2554f6') OR p_code='G-ielts-grammar-lab-giving-examples-naturally' AND n.code IN ('G-ielts-grammar-lab-giving-examples-naturally~3f49774a706763cb') OR p_code='G-ielts-grammar-lab-grammar-for-band7plus' AND n.code IN ('G-ielts-grammar-lab-grammar-for-band7plus~2870e63bdd6355d4') OR p_code='G-ielts-grammar-lab-grammar-in-speaking' AND n.code IN ('G-ielts-grammar-lab-grammar-in-speaking~b867324ad210a6d6') OR p_code='G-ielts-grammar-lab-speculating-about-the-future' AND n.code IN ('G-ielts-grammar-lab-speculating-about-the-future~908aa309c8e3c87a') OR p_code='G-ielts-grammar-lab-strong-vs-cautious-opinions' AND n.code IN ('G-ielts-grammar-lab-strong-vs-cautious-opinions~3f12ba7d95a3eae3') OR p_code='G-ielts-grammar-lab-talking-about-future-plans' AND n.code IN ('G-ielts-grammar-lab-talking-about-future-plans~27bca9e5fa84feda') OR p_code='G-ielts-grammar-lab-talking-about-habits-and-routines' AND n.code IN ('G-ielts-grammar-lab-talking-about-habits-and-routines~09633fa312f42c4d') OR p_code='G-modifiers-adverbs' AND n.code IN ('G-modifiers-adverbs~31dd5264b1e6fcfa') OR p_code='G-modifiers-compound-adjectives' AND n.code IN ('G-modifiers-compound-adjectives~7f1539c7bfbf7d83') OR p_code='G-modifiers-intensifiers-and-mitigators' AND n.code IN ('G-modifiers-intensifiers-and-mitigators~68d1192e91a11bf9') OR p_code='G-modifiers-order-of-adjectives' AND n.code IN ('G-modifiers-order-of-adjectives~1b847a986f8c7e37') OR p_code='G-parts-of-speech-conjunctions' AND n.code IN ('G-parts-of-speech-conjunctions~f208c5eacc4476e5') OR p_code='G-parts-of-speech-nouns' AND n.code IN ('G-parts-of-speech-nouns~8fee5081d137cb3c') OR p_code='G-parts-of-speech-prepositions' AND n.code IN ('G-parts-of-speech-prepositions~93b1dc4ce792322f') OR p_code='G-parts-of-speech-word-formation-adjective-suffixes' AND n.code IN ('G-parts-of-speech-word-formation-adjective-suffixes~43306a3dbccc1b45') OR p_code='G-parts-of-speech-word-formation-noun-suffixes' AND n.code IN ('G-parts-of-speech-word-formation-noun-suffixes~5af04090f16431b1') OR p_code='G-sentence-structures-complex-sentence' AND n.code IN ('G-sentence-structures-complex-sentence~1d2d78009d04e4f6') OR p_code='G-sentence-structures-inversion' AND n.code IN ('G-sentence-structures-inversion~1db2c488f313af33') OR p_code='G-sentence-structures-reported-speech' AND n.code IN ('G-sentence-structures-reported-speech~e96d1b91dcae0fbb') OR p_code='G-tenses-future-forms' AND n.code IN ('G-tenses-future-forms~5cd5981bb7a110ec') OR p_code='G-tenses-present-perfect' AND n.code IN ('G-tenses-present-perfect~a81cfec836bbd73c') OR p_code='G-verb-patterns-gerund-vs-infinitive' AND n.code IN ('G-verb-patterns-gerund-vs-infinitive~feb3bd0a74e07aaf') OR p_code='G-verb-patterns-infinitive' AND n.code IN ('G-verb-patterns-infinitive~62d4974c6eba222b') OR p_code='G-verb-patterns-phrasal-verbs' AND n.code IN ('G-verb-patterns-phrasal-verbs~3a299073ebca60aa')); END IF;
  SELECT * INTO m FROM public.quiz_banks WHERE grammar_canonical_code=p_code AND id<>r.id AND id<>n.id;
  RETURN m.grammar_predecessor_bank_id=r.id AND n.grammar_predecessor_bank_id=m.id
    AND m.topic_id=r.topic_id AND m.is_published AND NOT m.grammar_is_current AND m.grammar_retired_at IS NOT NULL
    AND m.version=r.version+1 AND n.version=m.version+1
    AND m.code=p_code||'~'||left(pair.middle_source,16) AND n.code=p_code||'~'||left(pair.final_source,16);
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
        AND old_bank.topic_id=NEW.topic_id AND (old_bank.code=NEW.grammar_canonical_code OR (
          (public.grammar_quiz_followup_pair(NEW.grammar_canonical_code)).final_source IS NOT NULL AND old_bank.code=NEW.grammar_canonical_code||'~'||left((public.grammar_quiz_followup_pair(NEW.grammar_canonical_code)).middle_source,16)
          AND c->>'source_sha256'=(public.grammar_quiz_followup_pair(NEW.grammar_canonical_code)).final_source
          AND (SELECT count(*) FROM public.quiz_banks WHERE grammar_canonical_code=NEW.grammar_canonical_code)=2))
        AND old_bank.grammar_revision=c->>'old_revision' AND old_bank.grammar_retired_at IS NOT NULL
        AND (old_bank.grammar_predecessor_bank_id IS NULL OR (public.grammar_quiz_followup_pair(NEW.grammar_canonical_code)).final_source IS NOT NULL))
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
  IF c->>'action'='cutover' AND c->>'old_bank'=OLD.id::TEXT
    AND (public.grammar_quiz_followup_pair(OLD.grammar_canonical_code)).final_source IS NOT NULL AND OLD.grammar_is_current
    AND OLD.code=OLD.grammar_canonical_code||'~'||left((public.grammar_quiz_followup_pair(OLD.grammar_canonical_code)).middle_source,16)
    AND OLD.grammar_predecessor_bank_id IS NOT NULL AND c->>'source_sha256'=(public.grammar_quiz_followup_pair(OLD.grammar_canonical_code)).final_source
    AND c->>'old_revision'=OLD.grammar_revision
    AND (to_jsonb(NEW)-ARRAY['grammar_is_current','grammar_retired_at','updated_at'])=
        (to_jsonb(OLD)-ARRAY['grammar_is_current','grammar_retired_at','updated_at'])
    AND NOT NEW.grammar_is_current AND NEW.grammar_retired_at IS NOT NULL
    AND public.grammar_quiz_audit_chain(OLD.grammar_canonical_code) THEN
    PERFORM public.grammar_quiz_receipt_data(OLD.grammar_predecessor_bank_id);
    NEW.updated_at:=OLD.updated_at; RETURN NEW;
  END IF;
  IF c->>'action'='pause_starts' AND c->>'bank'=OLD.id::TEXT
    AND c->>'code'=OLD.grammar_canonical_code
    AND (to_jsonb(NEW)-'grammar_new_starts_enabled'-'updated_at')=(to_jsonb(OLD)-'grammar_new_starts_enabled'-'updated_at')
    AND NOT NEW.grammar_new_starts_enabled THEN
    NEW.updated_at := OLD.updated_at; RETURN NEW;
  END IF;
  RAISE EXCEPTION 'grammar_managed_bank_immutable' USING ERRCODE='55000';
END $$;

CREATE OR REPLACE FUNCTION public.grammar_quiz_validate_receipt_envelope(p_data JSONB,p_bank UUID,p_actor UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.quiz_banks%ROWTYPE; n public.quiz_banks%ROWTYPE; binding JSONB;
  old_bank JSONB; new_bank JSONB; old_questions JSONB; new_questions JSONB;
  old_q JSONB; new_q JSONB; before_q JSONB; after_q JSONB; reviewed_questions JSONB:='[]';
  fields JSONB; changes JSONB:='[]'; key TEXT; candidate BOOLEAN; pre JSONB; initial_old JSONB;
  expected TEXT; preview TEXT; committed TEXT; original TEXT; manifest TEXT; corrected TEXT; matches INTEGER:=0;
  followup BOOLEAN; archived_child BOOLEAN; pair RECORD; stamp TIMESTAMPTZ; count_old INTEGER; count_new INTEGER; i INTEGER;
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
  SELECT * INTO pair FROM public.grammar_quiz_followup_pair(b.grammar_canonical_code);
  binding:=public.grammar_quiz_audit_binding(b.grammar_canonical_code,p_data->>'source_sha256');
  followup:=b.grammar_predecessor_bank_id IS NOT NULL;
  archived_child:=COALESCE(NOT n.grammar_is_current AND b.grammar_predecessor_bank_id IS NULL AND pair.middle_source IS NOT NULL AND p_data->>'source_sha256'=pair.middle_source AND public.grammar_quiz_audit_chain(b.grammar_canonical_code),FALSE);
  IF followup THEN
    IF pair.final_source IS NULL OR p_data->>'source_sha256'<>pair.final_source OR b.code<>b.grammar_canonical_code||'~'||left(pair.middle_source,16) OR NOT public.grammar_quiz_audit_chain(b.grammar_canonical_code) THEN
      RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
    END IF;
    PERFORM public.grammar_quiz_receipt_data(b.grammar_predecessor_bank_id);
    binding:=jsonb_set(binding,'{allowed_fields}',binding->'followup_fields');
  END IF;
  IF binding IS NULL OR p_data->>'actor_id' IS DISTINCT FROM p_actor::TEXT
    OR p_data->>'original_bank_id' IS DISTINCT FROM b.id::TEXT
    OR p_data->>'topic_id' IS DISTINCT FROM b.topic_id::TEXT
    OR p_data->>'canonical_code' IS DISTINCT FROM b.grammar_canonical_code OR (NOT followup AND b.code IS DISTINCT FROM b.grammar_canonical_code)
    OR b.skill_area<>'grammar' OR n.skill_area<>'grammar' OR NOT b.is_published OR NOT n.is_published
    OR b.grammar_is_current
    OR b.course_id IS NOT NULL OR b.lesson_no IS NOT NULL
    OR n.grammar_canonical_code IS DISTINCT FROM b.grammar_canonical_code OR (NOT n.grammar_is_current AND NOT archived_child)
    OR n.grammar_predecessor_bank_id IS DISTINCT FROM b.id OR n.topic_id IS DISTINCT FROM b.topic_id
    OR n.code IS DISTINCT FROM b.grammar_canonical_code||'~'||left(binding->>'source_sha256',16)
    OR n.version IS DISTINCT FROM b.version+1 OR (n.grammar_retired_at IS NOT NULL AND NOT archived_child)
    OR b.grammar_retired_at IS DISTINCT FROM stamp OR n.created_at IS DISTINCT FROM stamp OR n.updated_at IS DISTINCT FROM stamp
    OR NOT EXISTS(SELECT 1 FROM public.content_topics WHERE id=b.topic_id AND skill_area='grammar')
    OR p_data->>'source_sha256' IS DISTINCT FROM binding->>'source_sha256'
    OR p_data->>'manifest_sha256' IS DISTINCT FROM binding->>'manifest_sha256'
    OR jsonb_typeof(b.meta) IS DISTINCT FROM 'object' OR jsonb_typeof(n.meta) IS DISTINCT FROM 'object'
    OR (b.meta ? 'text_match_by_qid' AND b.meta->'text_match_by_qid' IS DISTINCT FROM '{}'::JSONB) THEN
    RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
  END IF;
  old_bank:=public.grammar_quiz_bank_evidence(b); new_bank:=public.grammar_quiz_bank_evidence(n);
  IF archived_child THEN new_bank:=new_bank||jsonb_build_object('grammar_is_current',TRUE,'grammar_retired_at',NULL); END IF;
  IF (new_bank-grammar_fields-ARRAY['id','code','version','created_at','updated_at','meta','words_count'])
      IS DISTINCT FROM (old_bank-grammar_fields-ARRAY['id','code','version','created_at','updated_at','meta','words_count'])
    OR n.words_count IS DISTINCT FROM (binding->'metadata'->>'words_count')::INTEGER
    OR n.meta IS DISTINCT FROM (b.meta||CASE WHEN binding->'metadata'->'meta' ? 'text_match_by_qid'
      THEN jsonb_build_object('text_match_by_qid',binding->'metadata'->'meta'->'text_match_by_qid') ELSE '{}'::JSONB END) THEN
    RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
  END IF;
  FOREACH key IN ARRAY ARRAY['code','title','skill_area','source','words_count','course_id','lesson_no','version'] LOOP
    IF old_bank->key IS DISTINCT FROM binding->'metadata'->key
      AND NOT (followup AND key='code' AND old_bank->>'code'=b.grammar_canonical_code||'~'||left(pair.middle_source,16))
      AND NOT (followup AND key='version' AND b.version=2 AND binding->'metadata'->'version'='1'::JSONB)
      AND NOT (key='words_count' AND binding->'metadata_changes'->key->'before'=old_bank->key
        AND binding->'metadata_changes'->key->'after'=binding->'metadata'->key) THEN
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
  original:=CASE WHEN followup THEN b.grammar_revision ELSE public.grammar_quiz_evidence_hash(jsonb_build_object('bank',old_bank-grammar_fields-'updated_at','questions',old_questions)) END;
  corrected:=public.grammar_quiz_evidence_hash(jsonb_build_object('manifest_sha256',manifest,'original_revision',original));
  IF manifest IS DISTINCT FROM binding->>'manifest_sha256'
    OR original IS DISTINCT FROM b.grammar_revision OR original IS DISTINCT FROM p_data->>'original_revision'
    OR corrected IS DISTINCT FROM n.grammar_revision OR corrected IS DISTINCT FROM p_data->>'corrected_revision'
    OR public.grammar_quiz_evidence_hash(old_questions) IS DISTINCT FROM p_data->>'original_questions_sha256'
    OR public.grammar_quiz_evidence_hash(b.meta) IS DISTINCT FROM p_data->>'original_metadata_sha256'
    OR public.grammar_quiz_evidence_hash(jsonb_build_object('code',b.grammar_canonical_code,'source_sha256',binding->>'source_sha256',
      'expected_revision',p_data->>'expected_revision','preview_fingerprint',p_data->>'preview_fingerprint',
      'operation_id',p_data->>'operation_id')) IS DISTINCT FROM p_data->>'payload_sha256' THEN
    RAISE EXCEPTION 'grammar_cutover_receipt_invalid' USING ERRCODE='55000';
  END IF;
  FOREACH candidate IN ARRAY ARRAY[FALSE,TRUE] LOOP
    initial_old:=old_bank||jsonb_build_object('grammar_new_starts_enabled',candidate);
    pre:=CASE WHEN followup THEN initial_old||jsonb_build_object('grammar_is_current',TRUE,'grammar_retired_at',NULL)
      ELSE initial_old||jsonb_build_object('grammar_canonical_code',NULL,'grammar_revision',NULL,
      'grammar_is_current',FALSE,'grammar_predecessor_bank_id',NULL,'grammar_retired_at',NULL) END;
    expected:=public.grammar_quiz_evidence_hash(jsonb_build_object('original',pre,'current',pre,
      'questions',old_questions,'current_questions',old_questions));
    preview:=public.grammar_quiz_evidence_hash(jsonb_build_object('code',b.grammar_canonical_code,'expected_revision',expected,
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
  IF b.grammar_canonical_code IS NULL OR (b.grammar_predecessor_bank_id IS NOT NULL AND ((public.grammar_quiz_followup_pair(b.grammar_canonical_code)).final_source IS NULL OR NOT public.grammar_quiz_audit_chain(b.grammar_canonical_code)))
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
          'provably_unfinished_terminal_carryover','genuinely_mastered','never_started','readonly_or_reset')
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

-- Postconditions
DO $$
DECLARE
    v_wrong text;
BEGIN
    SELECT pg_catalog.string_agg(f.sig, ', ' ORDER BY f.sig) INTO v_wrong
      FROM (VALUES ('public.grammar_quiz_audit_chain(text)', 'ffbfbfbd73d66246369cc4980219cbec', '1a3d52ef50d66565c9e2abb1b597dc55'),
                   ('public.grammar_quiz_guard_bank()', '8a48c803a25b91658876a34b8c25245c', '7bc1faa8d3d04328042590249e7aaead'),
                   ('public.grammar_quiz_validate_receipt_envelope(jsonb,uuid,uuid)', 'dad931cd7e1fb3e03958e767b9b1e2e5', 'ecda7c8f5b762809e6c771404dab5dca'),
                   ('public.grammar_quiz_receipt_data(uuid)', '30ee07b67df6b53155eba485a635b62b', '1fd63bf5cd3707a515359e8d4cca2c39')) f(sig, old_hash, new_hash)
      JOIN pg_catalog.pg_proc p ON p.oid OPERATOR(pg_catalog.=) f.sig::regprocedure
     WHERE NOT p.prosecdef
        OR p.proconfig IS NULL
        OR pg_catalog.array_to_string(p.proconfig, '|') OPERATOR(pg_catalog.<>) 'search_path=public, pg_temp'
        OR pg_catalog.md5(p.prosrc) OPERATOR(pg_catalog.<>) f.old_hash
        OR p.proowner OPERATOR(pg_catalog.<>) (SELECT c.relowner FROM pg_catalog.pg_class c
                                                WHERE c.oid OPERATOR(pg_catalog.=) 'public.quiz_banks'::regclass)
        OR p.proacl IS NULL
        OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
                    WHERE a.grantee OPERATOR(pg_catalog.=) 0::oid)
        OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE');
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'grammar_quiz_search_path_wrong: %', v_wrong;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger g
                    WHERE g.tgrelid OPERATOR(pg_catalog.=) 'public.quiz_banks'::regclass
                      AND g.tgname OPERATOR(pg_catalog.=) 'zz_grammar_quiz_bank_guard'
                      AND g.tgfoid OPERATOR(pg_catalog.=) 'public.grammar_quiz_guard_bank()'::regprocedure
                      AND g.tgenabled OPERATOR(pg_catalog.=) ANY (ARRAY['O', 'A']::"char"[])) THEN
        RAISE EXCEPTION 'grammar_quiz_trigger_missing: zz_grammar_quiz_bank_guard';
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_temp.m369_function_identity b
                LEFT JOIN pg_catalog.pg_proc p ON p.oid OPERATOR(pg_catalog.=) b.oid
                WHERE p.oid IS NULL
                   OR p.proowner IS DISTINCT FROM b.proowner
                   OR p.proacl IS DISTINCT FROM b.proacl
                   OR p.prosecdef IS DISTINCT FROM b.prosecdef) THEN
        RAISE EXCEPTION 'grammar_quiz_function_identity_changed';
    END IF;
END $$;

COMMIT;
