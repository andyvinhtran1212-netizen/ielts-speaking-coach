"""D2 HTTP/service contract tests on strict §8 v1.3 query doubles.

These do not claim PG atomicity/RLS proof; D1 integration remains a merge gate.
"""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import inspect
import json
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from test_listening_blackeye import env, FakeDB, paper, visible, BASE, leak_free
from models import listening_blackeye as dto
from routers import admin_class_assignments as ar, listening as lr
from services import exercise_book_api as svc, listening_blackeye as be, staff_guard

ADMIN_GUARD = ar.require_admin
C = "00000000-0000-4000-8000-000000000001"
A = "00000000-0000-4000-8000-000000000002"
I = "00000000-0000-4000-8000-000000000003"
S = "00000000-0000-4000-8000-000000000004"
G = "00000000-0000-4000-8000-000000000005"
CH = "00000000-0000-4000-8000-000000000006"
ADMIN = f"/admin/cohorts/{C}"

# Exact ordered names from FD §8. Unknown/extra/missing params fail tests.
SIGNATURES = {
    "fn_exercise_book_actor_access": "p_actor_id p_cohort_id p_programme_id",
    "fn_record_cohort_grant": "p_actor_id p_step_up_at p_cohort_id p_programme_id p_grantee_id p_role p_action p_reason p_request_id p_auth_session_id",
    "fn_list_cohort_grants": "p_actor_id p_step_up_at p_cohort_id p_programme_id",
    "fn_read_cohort_grant_log": "p_actor_id p_step_up_at p_cohort_id p_programme_id p_limit p_before_seq",
    "fn_create_exercise_book_assignment": "p_actor_id p_request_id p_cohort_id p_programme_id p_activities p_recipient_ids p_due_at p_deadline_timezone p_replay_policy p_title",
    "fn_close_exercise_book_assignment": "p_actor_id p_cohort_id p_assignment_id p_reason",
    "fn_list_exercise_book_assignments": "p_actor_id p_cohort_id p_programme_id p_limit p_before_created_at p_before_id",
    "fn_read_exercise_book_progress": "p_actor_id p_cohort_id p_assignment_id",
    "fn_list_learner_exercise_book_assignments": "p_user_id p_limit p_before_due_at p_before_id",
    "fn_acquire_exercise_book_assigned_attempt": "p_user_id p_item_id p_test_id p_binding p_renderer_affinity_protocol",
    "fn_save_exercise_book_answer": "p_user_id p_attempt_id p_q_num p_user_answer p_client_seq",
    "fn_submit_exercise_book_assigned_attempt": "p_user_id p_attempt_id p_expected_answers p_confirm_blank",
}


class DBError(Exception):
    def __init__(self, code, message="SECRET_DB_MESSAGE"):
        self.code, self.message = code, message
        super().__init__("SECRET_DB_EXCEPTION " + message)


