"""Black Eye boundary; immutable existing snapshot storage, no live-key fallback.

Generic assignment paths remain closed. Assigned exercise-book paths use the
frozen D1 RPC contract and derive context from child rows at read time.
"""
from __future__ import annotations

import json
from typing import NoReturn
from uuid import UUID

from fastapi import HTTPException
from pydantic import ValidationError

from models.listening_blackeye import (
    PROGRAMME, BlackEyeActivityPublic, BlackEyeActivityReview, BlackEyeAttemptState,
    BlackEyeContext, BlackEyeKeepChange, BlackEyeLearnerBinding,
    BlackEyeRevisionBinding, BlackEyeReviewItem, BlackEyePublicItem,
)
from services.active_player_lifecycle import require_resume_active
from services import exercise_book_api as books

UNAVAILABLE = "Black Eye frozen contract unavailable."
ASSIGNMENT_UNAVAILABLE = "Black Eye assignment contract unavailable."
LOCKS = {"U1-A08": "audio_incomplete_download", "U1-A14": "audio_not_found",
         "U1-A19": "original_options_unreviewed"}


def unavailable() -> NoReturn:
    raise HTTPException(503, UNAVAILABLE, headers={"Cache-Control": "private, no-store"})


def assignment_seam():
    """No generic single-test fallback, no catalog/create/receipt in PR1."""
    raise HTTPException(503, ASSIGNMENT_UNAVAILABLE, headers={"Cache-Control": "private, no-store"})


def is_blackeye(test: dict) -> bool:
    # Conflicting namespaces fail in Black Eye validation, never generic fallback.
    if test.get("programme_id") == PROGRAMME:
        return True
    metadata = test.get("metadata") or {}
    if not isinstance(metadata, dict):
        unavailable()
    # Even malformed/conflicting Black Eye metadata must not fall through.
    return "blackeye" in metadata


def test_identity(supabase_admin, test_id: str, *, missing_status: int | None = 503) -> dict:
    """Service-role only: routers pass their database.supabase_admin, never a JWT client.

    Optional identity probes must not replace a generic route's legacy missing-row
    semantics. Authoritative Black Eye reads retain the default fail-closed 503.
    """
    try:
        rows = supabase_admin.table("listening_tests").select(
            "id,programme_id,status,is_public,scoring_policy,content_package_id,metadata"
        ).eq("id", str(test_id)).limit(1).execute().data or []
    except Exception:
        unavailable()
    if not rows and missing_status is None:
        return {}
    if len(rows) != 1:
        raise HTTPException(missing_status or 503, UNAVAILABLE)
    return rows[0]


def attempt_is_blackeye(supabase_admin, attempt: dict) -> bool:
    # Revisionless diagnostic attempts predate Black Eye admission. Do not add
    # catalog IO (or override generic 404/409/422 guards) on this legacy path.
    if attempt.get("paper_revision") is None:
        if attempt.get("scoring_policy") != "report_only":
            return False
        test_id = attempt.get("test_id")
        return bool(test_id) and is_blackeye(test_identity(
            supabase_admin, test_id, missing_status=None))
    # One identity-only snapshot read, no live catalog lookup on frozen generic
    # autosave/submit. Frozen identity survives catalog deletion/outage. Only
    # namespace scalars are projected, never the binding or protected material.
    try:
        rows = supabase_admin.table("mock_paper_attempt_snapshots").select(
            "programme_id:paper_row->programme_id,blackeye_identity:paper_row->metadata->blackeye->binding->programme_id"
        ).eq("skill", "listening").eq("attempt_id", str(attempt["id"])).limit(1).execute().data or []
    except Exception:
        unavailable()
    if not rows:
        # Generic guards own missing generic snapshots; check only identity, not
        # content/marking. A missing Black Eye snapshot is rejected by its branch.
        test_id = attempt.get("test_id")
        return bool(test_id) and is_blackeye(test_identity(
            supabase_admin, test_id, missing_status=None))
    if len(rows) != 1:
        unavailable()
    return (rows[0].get("programme_id") == PROGRAMME
            or rows[0].get("blackeye_identity") is not None)


