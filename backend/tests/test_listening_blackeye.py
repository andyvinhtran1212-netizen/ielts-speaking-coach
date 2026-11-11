"""PR1 real HTTP/Pydantic tests; DB is a strict in-memory boundary double.

No SQL execution/concurrency/RLS proof. Assignment create/T09/T10 moved to PR2
per uid d461e884; assigned starts must reject, not pretend to freeze a mapping.
"""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from models.listening_blackeye import PROGRAMME, BlackEyeAttemptState, BlackEyeUnitPublic
from routers import listening as lr, admin_class_assignments as ar
from services import listening_blackeye as svc
from services.listening_package_import import validate_form_response_cells, PackageValidationError

BASE = "/api/listening"
GENERIC_ASSEMBLE = lr._assemble_listening_player_payload


def paper(n=2, activity="U1-A03", readiness="ready"):
    binding = dict(programme_id=PROGRAMME, collection_id="blackeye-v5-upper",
        source_contract="blackeye_u1_v1", unit_id="U1", activity_id=activity,
        content_revision="fixture-content-A", policy_revision="fixture-policy-A",
        answer_set_revision=str(uuid4()))
    return dict(id=str(uuid4()), programme_id=PROGRAMME, status="published", is_public=True,
        scoring_policy="report_only", content_package_id="fixture-package", mock_content_revision=973821,
        policy_revision=973822, metadata={"blackeye": dict(binding=binding,
            title="Synthetic activity", order=int(activity[-2:]), readiness=readiness,
            readiness_reasons=[] if readiness == "ready" else [svc.LOCKS.get(activity, "fixture_pending")],
            selectable=readiness == "ready", response_cell_count=n, scoring_policy="report_only",
            objective_denominator=0, dictation=dict(available=False, reason="separate_release_required"),
            media_handle=None, items=[dict(source_item_id=f"fixture-cell-{q}", q_num=q,
                source_display_number=f"0{q}", interaction="keep_change" if activity in {"U1-A03", "U1-A04"} else "text",
                prompt="Synthetic prompt", instruction="Synthetic instruction", givens=["fixture-given"],
                group_id=None, row_id=None, column_id=None, secret="PRIVATE_EXTRA") for q in range(1,n+1)]),
            "blackeye_db_revisions": dict(paper_revision=973821, policy_revision=973822),
            "blackeye_context": dict(kind="standalone", class_assignment_item_id=None, assignment_id=None, cohort_id=None)})


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.cols, self.filters, self.patch = db, table, "*", [], None
        self.maximum = None
    def or_(self, expression):
        from blackeye_query_double import matches_blackeye_filter
        self.filters.append((expression, None, "be_or"))
        return self

    def select(self, cols, **kwargs): self.cols = cols; return self
    def range(self, start, end): self.maximum = end + 1; return self
    def eq(self, key, value): self.filters.append((key, value, "eq")); return self
    def is_(self, key, value): self.filters.append((key, None if value == "null" else value, "eq")); return self
    def gt(self, key, value): self.filters.append((key, value, "gt")); return self
    def limit(self, maximum): self.maximum = maximum; return self
    def order(self, *args, **kwargs): return self
    def update(self, patch): self.patch = patch; return self
    def insert(self, row):
        self.patch = deepcopy(row)
        self.db.rows[self.table].append(deepcopy(row))
        return self
    def execute(self):
        self.db.calls.append((self.table, self.cols, self.patch))
        if self.table not in self.db.rows: raise AssertionError(f"Unexpected/private table {self.table}")
        rows = self.db.rows[self.table]
        def match(row):
            for key, value, op in self.filters:
                if key == "answers" and isinstance(value, str): value = json.loads(value)
                if op == "be_or":
                    from blackeye_query_double import matches_blackeye_filter
                    if not matches_blackeye_filter(row, key): return False
                    continue
                actual = row.get(key)
                if op == "eq" and str(actual) != str(value): return False
                if op == "gt" and (actual is None or actual <= value): return False
            return True
        selected = [r for r in rows if match(r)]
        if self.patch:
            if not self.db.lose_cas:
                for row in selected: row.update(deepcopy(self.patch))
            else: selected = []
        if self.maximum is not None: selected = selected[:self.maximum]
        if self.cols == "*": result = deepcopy(selected)
        elif self.cols.startswith("programme_id:paper_row->programme_id"):
            result = [dict(programme_id=r["paper_row"]["programme_id"], blackeye_identity=r["paper_row"]["metadata"].get("blackeye", {}).get("binding", {}).get("programme_id")) for r in selected]
        else: result = [{k: deepcopy(r[k]) for k in map(str.strip,self.cols.split(",")) if k in r} for r in selected]
        return SimpleNamespace(data=result, count=len(result))


