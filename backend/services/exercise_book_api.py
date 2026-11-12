"""Exercise-book HTTP adapter for FD's D↔E contract §8 (v1.3.2).

All RPC identities are supplied by authenticated route handlers. No generic
assignment writers, client-supplied actors, or private payload logging.
"""
from __future__ import annotations

import base64
import json
import logging
import re
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from pydantic import ValidationError

from models import listening_blackeye as dto

logger = logging.getLogger(__name__)
PRIVATE = {"Cache-Control": "private, no-store"}
MESSAGES = {
    401: "Vui lòng đăng nhập.", 403: "Bạn chưa được cấp quyền truy cập.",
    404: "Không tìm thấy tài nguyên.", 409: "Dữ liệu đã thay đổi. Vui lòng tải lại.",
    422: "Yêu cầu không hợp lệ.", 503: "Dịch vụ tạm thời chưa sẵn sàng.",
}
ERRORS = {
    "EB403": {x: (403, x) for x in ("not_granted", "not_owner", "step_up_required")},
    "EB404": {"not_found": (404, "not_found")},
    "EB409": {x: (409, x) for x in ("stale_revision", "idempotency_conflict", "attempt_changed", "already_archived", "grant_state_unchanged")},
    "EB422": {x: (422, "validation" if x == "self_grant" else x) for x in ("activity_locked", "validation", "past_due", "self_grant")},
}
RETRY_STATES = {"40P01", "40001", "55P03"}
RPC_NAMES = frozenset({
    "fn_record_cohort_grant", "fn_list_cohort_grants", "fn_read_cohort_grant_log",
    "fn_exercise_book_actor_access", "fn_create_exercise_book_assignment",
    "fn_close_exercise_book_assignment", "fn_list_exercise_book_assignments",
    "fn_read_exercise_book_progress", "fn_list_learner_exercise_book_assignments",
    "fn_acquire_exercise_book_assigned_attempt", "fn_save_exercise_book_answer",
    "fn_submit_exercise_book_assigned_attempt",
})


def fail(status=503, code="unavailable"):
    raise HTTPException(status, {"detail": MESSAGES[status], "code": code}, headers=PRIVATE)


def rpc(db, name, params):
    if name not in RPC_NAMES:
        raise ValueError("Unregistered exercise-book RPC")
    for attempt in range(2):
        try:
            return db.rpc(name, params).execute().data
        except Exception as exc:
            # Do not stringify exceptions: DB clients may include all parameters.
            state = getattr(exc, "code", None)
            message = getattr(exc, "message", None)
            if state in RETRY_STATES and attempt == 0:
                continue
            mapped = ERRORS.get(state, {}).get(message)
            if mapped:
                if mapped == (403, "step_up_required"):
                    logger.warning("%s step_up_required reason=db_clock", name)
                fail(*mapped)
            # Only fixed function name and allowlisted SQLSTATE. Never reason,
            # grantee, actor, client text, exception message or traceback.
            safe_state = state if state in RETRY_STATES | {"42501", "42883", "42P01"} else "unknown"
            logger.error("%s SQLSTATE=%s", name, safe_state)
            fail()


def object_result(value):
    if isinstance(value, list) and len(value) == 1:
        value = value[0]
    if not isinstance(value, dict):
        fail()
    return value


def model(model_type, value):
    try:
        return model_type.model_validate(value)
    except (ValidationError, TypeError, ValueError):
        fail()


def checked_uuid(value):
    try:
        return str(UUID(value))
    except (TypeError, ValueError, AttributeError):
        fail(422, "validation")


def access(db, actor_id, cohort_id, *, assigner=False):
    result = object_result(rpc(db, "fn_exercise_book_actor_access", {
        "p_actor_id": actor_id, "p_cohort_id": cohort_id, "p_programme_id": dto.PROGRAMME,
    }))
    roles = result.get("roles")
    if not isinstance(roles, list) or type(result.get("is_owner")) is not bool:
        fail()
    if not ({"assigner"} if assigner else {"assigner", "teacher"}).intersection(roles):
        fail(403, "not_granted")
    return result


def _rows(query):
    try:
        return query.execute().data or []
    except Exception:
        fail()