def activity_from_paper(paper: dict) -> tuple[BlackEyeActivityPublic, BlackEyeRevisionBinding]:
    """Positive field construction, not removal of known secret keys."""
    try:
        if paper.get("programme_id") != PROGRAMME or paper.get("scoring_policy") != "report_only":
            raise ValueError("identity")
        raw = paper["metadata"]["blackeye"]
        full = BlackEyeRevisionBinding.model_validate(raw["binding"])
        # Opaque UUID, not digest/HMAC/reference encoding. IDs are author-assigned
        # at import, never computed from answers by this boundary.
        UUID(full.answer_set_revision)
        binding = BlackEyeLearnerBinding.model_validate({
            key: getattr(full, key) for key in BlackEyeLearnerBinding.model_fields
        })
        fields = {key: raw[key] for key in BlackEyeActivityPublic.model_fields
                  if key not in {"binding", "items", "test_id"}}
        item_fields = BlackEyePublicItem.model_fields
        fields["items"] = [{key: item[key] for key in item_fields} for item in raw["items"]]
        activity = BlackEyeActivityPublic(binding=binding, test_id=str(paper["id"]), **fields)
        return activity, full
    except (KeyError, TypeError, ValueError, ValidationError):
        unavailable()


def require_ready(activity: BlackEyeActivityPublic):
    if activity.binding.activity_id in LOCKS or activity.readiness != "ready" or not activity.selectable:
        raise HTTPException(422, "Black Eye activity locked.")


def require_published(db, test: dict):
    if test.get("status") != "published" or test.get("is_public") is not True:
        raise HTTPException(404, "Black Eye activity unavailable.")
    package_id = test.get("content_package_id")
    if not package_id:
        unavailable()
    try:
        rows = db.table("listening_content_packages").select("id,status,programme_id").eq(
            "id", package_id).limit(1).execute().data or []
    except Exception:
        unavailable()
    if (len(rows) != 1 or rows[0].get("status") != "published"
            or rows[0].get("programme_id") != PROGRAMME):
        raise HTTPException(404, "Black Eye activity unavailable.")


def published_papers(db, *, ids=None, allow_missing=False):
    """Two batched reads, never one package lookup per activity."""
    try:
        q = db.table("listening_tests").select("*").eq("programme_id", PROGRAMME).eq(
            "status", "published").eq("is_public", True)
        if ids is not None:
            if not ids:
                return []
            q = q.in_("id", sorted(ids))
        rows = q.execute().data or []
        package_ids = sorted({r["content_package_id"] for r in rows if r.get("content_package_id")})
        packages = db.table("listening_content_packages").select("id,status,programme_id").in_(
            "id", package_ids).execute().data or [] if package_ids else []
        valid = {r["id"] for r in packages if r.get("status") == "published" and r.get("programme_id") == PROGRAMME}
        if not allow_missing and any(r.get("content_package_id") not in valid for r in rows):
            raise HTTPException(404, "Black Eye activity unavailable.")
        return [r for r in rows if r.get("content_package_id") in valid]
    except HTTPException:
        raise
    except Exception:
        unavailable()


def public_inventory(db):
    activities = [activity_from_paper(row)[0] for row in published_papers(db)]
    if not activities or len({a.binding.activity_id for a in activities}) != len(activities):
        unavailable()
    return {"collection_id": "blackeye-v5-upper", "unit_id": "U1",
            "activities": sorted(activities, key=lambda a: a.order)}