class D1DB(FakeDB):
    def __init__(self, p):
        super().__init__(p)
        self.errors = []
        self.roles = ["assigner"]
        self.is_owner = True
        self.seq = {}
        self.grants = []
        self.grant_events = []
        self.list_rows = []
        self.learner_rows = []
        self.rows["class_assignment_activities"] = []
        self.receipt = None
        self.progress = None
        self.mutations = []
        self.storage = SimpleNamespace(from_=lambda bucket: SimpleNamespace(create_signed_url=self.sign))
        self.signed = []

    def sign(self, path, ttl):
        self.signed.append((path, ttl))
        return {"signedURL": "https://synthetic.invalid/private-audio"}

    def rpc(self, name, params):
        if name not in SIGNATURES:
            return super().rpc(name, params)
        assert set(params) == set(SIGNATURES[name].split()), (name, params.keys())
        # The double cannot independently authenticate; the route inventory
        # below pins how the actor is obtained and forwarded.
        self.rpcs.append((name, deepcopy(params)))
        def execute():
            if self.errors:
                raise self.errors.pop(0)
            if name == "fn_exercise_book_actor_access":
                return SimpleNamespace(data=[dict(is_owner=self.is_owner, roles=self.roles)])
            if name == "fn_create_exercise_book_assignment":
                self.mutations.append(name)
                return SimpleNamespace(data={**deepcopy(self.receipt), "replayed": len(self.mutations) > 1})
            if name == "fn_close_exercise_book_assignment":
                self.mutations.append(name)
                self.receipt["status"] = "archived"
                return SimpleNamespace(data=deepcopy(self.receipt))
            if name == "fn_read_exercise_book_progress":
                return SimpleNamespace(data=deepcopy(self.progress))
            if name == "fn_record_cohort_grant":
                if not self.is_owner:
                    raise DBError("EB403", "not_owner")
                self.mutations.append(name)
                return SimpleNamespace(data=[dict(event_id=CH, seq=1, occurred_at=now(), replayed=len(self.mutations) > 1)])
            if name == "fn_list_cohort_grants":
                if not self.is_owner:
                    raise DBError("EB403", "not_owner")
                return SimpleNamespace(data=deepcopy(self.grants))
            if name == "fn_acquire_exercise_book_assigned_attempt":
                self.mutations.append(name)
                attempts = self.rows["listening_test_attempts"]
                attempt = next((a for a in attempts if a["class_assignment_item_id"] == params["p_item_id"] and a["test_id"] == params["p_test_id"] and a["status"] == "in_progress"), None)
                if not attempt:
                    test = next(p for p in self.rows["listening_tests"] if p["id"] == params["p_test_id"])
                    attempt = self.freeze(test)
                    attempt.update(class_assignment_item_id=I, attempt_purpose="assigned_practice")
                return SimpleNamespace(data={**deepcopy(attempt), "class_assignment_activity_id": CH, "created": True})
            if name == "fn_save_exercise_book_answer":
                self.mutations.append(name)
                attempt = next(a for a in self.rows["listening_test_attempts"] if a["id"] == params["p_attempt_id"])
                key = (attempt["id"], params["p_q_num"])
                applied = params["p_client_seq"] > self.seq.get(key, 0)
                if applied:
                    attempt["answers"] = [a for a in attempt["answers"] if a["q_num"] != params["p_q_num"]]
                    attempt["answers"].append(dict(q_num=params["p_q_num"], user_answer=params["p_user_answer"]))
                    self.seq[key] = params["p_client_seq"]
                return SimpleNamespace(data=[dict(attempt_id=attempt["id"], answer_count=len(attempt["answers"]), client_seq=self.seq[key], applied=applied)])
            if name == "fn_submit_exercise_book_assigned_attempt":
                attempt = next(a for a in self.rows["listening_test_attempts"] if a["id"] == params["p_attempt_id"])
                activity, _, _ = be.frozen_public(self, attempt)
                expected = be.answer_map(activity, params["p_expected_answers"])
                if expected != be.answer_map(activity, attempt["answers"]):
                    raise DBError("EB409", "attempt_changed")
                blanks = sum(be.decode_answer(i, expected.get(i.q_num, "")) for i in activity.items)
                if blanks and not params["p_confirm_blank"]:
                    raise DBError("EB422", "validation")
                replayed = attempt["status"] == "submitted"
                attempt.update(status="submitted", submitted_at=attempt.get("submitted_at") or now(),
                    result_summary=dict(submitted=True, item_count=len(activity.items), blank_count=blanks,
                        unscored_count=len(activity.items), objective_denominator=0, score=None, band_estimate=None))
                self.mutations.append(name)
                return SimpleNamespace(data={**deepcopy(attempt), "replayed": replayed})
            if name in {"fn_list_exercise_book_assignments", "fn_list_learner_exercise_book_assignments", "fn_read_cohort_grant_log"}:
                assert 1 <= params["p_limit"] <= 100
                if name == "fn_read_cohort_grant_log":
                    rows = [r for r in self.grant_events if params["p_before_seq"] is None or r["seq"] < params["p_before_seq"]]
                    return SimpleNamespace(data=deepcopy(rows[:params["p_limit"]]))
                learner = name == "fn_list_learner_exercise_book_assignments"
                time_field = "due_at" if learner else "created_at"
                before = params["p_before_due_at" if learner else "p_before_created_at"]
                rows = self.learner_rows if learner else self.list_rows
                rows = [r for r in rows if before is None or (r[time_field], r["assignment_id"]) < (before, params["p_before_id"])]
                result = deepcopy(rows[:params["p_limit"]])
                return SimpleNamespace(data={"items": result} if learner else result)
            raise AssertionError(name)
        return SimpleNamespace(execute=execute)


def now():
    return datetime.now(timezone.utc).isoformat()


