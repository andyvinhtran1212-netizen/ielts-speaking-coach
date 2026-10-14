-- VOCABSETS-0020. Additive: legacy personal stacks, quizzes and D1 stay intact.
BEGIN;
CREATE TABLE IF NOT EXISTS vocabulary_sets (
  id uuid PRIMARY KEY, title text NOT NULL, description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  version integer NOT NULL DEFAULT 1, published_revision integer NOT NULL DEFAULT 0,
  card_ids uuid[] NOT NULL DEFAULT '{}', library boolean NOT NULL DEFAULT false,
  course_ids uuid[] NOT NULL DEFAULT '{}', cohort_ids uuid[] NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES auth.users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vocabulary_set_revisions (
  set_id uuid REFERENCES vocabulary_sets(id), revision integer,
  title text NOT NULL, description text NOT NULL, cards jsonb NOT NULL,
  library boolean NOT NULL, course_ids uuid[] NOT NULL, cohort_ids uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(set_id, revision)
);
CREATE TABLE IF NOT EXISTS vocabulary_set_sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id),
  set_id uuid NOT NULL REFERENCES vocabulary_sets(id), revision integer NOT NULL,
  title text NOT NULL, mode text NOT NULL CHECK(mode IN ('flashcards','learn','cloze','test')),
  start_payload jsonb NOT NULL, items jsonb NOT NULL, answers jsonb NOT NULL DEFAULT '[]',
  completed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(set_id, revision) REFERENCES vocabulary_set_revisions(set_id, revision)
);
CREATE INDEX IF NOT EXISTS vocabulary_sessions_owner ON vocabulary_set_sessions(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS vocabulary_shared_progress (
  user_id uuid REFERENCES auth.users(id), card_id uuid,
  version integer NOT NULL DEFAULT 0, familiar boolean NOT NULL DEFAULT false,
  recall_attempts integer NOT NULL DEFAULT 0, recall_correct integer NOT NULL DEFAULT 0,
  interval_days integer NOT NULL DEFAULT 0, ease_factor numeric NOT NULL DEFAULT 2.5,
  lapse_count integer NOT NULL DEFAULT 0, review_count integer NOT NULL DEFAULT 0,
  last_reviewed_at timestamptz, next_review_at timestamptz,
  PRIMARY KEY(user_id,card_id)
);
CREATE TABLE IF NOT EXISTS vocabulary_set_receipts (
  user_id uuid REFERENCES auth.users(id), client_id uuid, session_id uuid NOT NULL REFERENCES vocabulary_set_sessions(id),
  payload jsonb NOT NULL, response jsonb NOT NULL, PRIMARY KEY(user_id,client_id)
);
-- Answer snapshots never leave the backend through direct Supabase requests.
ALTER TABLE vocabulary_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_set_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_set_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_shared_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_set_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vocabulary_sets,vocabulary_set_revisions,vocabulary_set_sessions,vocabulary_shared_progress,vocabulary_set_receipts FROM anon,authenticated;
GRANT ALL ON vocabulary_sets,vocabulary_set_revisions,vocabulary_set_sessions,vocabulary_shared_progress,vocabulary_set_receipts TO service_role;

CREATE OR REPLACE FUNCTION fn_vocabulary_set_visible(p_user uuid,p_set uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM vocabulary_sets v JOIN vocabulary_set_revisions r ON r.set_id=v.id AND r.revision=v.published_revision
   WHERE v.id=p_set AND v.status='published' AND (
   r.library OR EXISTS(SELECT 1 FROM students s JOIN student_cohort_memberships m ON m.student_id=s.id AND m.is_active
     JOIN cohorts c ON c.id=m.cohort_id AND c.is_active LEFT JOIN courses k ON k.id=c.course_id
     WHERE s.user_id=p_user AND (c.id=ANY(r.cohort_ids) OR (k.is_active AND k.id=ANY(r.course_ids))))));
$$;

CREATE OR REPLACE FUNCTION fn_save_vocabulary_set(p_id uuid,p_actor uuid,p_expected integer,p_data jsonb,p_action text DEFAULT 'save')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v vocabulary_sets; snapshot jsonb; ids uuid[]; courses_wanted uuid[]; cohorts_wanted uuid[];
BEGIN
 SELECT * INTO v FROM vocabulary_sets WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN
   IF p_expected<>0 OR p_action<>'save' THEN RAISE EXCEPTION 'set_conflict'; END IF;
   INSERT INTO vocabulary_sets(id,title,created_by) VALUES(p_id,p_data->>'title',p_actor) RETURNING * INTO v;
  ELSIF v.version<>p_expected THEN
    -- An acknowledgement may be lost: replay only the exact next saved state.
    IF p_action='save' AND v.version=p_expected+1 AND v.title=p_data->>'title' AND v.description=p_data->>'description'
      AND to_jsonb(v.card_ids)=p_data->'card_ids' AND to_jsonb(v.course_ids)=p_data->'course_ids'
      AND to_jsonb(v.cohort_ids)=p_data->'cohort_ids' AND v.library=(p_data->>'library')::boolean THEN RETURN to_jsonb(v); END IF;
    RAISE EXCEPTION 'set_conflict';
 END IF;
 IF p_action='save' THEN
   SELECT COALESCE(array_agg(x::uuid),'{}') INTO ids FROM jsonb_array_elements_text(p_data->'card_ids') x;
   SELECT COALESCE(array_agg(x::uuid),'{}') INTO courses_wanted FROM jsonb_array_elements_text(p_data->'course_ids') x;
   SELECT COALESCE(array_agg(x::uuid),'{}') INTO cohorts_wanted FROM jsonb_array_elements_text(p_data->'cohort_ids') x;
   IF cardinality(ids)>200 OR (SELECT count(*) FROM vocab_cards WHERE id=ANY(ids))<>cardinality(ids) THEN RAISE EXCEPTION 'invalid_cards'; END IF;
   IF (SELECT count(*) FROM courses WHERE id=ANY(courses_wanted) AND is_active)<>cardinality(courses_wanted)
     OR (SELECT count(*) FROM cohorts WHERE id=ANY(cohorts_wanted) AND is_active)<>cardinality(cohorts_wanted) THEN RAISE EXCEPTION 'invalid_audience'; END IF;
   UPDATE vocabulary_sets SET title=p_data->>'title',description=p_data->>'description',card_ids=ids,
     library=(p_data->>'library')::boolean,course_ids=courses_wanted,cohort_ids=cohorts_wanted,
     version=CASE WHEN p_expected=0 THEN 1 ELSE version+1 END,updated_at=now() WHERE id=p_id RETURNING * INTO v;
 ELSIF p_action='publish' THEN
   IF cardinality(v.card_ids)=0 OR (NOT v.library AND cardinality(v.course_ids)+cardinality(v.cohort_ids)=0) THEN RAISE EXCEPTION 'incomplete_set'; END IF;
   SELECT jsonb_agg(jsonb_build_object('id',c.id,'slug',c.slug,'category',c.category,'headword',c.headword,
      'gloss_vi',COALESCE(c.gloss_vi,''),'definition_en',COALESCE(c.definition_en,''),'pronunciation',COALESCE(c.pronunciation,''),
      'part_of_speech',COALESCE(c.part_of_speech,''),'level',COALESCE(c.level,''),'example',COALESCE(c.example,''),
      'audio_headword',COALESCE(c.audio_headword,''),'audio_example',COALESCE(c.audio_example,'')) ORDER BY x.n)
   INTO snapshot FROM unnest(v.card_ids) WITH ORDINALITY x(id,n) JOIN vocab_cards c ON c.id=x.id;
   IF jsonb_array_length(COALESCE(snapshot,'[]'))<>cardinality(v.card_ids) THEN RAISE EXCEPTION 'invalid_cards'; END IF;
   IF (SELECT count(*) FROM courses WHERE id=ANY(v.course_ids) AND is_active)<>cardinality(v.course_ids)
     OR (SELECT count(*) FROM cohorts WHERE id=ANY(v.cohort_ids) AND is_active)<>cardinality(v.cohort_ids) THEN RAISE EXCEPTION 'invalid_audience'; END IF;
   INSERT INTO vocabulary_set_revisions(set_id,revision,title,description,cards,library,course_ids,cohort_ids)
     VALUES(p_id,v.published_revision+1,v.title,v.description,snapshot,v.library,v.course_ids,v.cohort_ids);
   UPDATE vocabulary_sets SET published_revision=published_revision+1,status='published',version=version+1,updated_at=now() WHERE id=p_id RETURNING * INTO v;
 ELSIF p_action='archive' THEN
   UPDATE vocabulary_sets SET status='archived',version=version+1,updated_at=now() WHERE id=p_id RETURNING * INTO v;
 ELSE RAISE EXCEPTION 'invalid_action'; END IF;
 RETURN to_jsonb(v);
END; $$;

CREATE OR REPLACE FUNCTION fn_start_vocabulary_session(p_user uuid,p_id uuid,p_set uuid,p_revision integer,p_mode text,p_payload jsonb,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v vocabulary_set_sessions; title_value text;
BEGIN
 -- Serialize duplicate starts, including requests racing in different workers.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 SELECT * INTO v FROM vocabulary_set_sessions WHERE id=p_id;
 IF FOUND THEN
   IF v.user_id<>p_user OR v.set_id<>p_set OR v.start_payload<>p_payload THEN RAISE EXCEPTION 'replay_conflict'; END IF;
   IF NOT fn_vocabulary_set_visible(p_user,p_set) THEN RAISE EXCEPTION 'set_denied'; END IF;
   RETURN to_jsonb(v);
 END IF;
 PERFORM 1 FROM vocabulary_sets WHERE id=p_set FOR SHARE;
 IF NOT fn_vocabulary_set_visible(p_user,p_set) THEN RAISE EXCEPTION 'set_denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM vocabulary_sets WHERE id=p_set AND published_revision=p_revision) THEN RAISE EXCEPTION 'set_conflict'; END IF;
 SELECT title INTO title_value FROM vocabulary_set_revisions WHERE set_id=p_set AND revision=p_revision;
 INSERT INTO vocabulary_set_sessions(id,user_id,set_id,revision,title,mode,start_payload,items)
 VALUES(p_id,p_user,p_set,p_revision,title_value,p_mode,p_payload,p_items) RETURNING * INTO v;
 RETURN to_jsonb(v);
END; $$;

CREATE OR REPLACE FUNCTION fn_answer_vocabulary_session(p_user uuid,p_session uuid,p_client uuid,p_payload jsonb,p_answers jsonb,p_progress jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v vocabulary_set_sessions; receipt vocabulary_set_receipts; change jsonb; current_version integer; response jsonb;
BEGIN
 -- Stable lock order: receipt key, session, then sorted canonical card IDs.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||p_client::text,0));
 SELECT * INTO v FROM vocabulary_set_sessions WHERE id=p_session AND user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'session_missing'; END IF;
 PERFORM 1 FROM vocabulary_sets WHERE id=v.set_id FOR SHARE;
 IF NOT fn_vocabulary_set_visible(p_user,v.set_id) THEN RAISE EXCEPTION 'set_denied'; END IF;
 SELECT * INTO receipt FROM vocabulary_set_receipts WHERE user_id=p_user AND client_id=p_client;
 IF FOUND THEN
   IF receipt.session_id<>p_session OR receipt.payload<>p_payload THEN RAISE EXCEPTION 'replay_conflict'; END IF;
   RETURN receipt.response;
 END IF;
 IF v.completed THEN RAISE EXCEPTION 'session_completed'; END IF;
 IF v.mode='test' THEN
   IF jsonb_array_length(p_answers)<>jsonb_array_length(v.items) THEN RAISE EXCEPTION 'invalid_answers'; END IF;
 ELSE
   IF jsonb_array_length(p_answers)<>1 OR (p_answers->0->>'index')::integer<>jsonb_array_length(v.answers) THEN RAISE EXCEPTION 'answer_conflict'; END IF;
 END IF;
 FOR change IN SELECT value FROM jsonb_array_elements(p_progress) ORDER BY value->>'card_id' LOOP
   INSERT INTO vocabulary_shared_progress(user_id,card_id) VALUES(p_user,(change->>'card_id')::uuid) ON CONFLICT DO NOTHING;
   SELECT version INTO current_version FROM vocabulary_shared_progress WHERE user_id=p_user AND card_id=(change->>'card_id')::uuid FOR UPDATE;
   IF current_version<>(change->>'expected_version')::integer THEN RAISE EXCEPTION 'progress_conflict'; END IF;
   UPDATE vocabulary_shared_progress SET version=version+1,familiar=(change->>'familiar')::boolean,
     recall_attempts=(change->>'recall_attempts')::integer,recall_correct=(change->>'recall_correct')::integer,
     interval_days=(change->>'interval_days')::integer,ease_factor=(change->>'ease_factor')::numeric,
     lapse_count=(change->>'lapse_count')::integer,review_count=(change->>'review_count')::integer,
     last_reviewed_at=(change->>'last_reviewed_at')::timestamptz,next_review_at=(change->>'next_review_at')::timestamptz
     WHERE user_id=p_user AND card_id=(change->>'card_id')::uuid;
 END LOOP;
 UPDATE vocabulary_set_sessions SET answers=answers||p_answers,
   completed=(jsonb_array_length(answers||p_answers)=jsonb_array_length(items)) WHERE id=p_session RETURNING * INTO v;
 response=to_jsonb(v);
 INSERT INTO vocabulary_set_receipts(user_id,client_id,session_id,payload,response) VALUES(p_user,p_client,p_session,p_payload,response);
 RETURN response;
END; $$;
REVOKE ALL ON FUNCTION fn_vocabulary_set_visible(uuid,uuid),fn_save_vocabulary_set(uuid,uuid,integer,jsonb,text),fn_start_vocabulary_session(uuid,uuid,uuid,integer,text,jsonb,jsonb),fn_answer_vocabulary_session(uuid,uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION fn_vocabulary_set_visible(uuid,uuid),fn_save_vocabulary_set(uuid,uuid,integer,jsonb,text),fn_start_vocabulary_session(uuid,uuid,uuid,integer,text,jsonb,jsonb),fn_answer_vocabulary_session(uuid,uuid,uuid,jsonb,jsonb,jsonb) TO service_role;
COMMIT;