def frozen_public(db, attempt: dict):
    try:
        if attempt.get("paper_revision") is None or attempt.get("policy_revision") is None:
            raise ValueError("no revision")
        rows = db.table("mock_paper_attempt_snapshots").select(
            "skill,attempt_id,paper_id,paper_revision,policy_revision,paper_row"
        ).eq("skill", "listening").eq("attempt_id", str(attempt["id"])).limit(1).execute().data or []
        if len(rows) != 1:
            raise ValueError("snapshot")
        snap = rows[0]
        if (snap["skill"] != "listening" or str(snap["attempt_id"]) != str(attempt["id"])
                or str(snap["paper_id"]) != str(attempt["test_id"])
                or snap["paper_revision"] != attempt["paper_revision"]
                or snap["policy_revision"] != attempt["policy_revision"]):
            raise ValueError("binding")
        paper = snap["paper_row"]
        mapping = paper["metadata"]["blackeye_db_revisions"]
        if (mapping != {"paper_revision": attempt["paper_revision"],
                       "policy_revision": attempt["policy_revision"]}
                or paper.get("mock_content_revision") != attempt["paper_revision"]
                or paper.get("policy_revision") != attempt["policy_revision"]):
            raise ValueError("revision map")
        activity, full = activity_from_paper(paper)
        if activity.test_id != str(attempt["test_id"]) or attempt.get("scoring_policy") != "report_only":
            raise ValueError("test")
        require_ready(activity)
        context = BlackEyeContext.model_validate(paper["metadata"]["blackeye_context"])
        if attempt.get("class_assignment_item_id"):
            context, _, _ = books.assigned_context(db, attempt["user_id"],
                attempt["class_assignment_item_id"], attempt["test_id"], full_binding=full)
        if (attempt.get("sitting_id") or context.class_assignment_item_id != attempt.get("class_assignment_item_id")
                or attempt.get("attempt_purpose") != ("practice" if context.kind == "standalone" else "assigned_practice")):
            raise ValueError("context")
        return activity, full, context
    except HTTPException:
        raise
    except Exception:
        unavailable()


def decode_answer(item, value: str) -> bool:
    """Validate without rewriting even one character; return blank-component fact."""
    if not isinstance(value, str):
        raise HTTPException(422, "Invalid Black Eye response.")
    if item.interaction == "text":
        return not value.strip()
    if value == "":
        return True
    try:
        def unique_pairs(pairs):
            result = {}
            for key, val in pairs:
                if key in result:
                    raise ValueError("duplicate key")
                result[key] = val
            return result
        raw = json.loads(value, object_pairs_hook=unique_pairs)
        pair = BlackEyeKeepChange.model_validate(raw)
    except (ValueError, TypeError, ValidationError):
        raise HTTPException(422, "Invalid Black Eye composite response.") from None
    return pair.action is None or (pair.action == "CHANGE" and not pair.correction_text.strip())


def answer_map(activity, answers):
    try:
        cells = {i.q_num: i for i in activity.items}
        result = {}
        for answer in answers:
            q = answer["q_num"]
            if type(q) is not int or q not in cells or q in result:
                raise ValueError("cell")
            if "source_item_id" in answer and answer["source_item_id"] != cells[q].source_item_id:
                raise ValueError("source")
            value = answer["user_answer"]
            decode_answer(cells[q], value)
            result[q] = value
        return result
    except HTTPException:
        raise
    except Exception:
        unavailable()


def state(db, attempt):
    activity, _, context = frozen_public(db, attempt)
    if context.kind == "assigned":
        validate_assigned_context(db, attempt, context)
    if attempt.get("status") not in {"in_progress", "submitted"}:
        raise HTTPException(422, "Black Eye attempt inactive.")
    if attempt["status"] == "in_progress":
        require_resume_active(attempt)
    answers = answer_map(activity, attempt.get("answers") or [])
    try:
        summary = attempt.get("result_summary") if attempt["status"] == "submitted" else None
        if attempt["status"] == "submitted" and (not summary or not attempt.get("submitted_at")):
            raise ValueError("missing result")
        if summary is not None and summary != {
            "submitted": True, "item_count": len(activity.items),
            "blank_count": sum(decode_answer(i, answers.get(i.q_num, "")) for i in activity.items),
            "unscored_count": len(activity.items), "objective_denominator": 0,
            "score": None, "band_estimate": None,
        }:
            raise ValueError("frozen report mismatch")
        return BlackEyeAttemptState(
            attempt_id=str(attempt["id"]), test_id=str(attempt["test_id"]), binding=activity.binding,
            context=context, status=attempt["status"], answers=[
                {"q_num": i.q_num, "source_item_id": i.source_item_id, "user_answer": answers[i.q_num]}
                for i in activity.items if i.q_num in answers],
            submitted_at=attempt.get("submitted_at"), result_summary=summary)
    except (ValidationError, ValueError):
        unavailable()