def _all_rows(db, table, columns, configure):
    rows, offset = [], 0
    while True:
        page = _rows(configure(db.table(table).select(columns)).order("id").range(offset, offset + 999))
        rows.extend(page)
        if len(page) < 1000:
            return rows
        offset += 1000


def require_grant_owner(db, actor_id):
    # require_admin already checked the canonical active admin. Check the
    # global 377 owner before requesting fresh MFA; grant RPCs recheck both.
    rows = _rows(db.table("exercise_book_grant_owners").select("user_id").eq(
        "user_id", actor_id).limit(1))
    if len(rows) != 1:
        fail(403, "not_owner")


def book_parent(row):
    # D1 378 persists this exact marker even with content_id=NULL (§8.4).
    # Do not admit a generic assignment into the private book read paths.
    return (row.get("skill") == "listening"
            and (row.get("content_config") or {}).get("programme_id") == dto.PROGRAMME)


def assignment(db, cohort_id, assignment_id):
    rows = _rows(db.table("class_assignments").select("*").eq("id", assignment_id).eq("cohort_id", cohort_id).limit(1))
    if len(rows) != 1 or not book_parent(rows[0]):
        fail(404, "not_found")
    return rows[0]


def assigned_context(db, user_id, item_id, test_id, *, full_binding=None):
    """Join item→student owner→assignment→child; never trust parent artifact_id.

    Context is derived at read time; the immutable 306 snapshot stays untouched.
    """
    item_id = checked_uuid(item_id)
    items = _rows(db.table("class_assignment_items").select("id,assignment_id,student_id").eq("id", item_id).limit(1))
    if len(items) != 1:
        fail(404, "not_found")
    item = items[0]
    owners = _rows(db.table("students").select("id,user_id").eq("id", item["student_id"]).eq("user_id", user_id).limit(1))
    if len(owners) != 1:
        fail(404, "not_found")
    parents = _rows(db.table("class_assignments").select("*").eq("id", item["assignment_id"]).limit(1))
    if len(parents) != 1 or not book_parent(parents[0]):
        fail(404, "not_found")
    children = _rows(db.table("class_assignment_activities").select("*").eq(
        "assignment_id", item["assignment_id"]).eq("test_id", test_id).limit(2))
    if len(children) != 1:
        fail(404, "not_found")
    child = children[0]
    bound = model(dto.BlackEyeRevisionBinding, child.get("binding"))
    if full_binding is not None and bound != full_binding:
        fail(409, "stale_revision")
    context = dto.BlackEyeContext(kind="assigned", class_assignment_item_id=item_id,
        assignment_id=item["assignment_id"], cohort_id=parents[0]["cohort_id"])
    return context, parents[0], child


def active_assignment(parent):
    if parent.get("status") != "published":
        fail(422, "activity_locked")
    try:
        due = datetime.fromisoformat(parent["due_at"].replace("Z", "+00:00"))
        if due.utcoffset() is None:
            fail()
    except (ValueError, KeyError, TypeError):
        fail()
    if datetime.now(timezone.utc) > due:
        fail(422, "past_due")


def receipt(db, actor_id, cohort_id, assignment_id):
    access(db, actor_id, cohort_id)
    parent = assignment(db, cohort_id, assignment_id)
    items = _all_rows(db, "class_assignment_items", "id,student_id", lambda q: q.eq("assignment_id", assignment_id))
    # 378 stores one activity per assignment, shared by every recipient item.
    children = _all_rows(db, "class_assignment_activities", "*",
                         lambda q: q.eq("assignment_id", assignment_id))
    if not items or not children:
        fail(404, "not_found")
    selected = sorted(children, key=lambda r: r["position"])
    bindings = [model(dto.BlackEyeRevisionBinding, r.get("binding")) for r in selected]
    if ([r["position"] for r in selected] != list(range(1, len(selected) + 1))
            or len({r["test_id"] for r in selected}) != len(selected)
            or len({b.activity_id for b in bindings}) != len(bindings)):
        fail()
    return model(dto.BlackEyeAssignmentReceipt, dict(assignment_id=assignment_id, request_id=assignment_id,
        cohort_id=cohort_id, activities=bindings, recipient_ids=sorted(i["student_id"] for i in items),
        due_at=parent.get("due_at"), deadline_timezone="Asia/Ho_Chi_Minh", replay_policy="allowed",
        completion_denominator=len(bindings), status=parent.get("status"), created_at=parent.get("created_at")))