@pytest.fixture
def book(env, monkeypatch):
    db = D1DB(env.p)
    env.db = db
    env.actor.update(id=db.user, admin=True)
    env.auth_calls = []
    async def admin(auth):
        env.auth_calls.append(auth)
        if env.actor.get("deny"):
            raise HTTPException(401, "PRIVATE_AUTH_ERROR")
        return {"id": env.actor["id"], "factors": [dict(factor_type="totp", status="verified",
            created_at=(datetime.now(timezone.utc)-timedelta(days=2)).isoformat(),
            updated_at=(datetime.now(timezone.utc)-timedelta(days=2)).isoformat())]}
    monkeypatch.setattr(ar, "require_admin", ADMIN_GUARD)
    monkeypatch.setattr(ar, "_staff_admin_guard", admin)
    monkeypatch.setattr(ar, "supabase_admin", db)
    monkeypatch.setattr(lr, "supabase_admin", db)
    env.claims = {"sub": db.user, "aal": "aal2", "amr": [{"method": "totp", "timestamp": datetime.now(timezone.utc).timestamp()}], "session_id": "SYNTHETIC_SESSION"}
    monkeypatch.setattr(staff_guard, "_token_claims", lambda auth, user_id: deepcopy(env.claims))
    db.receipt = dict(assignment_id=A, request_id=A, cohort_id=C, activities=[deepcopy(env.p["metadata"]["blackeye"]["binding"])],
        recipient_ids=[S], due_at=(datetime.now(timezone.utc)+timedelta(days=2)).isoformat(),
        deadline_timezone="Asia/Ho_Chi_Minh", replay_policy="allowed", completion_denominator=1,
        status="published", created_at=now())
    db.rows["class_assignments"] = [dict(id=A, cohort_id=C, skill="listening", status="published", due_at=db.receipt["due_at"], created_at=db.receipt["created_at"], title="Synthetic book", content_config={"programme_id": dto.PROGRAMME})]
    db.rows["class_assignment_items"] = [dict(id=I, assignment_id=A, student_id=S, state="assigned", submitted_at=None)]
    db.rows["students"] = [dict(id=S, user_id=db.user, full_name="Tên giả", is_active=True, archived_at=None, cohort_id=C)]
    db.rows["class_assignment_activities"] = [dict(id=CH, class_assignment_item_id=I, test_id=env.p["id"], position=1, binding=deepcopy(db.receipt["activities"][0]))]
    db.progress = dict(assignment_id=A, cohort_id=C,
        activities=[dict(activity_key="U1-A03", test_id=env.p["id"], position=1)],
        students=[dict(student_id=S, display_name="Tên giả", item_id=I)],
        cells=[dict(student_id=S, activity_id="U1-A03", item_id=I, attempt_id=None, status="not_started", submitted_at=None, blank_count=0)],
        completion=dict(denominator=1, submitted_by_student={S: 0}))
    return env


def create_body(book):
    return {k: deepcopy(book.db.receipt[k]) for k in ("request_id", "activities", "recipient_ids", "due_at", "deadline_timezone", "replay_policy")}


def start_assigned(book):
    r = book.client.post(f'{BASE}/tests/{book.p["id"]}/attempts?class_item={I}', json={"blackeye_binding": visible(book.p)})
    assert r.status_code == 200, r.text
    return r.json()


def test_all_twelve_rpc_names_are_pinned():
    assert svc.RPC_NAMES == set(SIGNATURES)


def test_create_replay_close_receipt_and_single_auth(book):
    first = book.client.post(ADMIN + "/listening-source-assignments", json=create_body(book))
    assert first.status_code == 201, first.text
    assert len(book.auth_calls) == 1
    again = book.client.post(ADMIN + "/listening-source-assignments", json=create_body(book))
    assert again.status_code == 200 and again.json() == first.json()
    receipt = book.client.get(ADMIN + f"/listening-source-assignments/{A}")
    assert receipt.status_code == 200 and receipt.json() == first.json()
    closed = book.client.patch(ADMIN + f"/listening-source-assignments/{A}", json={"status": "archived", "reason": "Kết thúc bài giả"})
    assert closed.status_code == 200 and closed.json()["status"] == "archived"
    params = next(p for n, p in book.db.rpcs if n == "fn_create_exercise_book_assignment")
    assert params["p_actor_id"] == book.actor["id"] and params["p_programme_id"] == dto.PROGRAMME
    assert "replayed" not in first.json()
    assert all(patch is None for _, _, patch in book.db.calls)


def test_grant_based_first_assignment_catalog_and_denial(book, monkeypatch):
    # A grant holder can create the first assignment; no historical creator scan.
    book.db.rows["class_assignments"] = []
    monkeypatch.setattr("services.class_membership_service.active_students_for_cohort", lambda *a: book.db.rows["students"])
    r = book.client.get(ADMIN + "/listening-source-catalog")
    assert r.status_code == 200, r.text
    assert r.json()["eligible_recipients"] == [{"student_id": S, "display_name": "Tên giả"}]
    assert not any(t == "class_assignments" for t, _, _ in book.db.calls)
    book.db.roles = []
    book.db.is_owner = False
    book.db.calls.clear()
    r = book.client.get(ADMIN + "/listening-source-catalog")
    assert r.status_code == 403 and r.json()["code"] == "not_granted"
    assert book.db.calls == []


@pytest.mark.parametrize("count", [10, 500])
def test_progress_is_one_rpc_no_n_plus_one(book, count):
    book.db.progress["cells"] *= count
    r = book.client.get(ADMIN + f"/listening-source-assignments/{A}/progress")
    assert r.status_code == 200, r.text
    assert len(r.json()["cells"]) == count
    assert len(book.db.rpcs) == 1 and not book.db.calls
    leak_free(book, r)
    assert all(x not in r.text for x in ("score", "accuracy", "answer_set_revision"))