def start(db, test, user_id, binding, *, standalone, class_item, purpose, sitting_id, protocol):
    require_published(db, test)
    if binding is None:
        raise HTTPException(422, "Black Eye binding required.")
    # Resolve client preconditions BEFORE the seam/private snapshot/admission.
    activity, _ = activity_from_paper(test)
    require_ready(activity)
    if class_item:
        class_item = books.checked_uuid(class_item)
        if standalone or sitting_id or purpose not in {None, "assigned_practice"}:
            books.fail(422, "validation")
        result = books.object_result(books.rpc(db, "fn_acquire_exercise_book_assigned_attempt", {
            "p_user_id": user_id, "p_item_id": class_item, "p_test_id": str(test["id"]),
            "p_binding": binding.model_dump(), "p_renderer_affinity_protocol": protocol or "legacy",
        }))
        if result.get("user_id") != user_id or result.get("test_id") != str(test["id"]) or result.get("class_assignment_item_id") != class_item:
            books.fail()
        frozen = state(db, result)
        if frozen.binding != binding or frozen.context.kind != "assigned":
            books.fail()
        return frozen
    if not standalone:
        assignment_seam()
    if sitting_id or purpose not in {None, "practice"}:
        raise HTTPException(422, "Invalid Black Eye context.")
    identity = ("programme_id", "collection_id", "source_contract", "unit_id", "activity_id")
    if any(getattr(binding, key) != getattr(activity.binding, key) for key in identity):
        raise HTTPException(422, "Invalid Black Eye binding.")
    if binding != activity.binding:
        raise HTTPException(409, "Black Eye revision changed.")
    try:
        result = db.rpc("fn_acquire_blackeye_attempt", {
            "p_test_id": str(test["id"]), "p_user_id": str(user_id),
            "p_binding": binding.model_dump(), "p_renderer_affinity_protocol": protocol or "legacy",
        }).execute().data
    except Exception as exc:
        message = str(exc)
        if "blackeye_stale" in message:
            raise HTTPException(409, "Black Eye revision changed.") from None
        if "blackeye_invalid_inactive" in message:
            raise HTTPException(422, "Black Eye attempt inactive.") from None
        if any(code in message for code in ("blackeye_invalid_context", "blackeye_invalid_revision", "blackeye_invalid_cells")):
            unavailable()
        if "blackeye_invalid" in message:
            raise HTTPException(422, "Invalid Black Eye binding.") from None
        if "blackeye_forbidden" in message:
            raise HTTPException(404, "Black Eye activity unavailable.") from None
        unavailable()
    if isinstance(result, list) and len(result) == 1:
        result = result[0]
    if not isinstance(result, dict) or result.get("user_id") != user_id or result.get("test_id") != str(test["id"]):
        unavailable()
    frozen = state(db, result)
    if frozen.binding != binding or frozen.context.kind != "standalone":
        unavailable()
    return frozen


def save(db, attempt, q_num, value, *, client_seq=None, user_id=None):
    activity, _, context = frozen_public(db, attempt)
    if context.kind == "assigned":
        if user_id != attempt.get("user_id"):
            books.fail(404, "not_found")
        cell = next((i for i in activity.items if i.q_num == q_num), None)
        if cell is None or type(q_num) is not int or not isinstance(value, str) or len(value) > 4000 or type(client_seq) is not int or not 1 <= client_seq <= 9223372036854775807:
            books.fail(422, "validation")
        decode_answer(cell, value)
        result = books.object_result(books.rpc(db, "fn_save_exercise_book_answer", {
            "p_user_id": user_id, "p_attempt_id": attempt["id"], "p_q_num": q_num,
            "p_user_answer": value, "p_client_seq": client_seq,
        }))
        if result.get("attempt_id") != attempt["id"] or type(result.get("client_seq")) is not int or type(result.get("applied")) is not bool:
            books.fail()
        return {"attempt_id": result["attempt_id"], "answer_count": result.get("answer_count"),
                "client_seq": result["client_seq"], "performance_event_recorded": False}
    require_published(db, test_identity(db, attempt["test_id"]))
    if attempt.get("status") != "in_progress":
        raise HTTPException(422, "Black Eye attempt inactive.")
    require_resume_active(attempt)
    cell = next((i for i in activity.items if i.q_num == q_num), None)
    if cell is None or type(q_num) is not int:
        raise HTTPException(422, "Invalid Black Eye cell.")
    if len(value) > 2000:
        raise HTTPException(422, "Black Eye response too long.")
    decode_answer(cell, value)
    try:
        count = db.rpc("fn_upsert_listening_answer", {
            "p_attempt_id": str(attempt["id"]), "p_q_num": q_num, "p_user_answer": value,
        }).execute().data
    except Exception:
        unavailable()
    if count is None:
        raise HTTPException(409, "Black Eye attempt changed.")
    if type(count) is not int or not 1 <= count <= len(activity.items):
        unavailable()
    return {"attempt_id": str(attempt["id"]), "answer_count": count, "performance_event_recorded": False}