class FakeDB:
    """Models IO only; deliberately does not claim to execute migration376."""
    def __init__(self, p):
        self.calls, self.rpcs, self.lose_cas, self.rpc_error = [], [], False, None
        self.user = str(uuid4())
        self.rows = dict(listening_tests=[p], listening_content_packages=[dict(id="fixture-package", status="published", programme_id=PROGRAMME)],
            listening_test_attempts=[], mock_paper_attempt_snapshots=[], class_assignments=[], class_assignment_items=[], students=[])
    def table(self, name): return Query(self, name)
    def freeze(self, p):
        now = datetime.now(timezone.utc)
        a = dict(id=str(uuid4()), user_id=self.user, test_id=p["id"], status="in_progress", answers=[],
            scoring_policy="report_only", paper_revision=973821, policy_revision=973822,
            class_assignment_item_id=None, sitting_id=None, attempt_purpose="practice",
            resume_expires_at=(now+timedelta(hours=1)).isoformat(), created_at=now.isoformat(),
            submitted_at=None, result_summary=None)
        review = dict(binding=deepcopy(p["metadata"]["blackeye"]["binding"]), items=[dict(
            source_item_id=i["source_item_id"], q_num=i["q_num"], source_status="UNRESOLVED", scoring_mode="SELF-CHECK",
            academic_verdict="UNRESOLVED", reference="SYNTHETIC_REFERENCE", reference_provenance="editorial",
            explanation_vi="Giải thích giả lập", limitation_vi="Giới hạn giả lập", evidence_pointer=None,
            secret="PRIVATE_EXTRA") for i in p["metadata"]["blackeye"]["items"]],
            transcript=[dict(text="SYNTHETIC_TRANSCRIPT", start=12, end=14, secret="PRIVATE_EXTRA")])
        s = dict(skill="listening", attempt_id=a["id"], paper_id=p["id"], paper_revision=973821,
            policy_revision=973822, paper_row=deepcopy(p), marking_rows=[dict(payload=dict(blackeye_review=review))])
        self.rows["listening_test_attempts"].append(a)
        self.rows["mock_paper_attempt_snapshots"].append(s)
        return a
    def rpc(self, name, params):
        self.rpcs.append((name, deepcopy(params)))
        def execute():
            if self.rpc_error: raise RuntimeError(self.rpc_error)
            if name == "fn_acquire_blackeye_attempt":
                assert "answer_set_revision" not in params["p_binding"]
                rows = self.rows["listening_test_attempts"]
                a = rows[0] if rows else self.freeze(self.rows["listening_tests"][0])
                return SimpleNamespace(data=deepcopy(a))
            if name == "fn_submit_blackeye_attempt":
                a = self.rows["listening_test_attempts"][0]
                assert a["id"] == params["p_attempt_id"] and a["user_id"] == params["p_user_id"]
                if self.lose_cas or a["answers"] != params["p_expected_answers"]:
                    raise RuntimeError("blackeye_changed")
                a.update(status="submitted", submitted_at=datetime.now(timezone.utc).isoformat(),
                         result_summary=deepcopy(params["p_result_summary"]))
                return SimpleNamespace(data=deepcopy(a))
            if name == "fn_upsert_listening_answer":
                a = self.rows["listening_test_attempts"][0]
                answers = [i for i in a["answers"] if i["q_num"] != params["p_q_num"]]
                answers.append(dict(q_num=params["p_q_num"], user_answer=params["p_user_answer"]))
                a["answers"] = answers
                return SimpleNamespace(data=len(answers))
            raise AssertionError(name)
        return SimpleNamespace(execute=execute)


@pytest.fixture
def env(monkeypatch):
    p = paper()
    db = FakeDB(p)
    actor = dict(id=db.user, admin=False)
    async def auth(_authorization):
        if actor.get("deny"): raise HTTPException(401, "Unauthorized")
        return {"id": actor["id"]}
    async def admin(_authorization):
        if not actor["admin"]: raise HTTPException(403, "Forbidden")
        return {"id": actor["id"]}
    async def is_admin(_authorization): return actor["admin"]
    monkeypatch.setattr(lr, "supabase_admin", db)
    monkeypatch.setattr(ar, "supabase_admin", db)
    monkeypatch.setattr(lr, "_require_auth", auth)
    monkeypatch.setattr(lr, "_is_admin", is_admin)
    monkeypatch.setattr(ar, "require_admin", admin)
    def forbidden(*args, **kwargs): raise AssertionError("generic assembly/private reader/signer invoked")
    for name in ("_assemble_listening_player_payload", "_student_audio_url_for_test", "_practice_exercise_payloads", "load_marking_snapshot"):
        monkeypatch.setattr(lr, name, forbidden, raising=False)
    app = FastAPI()
    app.include_router(lr.user_router)
    app.include_router(ar.router)
    client = TestClient(app)
    return SimpleNamespace(p=p, db=db, actor=actor, app=app, client=client)