def create(db, actor_id, cohort_id, body):
    value = object_result(rpc(db, "fn_create_exercise_book_assignment", {
        "p_actor_id": actor_id, "p_request_id": body.request_id, "p_cohort_id": cohort_id,
        "p_programme_id": dto.PROGRAMME, "p_activities": [a.model_dump() for a in body.activities],
        "p_recipient_ids": body.recipient_ids, "p_due_at": body.due_at,
        "p_deadline_timezone": body.deadline_timezone, "p_replay_policy": body.replay_policy, "p_title": None,
    }))
    replayed = value.pop("replayed", None)
    if type(replayed) is not bool:
        fail()
    result = model(dto.BlackEyeAssignmentReceipt, value)
    if result.assignment_id != body.request_id or result.cohort_id != cohort_id:
        fail()
    return result, 200 if replayed else 201


def close(db, actor_id, cohort_id, assignment_id, body):
    value = rpc(db, "fn_close_exercise_book_assignment", {
        "p_actor_id": actor_id, "p_cohort_id": cohort_id,
        "p_assignment_id": assignment_id, "p_reason": body.reason,
    })
    result = model(dto.BlackEyeAssignmentReceipt, object_result(value))
    if result.assignment_id != assignment_id or result.cohort_id != cohort_id or result.status != "archived":
        fail()
    return result


def progress(db, actor_id, cohort_id, assignment_id):
    result = object_result(rpc(db, "fn_read_exercise_book_progress", {
        "p_actor_id": actor_id, "p_cohort_id": cohort_id, "p_assignment_id": assignment_id,
    }))
    result = model(dto.BlackEyeAssignmentProgress, {**result, "dictation": {
        "available": False, "reason": "separate_release_required"}})
    if result.assignment_id != assignment_id or result.cohort_id != cohort_id:
        fail()
    return result


def encode_cursor(kind, values):
    return base64.urlsafe_b64encode(json.dumps([kind, values], separators=(",", ":")).encode()).decode().rstrip("=")


def decode_cursor(cursor, kind):
    if cursor is None:
        return None
    try:
        if len(cursor) > 1024:
            raise ValueError()
        tag, values = json.loads(base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True))
        if tag != kind or not isinstance(values, list):
            raise ValueError()
        if kind == "grant-log":
            if len(values) != 1 or type(values[0]) is not int or values[0] < 1:
                raise ValueError()
        else:
            if len(values) != 2 or not all(isinstance(value, str) for value in values):
                raise ValueError()
            if datetime.fromisoformat(values[0].replace("Z", "+00:00")).utcoffset() is None:
                raise ValueError()
            UUID(values[1])
        return values
    except (ValueError, TypeError, KeyError, IndexError, UnicodeError):
        fail(422, "validation")


def page(db, name, params, limit, cursor, *, kind, time_field=None, before_field=None, json_items=False):
    if type(limit) is not int or not 1 <= limit <= 200:
        fail(422, "validation")
    before = decode_cursor(cursor, kind)
    rows = []
    # HTTP permits 200, SQL permits 100. Fetch through the same keyset in
    # chunks, including one lookahead row, without exceeding either contract.
    while len(rows) <= limit:
        size = min(100, limit + 1 - len(rows))
        values = {**params, "p_limit": size}
        if kind == "grant-log":
            values["p_before_seq"] = before[0] if before else None
        else:
            values[before_field] = before[0] if before else None
            values["p_before_id"] = before[1] if before else None
        result = rpc(db, name, values)
        batch = object_result(result).get("items") if json_items else result
        if not isinstance(batch, list) or len(batch) > size:
            fail()
        rows.extend(batch)
        if len(batch) < size:
            break
        last = batch[-1]
        next_before = [last["seq"]] if kind == "grant-log" else [last[time_field], last["assignment_id"]]
        if next_before == before:
            fail()
        before = next_before
    more = len(rows) > limit
    rows = rows[:limit]
    last = rows[-1] if rows else None
    values = ([last["seq"]] if kind == "grant-log" else [last[time_field], last["assignment_id"]]) if last else None
    return rows, encode_cursor(kind, values) if more else None