@pytest.mark.parametrize("limit,count", [(1, 2), (50, 50), (100, 101), (200, 205)])
def test_keyset_pagination_honors_both_limits(book, limit, count):
    stamp = now()
    book.db.list_rows = [dict(assignment_id=str(UUID(int=i)), title="Synthetic", due_at=stamp, status="published",
        activity_count=2, recipient_count=3, created_at=stamp) for i in range(count, 0, -1)]
    r = book.client.get(ADMIN + f"/listening-source-assignments?limit={limit}")
    assert r.status_code == 200, r.text
    assert len(r.json()["items"]) == min(limit, count)
    cursor = r.json()["next_cursor"]
    assert bool(cursor) == (count > limit)
    assert all(p["p_limit"] <= 100 for _, p in book.db.rpcs)
    if cursor:
        more = book.client.get(ADMIN + f"/listening-source-assignments?limit={limit}&cursor={cursor}")
        assert more.status_code == 200
        assert {x["assignment_id"] for x in r.json()["items"]}.isdisjoint(x["assignment_id"] for x in more.json()["items"])


@pytest.mark.parametrize("value", ["not-base64", "e30", "x" * 1025, svc.encode_cursor("grant-log", [1]), svc.encode_cursor("admin-assignments", ["naive", G])])
def test_cursor_validation_is_fixed_and_zero_rpc(book, value):
    r = book.client.get(ADMIN + "/listening-source-assignments", params={"cursor": value})
    assert r.status_code == 422 and r.json()["code"] == "validation"
    assert value not in r.text and not book.db.rpcs


@pytest.mark.parametrize("method,suffix", [("get", ""), ("get", "/log"), ("post", "")])
@pytest.mark.parametrize("failure", ["missing", "old", "cooloff"])
def test_grant_step_up_enforced_when_global_flag_false(book, monkeypatch, method, suffix, failure):
    monkeypatch.setattr(staff_guard.settings, "ADMIN_STEP_UP_ENFORCE", False)
    if failure == "missing":
        book.claims["amr"] = []
    elif failure == "old":
        book.claims["amr"][0]["timestamp"] -= 601
    else:
        original = ar._staff_admin_guard
        async def changed_factor(auth):
            user = await original(auth)
            user["factors"][0]["updated_at"] = now()
            return user
        monkeypatch.setattr(ar, "_staff_admin_guard", changed_factor)
    body = dict(grantee_id=G, role="teacher", action="grant", reason="Mục đích giả", request_id=A)
    r = getattr(book.client, method)(ADMIN + "/exercise-book-grants" + suffix, **({"json": body} if method == "post" else {}))
    assert r.status_code == 403 and r.json()["code"] == "step_up_required", r.text
    assert not book.db.rpcs and not book.db.calls and not book.db.mutations


def test_grants_read_write_replay_verified_session_and_empty_owner(book):
    r = book.client.get(ADMIN + "/exercise-book-grants")
    assert r.status_code == 200 and r.json() == {"cohort_id": C, "grants": []}
    body = dict(grantee_id=G, role="teacher", action="grant", reason="Mục đích giả", request_id=A)
    first = book.client.post(ADMIN + "/exercise-book-grants", json=body)
    assert first.status_code == 201, first.text
    again = book.client.post(ADMIN + "/exercise-book-grants", json=body)
    # Timestamp belongs to DB's original event on replay; double uses now().
    assert again.status_code == 200 and again.json()["event_id"] == first.json()["event_id"]
    params = next(p for n, p in book.db.rpcs if n == "fn_record_cohort_grant")
    assert params["p_actor_id"] == book.actor["id"]
    assert params["p_auth_session_id"] == "SYNTHETIC_SESSION" and params["p_step_up_at"]
    book.db.is_owner = False
    r = book.client.get(ADMIN + "/exercise-book-grants")
    assert r.status_code == 403 and r.json()["code"] == "not_owner"


@pytest.mark.parametrize("state,tokens", [(s, list(m)) for s, m in svc.ERRORS.items()])
def test_exact_sqlstate_message_mapping(book, state, tokens):
    for token in tokens:
        book.db.errors = [DBError(state, token)]
        r = book.client.post(ADMIN + "/listening-source-assignments", json=create_body(book))
        status, code = svc.ERRORS[state][token]
        assert r.status_code == status and r.json() == {"detail": svc.MESSAGES[status], "code": code}
        assert r.headers["cache-control"] == "private, no-store"