def visible(p): return {k:v for k,v in p["metadata"]["blackeye"]["binding"].items() if k != "answer_set_revision"}
def start(e, body=None, query="standalone=true"):
    return e.client.post(f'{BASE}/tests/{e.p["id"]}/attempts?{query}', json=body if body is not None else dict(blackeye_binding=visible(e.p)))
def leak_free(e, response):
    raw = response.content + str(dict(response.headers)).encode()
    for private in (e.p["metadata"]["blackeye"]["binding"]["answer_set_revision"], "973821", "973822", "PRIVATE_EXTRA", "approval_hash", hashlib.sha256(b"synthetic-answer-set").hexdigest()):
        assert private.encode() not in raw
    assert b'answer_set_revision' not in raw
    assert b'attempt_receipt' not in raw


@pytest.mark.parametrize("activity,ready", [("U1-A03","ready"),("U1-A02","candidate"),("U1-A08","locked"),("U1-A14","locked"),("U1-A19","locked")])
def test_n2_t01_public_allowlist(env, activity, ready):
    p = paper(activity=activity, readiness=ready)
    env.p = p; env.db.rows["listening_tests"] = [p]
    r = env.client.get(f"{BASE}/source-collections/blackeye-v5-upper/units/U1")
    assert r.status_code == 200, r.text
    BlackEyeUnitPublic.model_validate(r.json())
    leak_free(env, r)
    assert r.headers["cache-control"] == "private, no-store"


@pytest.mark.parametrize("query", ["standalone=true", "class_item=fixture-item"])
def test_n2_t02_answer_set_input_no_oracle_no_private_io(env, query):
    bodies=[]
    for value in (env.p["metadata"]["blackeye"]["binding"]["answer_set_revision"], "wrong"):
        b=visible(env.p); b["answer_set_revision"]=value
        r=start(env, dict(blackeye_binding=b), query)
        assert r.status_code == 422; leak_free(env,r); bodies.append(r.content)
    assert bodies[0] == bodies[1]
    assert env.db.calls == [] and env.db.rpcs == []


@pytest.mark.parametrize("body", [{}, {"blackeye_binding":None}, {"blackeye_binding":{}}, {"blackeye_binding":{"activity_id":"U1-A03"}}])
def test_n1_missing_null_malformed_binding(env, body):
    r=start(env,body); assert r.status_code == 422, r.text
    leak_free(env,r)
    assert env.db.rpcs == []
    assert not any(t == "mock_paper_attempt_snapshots" for t,_,_ in env.db.calls)


def test_n2_t03_start_server_frozen_and_t06_key_only_change(env):
    before=env.client.get(f"{BASE}/source-collections/blackeye-v5-upper/units/U1")
    env.p["metadata"]["blackeye"]["binding"]["answer_set_revision"] = str(uuid4())
    after=env.client.get(f"{BASE}/source-collections/blackeye-v5-upper/units/U1")
    assert before.content == after.content
    assert before.headers == after.headers
    r=start(env); assert r.status_code == 200, r.text
    BlackEyeAttemptState.model_validate(r.json()); leak_free(env,r)
    assert env.db.rows["mock_paper_attempt_snapshots"][0]["paper_row"]["metadata"]["blackeye"]["binding"] == env.p["metadata"]["blackeye"]["binding"]


@pytest.mark.parametrize("key,value,status", [("content_revision","old-content",409),("policy_revision","old-policy",409),("activity_id","U1-A02",422),("source_contract","bad",422),("content_revision","latest",422)])
def test_n2_t05_wrong_stale_binding(env,key,value,status):
    b=visible(env.p); b[key]=value
    r=start(env,dict(blackeye_binding=b)); assert r.status_code == status,r.text
    leak_free(env,r); assert env.db.rpcs == []


@pytest.mark.parametrize("activity", ["U1-A08","U1-A14","U1-A19"])
def test_locked_start_cannot_mint_attempt(env,activity):
    p=paper(activity=activity,readiness="locked"); env.p=p; env.db.rows["listening_tests"]=[p]
    r=start(env); assert r.status_code == 422; assert env.db.rpcs == []


@pytest.mark.parametrize("assigned", [False,True])
@pytest.mark.parametrize("path,method,body", [("guided-state","get",None),("questions/1/reveal","post",None),("check","post",dict(q_num=1,user_answer="fixture",reveal=True))])
def test_r2_o5_guided_denies_before_marking_reads(env,assigned,path,method,body):
    a=env.db.freeze(env.p)
    if assigned: a["class_assignment_item_id"]="assigned-fixture"; a["attempt_purpose"]="assigned_practice"
    r=getattr(env.client,method)(f'{BASE}/tests/attempts/{a["id"]}/{path}', **({"json":body} if body else {}))
    assert r.status_code == 422,r.text; leak_free(env,r)
    assert not any(t in {"listening_exercises","listening_content"}
                   or (t == "mock_paper_attempt_snapshots" and (cols == "*" or "marking_rows" in cols))
                   for t,cols,_ in env.db.calls)
    assert env.db.rpcs == []