def list_assignments(db, actor_id, cohort_id, limit, cursor):
    rows, next_cursor = page(db, "fn_list_exercise_book_assignments", {
        "p_actor_id": actor_id, "p_cohort_id": cohort_id, "p_programme_id": dto.PROGRAMME,
    }, limit, cursor, kind="admin-assignments", time_field="created_at", before_field="p_before_created_at")
    return model(dto.BlackEyeAssignmentList, {"items": rows, "next_cursor": next_cursor})


def learner_assignments(db, user_id, limit, cursor):
    from services import listening_blackeye as blackeye
    rows, next_cursor = page(db, "fn_list_learner_exercise_book_assignments", {"p_user_id": user_id},
        limit, cursor, kind="learner-assignments", time_field="due_at", before_field="p_before_due_at", json_items=True)
    ids = {a["test_id"] for row in rows for a in row["activities"] if a.get("test_id")}
    papers = blackeye.published_papers(db, ids=ids, allow_missing=True) if ids else []
    readiness = {}
    for paper in papers:
        activity, _ = blackeye.activity_from_paper(paper)
        readiness[str(paper["id"])] = ("ready" if activity.selectable else "locked", activity.readiness_reasons)
    for row in rows:
        for activity in row["activities"]:
            ready, reasons = readiness.get(activity.get("test_id"), ("locked", ["activity_unavailable"]))
            activity.update(readiness=ready, readiness_reasons=reasons)
    return model(dto.BlackEyeLearnerAssignmentList, {"items": rows, "next_cursor": next_cursor})


def grant_context(actor, authorization):
    from services.staff_guard import _token_claims, _totp_verified_at
    claims = _token_claims(authorization, actor["id"])
    at = _totp_verified_at(claims)
    if at is None:
        fail(403, "step_up_required")
    # §8.15-F1: an optional audit claim must never block the request. Only
    # forward safe values from the already accepted token; never log the claim.
    session_id = claims.get("session_id")
    if not isinstance(session_id, str) or re.fullmatch(r"[A-Za-z0-9._:-]{1,64}", session_id) is None:
        session_id = None
    return datetime.fromtimestamp(at, timezone.utc).isoformat(), session_id


def grants(db, actor_id, cohort_id, step_up_at):
    rows = rpc(db, "fn_list_cohort_grants", {"p_actor_id": actor_id, "p_step_up_at": step_up_at,
        "p_cohort_id": cohort_id, "p_programme_id": dto.PROGRAMME})
    return model(dto.ExerciseBookGrantList, {"cohort_id": cohort_id, "grants": rows})


def record_grant(db, actor_id, cohort_id, step_up_at, session_id, body):
    if session_id is not None and (not isinstance(session_id, str) or re.fullmatch(r"[A-Za-z0-9._:-]{1,64}", session_id) is None):
        fail(422, "validation")
    value = object_result(rpc(db, "fn_record_cohort_grant", {
        "p_actor_id": actor_id, "p_step_up_at": step_up_at, "p_cohort_id": cohort_id,
        "p_programme_id": dto.PROGRAMME, "p_grantee_id": body.grantee_id,
        "p_role": body.role, "p_action": body.action, "p_reason": body.reason,
        "p_request_id": body.request_id, "p_auth_session_id": session_id,
    }))
    replayed = value.pop("replayed", None)
    if type(replayed) is not bool:
        fail()
    return model(dto.ExerciseBookGrantReceipt, value), 200 if replayed else 201


def grant_log(db, actor_id, cohort_id, step_up_at, limit, cursor):
    rows, next_cursor = page(db, "fn_read_cohort_grant_log", {"p_actor_id": actor_id,
        "p_step_up_at": step_up_at, "p_cohort_id": cohort_id, "p_programme_id": dto.PROGRAMME},
        limit, cursor, kind="grant-log")
    return model(dto.ExerciseBookGrantLog, {"items": rows, "next_cursor": next_cursor})