@pytest.mark.parametrize("state", ["40P01", "40001", "55P03"])
def test_transient_sql_retry_exactly_once(book, state):
    book.db.errors = [DBError(state)]
    r = book.client.post(ADMIN + "/listening-source-assignments", json=create_body(book))
    assert r.status_code == 201 and len(book.db.rpcs) == 2
    book.db.errors = [DBError(state), DBError(state)]
    book.db.rpcs.clear()
    r = book.client.post(ADMIN + "/listening-source-assignments", json=create_body(book))
    assert r.status_code == 503 and len(book.db.rpcs) == 2


@pytest.mark.parametrize("state", ["42501", "42883", "42P01", "EB403", "UNKNOWN_SECRET"])
def test_failure_logs_function_and_sqlstate_only(book, caplog, state):
    book.db.errors = [DBError(state)]
    body = dict(grantee_id=G, role="teacher", action="grant", reason="SENTINEL_REASON", request_id=A)
    r = book.client.post(ADMIN + "/exercise-book-grants", json=body)
    assert r.status_code == 503
    records = [r.getMessage() for r in caplog.records if r.name == svc.__name__]
    assert records == [f'fn_record_cohort_grant SQLSTATE={state if state in {"42501", "42883", "42P01"} else "unknown"}']
    for secret in ("SENTINEL_REASON", G, "SECRET_DB", book.actor["id"]):
        assert secret not in r.text + caplog.text


def test_assigned_sequence_submit_retry_review_and_snapshot_unchanged(book):
    state = start_assigned(book)
    attempt_id = state["attempt_id"]
    assert state["context"] == dict(kind="assigned", class_assignment_item_id=I, assignment_id=A, cohort_id=C)
    snapshot = deepcopy(book.db.rows["mock_paper_attempt_snapshots"])
    path = f"{BASE}/tests/attempts/{attempt_id}"
    value = json.dumps(dict(version="blackeye_keep_change_v1", action="KEEP", correction_text=""))
    for seq, text in [(2, value), (1, "")]:
        r = book.client.patch(path + "/answers", json={"q_num": 1, "user_answer": text, "client_seq": seq})
        assert r.status_code == 200 and r.json()["client_seq"] == 2, r.text
    state = book.client.get(path).json()
    assert state["answers"][0]["user_answer"] == value
    stale = book.client.post(path + "/submit", json={"expected_answers": [], "confirm_blank": True})
    assert stale.status_code == 409 and stale.json()["code"] == "attempt_changed"
    body = {"expected_answers": state["answers"], "confirm_blank": True}
    first = book.client.post(path + "/submit", json=body)
    assert first.status_code == 200, first.text
    again = book.client.post(path + "/submit", json=body)
    assert again.status_code == 200 and first.json() == again.json()
    review = book.client.get(path + "/review")
    assert review.status_code == 200, review.text
    assert "SYNTHETIC_REFERENCE" in review.text
    assert book.db.rows["mock_paper_attempt_snapshots"] == snapshot
    assert book.db.rows["class_assignment_items"][0]["state"] == "assigned"
    assert book.db.rows["class_assignment_items"][0]["submitted_at"] is None
    assert not any(patch for _, _, patch in book.db.calls)


def test_assigned_missing_sequence_or_submit_body_never_mutates(book):
    state = start_assigned(book)
    path = f'{BASE}/tests/attempts/{state["attempt_id"]}'
    book.db.mutations.clear()
    r = book.client.patch(path + "/answers", json={"q_num": 1, "user_answer": ""})
    assert r.status_code == 422
    r = book.client.post(path + "/submit")
    assert r.status_code == 422
    assert not book.db.mutations


def test_teacher_review_selects_activity_and_checks_actual_student_owner(book):
    state = start_assigned(book)
    aid = state["attempt_id"]
    r = book.client.post(f"{BASE}/tests/attempts/{aid}/submit", json={"expected_answers": [], "confirm_blank": True})
    assert r.status_code == 200
    url = ADMIN + f"/assignments/{A}/items/{I}/listening-review"
    r = book.client.get(url, params={"activity_id": "U1-A03"})
    assert r.status_code == 200, r.text
    assert r.json()["attempt"]["attempt_id"] == aid
    book.db.rows["students"][0]["user_id"] = G
    book.db.calls.clear()
    r = book.client.get(url, params={"activity_id": "U1-A03"})
    assert r.status_code == 409
    assert not any("marking_rows" in cols for _, cols, _ in book.db.calls)


def test_owner_denial_equals_missing_before_snapshot_or_sign(book):
    state = start_assigned(book)
    aid = state["attempt_id"]
    book.actor["id"] = G
    book.db.calls.clear()
    r = book.client.get(f'{BASE}/tests/attempts/{aid}')
    missing = book.client.get(f'{BASE}/tests/attempts/{G}')
    assert r.status_code == missing.status_code == 404
    assert r.json() == missing.json()
    assert not book.db.signed and not any(t == "mock_paper_attempt_snapshots" for t, _, _ in book.db.calls)