def test_o6_player_playback_interim_no_bundle_no_sign_no_mutation(env):
    a=env.db.freeze(env.p)
    r=env.client.get(f'{BASE}/tests/{env.p["id"]}'); assert r.status_code == 503,r.text; leak_free(env,r)
    r=env.client.post(f'{BASE}/tests/attempts/{a["id"]}/playback-started', json={"playback_claim_id":str(uuid4())})
    assert r.status_code == 503,r.text; leak_free(env,r)
    assert env.db.rpcs == [] and not any(patch for _,_,patch in env.db.calls)


def test_n4_composite_save_reload_submit_retry_review_lossless(env):
    r=start(env); assert r.status_code == 200,r.text
    aid=r.json()["attempt_id"]
    value=json.dumps(dict(version="blackeye_keep_change_v1", action="KEEP", correction_text="  001 ; | tiếng Việt\n終  "), ensure_ascii=False,indent=2)
    r=env.client.patch(f'{BASE}/tests/attempts/{aid}/answers',json=dict(q_num=1,user_answer=value))
    assert r.status_code == 200,r.text; leak_free(env,r)
    r=env.client.get(f'{BASE}/tests/attempts/{aid}'); assert r.json()["answers"][0]["user_answer"] == value; leak_free(env,r)
    r=env.client.post(f'{BASE}/tests/attempts/{aid}/submit'); assert r.status_code == 200,r.text; leak_free(env,r)
    assert r.json()["result_summary"] == dict(submitted=True,item_count=2,blank_count=1,unscored_count=2,objective_denominator=0,score=None,band_estimate=None)
    first=r.content
    env.db.rows["listening_tests"]=[]
    r=env.client.post(f'{BASE}/tests/attempts/{aid}/submit'); assert r.content == first,r.text; leak_free(env,r)
    env.db.rows["listening_tests"]=[env.p]
    env.p["metadata"]["blackeye"]["binding"]["content_revision"]="new-current"
    r=env.client.get(f'{BASE}/tests/attempts/{aid}/review'); assert r.status_code == 200,r.text; leak_free(env,r)
    assert r.json()["items"][0]["saved_response"] == value
    assert r.json()["transcript"][0]["start"] is None
    assert r.json()["attempt"]["binding"]["content_revision"] == "fixture-content-A"
    assert r.json()["audio"]["url"] is None


@pytest.mark.parametrize("value", ['true','KEEP','{"version":"bad","action":"KEEP","correction_text":""}', '{"version":"blackeye_keep_change_v1","action":"KEEP","action":"CHANGE","correction_text":""}'])
def test_malformed_composite_never_falls_back(env,value):
    a=env.db.freeze(env.p)
    r=env.client.patch(f'{BASE}/tests/attempts/{a["id"]}/answers',json=dict(q_num=1,user_answer=value))
    assert r.status_code == 422,r.text; assert env.db.rpcs == []


@pytest.mark.parametrize("count,programme,accepted", [(40,"generic",True),(41,"generic",False),(48,PROGRAMME,True),(49,PROGRAMME,False)])
def test_n4_cap_validation(count,programme,accepted):
    p=paper(count, "U1-A13" if count in (48,49) else "U1-A02")
    ids=[i["source_item_id"] for i in p["metadata"]["blackeye"]["items"]]
    kwargs=dict(blackeye_paper=p) if programme == PROGRAMME else {}
    if accepted: validate_form_response_cells(programme,ids,count,**kwargs)
    else:
        with pytest.raises(PackageValidationError): validate_form_response_cells(programme,ids,count,**kwargs)


def test_n4_a13_48_save_submit_review_one_boundary(env):
    p=paper(48,"U1-A13"); env.p=p; env.db.rows["listening_tests"]=[p]
    r=start(env); assert r.status_code == 200,r.text
    aid=r.json()["attempt_id"]
    for q in range(1,49):
        r=env.client.patch(f'{BASE}/tests/attempts/{aid}/answers',json=dict(q_num=q,user_answer=f"00{q} units"))
        assert r.status_code == 200,r.text
    r=env.client.patch(f'{BASE}/tests/attempts/{aid}/answers',json=dict(q_num=49,user_answer="no")); assert r.status_code == 422
    r=env.client.post(f'{BASE}/tests/attempts/{aid}/submit'); assert r.status_code == 200,r.text
    assert len(r.json()["answers"]) == 48 and r.json()["result_summary"]["item_count"] == 48
    r=env.client.get(f'{BASE}/tests/attempts/{aid}/review'); assert r.status_code == 200,r.text
    assert len(r.json()["items"]) == 48; leak_free(env,r)