def submit(db, attempt, user_id, body=None):
    if str(attempt.get("user_id")) != str(user_id):
        raise HTTPException(404, "Attempt not found")
    if attempt.get("class_assignment_item_id"):
        if body is None:
            books.fail(422, "validation")
        activity, _, _ = frozen_public(db, attempt)
        expected = [a.model_dump() for a in body.expected_answers]
        try:
            if any(len(a["user_answer"]) > 4000 for a in expected):
                books.fail(422, "validation")
            answer_map(activity, expected)
        except HTTPException:
            books.fail(422, "validation")
        result = books.object_result(books.rpc(db, "fn_submit_exercise_book_assigned_attempt", {
            "p_user_id": user_id, "p_attempt_id": attempt["id"],
            "p_expected_answers": expected, "p_confirm_blank": body.confirm_blank,
        }))
        if result.get("user_id") != user_id or result.get("id") != attempt["id"] or result.get("status") != "submitted":
            books.fail()
        return state(db, result)
    # Idempotent retry NEVER grades or reads live exercises/catalog.
    if attempt.get("status") == "submitted":
        return state(db, attempt)
    activity, _, context = frozen_public(db, attempt)
    if context.kind == "assigned":
        assignment_seam()
    require_published(db, test_identity(db, attempt["test_id"]))
    if attempt.get("status") != "in_progress":
        raise HTTPException(422, "Black Eye attempt inactive.")
    require_resume_active(attempt)
    answers = answer_map(activity, attempt.get("answers") or [])
    summary = {"submitted": True, "item_count": len(activity.items),
               "blank_count": sum(decode_answer(i, answers.get(i.q_num, "")) for i in activity.items),
               "unscored_count": len(activity.items), "objective_denominator": 0,
               "score": None, "band_estimate": None}
    try:
        db.rpc("fn_submit_blackeye_attempt", {
            "p_attempt_id": str(attempt["id"]), "p_user_id": str(user_id),
            "p_expected_answers": attempt.get("answers") or [], "p_result_summary": summary,
        }).execute()
        # Canonical readback also handles a concurrent identical submit/lost ACK.
        fresh = db.table("listening_test_attempts").select("*").eq("id", attempt["id"]).eq(
            "user_id", user_id).limit(1).execute().data or []
    except Exception as exc:
        if "blackeye_changed" in str(exc):
            raise HTTPException(409, "Black Eye attempt changed.") from None
        unavailable()
    if len(fresh) != 1:
        unavailable()
    if fresh[0].get("status") != "submitted":
        raise HTTPException(409, "Black Eye attempt changed.")
    return state(db, fresh[0])


def review(db, attempt):
    # Caller must prove owner OR exact assignment-creator capability before this.
    if attempt.get("status") != "submitted":
        raise HTTPException(409, "Black Eye review requires submission.")
    require_published(db, test_identity(db, attempt["test_id"]))
    activity, full, context = frozen_public(db, attempt)
    if context.kind == "assigned":
        validate_assigned_context(db, attempt, context)
    attempt_state = state(db, attempt)
    try:
        rows = db.table("mock_paper_attempt_snapshots").select("marking_rows,paper_row").eq(
            "skill", "listening").eq("attempt_id", str(attempt["id"])).eq(
            "paper_id", str(attempt["test_id"])).eq("paper_revision", attempt["paper_revision"]).eq(
            "policy_revision", attempt["policy_revision"]).limit(1).execute().data or []
        if len(rows) != 1 or len(rows[0]["marking_rows"]) != 1:
            raise ValueError("private snapshot")
        material = rows[0]["marking_rows"][0]["payload"]["blackeye_review"]
        if material["binding"] != full.model_dump():
            raise ValueError("private binding")
        answers = answer_map(activity, attempt.get("answers") or [])
        records = material["items"]
        if [(r["q_num"], r["source_item_id"]) for r in records] != [(i.q_num, i.source_item_id) for i in activity.items]:
            raise ValueError("review cell map")
        projected = []
        for cell, record in zip(activity.items, records, strict=True):
            values = {k: record[k] for k in BlackEyeReviewItem.model_fields
                      if k not in {"saved_response", "blank"}}
            value = answers.get(cell.q_num, "")
            projected.append(BlackEyeReviewItem(**values, saved_response=value, blank=decode_answer(cell, value)))
        # Whole-activity only. No asset signer or arbitrary raw source bundle.
        transcript = [{"text": t["text"], "start": None, "end": None} for t in material["transcript"]]
        return BlackEyeActivityReview(attempt=attempt_state, items=projected, transcript=transcript,
            audio=signed_audio(db, rows[0]["paper_row"]))
    except HTTPException:
        raise
    except Exception:
        unavailable()