def test_start_and_resume_do_not_change_snapshot_context(book):
    first = start_assigned(book)
    resumed = book.client.get(f'{BASE}/tests/{book.p["id"]}/attempts/in-progress?class_item={I}')
    assert resumed.status_code == 200 and resumed.json()["attempt"]["attempt_id"] == first["attempt_id"]
    assert book.db.rows["mock_paper_attempt_snapshots"][0]["paper_row"]["metadata"]["blackeye_context"]["kind"] == "standalone"


def test_player_signs_only_owner_snapshot_audio(book):
    state = start_assigned(book)
    aid = state["attempt_id"]
    snap = book.db.rows["mock_paper_attempt_snapshots"][0]
    snap["paper_row"]["assembled_audio_storage_path"] = "SYNTHETIC_SNAPSHOT_AUDIO"
    book.p["assembled_audio_storage_path"] = "CHANGED_LIVE_AUDIO"
    url = f'{BASE}/tests/{book.p["id"]}?class_item={I}&attempt_id={aid}'
    r = book.client.get(url)
    assert r.status_code == 200 and r.json()["audio"]["expires_in"] == 7200, r.text
    assert book.db.signed == [("SYNTHETIC_SNAPSHOT_AUDIO", 7200)]
    book.actor["id"] = G
    book.db.signed.clear()
    r = book.client.get(url)
    assert r.status_code == 404 and not book.db.signed


@pytest.mark.parametrize("patch", [
    {"recipient_ids": ["SECRET_INVALID_UUID"]}, {"due_at": "2020-01-01T00:00:00Z"},
    {"due_at": "2099-01-01T00:00:00Z"}, {"due_at": "2026-11-15"},
    {"request_id": "-" * 36}, {"actor_id": G}, {"recipient_ids": [S, S]},
])
def test_create_invalid_inputs_never_rpc_or_echo(book, patch):
    body = {**create_body(book), **patch}
    r = book.client.post(ADMIN + "/listening-source-assignments", json=body)
    assert r.status_code == 422 and r.json()["code"] == "validation", r.text
    assert not book.db.rpcs
    assert "SECRET_INVALID_UUID" not in r.text


@pytest.mark.parametrize("template", ["listening-source-catalog", "listening-source-assignments", "exercise-book-grants", "exercise-book-grants/log"])
def test_auth_precedes_validation_and_all_private_headers(book, template):
    book.actor["deny"] = True
    r = book.client.get(ADMIN + "/" + template, params={"limit": "SECRET_INVALID"})
    assert r.status_code == 401 and r.headers["cache-control"] == "private, no-store"
    assert not book.db.rpcs and not book.db.calls


def test_route_template_cannot_be_spoofed_by_identifier(book, monkeypatch):
    calls = []
    async def guard(*args):
        calls.append(args)
        raise HTTPException(503, "Guard reached")
    monkeypatch.setattr(ar, "require_admin", guard)
    r = book.client.patch("/admin/cohorts/listening-source-catalog/assignments/a", json={"due_at": now()})
    assert r.status_code == 503 and calls


def test_rpc_actor_inventory_has_no_wire_identity_fields():
    # Pin every route feeding a §8 operation to its canonical verified user.
    routes = {
        ar.blackeye_source_catalog: ("require_admin", 'actor["id"]'),
        ar.blackeye_source_assign: ("require_admin", 'actor["id"]'),
        ar.blackeye_source_list: ("require_admin", 'actor["id"]'),
        ar.blackeye_source_receipt: ("require_admin", 'actor["id"]'),
        ar.blackeye_source_close: ("require_admin", 'actor["id"]'),
        ar.blackeye_assignment_progress: ("require_admin", 'actor["id"]'),
        ar.blackeye_teacher_review: ("require_admin", 'actor["id"]'),
        ar.exercise_book_grants: ("require_admin", 'actor["id"]'),
        ar.exercise_book_record_grant: ("require_admin", 'actor["id"]'),
        ar.exercise_book_grant_log: ("require_admin", 'actor["id"]'),
        lr.list_learner_exercise_book_assignments: ("_require_auth", 'user["id"]'),
        lr.start_listening_test_attempt: ("_require_auth", 'user["id"]'),
        lr.patch_listening_test_attempt_answer: ("_require_auth", 'user["id"]'),
        lr.submit_listening_test_attempt: ("_require_auth", 'user["id"]'),
    }
    for fn, (guard, identity) in routes.items():
        source = inspect.getsource(inspect.unwrap(fn))
        assert f"await {guard}(authorization)" in source and identity in source
        assert "actor_id" not in inspect.signature(fn).parameters
        assert "user_id" not in inspect.signature(fn).parameters
    for model in (dto.BlackEyeAssignmentCreate, dto.BlackEyeAssignmentClose, dto.ExerciseBookGrantCreate, dto.BlackEyeSubmitRequest):
        assert not {"actor_id", "user_id", "p_actor_id", "p_user_id", "step_up_at", "auth_session_id"}.intersection(model.model_fields)
        assert model.model_config["extra"] == "forbid"


