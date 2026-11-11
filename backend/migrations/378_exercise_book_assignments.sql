-- Exercise-book D1, pending_feature. Run only after separately approved 376/377.
-- One immutable activity per assignment, one immutable attempt link per retry.
-- No new UNIQUE on any shared assignment/attempt table, no request table.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE public.class_assignment_activities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id uuid NOT NULL REFERENCES public.class_assignments(id) ON DELETE RESTRICT,
    test_id uuid NOT NULL REFERENCES public.listening_tests(id) ON DELETE RESTRICT,
    position integer NOT NULL CHECK (position BETWEEN 1 AND 17),
    programme_id text NOT NULL REFERENCES public.exercise_book_registry(programme_id) ON DELETE RESTRICT,
    activity_key text NOT NULL,
    binding jsonb NOT NULL CHECK (jsonb_typeof(binding)='object'),
    request_fingerprint text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX exercise_book_activity_assignment ON public.class_assignment_activities(assignment_id,position);
CREATE TABLE public.exercise_book_attempt_links (
    attempt_id uuid PRIMARY KEY REFERENCES public.listening_test_attempts(id) ON DELETE RESTRICT,
    activity_id uuid NOT NULL REFERENCES public.class_assignment_activities(id) ON DELETE RESTRICT,
    item_id uuid NOT NULL REFERENCES public.class_assignment_items(id) ON DELETE RESTRICT,
    client_sequences jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX exercise_book_link_cell ON public.exercise_book_attempt_links(item_id,activity_id);
CREATE TRIGGER exercise_book_activities_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.class_assignment_activities FOR EACH STATEMENT EXECUTE FUNCTION public.fn_eb_append_only();

-- Existing class audit actions remain valid; the added actions carry no answers
-- or grant reasons. Evidence is retained by rollback (including these CHECK values).
DO $$
DECLARE constraint_name name; definition text; found_count integer;
BEGIN
    SELECT count(*) INTO found_count FROM pg_constraint c
      WHERE c.conrelid='public.class_action_log'::regclass AND c.contype='c'
        AND (SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='action')=ANY(c.conkey);
    SELECT c.conname,pg_get_constraintdef(c.oid) INTO constraint_name,definition FROM pg_constraint c
      WHERE c.conrelid='public.class_action_log'::regclass AND c.contype='c'
        AND (SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='action')=ANY(c.conkey);
    IF found_count<>1 OR definition IS DISTINCT FROM
       'CHECK ((action = ANY (ARRAY[''due_change''::text, ''return_work''::text])))' THEN
        RAISE EXCEPTION 'exercise_book_action_check_drift' USING ERRCODE='55000'; END IF;
    EXECUTE format('ALTER TABLE public.class_action_log DROP CONSTRAINT %I',constraint_name);
END $$;
ALTER TABLE public.class_action_log ADD CONSTRAINT class_action_log_action_check
 CHECK (action IN ('due_change','return_work','exercise_book_assign','exercise_book_close')) NOT VALID;
ALTER TABLE public.class_action_log VALIDATE CONSTRAINT class_action_log_action_check;

CREATE FUNCTION public.fn_eb_roles(p_actor_id uuid,p_cohort_id uuid,p_programme_id text,p_assign boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE granted text[];
BEGIN
    SELECT a.roles INTO granted FROM public.fn_exercise_book_actor_access(p_actor_id,p_cohort_id,p_programme_id) a;
    IF NOT COALESCE('assigner'=ANY(granted),false)
       AND (p_assign OR NOT COALESCE('teacher'=ANY(granted),false)) THEN
        RAISE EXCEPTION 'not_granted' USING ERRCODE='EB403';
    END IF;
END $$;

-- Full private binding comparison, including the answer set, is done under the
-- canonical paper lock. Snapshot capture 306 is unchanged.
CREATE FUNCTION public.fn_eb_paper(p_test_id uuid,p_binding jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE paper jsonb; reg public.exercise_book_registry%ROWTYPE; activity jsonb; b jsonb; review jsonb; n integer;
BEGIN
    paper:=public.fn_mock_paper_row('listening',p_test_id);
    SELECT r.* INTO reg FROM public.exercise_book_registry r WHERE r.programme_id=paper->>'programme_id';
    IF NOT FOUND OR NOT public.fn_mock_admission_contract_active() THEN
        RAISE EXCEPTION 'activity_locked' USING ERRCODE='EB422';
    END IF;
    activity:=paper->'metadata'->reg.metadata_key; b:=activity->'binding';
    IF b IS DISTINCT FROM p_binding THEN RAISE EXCEPTION 'stale_revision' USING ERRCODE='EB409'; END IF;
    IF paper->>'status' IS DISTINCT FROM 'published' OR paper->>'is_public' IS DISTINCT FROM 'true'
      OR paper->>'scoring_policy' IS DISTINCT FROM reg.scoring_policy
      OR NOT EXISTS (SELECT 1 FROM public.listening_content_packages p
          WHERE p.id=(paper->>'content_package_id')::uuid AND p.programme_id=reg.programme_id AND p.status='published')
      OR b->>'programme_id' IS DISTINCT FROM reg.programme_id
      OR b->>'collection_id' IS DISTINCT FROM reg.collection_id
      OR b->>'source_contract' IS DISTINCT FROM reg.source_contract OR b->>'unit_id' IS DISTINCT FROM reg.unit_id
      OR COALESCE(b->>'activity_id','') !~ reg.activity_pattern OR b->>'activity_id'=ANY(reg.locked_activities)
      OR activity->>'readiness' IS DISTINCT FROM 'ready' OR activity->>'selectable' IS DISTINCT FROM 'true'
      OR COALESCE(b->>'content_revision','') IN ('','latest') OR COALESCE(b->>'policy_revision','') IN ('','latest')
      OR COALESCE(b->>'answer_set_revision','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      OR jsonb_typeof(activity->'items') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'activity_locked' USING ERRCODE='EB422';
    END IF;
    n:=jsonb_array_length(activity->'items');
    IF n NOT BETWEEN 1 AND 48 OR activity->>'response_cell_count' IS DISTINCT FROM n::text
      OR (reg.cell_rules->(b->>'activity_id') ? 'count' AND (reg.cell_rules->(b->>'activity_id')->>'count')::integer<>n)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(activity->'items') c
        WHERE reg.cell_rules->(b->>'activity_id') ? 'interaction'
          AND c->>'interaction' IS DISTINCT FROM reg.cell_rules->(b->>'activity_id')->>'interaction')
      OR (SELECT count(DISTINCT c->>'source_item_id') FROM jsonb_array_elements(activity->'items') c)<>n
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(activity->'items') WITH ORDINALITY c(item,pos)
        WHERE c.item->>'q_num' IS DISTINCT FROM c.pos::text OR COALESCE(c.item->>'source_item_id','')=''
          OR NOT COALESCE(c.item->>'interaction'=ANY(reg.interactions),false)) THEN
        RAISE EXCEPTION 'activity_locked' USING ERRCODE='EB422';
    END IF;
    IF (SELECT count(*) FROM public.listening_exercises e JOIN public.listening_content c ON c.id=e.content_id
       WHERE c.test_id=p_test_id)<>1 THEN RAISE EXCEPTION 'activity_locked' USING ERRCODE='EB422'; END IF;
    SELECT e.payload->reg.review_key INTO review FROM public.listening_exercises e
      JOIN public.listening_content c ON c.id=e.content_id WHERE c.test_id=p_test_id
        AND c.status='published' AND e.status='published';
    IF review->'binding' IS DISTINCT FROM b OR jsonb_typeof(review->'items') IS DISTINCT FROM 'array'
      OR jsonb_typeof(review->'transcript') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'activity_locked' USING ERRCODE='EB422';
    END IF;
    IF jsonb_array_length(review->'items')<>n OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(activity->'items') WITH ORDINALITY c(item,pos)
       WHERE review->'items'->(c.pos::integer-1)->>'q_num' IS DISTINCT FROM c.item->>'q_num'
          OR review->'items'->(c.pos::integer-1)->>'source_item_id' IS DISTINCT FROM c.item->>'source_item_id'
          OR NOT COALESCE(review->'items'->(c.pos::integer-1)->>'scoring_mode'=ANY(reg.scoring_modes),false)) THEN
        RAISE EXCEPTION 'activity_locked' USING ERRCODE='EB422';
    END IF;
    RETURN paper;
END $$;

CREATE FUNCTION public.fn_eb_receipt(p_assignment_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT jsonb_build_object('assignment_id',a.id,'request_id',a.id,'cohort_id',a.cohort_id,
   'activities',(SELECT jsonb_agg(c.binding ORDER BY c.position) FROM public.class_assignment_activities c WHERE c.assignment_id=a.id),
   'recipient_ids',(SELECT jsonb_agg(i.student_id ORDER BY i.student_id) FROM public.class_assignment_items i WHERE i.assignment_id=a.id),
   'due_at',to_char(a.due_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'deadline_timezone',a.content_config->>'deadline_timezone',
   'replay_policy',a.content_config->>'replay_policy',
   'completion_denominator',(SELECT count(*) FROM public.class_assignment_activities c WHERE c.assignment_id=a.id),
   'status',a.status,'created_at',to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
 FROM public.class_assignments a WHERE a.id=p_assignment_id
$$;

CREATE FUNCTION public.fn_create_exercise_book_assignment(
 p_actor_id uuid,p_request_id uuid,p_cohort_id uuid,p_programme_id text,p_activities jsonb,
 p_recipient_ids uuid[],p_due_at timestamptz,p_deadline_timezone text DEFAULT 'Asia/Ho_Chi_Minh',
 p_replay_policy text DEFAULT 'allowed',p_title text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE reg public.exercise_book_registry%ROWTYPE; b jsonb; paper jsonb; test_id uuid;
        selected_tests uuid[]:='{}'; recipients uuid[]; fingerprint text; resolved_title text; old_assignment public.class_assignments%ROWTYPE;
        actor_email text;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE insufficient_privilege; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('eb_assign:'||p_request_id,0));
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('eb_grant:'||p_cohort_id||':'||p_programme_id,0));
    PERFORM public.fn_eb_roles(p_actor_id,p_cohort_id,p_programme_id,true);
    PERFORM public.fn_eb_require_cohort(p_cohort_id,p_programme_id);
    SELECT r.* INTO reg FROM public.exercise_book_registry r WHERE r.programme_id=p_programme_id;
    IF jsonb_typeof(p_activities) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'validation' USING ERRCODE='EB422'; END IF;
    IF p_request_id IS NULL OR jsonb_array_length(p_activities) NOT BETWEEN 1 AND 17
      OR COALESCE(cardinality(p_recipient_ids),0) NOT BETWEEN 1 AND 500
      OR cardinality(p_recipient_ids)*jsonb_array_length(p_activities)>8500
      OR array_position(p_recipient_ids,NULL) IS NOT NULL
      OR p_deadline_timezone IS DISTINCT FROM 'Asia/Ho_Chi_Minh' OR p_replay_policy IS DISTINCT FROM 'allowed'
      OR p_due_at IS NULL OR p_due_at>clock_timestamp()+interval '180 days' THEN
        RAISE EXCEPTION 'validation' USING ERRCODE='EB422';
    END IF;
    SELECT array_agg(x ORDER BY x) INTO recipients FROM (SELECT DISTINCT unnest(p_recipient_ids) x) q;
    IF cardinality(recipients)<>cardinality(p_recipient_ids) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_activities) c WHERE jsonb_typeof(c)<>'object') THEN
        RAISE EXCEPTION 'validation' USING ERRCODE='EB422';
    END IF;
    resolved_title:=COALESCE(p_title,reg.unit_title);
    IF length(btrim(resolved_title)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'validation' USING ERRCODE='EB422'; END IF;
    -- timestamptz serialization is independent of the caller's TimeZone.
    fingerprint:=encode(sha256(convert_to(jsonb_build_object('actor',p_actor_id,'cohort',p_cohort_id,
      'programme',p_programme_id,'activities',p_activities,'recipients',to_jsonb(recipients),
      'due_at',to_char(p_due_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),
      'timezone',p_deadline_timezone,'replay_policy',p_replay_policy,'title',resolved_title)::text,'UTF8')),'hex');
    SELECT a.* INTO old_assignment FROM public.class_assignments a WHERE a.id=p_request_id;
    IF FOUND THEN
      IF old_assignment.cohort_id IS DISTINCT FROM p_cohort_id OR old_assignment.assigned_by IS DISTINCT FROM p_actor_id
        OR old_assignment.content_config->>'programme_id' IS DISTINCT FROM p_programme_id
        OR NOT EXISTS (SELECT 1 FROM public.class_assignment_activities c WHERE c.assignment_id=p_request_id)
        OR EXISTS (SELECT 1 FROM public.class_assignment_activities c WHERE c.assignment_id=p_request_id AND c.request_fingerprint<>fingerprint) THEN
          RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='EB409';
      END IF;
      RETURN public.fn_eb_receipt(p_request_id)||jsonb_build_object('replayed',true);
    END IF;
    IF p_due_at<=clock_timestamp() THEN RAISE EXCEPTION 'validation' USING ERRCODE='EB422'; END IF;
    -- Lock recipient source rows too: archive/removal cannot race fan-out.
    PERFORM 1 FROM public.students s JOIN public.student_cohort_memberships cm ON cm.student_id=s.id
      JOIN public.users u ON u.id=s.user_id WHERE s.id=ANY(recipients) AND cm.cohort_id=p_cohort_id
        AND cm.is_active AND s.is_active AND s.archived_at IS NULL AND u.is_active AND u.suspended_at IS NULL
      ORDER BY s.id FOR SHARE OF s,cm,u;
    IF (SELECT count(*) FROM public.students s JOIN public.student_cohort_memberships cm ON cm.student_id=s.id
       JOIN public.users u ON u.id=s.user_id WHERE s.id=ANY(recipients) AND cm.cohort_id=p_cohort_id
         AND cm.is_active AND s.is_active AND s.archived_at IS NULL AND u.is_active AND u.suspended_at IS NULL)<>cardinality(recipients) THEN
        RAISE EXCEPTION 'validation' USING ERRCODE='EB422';
    END IF;
    FOR b IN SELECT value FROM jsonb_array_elements(p_activities) LOOP
      IF (SELECT count(*) FROM jsonb_object_keys(b))<>8 OR b->>'programme_id' IS DISTINCT FROM p_programme_id THEN
        RAISE EXCEPTION 'validation' USING ERRCODE='EB422';
      END IF;
      -- No arbitrary test selector: resolve each full binding server-side.
      IF (SELECT count(*) FROM public.listening_tests t WHERE t.programme_id=p_programme_id
          AND t.metadata->reg.metadata_key->'binding'=b)<>1 THEN
        RAISE EXCEPTION 'stale_revision' USING ERRCODE='EB409'; END IF;
      SELECT t.id INTO test_id FROM public.listening_tests t
        WHERE t.programme_id=p_programme_id AND t.metadata->reg.metadata_key->'binding'=b;
      IF test_id IS NULL THEN RAISE EXCEPTION 'stale_revision' USING ERRCODE='EB409'; END IF;
      IF test_id=ANY(selected_tests) THEN RAISE EXCEPTION 'validation' USING ERRCODE='EB422'; END IF;
      selected_tests:=array_append(selected_tests,test_id);
    END LOOP;
    FOR test_id IN SELECT unnest(selected_tests) ORDER BY 1 LOOP PERFORM public.fn_lock_mock_paper('listening',test_id); END LOOP;
    FOR n IN 1..cardinality(selected_tests) LOOP
      paper:=public.fn_eb_paper(selected_tests[n],p_activities->(n-1));
    END LOOP;
    BEGIN
      INSERT INTO public.class_assignments(id,cohort_id,skill,content_id,content_config,title,due_at,status,assigned_by)
      VALUES (p_request_id,p_cohort_id,'listening',NULL,jsonb_build_object('programme_id',p_programme_id,
        'exercise_book',true,'delivery_mode','assigned_practice','deadline_timezone',p_deadline_timezone,'replay_policy',p_replay_policy),
        resolved_title,p_due_at,'published',p_actor_id);
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='EB409'; END;
    INSERT INTO public.class_assignment_items(assignment_id,student_id) SELECT p_request_id,unnest(recipients);
    INSERT INTO public.class_assignment_activities(assignment_id,test_id,position,programme_id,activity_key,binding,request_fingerprint)
      SELECT p_request_id,selected_tests[c.pos],c.pos,p_programme_id,c.b->>'activity_id',c.b,fingerprint
        FROM jsonb_array_elements(p_activities) WITH ORDINALITY c(b,pos);
    SELECT u.email INTO actor_email FROM public.users u WHERE u.id=p_actor_id;
    INSERT INTO public.class_action_log(action,cohort_id,assignment_id,assignment_title,actor_user_id,actor_email,details)
      VALUES ('exercise_book_assign',p_cohort_id,p_request_id,resolved_title,p_actor_id,actor_email,
        jsonb_build_object('activity_count',cardinality(selected_tests),'recipient_count',cardinality(recipients)));
    RETURN public.fn_eb_receipt(p_request_id)||jsonb_build_object('replayed',false);
END $$;

CREATE FUNCTION public.fn_close_exercise_book_assignment(p_actor_id uuid,p_cohort_id uuid,p_assignment_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE programme text; assignment public.class_assignments%ROWTYPE;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE insufficient_privilege; END IF;
    SELECT c.programme_id INTO programme FROM public.class_assignment_activities c
      JOIN public.class_assignments a ON a.id=c.assignment_id
      WHERE a.id=p_assignment_id AND a.cohort_id=p_cohort_id AND a.skill='listening' LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='EB404'; END IF;
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('eb_grant:'||p_cohort_id||':'||programme,0));
    PERFORM public.fn_eb_roles(p_actor_id,p_cohort_id,programme,true);
    IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'validation' USING ERRCODE='EB422'; END IF;
    SELECT a.* INTO assignment FROM public.class_assignments a WHERE a.id=p_assignment_id AND a.cohort_id=p_cohort_id FOR UPDATE;
    IF assignment.status='archived' THEN RAISE EXCEPTION 'already_archived' USING ERRCODE='EB409'; END IF;
    UPDATE public.class_assignments SET status='archived' WHERE id=p_assignment_id;
    INSERT INTO public.class_action_log(action,cohort_id,assignment_id,assignment_title,actor_user_id,actor_email,details)
      SELECT 'exercise_book_close',p_cohort_id,p_assignment_id,assignment.title,p_actor_id,u.email,
        jsonb_build_object('reason',btrim(p_reason)) FROM public.users u WHERE u.id=p_actor_id;
    RETURN public.fn_eb_receipt(p_assignment_id);
END $$;

CREATE FUNCTION public.fn_list_exercise_book_assignments(p_actor_id uuid,p_cohort_id uuid,p_programme_id text,
 p_limit integer DEFAULT 50,p_before_created_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL)
RETURNS TABLE(assignment_id uuid,title text,status text,due_at timestamptz,activity_count integer,recipient_count integer,created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE insufficient_privilege; END IF;
    PERFORM public.fn_eb_roles(p_actor_id,p_cohort_id,p_programme_id);
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
      OR (p_before_created_at IS NULL)<>(p_before_id IS NULL) THEN RAISE EXCEPTION 'validation' USING ERRCODE='EB422'; END IF;
    RETURN QUERY SELECT a.id,a.title,a.status,a.due_at,
      (SELECT count(*)::integer FROM public.class_assignment_activities c WHERE c.assignment_id=a.id),
      (SELECT count(*)::integer FROM public.class_assignment_items i WHERE i.assignment_id=a.id),a.created_at
    FROM public.class_assignments a WHERE a.cohort_id=p_cohort_id
      AND EXISTS (SELECT 1 FROM public.class_assignment_activities c WHERE c.assignment_id=a.id AND c.programme_id=p_programme_id)
      AND (p_before_created_at IS NULL OR (a.created_at,a.id)<(p_before_created_at,p_before_id))
      ORDER BY a.created_at DESC,a.id DESC LIMIT p_limit;
END $$;

CREATE FUNCTION public.fn_eb_cells(p_assignment_id uuid) RETURNS TABLE(
 student_id uuid,display_name text,user_id uuid,item_id uuid,activity_id text,activity_row_id uuid,
 test_id uuid,"position" integer,attempt_id uuid,status text,submitted_at timestamptz,blank_count integer)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT s.id,s.full_name,s.user_id,i.id,c.activity_key,c.id,c.test_id,c.position,a.id,
   CASE WHEN c.test_id IS NULL THEN 'unavailable' WHEN a.status='submitted' THEN 'submitted'
     WHEN a.status='in_progress' AND a.resume_expires_at>clock_timestamp() AND ca.due_at>=clock_timestamp()
       AND ca.status='published' THEN 'in_progress'
     WHEN ca.due_at<clock_timestamp() OR a.resume_expires_at<=clock_timestamp() OR ca.status='archived' THEN 'expired'
     ELSE 'not_started' END,
   a.submitted_at,COALESCE((a.result_summary->>'blank_count')::integer,0)
 FROM public.class_assignments ca JOIN public.class_assignment_items i ON i.assignment_id=ca.id
 JOIN public.students s ON s.id=i.student_id JOIN public.class_assignment_activities c ON c.assignment_id=ca.id
 LEFT JOIN LATERAL (SELECT x.* FROM public.exercise_book_attempt_links l
   JOIN public.listening_test_attempts x ON x.id=l.attempt_id
   WHERE l.item_id=i.id AND l.activity_id=c.id AND x.user_id=s.user_id AND x.test_id=c.test_id
     AND x.class_assignment_item_id=i.id
   ORDER BY (x.status='submitted') DESC,x.started_at DESC,x.id DESC LIMIT 1) a ON true
 WHERE ca.id=p_assignment_id
$$;
CREATE FUNCTION public.fn_read_exercise_book_progress(p_actor_id uuid,p_cohort_id uuid,p_assignment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE programme text; result jsonb;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE insufficient_privilege; END IF;
    SELECT c.programme_id INTO programme FROM public.class_assignment_activities c
      JOIN public.class_assignments a ON a.id=c.assignment_id
      WHERE a.id=p_assignment_id AND a.cohort_id=p_cohort_id AND a.skill='listening' LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='EB404'; END IF;
    PERFORM public.fn_eb_roles(p_actor_id,p_cohort_id,programme);
    WITH cells AS MATERIALIZED (SELECT * FROM public.fn_eb_cells(p_assignment_id))
    SELECT jsonb_build_object('assignment_id',p_assignment_id,'cohort_id',p_cohort_id,
      'activities',(SELECT COALESCE(jsonb_agg(jsonb_build_object('activity_key',c.activity_key,'test_id',c.test_id,'position',c.position)
        ORDER BY c.position),'[]') FROM public.class_assignment_activities c WHERE c.assignment_id=p_assignment_id),
      'students',(SELECT COALESCE(jsonb_agg(jsonb_build_object('student_id',x.student_id,'display_name',x.display_name,'item_id',x.item_id)
        ORDER BY x.student_id),'[]') FROM (SELECT DISTINCT student_id,display_name,item_id FROM cells) x),
      'cells',(SELECT COALESCE(jsonb_agg(jsonb_build_object('student_id',x.student_id,'activity_id',x.activity_id,'item_id',x.item_id,
        'attempt_id',x.attempt_id,'status',x.status,'submitted_at',x.submitted_at,'blank_count',x.blank_count)
        ORDER BY x.student_id,x.position),'[]') FROM cells x),
      'completion',jsonb_build_object('denominator',(SELECT count(*) FROM public.class_assignment_activities c WHERE c.assignment_id=p_assignment_id),
        'submitted_by_student',(SELECT COALESCE(jsonb_object_agg(x.student_id,x.n),'{}') FROM
          (SELECT student_id,count(*) FILTER (WHERE status='submitted') n FROM cells GROUP BY student_id) x))) INTO result;
    RETURN result;
END $$;
CREATE FUNCTION public.fn_list_learner_exercise_book_assignments(p_user_id uuid,p_limit integer DEFAULT 50,
 p_before_due_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE insufficient_privilege; END IF;
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR (p_before_due_at IS NULL)<>(p_before_id IS NULL) THEN
      RAISE EXCEPTION 'validation' USING ERRCODE='EB422'; END IF;
    PERFORM 1 FROM public.users u WHERE u.id=p_user_id AND u.is_active AND u.suspended_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='EB404'; END IF;
    WITH selected AS MATERIALIZED (
      SELECT a.*,i.id item_id FROM public.class_assignments a JOIN public.class_assignment_items i ON i.assignment_id=a.id
      JOIN public.students s ON s.id=i.student_id JOIN public.student_cohort_memberships cm ON cm.student_id=s.id AND cm.cohort_id=a.cohort_id
      JOIN public.cohorts co ON co.id=a.cohort_id
      WHERE s.user_id=p_user_id AND s.is_active AND s.archived_at IS NULL AND cm.is_active AND co.is_active
        AND a.status='published' AND (a.publish_at IS NULL OR a.publish_at<=clock_timestamp())
        AND EXISTS (SELECT 1 FROM public.class_assignment_activities c WHERE c.assignment_id=a.id)
        AND (p_before_due_at IS NULL OR (a.due_at,a.id)<(p_before_due_at,p_before_id))
      ORDER BY a.due_at DESC,a.id DESC LIMIT p_limit)
    SELECT jsonb_build_object('items',COALESCE(jsonb_agg(jsonb_build_object('assignment_id',a.id,'cohort_id',a.cohort_id,
      'title',a.title,'due_at',a.due_at,'status',a.status,'activities',
      (SELECT jsonb_agg(jsonb_build_object('activity_id',c.activity_key,
        'title',COALESCE(t.metadata->r.metadata_key->>'title',t.title,c.activity_key),'position',c.position,
        'test_id',c.test_id,'item_id',a.item_id,'my_status',x.status,'latest_attempt_id',x.attempt_id) ORDER BY c.position)
       FROM public.class_assignment_activities c JOIN public.listening_tests t ON t.id=c.test_id
       JOIN public.exercise_book_registry r ON r.programme_id=c.programme_id
       JOIN public.fn_eb_cells(a.id) x ON x.activity_row_id=c.id
         AND x.item_id=a.item_id AND x.user_id=p_user_id WHERE c.assignment_id=a.id)) ORDER BY a.due_at DESC,a.id DESC),'[]'))
      INTO result FROM selected a;
    RETURN result;
END $$;

-- Resolve an owned cell under the assignment lock shared with close. The full
-- identity remains in the private child; callers never accept it from a learner.
CREATE FUNCTION public.fn_eb_owned_cell(p_user_id uuid,p_item_id uuid,p_test_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb;
BEGIN
    SELECT to_jsonb(c)||jsonb_build_object('assignment_status',a.status,'due_at',a.due_at,
      'publish_at',a.publish_at,'cohort_id',a.cohort_id) INTO result
      FROM public.class_assignment_activities c JOIN public.class_assignment_items i ON i.assignment_id=c.assignment_id
      JOIN public.class_assignments a ON a.id=i.assignment_id JOIN public.students s ON s.id=i.student_id
      JOIN public.users u ON u.id=s.user_id JOIN public.cohorts co ON co.id=a.cohort_id
      JOIN public.student_cohort_memberships cm ON cm.student_id=s.id AND cm.cohort_id=a.cohort_id
     WHERE i.id=p_item_id AND c.test_id=p_test_id AND s.user_id=p_user_id AND a.skill='listening'
       AND s.is_active AND s.archived_at IS NULL AND cm.is_active AND u.is_active AND u.suspended_at IS NULL AND co.is_active
     FOR SHARE OF a,s,u,co,cm;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='EB404'; END IF;
    IF result->>'assignment_status' IS DISTINCT FROM 'published'
       OR (result->>'publish_at')::timestamptz>clock_timestamp() THEN
        RAISE EXCEPTION 'activity_locked' USING ERRCODE='EB422'; END IF;
    IF (result->>'due_at')::timestamptz<clock_timestamp() THEN RAISE EXCEPTION 'past_due' USING ERRCODE='EB422'; END IF;
    RETURN result;
END $$;

CREATE FUNCTION public.fn_acquire_exercise_book_assigned_attempt(p_user_id uuid,p_item_id uuid,p_test_id uuid,
 p_binding jsonb,p_renderer_affinity_protocol text DEFAULT 'legacy') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE cell jsonb; paper jsonb; attempt jsonb; snapshot jsonb; created boolean:=false; reg public.exercise_book_registry%ROWTYPE;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE insufficient_privilege; END IF;
    PERFORM public.fn_lock_mock_paper('listening',p_test_id);
    PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_test_id::text,0));
    cell:=public.fn_eb_owned_cell(p_user_id,p_item_id,p_test_id);
    IF p_binding IS DISTINCT FROM ((cell->'binding')-'answer_set_revision') THEN RAISE EXCEPTION 'stale_revision' USING ERRCODE='EB409'; END IF;
    IF p_renderer_affinity_protocol IS NULL OR p_renderer_affinity_protocol NOT IN ('legacy','claim-v1') THEN
        RAISE EXCEPTION 'validation' USING ERRCODE='EB422'; END IF;
    paper:=public.fn_eb_paper(p_test_id,cell->'binding');
    SELECT r.* INTO reg FROM public.exercise_book_registry r WHERE r.programme_id=cell->>'programme_id';
    SELECT to_jsonb(a) INTO attempt FROM public.listening_test_attempts a
      JOIN public.exercise_book_attempt_links l ON l.attempt_id=a.id
      WHERE l.item_id=p_item_id AND l.activity_id=(cell->>'id')::uuid
        AND a.user_id=p_user_id AND a.test_id=p_test_id AND a.class_assignment_item_id=p_item_id
        AND a.status='in_progress' AND a.resume_expires_at>clock_timestamp()
      ORDER BY a.started_at DESC,a.id DESC LIMIT 1;
    IF attempt IS NULL THEN
      INSERT INTO public.listening_test_attempts(test_id,user_id,status,answers,scoring_policy,started_at,resume_expires_at,
        renderer_affinity,attempt_purpose,class_assignment_item_id)
      VALUES (p_test_id,p_user_id,'in_progress','[]',reg.scoring_policy,statement_timestamp(),statement_timestamp()+interval '24 hours',
        CASE WHEN p_renderer_affinity_protocol='claim-v1' THEN NULL ELSE 'legacy' END,'assigned_practice',p_item_id)
      RETURNING to_jsonb(listening_test_attempts.*) INTO attempt;
      created:=true;
    END IF;
    SELECT s.paper_row INTO snapshot FROM public.mock_paper_attempt_snapshots s
      WHERE s.skill='listening' AND s.attempt_id=(attempt->>'id')::uuid AND s.paper_id=p_test_id
        AND s.paper_revision=(attempt->>'paper_revision')::bigint AND s.policy_revision=(attempt->>'policy_revision')::bigint;
    IF snapshot->'metadata'->reg.metadata_key->'binding' IS DISTINCT FROM cell->'binding' THEN
        RAISE EXCEPTION 'stale_revision' USING ERRCODE='EB409'; END IF;
    RETURN attempt||jsonb_build_object('class_assignment_activity_id',cell->>'id','created',created);
END $$;

CREATE FUNCTION public.fn_eb_attempt_cell(p_user_id uuid,p_attempt_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE attempt public.listening_test_attempts%ROWTYPE; cell jsonb;
BEGIN
    SELECT a.* INTO attempt FROM public.listening_test_attempts a JOIN public.exercise_book_attempt_links l ON l.attempt_id=a.id
      JOIN public.class_assignment_activities c ON c.id=l.activity_id
      WHERE a.id=p_attempt_id AND a.user_id=p_user_id AND a.class_assignment_item_id=l.item_id AND a.test_id=c.test_id FOR UPDATE OF a;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='EB404'; END IF;
    cell:=public.fn_eb_owned_cell(p_user_id,attempt.class_assignment_item_id,attempt.test_id);
    RETURN cell;
END $$;
-- Match the backend's composite response validation and blank semantics.
CREATE FUNCTION public.fn_eb_answer_blank(p_item jsonb,p_answer text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE raw json; pair jsonb;
BEGIN
    IF p_answer IS NULL OR p_answer='' THEN RETURN true; END IF;
    IF p_item->>'interaction'='text' THEN RETURN btrim(p_answer,U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')=''; END IF;
    IF p_item->>'interaction' IS DISTINCT FROM 'keep_change' THEN
      RAISE EXCEPTION 'validation' USING ERRCODE='EB422'; END IF;
    BEGIN raw:=p_answer::json;
    EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'validation' USING ERRCODE='EB422'; END;
    IF json_typeof(raw) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'validation' USING ERRCODE='EB422'; END IF;
    IF (SELECT count(*)<>count(DISTINCT key) FROM json_each(raw)) THEN
      RAISE EXCEPTION 'validation' USING ERRCODE='EB422'; END IF;
    pair:=raw::jsonb;
    IF (SELECT count(*) FROM jsonb_object_keys(pair))<>3
      OR NOT pair ?& ARRAY['version','action','correction_text']
      OR pair->>'version' IS DISTINCT FROM 'blackeye_keep_change_v1'
      OR NOT (pair->'action'='null'::jsonb OR pair->>'action' IN ('KEEP','CHANGE'))
      OR jsonb_typeof(pair->'correction_text') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'validation' USING ERRCODE='EB422'; END IF;
    RETURN pair->>'action' IS NULL OR (pair->>'action'='CHANGE' AND btrim(pair->>'correction_text',U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')='');
END $$;

CREATE FUNCTION public.fn_save_exercise_book_answer(p_user_id uuid,p_attempt_id uuid,p_q_num integer,p_user_answer text,p_client_seq bigint)
RETURNS TABLE(attempt_id uuid,answer_count integer,client_seq bigint,applied boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE cell jsonb; a public.listening_test_attempts%ROWTYPE; last_seq bigint; n integer; frozen_items jsonb; reg public.exercise_book_registry%ROWTYPE;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE insufficient_privilege; END IF;
    cell:=public.fn_eb_attempt_cell(p_user_id,p_attempt_id);
    SELECT x.* INTO a FROM public.listening_test_attempts x WHERE x.id=p_attempt_id;
    IF a.status IS DISTINCT FROM 'in_progress' OR a.resume_expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION 'attempt_changed' USING ERRCODE='EB409'; END IF;
    SELECT r.* INTO reg FROM public.exercise_book_registry r WHERE r.programme_id=cell->>'programme_id';
    SELECT s.paper_row->'metadata'->reg.metadata_key->'items' INTO frozen_items
      FROM public.mock_paper_attempt_snapshots s WHERE s.skill='listening' AND s.attempt_id=p_attempt_id;
    n:=jsonb_array_length(frozen_items);
    IF n IS NULL OR p_q_num IS NULL OR p_q_num NOT BETWEEN 1 AND n OR p_user_answer IS NULL
      OR length(p_user_answer)>4000 OR p_client_seq IS NULL OR p_client_seq<0 THEN
        RAISE EXCEPTION 'validation' USING ERRCODE='EB422'; END IF;
    PERFORM public.fn_eb_answer_blank(frozen_items->(p_q_num-1),p_user_answer);
    SELECT (l.client_sequences->>p_q_num::text)::bigint INTO last_seq FROM public.exercise_book_attempt_links l WHERE l.attempt_id=p_attempt_id;
    IF last_seq IS NOT NULL AND p_client_seq<=last_seq THEN
      RETURN QUERY SELECT a.id,jsonb_array_length(a.answers),last_seq,false; RETURN; END IF;
    SELECT COALESCE(jsonb_agg(q ORDER BY (q->>'q_num')::integer),'[]') INTO a.answers FROM (
      SELECT x q FROM jsonb_array_elements(a.answers) x WHERE (x->>'q_num')::integer<>p_q_num
      UNION ALL SELECT jsonb_build_object('q_num',p_q_num,'user_answer',p_user_answer)) answers;
    UPDATE public.listening_test_attempts SET answers=a.answers WHERE id=p_attempt_id;
    UPDATE public.exercise_book_attempt_links SET client_sequences=client_sequences||jsonb_build_object(p_q_num::text,p_client_seq) WHERE exercise_book_attempt_links.attempt_id=p_attempt_id;
    RETURN QUERY SELECT a.id,jsonb_array_length(a.answers),p_client_seq,true;
END $$;

-- Signature retained for D2 v1.1 compatibility. p_result_summary is ignored:
-- the report is derived here from frozen cells and the persisted answers.
CREATE FUNCTION public.fn_submit_exercise_book_assigned_attempt(p_user_id uuid,p_attempt_id uuid,
 p_expected_answers jsonb,p_result_summary jsonb,p_confirm_blank boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE cell jsonb; a public.listening_test_attempts%ROWTYPE; reg public.exercise_book_registry%ROWTYPE; n integer; blanks integer; frozen_items jsonb;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE insufficient_privilege; END IF;
    -- Ownership/book membership precedes every read, including replay.
    PERFORM 1 FROM public.listening_test_attempts x JOIN public.exercise_book_attempt_links l ON l.attempt_id=x.id
      JOIN public.class_assignment_activities c ON c.id=l.activity_id
      JOIN public.class_assignment_items i ON i.id=l.item_id AND i.assignment_id=c.assignment_id
      JOIN public.students s ON s.id=i.student_id JOIN public.users u ON u.id=s.user_id
      WHERE x.id=p_attempt_id AND x.user_id=p_user_id AND s.user_id=p_user_id
        AND x.class_assignment_item_id=i.id AND x.test_id=c.test_id AND x.attempt_purpose='assigned_practice'
        AND u.is_active AND u.suspended_at IS NULL FOR UPDATE OF x;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='EB404'; END IF;
    SELECT x.* INTO a FROM public.listening_test_attempts x WHERE x.id=p_attempt_id;
    IF a.answers IS DISTINCT FROM p_expected_answers THEN RAISE EXCEPTION 'attempt_changed' USING ERRCODE='EB409'; END IF;
    IF a.status='submitted' THEN RETURN to_jsonb(a)||jsonb_build_object('replayed',true); END IF;
    cell:=public.fn_eb_attempt_cell(p_user_id,p_attempt_id);
    IF a.status IS DISTINCT FROM 'in_progress' OR a.resume_expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION 'attempt_changed' USING ERRCODE='EB409'; END IF;
    SELECT r.* INTO reg FROM public.exercise_book_registry r WHERE r.programme_id=cell->>'programme_id';
    SELECT s.paper_row->'metadata'->reg.metadata_key->'items' INTO frozen_items
      FROM public.mock_paper_attempt_snapshots s WHERE s.skill='listening' AND s.attempt_id=p_attempt_id;
    n:=jsonb_array_length(frozen_items);
    IF n IS NULL THEN RAISE EXCEPTION 'activity_locked' USING ERRCODE='EB422'; END IF;
    SELECT count(*)::integer INTO blanks FROM jsonb_array_elements(frozen_items) c
      WHERE public.fn_eb_answer_blank(c,(SELECT x->>'user_answer' FROM jsonb_array_elements(a.answers) x WHERE x->>'q_num'=c->>'q_num'));
    IF blanks>0 AND p_confirm_blank IS DISTINCT FROM true THEN RAISE EXCEPTION 'validation' USING ERRCODE='EB422'; END IF;
    UPDATE public.listening_test_attempts SET status='submitted',submitted_at=clock_timestamp(),score=NULL,band_estimate=NULL,
      grading_details='[]',trap_analytics='{}',result_summary=jsonb_build_object('submitted',true,'item_count',n,'blank_count',blanks,
        'unscored_count',n,'objective_denominator',0,'score',NULL,'band_estimate',NULL)
      WHERE id=p_attempt_id RETURNING * INTO a;
    RETURN to_jsonb(a)||jsonb_build_object('replayed',false);
END $$;

CREATE FUNCTION public.fn_eb_activity_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('eb_assign:'||NEW.assignment_id,0));
    IF EXISTS (SELECT 1 FROM public.class_assignment_activities c WHERE c.assignment_id=NEW.assignment_id
       AND (c.position=NEW.position OR c.test_id=NEW.test_id OR c.activity_key=NEW.activity_key))
       OR NOT EXISTS (SELECT 1 FROM public.class_assignments a WHERE a.id=NEW.assignment_id AND a.skill='listening'
         AND a.content_config->>'programme_id'=NEW.programme_id) THEN
        RAISE EXCEPTION 'validation' USING ERRCODE='EB422'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER exercise_book_activity_insert_guard BEFORE INSERT ON public.class_assignment_activities
 FOR EACH ROW EXECUTE FUNCTION public.fn_eb_activity_insert_guard();
CREATE FUNCTION public.fn_eb_link_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF TG_OP='DELETE' OR TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'exercise_book_append_only' USING ERRCODE='55000'; END IF;
    IF TG_OP='UPDATE' AND (NEW.attempt_id,NEW.activity_id,NEW.item_id) IS DISTINCT FROM (OLD.attempt_id,OLD.activity_id,OLD.item_id) THEN
      RAISE EXCEPTION 'attempt_changed' USING ERRCODE='EB409'; END IF;
    IF TG_OP='INSERT' AND NOT EXISTS (SELECT 1 FROM public.listening_test_attempts a
      JOIN public.class_assignment_items i ON i.id=NEW.item_id JOIN public.students s ON s.id=i.student_id
      JOIN public.class_assignment_activities c ON c.id=NEW.activity_id AND c.assignment_id=i.assignment_id
      WHERE a.id=NEW.attempt_id AND a.test_id=c.test_id AND a.class_assignment_item_id=i.id AND a.user_id=s.user_id
        AND a.attempt_purpose='assigned_practice' AND a.sitting_id IS NULL) THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE='EB404'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER exercise_book_link_guard BEFORE INSERT OR UPDATE OR DELETE ON public.exercise_book_attempt_links
 FOR EACH ROW EXECUTE FUNCTION public.fn_eb_link_guard();
CREATE TRIGGER exercise_book_link_no_truncate BEFORE TRUNCATE ON public.exercise_book_attempt_links
 FOR EACH STATEMENT EXECUTE FUNCTION public.fn_eb_link_guard();

CREATE OR REPLACE FUNCTION public.fn_guard_blackeye_admission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE paper jsonb; reg public.exercise_book_registry%ROWTYPE; cell jsonb; b jsonb;
BEGIN
    PERFORM public.fn_lock_mock_paper('listening',NEW.test_id);
    paper:=public.fn_mock_paper_row('listening',NEW.test_id);
    SELECT r.* INTO reg FROM public.exercise_book_registry r WHERE r.programme_id=paper->>'programme_id';
    IF NOT FOUND THEN
      IF COALESCE(paper->'metadata' ? 'blackeye',false) THEN RAISE EXCEPTION 'activity_locked' USING ERRCODE='EB422'; END IF;
      RETURN NEW;
    END IF;
    IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE insufficient_privilege; END IF;
    IF NEW.paper_revision IS NULL OR NEW.sitting_id IS NOT NULL THEN RAISE EXCEPTION 'activity_locked' USING ERRCODE='EB422'; END IF;
    b:=paper->'metadata'->reg.metadata_key->'binding';
    IF NEW.class_assignment_item_id IS NOT NULL THEN
      cell:=public.fn_eb_owned_cell(NEW.user_id,NEW.class_assignment_item_id,NEW.test_id);
      b:=cell->'binding';
      IF NEW.attempt_purpose IS DISTINCT FROM 'assigned_practice' THEN RAISE EXCEPTION 'activity_locked' USING ERRCODE='EB422'; END IF;
    ELSIF NEW.attempt_purpose IS DISTINCT FROM 'practice' THEN RAISE EXCEPTION 'activity_locked' USING ERRCODE='EB422'; END IF;
    paper:=public.fn_eb_paper(NEW.test_id,b);
    IF NEW.scoring_policy IS DISTINCT FROM reg.scoring_policy
      OR paper->'metadata'->(reg.metadata_key||'_db_revisions') IS DISTINCT FROM
        jsonb_build_object('paper_revision',NEW.paper_revision,'policy_revision',NEW.policy_revision)
      OR paper->'metadata'->(reg.metadata_key||'_context') IS DISTINCT FROM
        jsonb_build_object('kind','standalone','class_assignment_item_id',NULL,'assignment_id',NULL,'cohort_id',NULL) THEN
      RAISE EXCEPTION 'activity_locked' USING ERRCODE='EB422'; END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_zz_blackeye_admission ON public.listening_test_attempts;
CREATE TRIGGER trg_zz_blackeye_admission BEFORE INSERT ON public.listening_test_attempts
 FOR EACH ROW EXECUTE FUNCTION public.fn_guard_blackeye_admission();
CREATE FUNCTION public.fn_eb_link_attempt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE cell jsonb;
BEGIN
    IF NEW.class_assignment_item_id IS NOT NULL AND EXISTS
      (SELECT 1 FROM public.class_assignment_activities c JOIN public.class_assignment_items i ON i.assignment_id=c.assignment_id
        WHERE i.id=NEW.class_assignment_item_id AND c.test_id=NEW.test_id) THEN
      cell:=public.fn_eb_owned_cell(NEW.user_id,NEW.class_assignment_item_id,NEW.test_id);
      INSERT INTO public.exercise_book_attempt_links(attempt_id,activity_id,item_id)
        VALUES (NEW.id,(cell->>'id')::uuid,NEW.class_assignment_item_id);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_zzz_exercise_book_link AFTER INSERT ON public.listening_test_attempts
 FOR EACH ROW EXECUTE FUNCTION public.fn_eb_link_attempt();
CREATE FUNCTION public.fn_eb_attempt_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE cell jsonb; is_book boolean;
BEGIN
    SELECT EXISTS(SELECT 1 FROM public.exercise_book_attempt_links l WHERE l.attempt_id=OLD.id)
      OR EXISTS(SELECT 1 FROM public.mock_paper_attempt_snapshots s JOIN public.exercise_book_registry r
        ON r.programme_id=s.paper_row->>'programme_id' WHERE s.skill='listening' AND s.attempt_id=OLD.id)
      INTO is_book;
    IF NOT is_book AND TG_OP='UPDATE' THEN
      SELECT EXISTS(SELECT 1 FROM public.listening_tests t JOIN public.exercise_book_registry r ON r.programme_id=t.programme_id
        WHERE t.id=NEW.test_id) INTO is_book;
    END IF;
    IF NOT is_book THEN RETURN COALESCE(NEW,OLD); END IF;
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'attempt_changed' USING ERRCODE='EB409'; END IF;
    IF ROW(NEW.id,NEW.class_assignment_item_id,NEW.attempt_purpose,NEW.user_id,NEW.test_id,NEW.sitting_id,
           NEW.paper_revision,NEW.policy_revision,NEW.scoring_policy)
       IS DISTINCT FROM ROW(OLD.id,OLD.class_assignment_item_id,OLD.attempt_purpose,OLD.user_id,OLD.test_id,OLD.sitting_id,
           OLD.paper_revision,OLD.policy_revision,OLD.scoring_policy)
       OR (OLD.status='submitted' AND ROW(NEW.status,NEW.answers,NEW.result_summary,NEW.submitted_at,NEW.score,NEW.band_estimate,
           NEW.grading_details,NEW.trap_analytics) IS DISTINCT FROM ROW(OLD.status,OLD.answers,OLD.result_summary,OLD.submitted_at,
           OLD.score,OLD.band_estimate,OLD.grading_details,OLD.trap_analytics)) THEN
        RAISE EXCEPTION 'attempt_changed' USING ERRCODE='EB409'; END IF;
    -- Backstop older generic save/submit functions too. Metadata-only playback
    -- updates do not reopen or alter any learner work.
    IF OLD.class_assignment_item_id IS NOT NULL AND
       ROW(NEW.answers,NEW.status,NEW.result_summary) IS DISTINCT FROM ROW(OLD.answers,OLD.status,OLD.result_summary) THEN
      cell:=public.fn_eb_owned_cell(OLD.user_id,OLD.class_assignment_item_id,OLD.test_id);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_zz_exercise_book_attempt_immutable BEFORE UPDATE OR DELETE ON public.listening_test_attempts
 FOR EACH ROW EXECUTE FUNCTION public.fn_eb_attempt_immutable();

-- Q-16 self-study retry change formerly in PR2 376.
CREATE OR REPLACE FUNCTION public.fn_acquire_blackeye_attempt(
    p_test_id UUID,p_user_id UUID,p_binding JSONB,p_renderer_affinity_protocol TEXT DEFAULT 'legacy')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE paper JSONB; full_binding JSONB; visible JSONB; attempt JSONB; snapshot JSONB;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' OR p_test_id IS NULL OR p_user_id IS NULL THEN
        RAISE EXCEPTION 'blackeye_forbidden';
    END IF;
    IF p_renderer_affinity_protocol NOT IN ('legacy','claim-v1') OR p_renderer_affinity_protocol IS NULL THEN
        RAISE EXCEPTION 'blackeye_invalid_renderer';
    END IF;
    IF jsonb_typeof(p_binding) IS DISTINCT FROM 'object'
       OR p_binding ? 'answer_set_revision'
       OR (SELECT count(*) FROM jsonb_object_keys(p_binding))<>7 THEN
        RAISE EXCEPTION 'blackeye_invalid_binding';
    END IF;
    PERFORM public.fn_lock_mock_paper('listening',p_test_id);
    PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT||':'||p_test_id::TEXT,0));
    paper:=public.fn_mock_paper_row('listening',p_test_id);
    IF paper->>'programme_id' IS DISTINCT FROM 'blackeye-v5-upper-listening' THEN
        RAISE EXCEPTION 'blackeye_invalid_binding';
    END IF;
    IF NOT public.fn_mock_admission_contract_active() THEN RAISE EXCEPTION 'blackeye_unavailable'; END IF;
    IF paper->>'status' IS DISTINCT FROM 'published' OR paper->>'is_public' IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'blackeye_forbidden';
    END IF;
    full_binding:=paper#>'{metadata,blackeye,binding}';
    visible:=full_binding-'answer_set_revision';
    IF (p_binding-ARRAY['content_revision','policy_revision']) IS DISTINCT FROM
       (visible-ARRAY['content_revision','policy_revision']) THEN
        RAISE EXCEPTION 'blackeye_invalid_binding';
    END IF;
    IF p_binding IS DISTINCT FROM visible THEN RAISE EXCEPTION 'blackeye_stale'; END IF;
    -- Q-16: reuse only a live attempt. Retain submitted and expired rows.
    IF (SELECT count(*) FROM public.listening_test_attempts a WHERE a.test_id=p_test_id
        AND a.user_id=p_user_id AND a.class_assignment_item_id IS NULL AND a.sitting_id IS NULL
        AND a.status='in_progress' AND a.resume_expires_at>clock_timestamp())>1 THEN
        RAISE EXCEPTION 'blackeye_unavailable';
    END IF;
    SELECT to_jsonb(a) INTO attempt FROM public.listening_test_attempts a WHERE a.test_id=p_test_id
        AND a.user_id=p_user_id AND a.class_assignment_item_id IS NULL AND a.sitting_id IS NULL
        AND a.status='in_progress' AND a.resume_expires_at>clock_timestamp();
    IF attempt IS NULL THEN
        INSERT INTO public.listening_test_attempts
            (test_id,user_id,status,answers,scoring_policy,started_at,resume_expires_at,
             renderer_affinity,attempt_purpose)
        VALUES (p_test_id,p_user_id,'in_progress','[]'::jsonb,'report_only',statement_timestamp(),
                statement_timestamp()+interval '24 hours',
                CASE WHEN p_renderer_affinity_protocol='claim-v1' THEN NULL ELSE 'legacy' END,'practice')
        RETURNING to_jsonb(listening_test_attempts.*) INTO attempt;
    END IF;
    SELECT to_jsonb(s) INTO snapshot FROM public.mock_paper_attempt_snapshots s
        WHERE s.skill='listening' AND s.attempt_id=(attempt->>'id')::UUID
        AND s.paper_id=p_test_id AND s.paper_revision=(attempt->>'paper_revision')::BIGINT
        AND s.policy_revision=(attempt->>'policy_revision')::BIGINT;
    IF snapshot IS NULL OR snapshot#>'{paper_row,metadata,blackeye,binding}' IS NULL THEN
        RAISE EXCEPTION 'blackeye_unavailable';
    END IF;
    -- Existing attempts retain their original answer set even after a key-only
    -- publication. Public equality does not compare/echo the hidden identity.
    IF ((snapshot#>'{paper_row,metadata,blackeye,binding}')-'answer_set_revision') IS DISTINCT FROM p_binding THEN
        RAISE EXCEPTION 'blackeye_stale';
    END IF;
    RETURN attempt;
EXCEPTION WHEN deadlock_detected OR lock_not_available THEN
    RAISE EXCEPTION 'blackeye_unavailable';
END $$;
REVOKE ALL ON FUNCTION public.fn_acquire_blackeye_attempt(UUID,UUID,JSONB,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_acquire_blackeye_attempt(UUID,UUID,JSONB,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_resolve_mock_paper_access(
    p_skill TEXT,p_test_id UUID,p_user_id UUID,p_purpose TEXT DEFAULT 'delivery',
    p_class_item_id UUID DEFAULT NULL,p_sitting_id UUID DEFAULT NULL,p_allow_admission BOOLEAN DEFAULT FALSE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v JSONB; d JSONB; s RECORD; v_candidate JSONB; v_count INTEGER:=0;
        v_bound UUID; v_attempt JSONB; v_class BOOLEAN:=FALSE; v_public BOOLEAN;
BEGIN
    PERFORM public.fn_lock_mock_paper(p_skill,p_test_id);
    v:=public.fn_mock_paper_row(p_skill,p_test_id);
    IF v IS NULL OR v->>'status'<>'published' THEN RETURN jsonb_build_object('allowed',FALSE,'reason','unavailable'); END IF;
    d:=public.fn_mock_paper_dependencies(p_skill,p_test_id);
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(d) x WHERE x->>'reason'='verification_unavailable') THEN
        PERFORM public.fn_mock_paper_error(p_purpose,'verification_unavailable',p_skill,p_test_id,(v->>'policy_revision')::BIGINT);
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(d) x WHERE x->>'reason'='ambiguous_orphan') THEN
        IF p_user_id IS NOT NULL AND ((p_skill='reading' AND EXISTS(SELECT 1 FROM public.reading_test_attempts WHERE test_id=p_test_id AND user_id=p_user_id AND status='in_progress'))
            OR (p_skill='listening' AND EXISTS(SELECT 1 FROM public.listening_test_attempts WHERE test_id=p_test_id AND user_id=p_user_id AND status='in_progress'))) THEN
            RETURN jsonb_build_object('allowed',FALSE,'reason','ambiguous_orphan');
        END IF;
        RETURN jsonb_build_object('allowed',FALSE,'reason','unavailable');
    END IF;
    v_public:=COALESCE((v->>'is_public')::BOOLEAN,FALSE) AND
        (public.fn_mock_protected_references(d)='[]'::JSONB OR COALESCE(public.fn_mock_overlap_valid(v,d),FALSE));
    IF p_purpose NOT IN ('delivery','practice','assigned_practice','mock_delivery','dictation') THEN
        RETURN jsonb_build_object('allowed',FALSE,'reason','unsupported_purpose');
    END IF;
    IF p_user_id IS NOT NULL AND p_purpose IN ('delivery','mock_delivery') THEN
        FOR s IN SELECT to_jsonb(ms) sitting,to_jsonb(m) exam FROM public.mock_exam_sittings ms
            JOIN public.mock_exams m ON m.id=ms.mock_exam_id WHERE ms.user_id=p_user_id
              AND (p_sitting_id IS NULL OR ms.id=p_sitting_id) AND ms.status<>'void'
              AND CASE WHEN p_skill='reading' THEN m.reading_test_id ELSE m.listening_test_id END=p_test_id LOOP
            IF public.fn_mock_section_valid(p_skill,s.exam,s.sitting) THEN
                v_count:=v_count+1; v_candidate:=s.sitting;
            END IF;
        END LOOP;
    END IF;
    IF v_count>1 THEN RETURN jsonb_build_object('allowed',FALSE,'reason','ambiguous_entitlement'); END IF;
    IF v_count=1 THEN
        v_bound:=NULLIF(v_candidate->>(p_skill||'_attempt_id'),'')::UUID;
        IF v_bound IS NOT NULL THEN
            IF p_skill='reading' THEN SELECT to_jsonb(a) INTO v_attempt FROM public.reading_test_attempts a WHERE id=v_bound;
            ELSE SELECT to_jsonb(a) INTO v_attempt FROM public.listening_test_attempts a WHERE id=v_bound; END IF;
            IF v_attempt IS NULL OR v_attempt->>'user_id'<>p_user_id::TEXT
               OR v_attempt->>'test_id'<>p_test_id::TEXT
               OR v_attempt->>'sitting_id'<>v_candidate->>'id'
               OR v_attempt->>'status'<>'in_progress' THEN
                RETURN jsonb_build_object('allowed',FALSE,'reason','ambiguous_orphan');
            END IF;
        ELSIF NOT p_allow_admission THEN
            RETURN jsonb_build_object('allowed',FALSE,'reason','admission_required');
        END IF;
        RETURN jsonb_build_object('allowed',TRUE,'attempt_purpose','mock_delivery',
            'mock_sitting_id',v_candidate->>'id','attempt_id',v_bound,
            'paper_revision',v->'mock_content_revision','policy_revision',v->'policy_revision');
    END IF;
    IF p_purpose='mock_delivery' OR p_sitting_id IS NOT NULL THEN
        RETURN jsonb_build_object('allowed',FALSE,'reason','unavailable');
    END IF;
    -- D1 narrow book entitlement. Failure cannot fall through to public or
    -- generic class access. No change for any non-book paper or no-item call.
    IF p_skill='listening' AND p_class_item_id IS NOT NULL AND
       (EXISTS (SELECT 1 FROM public.exercise_book_registry r WHERE r.programme_id=v->>'programme_id')
         OR COALESCE(v->'metadata' ? 'blackeye',false)) THEN
        IF p_user_id IS NOT NULL AND p_purpose IN ('delivery','practice','assigned_practice')
          AND (public.fn_mock_protected_references(d)='[]'::jsonb OR COALESCE(public.fn_mock_overlap_valid(v,d),false))
          AND EXISTS (SELECT 1 FROM public.class_assignment_activities c
            JOIN public.class_assignment_items i ON i.assignment_id=c.assignment_id
            JOIN public.students st ON st.id=i.student_id JOIN public.users u ON u.id=st.user_id
            JOIN public.class_assignments a ON a.id=i.assignment_id JOIN public.cohorts co ON co.id=a.cohort_id
            JOIN public.student_cohort_memberships cm ON cm.student_id=st.id AND cm.cohort_id=a.cohort_id
            JOIN public.exercise_book_registry r ON r.programme_id=c.programme_id
            WHERE i.id=p_class_item_id AND st.user_id=p_user_id AND c.test_id=p_test_id
              AND r.programme_id=v->>'programme_id'
              AND a.skill='listening' AND a.status='published' AND co.is_active AND cm.is_active
              AND st.is_active AND st.archived_at IS NULL AND u.is_active AND u.suspended_at IS NULL
              AND c.binding=v->'metadata'->r.metadata_key->'binding'
              AND (a.publish_at IS NULL OR a.publish_at<=clock_timestamp()) AND a.due_at>=clock_timestamp()) THEN
            RETURN jsonb_build_object('allowed',true,'attempt_purpose','assigned_practice',
              'paper_revision',v->'mock_content_revision','policy_revision',v->'policy_revision');
        END IF;
        RETURN jsonb_build_object('allowed',false,'reason','unavailable');
    END IF;
    -- A policy Hide stops new admission, while the authenticated owner can
    -- continue one existing standalone attempt through canonical delivery.
    -- A pre-existing owned attempt is an independent frozen entitlement. Other
    -- exam references still block fresh admission, but cannot revoke this resume.
    IF p_user_id IS NOT NULL AND p_purpose='delivery' AND NOT p_allow_admission THEN
        IF p_skill='reading' THEN
            SELECT count(*),jsonb_agg(to_jsonb(a))->0 INTO v_count,v_attempt FROM public.reading_test_attempts a
             WHERE user_id=p_user_id AND test_id=p_test_id AND sitting_id IS NULL AND status='in_progress'
               AND resume_expires_at>clock_timestamp() AND (p_class_item_id IS NULL OR class_assignment_item_id=p_class_item_id);
        ELSE
            SELECT count(*),jsonb_agg(to_jsonb(a))->0 INTO v_count,v_attempt FROM public.listening_test_attempts a
             WHERE user_id=p_user_id AND test_id=p_test_id AND sitting_id IS NULL AND status='in_progress'
               AND resume_expires_at>clock_timestamp() AND (p_class_item_id IS NULL OR class_assignment_item_id=p_class_item_id);
        END IF;
        IF v_count>1 THEN RETURN jsonb_build_object('allowed',FALSE,'reason','ambiguous_orphan'); END IF;
        IF v_count=1 THEN RETURN jsonb_build_object('allowed',TRUE,'attempt_purpose',COALESCE(v_attempt->>'attempt_purpose','practice'),
            'attempt_id',v_attempt->>'id','paper_revision',v_attempt->'paper_revision','policy_revision',v_attempt->'policy_revision'); END IF;
    END IF;
    IF p_class_item_id IS NOT NULL AND p_user_id IS NOT NULL
       AND (public.fn_mock_protected_references(d)='[]'::JSONB OR COALESCE(public.fn_mock_overlap_valid(v,d),FALSE)) THEN
        SELECT EXISTS(SELECT 1 FROM public.class_assignment_items i
            JOIN public.students st ON st.id=i.student_id JOIN public.class_assignments a ON a.id=i.assignment_id
            WHERE i.id=p_class_item_id AND st.user_id=p_user_id AND a.skill=p_skill AND a.content_id=p_test_id
              AND a.status='published' AND (a.publish_at IS NULL OR a.publish_at<=clock_timestamp())
              AND (a.due_at IS NULL OR a.due_at>=clock_timestamp())
              AND a.content_config->>'delivery_mode'='assigned_practice') INTO v_class;
    END IF;
    IF v_class THEN RETURN jsonb_build_object('allowed',TRUE,'attempt_purpose','assigned_practice',
        'paper_revision',v->'mock_content_revision','policy_revision',v->'policy_revision'); END IF;
    IF v_public AND p_purpose<>'assigned_practice' THEN RETURN jsonb_build_object('allowed',TRUE,'attempt_purpose','practice',
        'paper_revision',v->'mock_content_revision','policy_revision',v->'policy_revision'); END IF;
    RETURN jsonb_build_object('allowed',FALSE,'reason','unavailable');
END $$;

ALTER FUNCTION public.fn_resolve_mock_paper_access(text,uuid,uuid,text,uuid,uuid,boolean) SET search_path = pg_catalog, pg_temp;

REVOKE ALL ON FUNCTION public.fn_eb_answer_blank(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

-- Fail closed under both PostgreSQL and Supabase default privileges.
REVOKE ALL ON FUNCTION public.fn_eb_roles(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_eb_paper(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_eb_receipt(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_create_exercise_book_assignment(uuid,uuid,uuid,text,jsonb,uuid[],timestamptz,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_create_exercise_book_assignment(uuid,uuid,uuid,text,jsonb,uuid[],timestamptz,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_close_exercise_book_assignment(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_close_exercise_book_assignment(uuid,uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_list_exercise_book_assignments(uuid,uuid,text,integer,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_list_exercise_book_assignments(uuid,uuid,text,integer,timestamptz,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_eb_cells(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_read_exercise_book_progress(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_read_exercise_book_progress(uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_list_learner_exercise_book_assignments(uuid,integer,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_list_learner_exercise_book_assignments(uuid,integer,timestamptz,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_eb_owned_cell(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_acquire_exercise_book_assigned_attempt(uuid,uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_acquire_exercise_book_assigned_attempt(uuid,uuid,uuid,jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_eb_attempt_cell(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_save_exercise_book_answer(uuid,uuid,integer,text,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_save_exercise_book_answer(uuid,uuid,integer,text,bigint) TO service_role;
REVOKE ALL ON FUNCTION public.fn_submit_exercise_book_assigned_attempt(uuid,uuid,jsonb,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_submit_exercise_book_assigned_attempt(uuid,uuid,jsonb,jsonb,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.fn_eb_activity_insert_guard() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_eb_link_guard() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_guard_blackeye_admission() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_eb_link_attempt() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_eb_attempt_immutable() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_acquire_blackeye_attempt(UUID,UUID,JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_acquire_blackeye_attempt(UUID,UUID,JSONB,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_resolve_mock_paper_access(TEXT,UUID,UUID,TEXT,UUID,UUID,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_resolve_mock_paper_access(TEXT,UUID,UUID,TEXT,UUID,UUID,BOOLEAN) TO service_role;
ALTER TABLE public.class_assignment_activities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.class_assignment_activities FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.class_assignment_activities TO service_role;
ALTER TABLE public.exercise_book_attempt_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.exercise_book_attempt_links FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.exercise_book_attempt_links TO service_role;
DO $$
DECLARE signature text; function_oid oid; relation_name text; relation_oid oid; allowed boolean;
BEGIN
    signature:='public.fn_eb_roles(uuid,uuid,text,boolean)'; allowed:=false;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_eb_answer_blank(jsonb,text)'; allowed:=false;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_eb_paper(uuid,jsonb)'; allowed:=false;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_eb_receipt(uuid)'; allowed:=false;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_create_exercise_book_assignment(uuid,uuid,uuid,text,jsonb,uuid[],timestamptz,text,text,text)'; allowed:=true;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_close_exercise_book_assignment(uuid,uuid,uuid,text)'; allowed:=true;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_list_exercise_book_assignments(uuid,uuid,text,integer,timestamptz,uuid)'; allowed:=true;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_eb_cells(uuid)'; allowed:=false;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_read_exercise_book_progress(uuid,uuid,uuid)'; allowed:=true;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_list_learner_exercise_book_assignments(uuid,integer,timestamptz,uuid)'; allowed:=true;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_eb_owned_cell(uuid,uuid,uuid)'; allowed:=false;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_acquire_exercise_book_assigned_attempt(uuid,uuid,uuid,jsonb,text)'; allowed:=true;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_eb_attempt_cell(uuid,uuid)'; allowed:=false;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_save_exercise_book_answer(uuid,uuid,integer,text,bigint)'; allowed:=true;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_submit_exercise_book_assigned_attempt(uuid,uuid,jsonb,jsonb,boolean)'; allowed:=true;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_eb_activity_insert_guard()'; allowed:=false;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_eb_link_guard()'; allowed:=false;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_guard_blackeye_admission()'; allowed:=false;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_eb_link_attempt()'; allowed:=false;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_eb_attempt_immutable()'; allowed:=false;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_acquire_blackeye_attempt(UUID,UUID,JSONB,TEXT)'; allowed:=true;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    signature:='public.fn_resolve_mock_paper_access(TEXT,UUID,UUID,TEXT,UUID,UUID,BOOLEAN)'; allowed:=true;
    function_oid:=to_regprocedure(signature);
    IF function_oid IS NULL OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=function_oid) AND p.proname=(SELECT proname FROM pg_proc WHERE oid=function_oid))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=function_oid AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
      OR EXISTS (SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
      OR has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR has_function_privilege('service_role',function_oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'exercise_book_function_postcondition' USING ERRCODE='55000'; END IF;
    relation_name:='public.class_assignment_activities';
    relation_oid:=to_regclass(relation_name);
    IF relation_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=relation_oid AND relrowsecurity)
      OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=relation_oid)
      OR EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname=split_part(relation_name,'.',1) AND tablename=split_part(relation_name,'.',2))
      OR EXISTS (SELECT 1 FROM pg_class c,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
        WHERE c.oid=relation_oid AND (a.grantee=0 OR a.grantee IN ('anon'::regrole,'authenticated'::regrole)
          OR (a.grantee='service_role'::regrole AND a.privilege_type<>'SELECT')))
      OR NOT has_table_privilege('service_role',relation_oid,'SELECT') THEN
        RAISE EXCEPTION 'exercise_book_table_postcondition' USING ERRCODE='55000'; END IF;
    relation_name:='public.exercise_book_attempt_links';
    relation_oid:=to_regclass(relation_name);
    IF relation_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=relation_oid AND relrowsecurity)
      OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=relation_oid)
      OR EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname=split_part(relation_name,'.',1) AND tablename=split_part(relation_name,'.',2))
      OR EXISTS (SELECT 1 FROM pg_class c,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
        WHERE c.oid=relation_oid AND (a.grantee=0 OR a.grantee IN ('anon'::regrole,'authenticated'::regrole)
          OR (a.grantee='service_role'::regrole AND a.privilege_type<>'SELECT')))
      OR NOT has_table_privilege('service_role',relation_oid,'SELECT') THEN
        RAISE EXCEPTION 'exercise_book_table_postcondition' USING ERRCODE='55000'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.class_assignment_activities'::regclass AND tgname='exercise_book_activities_immutable'
      AND tgfoid='public.fn_eb_append_only()'::regprocedure AND tgenabled='O' AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'exercise_book_trigger_postcondition' USING ERRCODE='55000'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.class_assignment_activities'::regclass AND tgname='exercise_book_activity_insert_guard'
      AND tgfoid='public.fn_eb_activity_insert_guard()'::regprocedure AND tgenabled='O' AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'exercise_book_trigger_postcondition' USING ERRCODE='55000'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.exercise_book_attempt_links'::regclass AND tgname='exercise_book_link_guard'
      AND tgfoid='public.fn_eb_link_guard()'::regprocedure AND tgenabled='O' AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'exercise_book_trigger_postcondition' USING ERRCODE='55000'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.exercise_book_attempt_links'::regclass AND tgname='exercise_book_link_no_truncate'
      AND tgfoid='public.fn_eb_link_guard()'::regprocedure AND tgenabled='O' AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'exercise_book_trigger_postcondition' USING ERRCODE='55000'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.listening_test_attempts'::regclass AND tgname='trg_zz_blackeye_admission'
      AND tgfoid='public.fn_guard_blackeye_admission()'::regprocedure AND tgenabled='O' AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'exercise_book_trigger_postcondition' USING ERRCODE='55000'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.listening_test_attempts'::regclass AND tgname='trg_zzz_exercise_book_link'
      AND tgfoid='public.fn_eb_link_attempt()'::regprocedure AND tgenabled='O' AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'exercise_book_trigger_postcondition' USING ERRCODE='55000'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.listening_test_attempts'::regclass AND tgname='trg_zz_exercise_book_attempt_immutable'
      AND tgfoid='public.fn_eb_attempt_immutable()'::regprocedure AND tgenabled='O' AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'exercise_book_trigger_postcondition' USING ERRCODE='55000'; END IF;
    IF (SELECT count(*) FROM pg_constraint c WHERE c.conrelid='public.class_action_log'::regclass
      AND c.contype='c' AND (SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='action')=ANY(c.conkey))<>1
      OR NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.class_action_log'::regclass
        AND c.conname='class_action_log_action_check' AND c.convalidated
        AND pg_get_constraintdef(c.oid)='CHECK ((action = ANY (ARRAY[''due_change''::text, ''return_work''::text, ''exercise_book_assign''::text, ''exercise_book_close''::text])))') THEN
        RAISE EXCEPTION 'exercise_book_action_check_postcondition' USING ERRCODE='55000'; END IF;
END $$;
COMMIT;