def test_n4_wrong_frozen_mapping_and_missing_snapshot_fail_closed(env):
    a=env.db.freeze(env.p)
    s=env.db.rows["mock_paper_attempt_snapshots"][0]
    s["paper_revision"]+=1
    r=env.client.get(f'{BASE}/tests/attempts/{a["id"]}'); assert r.status_code == 503; leak_free(env,r)
    env.db.rows["mock_paper_attempt_snapshots"]=[]
    r=env.client.get(f'{BASE}/tests/attempts/{a["id"]}'); assert r.status_code == 503


def test_cas_lost_race_is_conflict_not_optimistic_submit(env):
    a=env.db.freeze(env.p); env.db.lose_cas=True
    r=env.client.post(f'{BASE}/tests/attempts/{a["id"]}/submit'); assert r.status_code == 409,r.text
    assert a["status"] == "in_progress" and a["result_summary"] is None


def test_n2_t07_in_progress_projection_and_pre_submit_review_gate(env):
    a=env.db.freeze(env.p)
    r=env.client.get(f'{BASE}/tests/{env.p["id"]}/attempts/in-progress?standalone=true')
    assert r.status_code == 200,r.text; leak_free(env,r)
    r=env.client.get(f'{BASE}/tests/attempts/{a["id"]}/review'); assert r.status_code == 409,r.text
    assert not any("marking_rows" in cols for _,cols,_ in env.db.calls)


def test_cross_owner_and_global_admin_do_not_read_marking(env):
    a=env.db.freeze(env.p); env.actor.update(id=str(uuid4()),admin=True)
    r=env.client.get(f'{BASE}/tests/attempts/{a["id"]}/review'); assert r.status_code == 404,r.text
    assert not any("marking_rows" in cols for _,cols,_ in env.db.calls)


@pytest.mark.parametrize("method,path", [("get","/listening-source-catalog?collection_id=blackeye-v5-upper&unit_id=U1"),("post","/listening-source-assignments"),("get","/listening-source-assignments/fixture-assignment")])
def test_assignment_seam_never_catalogs_creates_receipts(env,method,path):
    env.actor["admin"]=True
    r=getattr(env.client,method)("/admin/cohorts/fixture-cohort"+path)
    assert r.status_code == 503,r.text; leak_free(env,r)
    assert env.db.calls == [] and env.db.rpcs == []


def test_assigned_start_seam_and_generic_give_service_reject(env):
    from services.class_assignment_service import create_class_assignment
    r=start(env,query="class_item=fixture-item"); assert r.status_code == 503,r.text
    assert env.db.rpcs == []
    with pytest.raises(HTTPException) as error:
        create_class_assignment(env.db,cohort_id="fixture-cohort",assigned_by="fixture-teacher",title="Synthetic",skill="listening",content_id=env.p["id"])
    assert error.value.status_code == 503
    assert env.db.rpcs == []


def test_n2_t08_exact_teacher_scope_and_no_answer_identity(env):
    a=env.db.freeze(env.p)
    a.update(class_assignment_item_id="fixture-item",attempt_purpose="assigned_practice")
    ctx=dict(kind="assigned",class_assignment_item_id="fixture-item",assignment_id="fixture-assignment",cohort_id="fixture-cohort")
    env.db.rows["mock_paper_attempt_snapshots"][0]["paper_row"]["metadata"]["blackeye_context"]=ctx
    env.db.rows["class_assignments"]=[dict(id="fixture-assignment",cohort_id="fixture-cohort",assigned_by="fixture-teacher",skill="listening",status="published",content_id=a["test_id"])]
    env.db.rows["class_assignment_items"]=[dict(id="fixture-item",assignment_id="fixture-assignment",student_id="fixture-student",artifact_id=a["id"],artifact_kind="listening_attempt")]
    env.db.rows["students"]=[dict(id="fixture-student",user_id=env.db.user)]
    a.update(status="submitted",submitted_at=datetime.now(timezone.utc).isoformat(),result_summary=dict(submitted=True,item_count=2,blank_count=2,unscored_count=2,objective_denominator=0,score=None,band_estimate=None))
    path="/admin/cohorts/fixture-cohort/assignments/fixture-assignment/items/fixture-item/listening-review"
    env.actor.update(id="global-admin",admin=True)
    r=env.client.get(path); assert r.status_code == 403,r.text
    assert not any("marking_rows" in cols for _,cols,_ in env.db.calls)
    env.actor["id"]="fixture-teacher"
    r=env.client.get(path.replace("fixture-cohort","other-cohort")); assert r.status_code == 404
    r=env.client.get(path.replace("fixture-item","wrong-item")); assert r.status_code == 404
    r=env.client.get(path); assert r.status_code == 200,r.text; leak_free(env,r)


def test_n2_t11_opaque_ids_independent_of_identical_answers_and_digest(env):
    p2=paper()
    assert env.p["metadata"]["blackeye"]["binding"]["answer_set_revision"] != p2["metadata"]["blackeye"]["binding"]["answer_set_revision"]
    digest=hashlib.sha256(b"synthetic-answer-set").hexdigest()
    env.p["metadata"]["blackeye"]["binding"]["answer_set_revision"]=digest
    r=env.client.get(f"{BASE}/source-collections/blackeye-v5-upper/units/U1"); assert r.status_code == 503
    assert digest not in r.text