def test_learner_list_readiness_is_batched_and_no_private_binding(book):
    stamp = book.db.receipt["due_at"]
    locked = paper(activity="U1-A08", readiness="locked")
    book.db.rows["listening_tests"].append(locked)
    book.db.learner_rows = [dict(assignment_id=A, cohort_id=C, title="Synthetic", due_at=stamp, status="published",
        activities=[dict(activity_id=p["metadata"]["blackeye"]["binding"]["activity_id"], title="Synthetic", position=index,
            test_id=p["id"], item_id=I, my_status="not_started", latest_attempt_id=None)
            for index, p in enumerate((book.p, locked), 1)])]
    r = book.client.get(BASE + "/exercise-book-assignments?limit=200&actor_id=" + G)
    assert r.status_code == 200, r.text
    assert [a["readiness"] for a in r.json()["items"][0]["activities"]] == ["ready", "locked"]
    assert r.json()["items"][0]["activities"][1]["readiness_reasons"] == ["audio_incomplete_download"]
    assert len(book.db.calls) == 2
    assert book.db.rpcs[0][1]["p_user_id"] == book.actor["id"]
    leak_free(book, r)
    book.db.learner_rows = []
    r = book.client.get(BASE + "/exercise-book-assignments")
    assert r.status_code == 200 and r.json() == {"items": [], "next_cursor": None}


def test_grant_log_keyset_and_exact_shape(book):
    book.db.grant_events = [dict(event_id=str(UUID(int=n)), seq=n, actor_id=book.actor["id"], grantee_id=G,
        role="assigner", action="grant", occurred_at=now(), reason="Mục đích giả", request_id=str(UUID(int=n+1000))) for n in range(105, 0, -1)]
    first = book.client.get(ADMIN + "/exercise-book-grants/log?limit=100")
    assert first.status_code == 200, first.text
    assert len(first.json()["items"]) == 100 and first.json()["next_cursor"]
    again = book.client.get(ADMIN + "/exercise-book-grants/log", params={"limit": 100, "cursor": first.json()["next_cursor"]})
    assert again.status_code == 200 and len(again.json()["items"]) == 5
    assert again.json()["next_cursor"] is None
    assert all(p["p_actor_id"] == book.actor["id"] and p["p_step_up_at"] for _, p in book.db.rpcs)


def test_multi_activity_receipt_never_uses_parent_artifact_or_one_test(book):
    p2 = paper(activity="U1-A02")
    b2 = deepcopy(p2["metadata"]["blackeye"]["binding"])
    item2, student2 = str(UUID(int=101)), str(UUID(int=102))
    book.db.rows["class_assignment_items"].append(dict(id=item2, assignment_id=A, student_id=student2))
    first_child = book.db.rows["class_assignment_activities"][0]
    book.db.rows["class_assignment_activities"] = [
        first_child, dict(id=str(UUID(int=103)), class_assignment_item_id=I, test_id=p2["id"], position=2, binding=b2),
        dict(first_child, id=str(UUID(int=104)), class_assignment_item_id=item2),
        dict(id=str(UUID(int=105)), class_assignment_item_id=item2, test_id=p2["id"], position=2, binding=b2),
    ]
    r = book.client.get(ADMIN + f"/listening-source-assignments/{A}")
    assert r.status_code == 200, r.text
    assert len(r.json()["activities"]) == r.json()["completion_denominator"] == 2
    assert set(r.json()["recipient_ids"]) == {S, student2}
    assert len(book.db.calls) == 3  # assignment, recipients, batched children
    book.db.rows["class_assignment_activities"][-1]["binding"] = deepcopy(first_child["binding"])
    r = book.client.get(ADMIN + f"/listening-source-assignments/{A}")
    assert r.status_code == 503


@pytest.mark.parametrize("error", ["not_found", "past_due", "activity_locked", "stale_revision"])
@pytest.mark.parametrize("operation", ["start", "save", "submit"])
def test_assigned_mutation_rpc_denials_preserve_state(book, error, operation):
    state = start_assigned(book) if operation != "start" else None
    before = deepcopy(book.db.rows)
    book.db.errors = [DBError({"not_found": "EB404", "past_due": "EB422", "activity_locked": "EB422", "stale_revision": "EB409"}[error], error)]
    if operation == "start":
        r = book.client.post(f'{BASE}/tests/{book.p["id"]}/attempts?class_item={I}', json={"blackeye_binding": visible(book.p)})
    elif operation == "save":
        r = book.client.patch(f'{BASE}/tests/attempts/{state["attempt_id"]}/answers', json={"q_num": 1, "user_answer": "", "client_seq": 1})
    else:
        r = book.client.post(f'{BASE}/tests/attempts/{state["attempt_id"]}/submit', json={"expected_answers": [], "confirm_blank": True})
    assert r.status_code == {"not_found": 404, "past_due": 422, "activity_locked": 422, "stale_revision": 409}[error]
    assert r.json()["code"] == error
    assert book.db.rows == before