def validate_assigned_context(db, attempt, context, *, actor_id=None):
    actual, _, _ = books.assigned_context(db, attempt["user_id"],
        context.class_assignment_item_id, attempt["test_id"])
    if context != actual or attempt.get("class_assignment_item_id") != actual.class_assignment_item_id:
        books.fail(404, "not_found")
    if actor_id is not None:
        books.access(db, actor_id, actual.cohort_id)


def teacher_review(db, actor_id, cohort_id, assignment_id, item_id, activity_id):
    books.access(db, actor_id, cohort_id)
    books.assignment(db, cohort_id, assignment_id)
    items = books._rows(db.table("class_assignment_items").select("id,student_id").eq(
        "id", item_id).eq("assignment_id", assignment_id).limit(1))
    if len(items) != 1:
        books.fail(404, "not_found")
    children = books._rows(db.table("class_assignment_activities").select("*").eq(
        "class_assignment_item_id", item_id))
    children = [r for r in children if books.model(BlackEyeRevisionBinding, r.get("binding")).activity_id == activity_id]
    if len(children) != 1:
        books.fail(404, "not_found")
    owners = books._rows(db.table("students").select("id,user_id").eq("id", items[0]["student_id"]).limit(1))
    if len(owners) != 1 or not owners[0].get("user_id"):
        books.fail(404, "not_found")
    attempts = books._rows(db.table("listening_test_attempts").select("*").eq(
        "class_assignment_item_id", item_id).eq("test_id", children[0]["test_id"]).eq(
        "user_id", owners[0]["user_id"]).eq("status", "submitted").order("created_at", desc=True).limit(1))
    if len(attempts) != 1:
        books.fail(409, "attempt_changed")
    attempt = attempts[0]
    _, full, context = frozen_public(db, attempt)
    if context.assignment_id != assignment_id or context.cohort_id != cohort_id or full != books.model(BlackEyeRevisionBinding, children[0]["binding"]):
        books.fail(404, "not_found")
    return review(db, attempt)


# Identity-only exclusion runs before generic reads/counts/joins or mutations.
# Never fetch learner rows/snapshots to decide who may see Black Eye data.
def hidden_test_ids(db):
    ids, offset = [], 0
    try:
        while True:
            rows = db.table("listening_tests").select("id,programme_id,metadata").or_(
                f"programme_id.eq.{PROGRAMME},metadata->blackeye.not.is.null"
            ).order("id").range(offset, offset + 999).execute().data or []
            ids.extend(str(r["id"]) for r in rows if is_blackeye(r))
            if len(rows) < 1000:
                return ids
            offset += 1000
    except Exception:
        unavailable()


def exclude_tests(db, query, *, key="test_id"):
    ids = hidden_test_ids(db)
    for offset in range(0, len(ids), 100):
        query = query.or_(f"{key}.is.null,{key}.not.in.({','.join(ids[offset:offset + 100])})")
    return query


def assignment_is_blackeye(db, assignment):
    config = assignment.get("content_config") or {}
    if config.get("programme_id") == PROGRAMME or "blackeye" in config:
        return True
    return (assignment.get("skill") == "listening" and assignment.get("content_id")
            and is_blackeye(test_identity(db, assignment["content_id"], missing_status=None)))


def generic_assignments(db, rows):
    candidates = [r for r in rows if r.get("skill") == "listening" and r.get("content_id")]
    hidden = set(hidden_test_ids(db)) if candidates else set()
    return [r for r in rows if str(r.get("content_id")) not in hidden
            and (r.get("content_config") or {}).get("programme_id") != PROGRAMME
            and "blackeye" not in (r.get("content_config") or {})]