def test_openapi_strict_binding_and_real_response_registration(env):
    schema=env.app.openapi()
    binding=schema["components"]["schemas"]["BlackEyeLearnerBinding"]
    assert binding["additionalProperties"] is False
    assert set(binding["required"]) == set(visible(env.p))
    assert "answer_set_revision" not in binding["properties"]
    start_body=schema["components"]["schemas"]["_ListeningAttemptStartRequest"]
    assert "blackeye_binding" in start_body["properties"]
    assert "blackeye_binding" not in start_body.get("required",[])
    route=schema["paths"][f"{BASE}/tests/{{test_id}}/attempts"]["post"]
    assert "BlackEyeAttemptState" in json.dumps(route["responses"])


def test_n2_t12_generic_http_receipts_remain_unchanged(env, monkeypatch):
    from services import mock_paper_policy, mock_attempt_flags
    p = env.p
    a = env.db.freeze(p)
    p.update(programme_id="general-listening-practice", metadata={}, full_audio_storage_path="fixture.wav",
             title="Generic synthetic", test_type="full")
    # Freeze needs only Black Eye material in its own tests; here use a generic
    # attempt double, and never manufacture a Black Eye snapshot.
    env.db.rows["mock_paper_attempt_snapshots"] = []
    env.db.rows["listening_content"] = []
    env.db.rows["listening_exercises"] = []
    monkeypatch.setattr(mock_paper_policy, "authorize", lambda *args, **kwargs: {"attempt_purpose":"practice"})
    monkeypatch.setattr(mock_paper_policy, "guard_owned_attempt", lambda *args, **kwargs: None)
    monkeypatch.setattr(mock_paper_policy, "owned_delivery_snapshot", lambda *args, **kwargs: (a,None))
    monkeypatch.setattr(mock_attempt_flags, "review_flag_state", lambda *args, **kwargs: {})
    monkeypatch.setattr(lr, "_assemble_listening_player_payload", GENERIC_ASSEMBLE)
    monkeypatch.setattr(lr, "_student_audio_url_for_test", lambda test: ("http://localhost/fixture.wav","fixture.wav",60))
    def generic_rpc(name, params):
        assert name == "fn_acquire_listening_programme_attempt_v2"
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=[dict(attempt_id=a["id"],created=False,attempt_status="in_progress")]))
    monkeypatch.setattr(env.db,"rpc",generic_rpc)
    for r in (
        env.client.post(f'{BASE}/tests/{p["id"]}/attempts?standalone=true',json={}),
        env.client.get(f'{BASE}/tests/{p["id"]}/attempts/in-progress?standalone=true'),
        env.client.get(f'{BASE}/tests/{p["id"]}?attempt_id={a["id"]}'),
    ):
        assert r.status_code == 200,r.text
        payload=r.json().get("attempt",r.json())
        assert payload["paper_revision"] == 973821 and payload["policy_revision"] == 973822
        assert "binding" not in payload
    # Additive field cannot silently select Black Eye cap/policy on generic.
    r=env.client.post(f'{BASE}/tests/{p["id"]}/attempts?standalone=true',json={"blackeye_binding":visible(paper())})
    assert r.status_code == 422


@pytest.mark.parametrize("status", [401,404,503])
def test_n2_t01_error_bodies_headers_never_echo_private(env,status):
    if status == 401: env.actor["deny"]=True
    if status == 404: env.db.rows["listening_content_packages"][0]["status"]="draft"
    if status == 503: env.p["metadata"]["blackeye"]["binding"]["source_contract"]="wrong"
    r=env.client.get(f"{BASE}/source-collections/blackeye-v5-upper/units/U1")
    assert r.status_code == status,r.text; leak_free(env,r)


@pytest.mark.parametrize("damage", ["49","duplicate","missing","count","namespace"])
def test_n4_malformed_authoritative_cells_never_admit(env,damage):
    if damage == "49":
        env.p=paper(49,"U1-A13"); env.db.rows["listening_tests"]=[env.p]
    elif damage == "duplicate": env.p["metadata"]["blackeye"]["items"][1]["source_item_id"]="fixture-cell-1"
    elif damage == "missing": env.p["metadata"]["blackeye"]["items"][1]["q_num"]=3
    elif damage == "count": env.p["metadata"]["blackeye"]["response_cell_count"]=3
    elif damage == "namespace": env.p["programme_id"]="general-listening-practice"
    r=start(env); assert r.status_code == 503,r.text; assert env.db.rpcs == []