@pytest.mark.parametrize("body_field", ["actor_id", "user_id", "step_up_at", "auth_session_id"])
def test_grant_body_cannot_spoof_actor_or_step_up(book, body_field):
    body = dict(grantee_id=G, role="assigner", action="grant", reason="Mục đích giả", request_id=A)
    body[body_field] = G
    r = book.client.post(ADMIN + "/exercise-book-grants", json=body)
    assert r.status_code == 422 and not book.db.rpcs


def test_grant_self_assignment_is_denied_by_canonical_rpc(book):
    book.db.errors = [DBError("EB422", "self_grant")]
    r = book.client.post(ADMIN + "/exercise-book-grants", json=dict(grantee_id=book.actor["id"],
        role="assigner", action="grant", reason="Mục đích giả", request_id=A))
    assert r.status_code == 422 and r.json()["code"] == "validation"
    assert not book.db.mutations


def test_binding_child_owner_mismatch_denies_before_marking(book):
    state = start_assigned(book)
    child = book.db.rows["class_assignment_activities"][0]
    child["binding"]["answer_set_revision"] = G
    r = book.client.get(f'{BASE}/tests/attempts/{state["attempt_id"]}')
    assert r.status_code == 409 and r.json()["code"] == "stale_revision"
    assert not any("marking_rows" in cols for _, cols, _ in book.db.calls)


def test_grant_rpc_identities_ignore_query_and_path_aliases(book):
    body = dict(grantee_id=G, role="teacher", action="grant", reason="Mục đích giả", request_id=A)
    r = book.client.post(ADMIN + "/exercise-book-grants?actor_id=" + G + "&user_id=" + G, json=body)
    assert r.status_code == 201
    assert book.db.rpcs[-1][1]["p_actor_id"] == book.actor["id"]
    assert book.db.rpcs[-1][1]["p_actor_id"] != C


@pytest.mark.parametrize("activity", ["U1-A08", "U1-A14", "U1-A19"])
def test_locked_creation_has_contract_error_and_no_rpc(book, activity):
    body = create_body(book)
    body["activities"][0]["activity_id"] = activity
    r = book.client.post(ADMIN + "/listening-source-assignments", json=body)
    assert r.status_code == 422 and r.json()["code"] == "activity_locked"
    assert not book.db.rpcs


@pytest.mark.parametrize("answers", [
    [{"q_num": 49, "source_item_id": "wrong", "user_answer": ""}],
    [{"q_num": 1, "source_item_id": "wrong", "user_answer": ""}],
    [{"q_num": 1, "source_item_id": "fixture-cell-1", "user_answer": "x" * 4001}],
    [{"q_num": 1, "source_item_id": "fixture-cell-1", "user_answer": ""}] * 2,
])
def test_submit_malformed_client_answers_are_validation_not_infrastructure(book, answers):
    state = start_assigned(book)
    book.db.rpcs.clear()
    r = book.client.post(f'{BASE}/tests/attempts/{state["attempt_id"]}/submit', json={"expected_answers": answers, "confirm_blank": True})
    assert r.status_code == 422 and r.json()["code"] == "validation", r.text
    assert not book.db.rpcs


def test_review_audio_comes_from_the_authorized_snapshot(book):
    state = start_assigned(book)
    aid = state["attempt_id"]
    snap = book.db.rows["mock_paper_attempt_snapshots"][0]
    snap["paper_row"]["assembled_audio_storage_path"] = "SYNTHETIC_FROZEN_AUDIO"
    r = book.client.post(f"{BASE}/tests/attempts/{aid}/submit", json={"expected_answers": [], "confirm_blank": True})
    assert r.status_code == 200
    r = book.client.get(f"{BASE}/tests/attempts/{aid}/review")
    assert r.status_code == 200 and r.json()["audio"]["expires_in"] == 7200
    assert book.db.signed == [("SYNTHETIC_FROZEN_AUDIO", 7200)]


def test_new_routes_publish_error_and_success_dtos(book):
    schema = book.app.openapi()
    for path, methods in schema["paths"].items():
        if "exercise-book" not in path and "listening-source-" not in path:
            continue
        for operation in methods.values():
            if not isinstance(operation, dict) or "responses" not in operation:
                continue
            assert "ExerciseBookError" in json.dumps(operation["responses"]["422"])
            assert any("content" in value for status, value in operation["responses"].items() if status in {"200", "201"})