def guard_generic_assignment(db, assignment_id, cohort_id=None):
    try:
        q = db.table("class_assignments").select("id,cohort_id,skill,content_id,content_config").eq("id", assignment_id)
        if cohort_id is not None:
            q = q.eq("cohort_id", cohort_id)
        rows = q.limit(1).execute().data or []
        if rows and assignment_is_blackeye(db, rows[0]):
            assignment_seam()
    except HTTPException:
        raise
    except Exception:
        unavailable()


def guard_generic_target(db, *, test_id=None, content_id=None, exercise_id=None, attempt_id=None, package_id=None, denied_status=404, external_test_code=False):
    try:
        if package_id:
            rows = db.table("listening_content_packages").select("id,programme_id").eq("package_id", package_id).limit(1).execute().data or []
            if rows and rows[0].get("programme_id") == PROGRAMME:
                assignment_seam()
        if attempt_id:
            rows = db.table("listening_test_attempts").select("id,test_id").eq("id", attempt_id).limit(1).execute().data or []
            test_id = rows[0].get("test_id") if rows else None
        if exercise_id:
            rows = db.table("listening_exercises").select("id,content_id").eq("id", exercise_id).limit(1).execute().data or []
            if rows and rows[0].get("content_id"):
                guard_generic_target(db, content_id=rows[0]["content_id"], denied_status=denied_status)
        if content_id:
            rows = db.table("listening_content").select("id,test_id").eq("id", content_id).limit(1).execute().data or []
            test_id = rows[0].get("test_id") if rows else None
        if test_id and external_test_code:
            try:
                UUID(str(test_id))
            except ValueError:
                # Dictation reports filter by the external listening_tests.test_id,
                # while the identity guard requires the UUID primary key.
                rows = db.table("listening_tests").select("id").eq("test_id", test_id).limit(1).execute().data or []
                test_id = rows[0]["id"] if rows else None
        if test_id and is_blackeye(test_identity(db, test_id, missing_status=None)):
            raise HTTPException(denied_status, "Black Eye resource unavailable.")
    except HTTPException:
        raise
    except Exception:
        unavailable()


def hidden_assignment_ids(db, *, cohort_id=None):
    ids, offset = [], 0
    hidden = set(hidden_test_ids(db))
    try:
        while True:
            query = db.table("class_assignments").select("id,skill,content_id,content_config").eq(
                "skill", "listening")
            if cohort_id is not None:
                query = query.eq("cohort_id", cohort_id)
            rows = query.order("id").range(offset, offset + 999).execute().data or []
            ids.extend(str(r["id"]) for r in rows if str(r.get("content_id")) in hidden
                       or (r.get("content_config") or {}).get("programme_id") == PROGRAMME
                       or "blackeye" in (r.get("content_config") or {}))
            if len(rows) < 1000:
                return ids
            offset += 1000
    except Exception:
        unavailable()


def exclude_assignments(db, query, *, key="id", cohort_id=None):
    ids = hidden_assignment_ids(db, cohort_id=cohort_id)
    for offset in range(0, len(ids), 100):
        query = query.or_(f"{key}.is.null,{key}.not.in.({','.join(ids[offset:offset + 100])})")
    return query


def player(db, test, user_id, *, attempt_id=None, class_item=None, sitting_id=None):
    """Positive Black Eye DTO. Authorize owner before snapshot access or signing."""
    from models.listening_blackeye import BlackEyePlayer
    require_published(db, test)
    if sitting_id:
        raise HTTPException(422, 'Invalid Black Eye context.')
    attempt = None
    if attempt_id:
        try:
            rows = db.table('listening_test_attempts').select('*').eq('id', str(attempt_id)).eq(
                'user_id', user_id).eq('test_id', str(test['id'])).limit(1).execute().data or []
        except Exception:
            unavailable()
        if len(rows) != 1:
            raise HTTPException(404, 'Black Eye attempt unavailable.')
        attempt = rows[0]
        if attempt.get('class_assignment_item_id') != class_item:
            raise HTTPException(404, 'Black Eye attempt unavailable.')
        attempt_state = state(db, attempt)
        activity, _, _ = frozen_public(db, attempt)
        # Audio paths come from the same immutable snapshot as the cells.
        try:
            rows = db.table('mock_paper_attempt_snapshots').select('paper_row').eq(
                'skill', 'listening').eq('attempt_id', str(attempt_id)).limit(1).execute().data or []
            if len(rows) != 1:
                unavailable()
            paper = rows[0]['paper_row']
        except Exception:
            unavailable()
    else:
        if class_item:
            _, parent, _ = books.assigned_context(db, user_id, class_item, str(test["id"]))
            books.active_assignment(parent)
        activity, _ = activity_from_paper(test)
        attempt_state, paper = None, test
    # Before admission this is only a public preview; no audio capability.
    audio = signed_audio(db, paper) if attempt is not None else {"url": None, "granularity": "whole_activity", "expires_in": None}
    return BlackEyePlayer(activity=activity, attempt=attempt_state, replay_policy="allowed", audio=audio)