def test_review_failure_preserves_persisted_submit_and_answers(env):
    aid=start(env).json()["attempt_id"]
    r=env.client.post(f'{BASE}/tests/attempts/{aid}/submit'); assert r.status_code == 200
    frozen=r.content
    env.db.rows["mock_paper_attempt_snapshots"][0]["marking_rows"]=[]
    r=env.client.get(f'{BASE}/tests/attempts/{aid}/review'); assert r.status_code == 503
    r=env.client.post(f'{BASE}/tests/attempts/{aid}/submit'); assert r.status_code == 200 and r.content == frozen


@pytest.mark.parametrize("surface", ["content", "exercises", "dictation"])
def test_no_section_or_dictation_side_door(env,surface):
    env.db.rows["listening_content"]=[dict(id="fixture-section",status="published",test_id=env.p["id"])]
    path = (f'{BASE}/content/fixture-section' if surface == "content" else
            f'{BASE}/exercises?content_id=fixture-section&exercise_type=dictation' if surface == "exercises" else
            f'{BASE}/tests/{env.p["id"]}/dictation')
    r=env.client.get(path); assert r.status_code == 422,r.text; leak_free(env,r)
    assert not any(t == "listening_exercises" for t,_,_ in env.db.calls)
    assert env.db.rpcs == []


def test_admin_preview_also_cannot_use_generic_assembler(env,monkeypatch):
    # Exercise the real assembler guard, not a spy returning a canned denial.
    monkeypatch.setattr(lr,"require_admin",ar.require_admin)
    monkeypatch.setattr(lr,"_assemble_listening_player_payload",GENERIC_ASSEMBLE)
    env.app.include_router(lr.admin_router)
    env.actor["admin"]=True
    r=env.client.get(f'/admin/listening/tests/{env.p["id"]}/player-preview')
    assert r.status_code == 503,r.text; leak_free(env,r)


@pytest.mark.parametrize("action,text,blank", [(None,"some text",True),("CHANGE","  ",True),("CHANGE","001",False),("KEEP","  retained text  ",False)])
def test_composite_incomplete_component_roundtrip(env,action,text,blank):
    aid=start(env).json()["attempt_id"]
    value=json.dumps(dict(version="blackeye_keep_change_v1",action=action,correction_text=text))
    r=env.client.patch(f'{BASE}/tests/attempts/{aid}/answers',json=dict(q_num=1,user_answer=value)); assert r.status_code == 200
    r=env.client.post(f'{BASE}/tests/attempts/{aid}/submit'); assert r.status_code == 200
    assert r.json()["result_summary"]["blank_count"] == 1+int(blank)
    r=env.client.get(f'{BASE}/tests/attempts/{aid}/review'); assert r.status_code == 200
    assert r.json()["items"][0]["blank"] == blank and r.json()["items"][0]["saved_response"] == value


@pytest.mark.parametrize("mode", ["dictation", "gist", "true_false", "mcq"])
@pytest.mark.parametrize("by_exercise", [False, True])
def test_f1_content_grading_rejects_before_private_reads_or_writes(env, mode, by_exercise):
    section, exercise = str(uuid4()), str(uuid4())
    env.db.rows["listening_content"] = [dict(id=section, test_id=env.p["id"], status="published",
                                           transcript="PROTECTED_SYNTHETIC_TRANSCRIPT")]
    env.db.rows["listening_exercises"] = [dict(id=exercise, content_id=section, status="published",
                                             exercise_type=mode, payload={"reference": "PROTECTED"})]
    env.db.rows["listening_attempts"] = []
    before = deepcopy(env.db.rows)
    body = {"mode": mode, "exercise_id" if by_exercise else "content_id": exercise if by_exercise else section,
            "user_transcript": ""}
    r = env.client.post(f"{BASE}/attempts", json=body)
    assert r.status_code == 422, r.text
    assert r.json() == {"detail": "Black Eye section access unavailable."}
    leak_free(env, r)
    assert b"PROTECTED" not in r.content and b'"diff"' not in r.content
    assert env.db.rows == before and env.db.rpcs == []
    assert not any(patch or table == "listening_attempts" for table, _, patch in env.db.calls)
    assert all(cols == "test_id" for table, cols, _ in env.db.calls if table == "listening_content")
    assert all(cols == "content_id" for table, cols, _ in env.db.calls if table == "listening_exercises")


def test_f1_generic_dictation_still_grades_and_saves(env):
    section, exercise = str(uuid4()), str(uuid4())
    env.p["programme_id"] = "ielts-listening-practice"
    env.p["metadata"] = {}
    env.db.rows["listening_content"] = [dict(id=section, test_id=env.p["id"], status="published",
                                           transcript="Synthetic generic transcript")]
    env.db.rows["listening_exercises"] = [dict(id=exercise, content_id=section, status="published",
                                             exercise_type="dictation", segments=[])]
    env.db.rows["listening_attempts"] = []
    r = env.client.post(f"{BASE}/attempts", json={"content_id": section, "mode": "dictation",
                                              "user_transcript": "Synthetic generic transcript"})
    assert r.status_code == 200, r.text
    assert r.json()["diff"] and r.json()["mode"] == "dictation"
    assert len(env.db.rows["listening_attempts"]) == 1