def signed_audio(db, paper):
    """Only call after owner/cohort authorization and frozen-paper validation."""
    path = paper.get("assembled_audio_storage_path") or paper.get("full_audio_storage_path")
    url = None
    if path:
        from config import settings
        try:
            signed = db.storage.from_(settings.LISTENING_AUDIO_BUCKET).create_signed_url(path, 7200)
            url = (signed or {}).get("signedURL") or (signed or {}).get("signed_url")
            if not isinstance(url, str) or not url:
                unavailable()
        except Exception:
            unavailable()
    return {"url": url, "granularity": "whole_activity", "expires_in": 7200 if url else None}


def playback_started(db, attempt):
    from datetime import datetime, timezone
    from models.listening_blackeye import BlackEyePlaybackAck
    state(db, attempt)
    if attempt.get("class_assignment_item_id"):
        _, parent, _ = books.assigned_context(db, attempt["user_id"], attempt["class_assignment_item_id"], attempt["test_id"])
        books.active_assignment(parent)
    if attempt.get('status') != 'in_progress':
        raise HTTPException(422, 'Black Eye attempt inactive.')
    require_published(db, test_identity(db, attempt['test_id']))
    timestamp = attempt.get('playback_started_at')
    try:
        if not timestamp:
            timestamp = datetime.now(timezone.utc).isoformat()
            db.table('listening_test_attempts').update({'playback_started_at': timestamp}).eq(
                'id', attempt['id']).eq('user_id', attempt['user_id']).eq('status', 'in_progress').is_(
                'playback_started_at', 'null').execute()
        rows = db.table('listening_test_attempts').select('playback_started_at,status').eq(
            'id', attempt['id']).eq('user_id', attempt['user_id']).limit(1).execute().data or []
        if len(rows) != 1 or rows[0].get('status') != 'in_progress' or not rows[0].get('playback_started_at'):
            raise HTTPException(409, 'Black Eye attempt changed.')
        return BlackEyePlaybackAck(attempt_id=str(attempt['id']), accepted=True,
            replay_policy='allowed', playback_started_at=rows[0]['playback_started_at'])
    except HTTPException:
        raise
    except Exception:
        unavailable()


def admin_catalog(db, actor_id, cohort_id):
    from models.listening_blackeye import BlackEyeActivityAdmin, BlackEyeSourceCatalog
    books.access(db, actor_id, cohort_id, assigner=True)
    activities = []
    for row in published_papers(db):
        activity, full = activity_from_paper(row)
        activities.append(BlackEyeActivityAdmin.model_validate({**activity.model_dump(), "binding": full.model_dump()}))
    if not activities or len({a.binding.activity_id for a in activities}) != len(activities):
        unavailable()
    errors, recipients = [], []
    try:
        from services.class_membership_service import active_students_for_cohort
        students = active_students_for_cohort(db, cohort_id, "id,user_id,full_name,is_active,archived_at")
        recipients = [{"student_id": str(s["id"]), "display_name": s.get("full_name") or "Học viên"}
            for s in students if s.get("user_id") and s.get("is_active") is True and not s.get("archived_at")]
    except Exception:
        errors = ["recipient_lookup_failed"]
    return BlackEyeSourceCatalog(inventory={"collection_id": "blackeye-v5-upper", "unit_id": "U1",
        "activities": sorted(activities, key=lambda a: a.order)}, eligible_recipients=recipients, lookup_errors=errors)