def test_r6_http_generic_assignment_seam_preempts_validation_and_service(env, monkeypatch):
    env.actor["admin"] = True
    monkeypatch.setattr(ar, "_require_cohort", lambda _: {"id": "fixture-cohort", "is_active": True})
    def no_service(*args, **kwargs):
        pytest.fail("generic assignment service reached")
    monkeypatch.setattr(ar, "create_class_assignment", no_service)
    r = env.client.post("/admin/cohorts/fixture-cohort/assignments", json={
        "skill": "listening", "title": "Synthetic task", "content_id": env.p["id"]})
    assert r.status_code == 503, r.text
    assert r.json() == {"detail": svc.ASSIGNMENT_UNAVAILABLE}
    assert "chưa hỗ trợ giao qua lớp" not in r.text
    leak_free(env, r)
    assert env.db.rpcs == [] and not any(patch for _, _, patch in env.db.calls)


@pytest.mark.parametrize("message,status,detail", [
    ("blackeye_invalid_inactive", 422, "Black Eye attempt inactive."),
    ("blackeye_unavailable_revision", 503, svc.UNAVAILABLE),
    ("blackeye_unavailable_context", 503, svc.UNAVAILABLE),
    ("blackeye_invalid_context", 503, svc.UNAVAILABLE),
    ("blackeye_invalid_revision", 503, svc.UNAVAILABLE),
])
def test_r5_rpc_inactive_and_server_mismatch_sanitized(env, message, status, detail):
    env.db.rpc_error = f"{message}: PRIVATE_EXTRA"
    r = start(env)
    assert r.status_code == status, r.text
    assert r.json() == {"detail": detail}
    leak_free(env, r)
    assert not env.db.rows["listening_test_attempts"]


def test_r2_legacy_dispatch_has_no_catalog_io_or_missing_test_keyerror():
    class NoIO:
        def table(self, _):
            pytest.fail("legacy diagnostic dispatch must not add a read")
    assert svc.attempt_is_blackeye(NoIO(), {"id": "legacy"}) is False
    assert svc.attempt_is_blackeye(NoIO(), {"id": "legacy", "test_id": "deleted", "scoring_policy": "diagnostic"}) is False


def test_r2_frozen_generic_dispatch_reads_identity_once_not_live_catalog(env):
    env.p["programme_id"] = "ielts-listening-practice"
    del env.p["metadata"]["blackeye"]
    a = env.db.freeze(paper())
    env.db.rows["mock_paper_attempt_snapshots"][0]["paper_row"] = deepcopy(env.p)
    env.db.rows["listening_tests"] = []
    assert svc.attempt_is_blackeye(env.db, a) is False
    assert len(env.db.calls) == 1 and env.db.calls[0][0] == "mock_paper_attempt_snapshots"
    assert env.db.calls[0][1] != "*" and "marking_rows" not in env.db.calls[0][1]


def test_server_cell_errors_are_unavailable(env):
    env.db.rpc_error = 'blackeye_invalid_cells'
    assert start(env).status_code == 503


@pytest.mark.parametrize('activity', ['U1-A02', 'U1-A03'])
def test_save_cell_length_capped_before_rpc(env, activity):
    p = paper(activity=activity)
    env.db.rows['listening_tests'] = [p]
    attempt = env.db.freeze(p)
    response = env.client.patch(f'{BASE}/tests/attempts/{attempt["id"]}/answers',
        json={'q_num': 1, 'user_answer': 'x' * 2001})
    assert response.status_code == 422
    assert env.db.rpcs == []


def test_submit_transport_url_bounded_for_48_long_answers(env, monkeypatch):
    import httpx
    from postgrest import SyncPostgrestClient
    p = paper(48, 'U1-A13')
    env.db.rows['listening_tests'] = [p]
    attempt = env.db.freeze(p)
    attempt['answers'] = [dict(q_num=i, user_answer='x' * 2000) for i in range(1,49)]
    urls = []
    def transport(request):
        urls.append(str(request.url))
        payload = json.loads(request.content)
        assert len(payload['p_expected_answers']) == 48
        assert len(request.content) > 96000
        attempt.update(status='submitted', submitted_at=datetime.now(timezone.utc).isoformat(),
                       result_summary=payload['p_result_summary'])
        return httpx.Response(200, json=attempt)
    client = SyncPostgrestClient('https://synthetic.invalid/rest/v1')
    client.session = httpx.Client(transport=httpx.MockTransport(transport))
    monkeypatch.setattr(env.db, 'rpc', client.rpc)
    response = env.client.post(f'{BASE}/tests/attempts/{attempt["id"]}/submit')
    assert response.status_code == 200, response.text
    assert len(urls) == 1 and len(urls[0]) < 150
    assert urls[0].endswith('/rpc/fn_submit_blackeye_attempt')
    client.session.close()
