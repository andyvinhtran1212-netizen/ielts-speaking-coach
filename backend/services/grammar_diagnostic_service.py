"""Rules-based MASTER30 objective diagnostic.

This service intentionally reports auditable evidence states. It does not
estimate an IELTS band or a psychometric mastery probability.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Optional

from fastapi import HTTPException

from database import supabase_admin
from services.class_assignment_service import is_accepting_submissions, is_assignment_open
from services.class_membership_service import student_is_active_in_cohort
from services import runtime_flags


ATTRIBUTES = [f"M{number:02d}" for number in range(1, 15)]
PROCESS_LABELS = {
    "P1": "phân tích cấu trúc",
    "P2": "chọn và phối hợp hình thức",
    "P3": "đọc nghĩa và ngữ cảnh",
    "P4": "phát hiện và giải thích lỗi",
    "P5": "tự tạo và biên tập câu",
}
PREREQUISITES = {
    "M02": ["M01"], "M03": ["M02"], "M04": ["M01"], "M05": ["M01"],
    "M06": ["M01"], "M07": ["M06"], "M08": ["M02", "M06"],
    "M09": ["M01", "M06", "M08"], "M10": ["M06", "M07"],
    "M11": ["M05", "M06"], "M12": ["M01"],
    "M13": ["M03", "M05", "M07", "M11", "M12"],
    "M14": ["M03", "M04", "M12", "M13"],
}
LIMITS = {"QUICK": (18, 28), "FULL": (34, 54)}
MAX_PER_ATTRIBUTE = 6
ENTRY_EXCLUDED_LEVELS = {"ENTRY_EXCLUDE", "REQUIRED", "REMEDIATION_ONLY_LANGUAGE"}
APPROVED_MANIFEST_SHA256 = "86a55dc1c3a8e5221eef9daa4772404f358ebb8f87c1284224e5197f58dbe531"

_content_cache: dict[str, Any] = {}


def clear_content_cache() -> None:
    _content_cache.clear()


def _active_release() -> dict[str, Any]:
    rows = (
        supabase_admin.table("grammar_content_releases")
        .select("id, release_key, manifest_sha256, validation, live_calibrated_ready")
        .eq("status", "active").limit(1).execute().data
    ) or []
    if not rows:
        raise HTTPException(503, detail={
            "error_code": "grammar_content_unavailable",
            "message": "Nội dung Grammar Check-up chưa sẵn sàng.",
        })
    release = rows[0]
    if (release.get("manifest_sha256") != APPROVED_MANIFEST_SHA256
            or not bool((release.get("validation") or {}).get("passed"))):
        raise HTTPException(503, detail={
            "error_code": "grammar_content_unvalidated",
            "message": "Nội dung Grammar Check-up đang được kiểm tra.",
        })
    return release


def _release_by_id(release_id: str) -> dict[str, Any]:
    rows = (
        supabase_admin.table("grammar_content_releases")
        .select("id, release_key, manifest_sha256, validation, live_calibrated_ready, status")
        .eq("id", release_id).in_("status", ["active", "retired"]).limit(1).execute().data
    ) or []
    if (not rows
            or rows[0].get("manifest_sha256") != APPROVED_MANIFEST_SHA256
            or not bool((rows[0].get("validation") or {}).get("passed"))):
        raise HTTPException(409, "Release Grammar của bài được giao không còn khả dụng")
    return rows[0]


def _content(release: dict[str, Any]) -> dict[str, Any]:
    release_id = str(release["id"])
    if _content_cache.get("release_id") == release_id:
        return _content_cache
    items = (
        supabase_admin.table("grammar_items").select("*")
        .eq("release_id", release_id).range(0, 999).execute().data
    ) or []
    routes = (
        supabase_admin.table("grammar_remediation_routes").select("route_id, attribute_id, route")
        .eq("release_id", release_id).execute().data
    ) or []
    misconceptions = (
        supabase_admin.table("grammar_misconceptions").select("attribute_id, learner_copy")
        .eq("release_id", release_id).execute().data
    ) or []
    if len(items) != 733:
        raise HTTPException(503, detail={
            "error_code": "grammar_content_incomplete",
            "message": "Kho Grammar Check-up chưa đủ nội dung.",
        })
    _content_cache.clear()
    _content_cache.update({
        "release_id": release_id,
        "items": items,
        "by_id": {str(row["item_id"]): row for row in items},
        "routes": routes,
        "route_by_attribute": defaultdict(list),
        "learner_copy": {str(row["attribute_id"]): row.get("learner_copy") or {} for row in misconceptions},
    })
    for row in routes:
        _content_cache["route_by_attribute"][str(row["attribute_id"])].append(row)
    return _content_cache


def _student_for_user(user_id: str) -> Optional[dict[str, Any]]:
    rows = (
        supabase_admin.table("students").select("id, cohort_id")
        .eq("user_id", user_id).limit(1).execute().data
    ) or []
    return rows[0] if rows else None


def _assignment_entitlement(user_id: str, item_id: str) -> dict[str, Any]:
    student = _student_for_user(user_id)
    if not student:
        raise HTTPException(404, "Không tìm thấy hồ sơ học viên")
    items = (
        supabase_admin.table("class_assignment_items").select("*")
        .eq("id", item_id).eq("student_id", student["id"]).limit(1).execute().data
    ) or []
    if not items:
        raise HTTPException(404, "Không tìm thấy bài tập của bạn")
    assignments = (
        supabase_admin.table("class_assignments").select("*")
        .eq("id", items[0]["assignment_id"]).limit(1).execute().data
    ) or []
    if not assignments or assignments[0].get("skill") != "grammar":
        raise HTTPException(404, "Không tìm thấy bài Grammar được giao")
    assignment = assignments[0]
    if not student_is_active_in_cohort(
        supabase_admin, str(student["id"]), str(assignment["cohort_id"]),
        legacy_cohort_id=student.get("cohort_id"),
    ):
        # Match the canonical My Class contract: ended membership must not
        # disclose whether a bookmarked assignment/session still exists.
        raise HTTPException(404, "Không tìm thấy bài Grammar được giao")
    return {"item": items[0], "assignment": assignment}


def _assignment_config(user_id: str, item_id: str) -> dict[str, Any]:
    entitled = _assignment_entitlement(user_id, item_id)
    assignment = entitled["assignment"]
    if not is_assignment_open(assignment):
        raise HTTPException(404, "Bài tập không còn mở")
    existing = (
        supabase_admin.table("grammar_diagnostic_sessions").select("*")
        .eq("class_assignment_item_id", item_id).limit(1).execute().data
    ) or []
    if not existing and not is_accepting_submissions(assignment):
        raise HTTPException(409, "Đã quá hạn nộp — bài tập này không còn nhận bài.")
    return {**entitled, "existing": existing[0] if existing else None}


def _require_session_accepting(user_id: str, session: dict[str, Any]) -> None:
    """Recheck the canonical assignment cutoff immediately before a mutation."""
    item_id = session.get("class_assignment_item_id")
    if not item_id:
        return
    entitled = _assignment_entitlement(user_id, str(item_id))
    assignment = entitled["assignment"]
    if not is_assignment_open(assignment):
        raise HTTPException(404, "Bài tập không còn mở")
    if not is_accepting_submissions(assignment):
        raise HTTPException(409, "Đã quá hạn nộp — bài tập này không còn nhận bài.")


def _translate_assignment_write_error(exc: Exception) -> None:
    message = str(exc).lower()
    if "grammar_assignment_not_accessible" in message:
        raise HTTPException(404, "Không tìm thấy bài Grammar được giao") from exc
    if "grammar_response_conflict" in message:
        raise HTTPException(409, "Câu này đã được trả lời với dữ liệu khác") from exc
    if ("grammar_assignment_not_accepting" in message
            or "grammar_session_not_accepting" in message):
        raise HTTPException(
            409,
            "Bài Grammar đã đóng hoặc quá hạn; không có dữ liệu mới được lưu.",
        ) from exc


def create_session(
    user_id: str,
    *,
    mode: str,
    module: str,
    test_length: str,
    class_assignment_item_id: Optional[str] = None,
) -> dict[str, Any]:
    if (not class_assignment_item_id
            and not runtime_flags.is_enabled("master30_grammar_self_serve", default=False)):
        raise HTTPException(
            403,
            detail={
                "error_code": "grammar_assignment_required",
                "message": "Grammar Check-up hiện được mở qua bài giáo viên giao trong My Class.",
            },
        )
    release = _active_release()
    mode, module, test_length = mode.upper(), module.upper(), test_length.upper()
    if mode not in {"ENTRY", "REVIEW"} or module not in {"GENERAL", "ACADEMIC"} or test_length not in LIMITS:
        raise HTTPException(422, "Cấu hình Grammar Check-up không hợp lệ")

    assignment = None
    if class_assignment_item_id:
        assignment = _assignment_config(user_id, class_assignment_item_id)
        if assignment["existing"]:
            # Route resumes through the canonical session read gate as well;
            # passing the row directly would skip the deadline recheck.
            return session_summary(user_id, str(assignment["existing"]["id"]))
        config = assignment["assignment"].get("content_config") or {}
        assigned_release_id = str(config.get("release_id") or "")
        if not assigned_release_id:
            raise HTTPException(409, "Bài Grammar được giao thiếu phiên bản nội dung")
        release = _release_by_id(assigned_release_id)
        mode = str(config.get("mode") or mode).upper()
        module = str(config.get("module") or module).upper()
        test_length = str(config.get("test_length") or test_length).upper()
        if mode not in {"ENTRY", "REVIEW"} or module not in {"GENERAL", "ACADEMIC"} or test_length not in LIMITS:
            raise HTTPException(409, "Cấu hình bài Grammar được giao không còn hợp lệ")

    row = {
        "user_id": user_id, "release_id": release["id"],
        "class_assignment_item_id": class_assignment_item_id,
        "mode": mode, "module": module, "test_length": test_length,
        "objective_limit": LIMITS[test_length][1],
    }
    if class_assignment_item_id:
        try:
            stored = supabase_admin.rpc(
                "create_assigned_grammar_diagnostic_session",
                {
                    "p_user_id": user_id,
                    "p_release_id": release["id"],
                    "p_item_id": class_assignment_item_id,
                    "p_mode": mode,
                    "p_module": module,
                    "p_test_length": test_length,
                    "p_objective_limit": LIMITS[test_length][1],
                },
            ).execute().data
        except Exception as exc:
            _translate_assignment_write_error(exc)
            raise
        if isinstance(stored, list):
            rows = stored
        elif isinstance(stored, dict):
            rows = [stored]
        else:
            rows = []
    else:
        rows = supabase_admin.table("grammar_diagnostic_sessions").insert(row).execute().data or []
    if not rows:
        raise HTTPException(500, "Không tạo được phiên Grammar Check-up")
    return session_summary(user_id, rows[0])


def _session(user_id: str, session_id: str) -> dict[str, Any]:
    rows = (
        supabase_admin.table("grammar_diagnostic_sessions").select("*")
        .eq("id", session_id).eq("user_id", user_id).limit(1).execute().data
    ) or []
    if not rows:
        raise HTTPException(404, "Không tìm thấy phiên Grammar Check-up")
    row = rows[0]
    # FR-001 applies the canonical assignment gate to reads as well as writes.
    # A bookmarked session/report must not bypass archive, scheduled publish,
    # deadline, ownership, or current cohort membership.
    _require_session_accepting(user_id, row)
    return row


def _responses(session_id: str) -> list[dict[str, Any]]:
    return (
        supabase_admin.table("grammar_diagnostic_responses").select("*")
        .eq("session_id", session_id).order("created_at").execute().data
    ) or []


def _exposures(session_id: str) -> list[dict[str, Any]]:
    return (
        supabase_admin.table("grammar_exposure_events").select("*")
        .eq("session_id", session_id).order("served_at").execute().data
    ) or []


def session_summary(user_id: str, session: dict[str, Any] | str) -> dict[str, Any]:
    row = _session(user_id, session) if isinstance(session, str) else session
    responses = _responses(str(row["id"]))
    answered = len(responses)
    return {
        "id": row["id"], "status": row["status"], "phase": row["current_phase"],
        "mode": row["mode"], "module": row["module"],
        "test_length": row["test_length"], "objective_limit": row["objective_limit"],
        "answered": answered, "remaining": max(0, int(row["objective_limit"]) - answered),
        "class_assignment_item_id": row.get("class_assignment_item_id"),
        "calibration": "structural_alpha",
        "live_calibrated_ready": False,
    }


def _public_item(item: dict[str, Any], phase: str, ordinal: int, total: int) -> dict[str, Any]:
    return {
        "item_id": item["item_id"], "prompt": item["prompt"],
        "options": item["options"], "phase": phase,
        "ordinal": ordinal, "total": total,
        "translation_available": bool(item.get("translation_vi")),
    }


def _eligible(item: dict[str, Any], session: dict[str, Any], phase: str) -> bool:
    if item.get("module") == "ACADEMIC" and session["module"] == "GENERAL":
        return False
    if phase == "BASELINE":
        if item.get("diagnostic_status") != "DIAGNOSTIC_APPROVED":
            return False
        if session["mode"] == "ENTRY" and not item.get("entry_safe"):
            return False
        return True
    if item.get("diagnostic_status") != "CONFIRMATION_RESERVED":
        return False
    if session["mode"] == "ENTRY":
        level = str((item.get("governance") or {}).get("course_specific_level") or "").upper()
        if level in ENTRY_EXCLUDED_LEVELS:
            return False
    return True


def _selection_attribute(session: dict[str, Any], phase: str, responses: list[dict[str, Any]]) -> list[str]:
    total = Counter(str(row["attribute_id"]) for row in responses)
    wrong = Counter(str(row["attribute_id"]) for row in responses if not row.get("is_correct"))
    if phase == "BASELINE":
        return sorted(ATTRIBUTES, key=lambda attr: (total[attr], ATTRIBUTES.index(attr)))
    confirmation = Counter(
        str(row["attribute_id"]) for row in responses if row.get("phase") == "CONFIRMATION"
    )
    return sorted(ATTRIBUTES, key=lambda attr: (
        0 if wrong[attr] else 1,
        (total[attr] - wrong[attr]) / total[attr] if total[attr] else 1.0,
        confirmation[attr], total[attr], ATTRIBUTES.index(attr),
    ))


def next_item(user_id: str, session_id: str) -> dict[str, Any]:
    session = _session(user_id, session_id)
    if session["status"] == "completed":
        return {"complete": True, "session": session_summary(user_id, session)}
    if session["status"] != "in_progress":
        raise HTTPException(409, detail={"error_code": "diagnostic_exhausted", "message": "Phiên này không còn câu độc lập phù hợp."})
    _require_session_accepting(user_id, session)
    content = _content({"id": session["release_id"]})
    responses = _responses(session_id)
    exposures = _exposures(session_id)
    answered_ids = {str(row["item_id"]) for row in responses}
    pending = next((row for row in exposures if str(row["item_id"]) not in answered_ids), None)
    if pending:
        item = content["by_id"].get(str(pending["item_id"]))
        if not item:
            raise HTTPException(409, "Câu đang làm không còn trong release của phiên")
        return {"complete": False, "item": _public_item(item, pending["phase"], len(responses) + 1, session["objective_limit"])}
    if len(responses) >= int(session["objective_limit"]):
        finalize_session(user_id, session_id)
        return {"complete": True, "session": session_summary(user_id, session_id)}

    baseline_limit = LIMITS[session["test_length"]][0]
    phase = "BASELINE" if len(responses) < baseline_limit else "CONFIRMATION"
    if phase != session.get("current_phase"):
        supabase_admin.table("grammar_diagnostic_sessions").update({
            "current_phase": phase, "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", session_id).eq("user_id", user_id).execute()

    try:
        history = (
            supabase_admin.table("grammar_exposure_events")
            .select("item_id, stimulus_family, parallel_set_id")
            .eq("user_id", user_id).range(0, 9999).execute().data
        ) or []
    except Exception as exc:
        raise HTTPException(503, detail={
            "error_code": "exposure_history_unavailable",
            "message": "Chưa đọc được lịch sử câu hỏi; hệ thống không lặp câu để giữ độ tin cậy.",
        }) from exc
    used_items = {str(row.get("item_id") or "") for row in history}
    used_families = {str(row.get("stimulus_family") or "") for row in history}
    used_parallel = {str(row.get("parallel_set_id") or "") for row in history if row.get("parallel_set_id")}
    counts = Counter(str(row["attribute_id"]) for row in responses)
    candidates = []
    for attribute in _selection_attribute(session, phase, responses):
        if counts[attribute] >= MAX_PER_ATTRIBUTE:
            continue
        scoped = [item for item in content["items"] if item["attribute_id"] == attribute and _eligible(item, session, phase)]
        scoped = [item for item in scoped if str(item["item_id"]) not in used_items
                  and str(item["stimulus_family"]) not in used_families
                  and (not item.get("parallel_set_id") or str(item["parallel_set_id"]) not in used_parallel)]
        if scoped:
            candidates = scoped
            break
    if not candidates:
        supabase_admin.table("grammar_diagnostic_sessions").update({
            "status": "exhausted", "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", session_id).eq("user_id", user_id).execute()
        raise HTTPException(409, detail={
            "error_code": "diagnostic_exhausted",
            "message": "Đã hết mẫu độc lập phù hợp; hệ thống không tái sử dụng câu cũ.",
        })
    candidates.sort(key=lambda item: hashlib.sha256(
        f"{session_id}:{phase}:{item['item_id']}".encode("utf-8")
    ).hexdigest())
    item = candidates[0]
    exposure = {
        "user_id": user_id, "session_id": session_id,
        "release_id": session["release_id"], "item_id": item["item_id"],
        "stimulus_family": item["stimulus_family"],
        "parallel_set_id": item.get("parallel_set_id"), "phase": phase,
    }
    try:
        supabase_admin.table("grammar_exposure_events").insert(exposure).execute()
    except Exception as exc:
        # Two browser requests can race after a reconnect.  The unique session
        # exposure is the winner; return that same pending item instead of
        # turning a harmless duplicate request into a learner-facing 500.
        _translate_assignment_write_error(exc)
        if "duplicate" not in str(exc).lower() and "unique" not in str(exc).lower():
            raise
        raced = next((row for row in _exposures(session_id)
                      if str(row["item_id"]) not in answered_ids), None)
        if not raced:
            raise
        raced_item = content["by_id"].get(str(raced["item_id"]))
        if not raced_item:
            raise HTTPException(409, "Câu đang làm không còn trong release của phiên") from exc
        return {
            "complete": False,
            "item": _public_item(
                raced_item, raced["phase"], len(responses) + 1,
                session["objective_limit"],
            ),
        }
    return {"complete": False, "item": _public_item(item, phase, len(responses) + 1, session["objective_limit"])}


def record_response(
    user_id: str,
    session_id: str,
    *,
    item_id: str,
    selected_option: int,
    response_time_ms: Optional[int],
    assistance_used: bool,
) -> dict[str, Any]:
    session = _session(user_id, session_id)
    content = _content({"id": session["release_id"]})
    item = content["by_id"].get(item_id)
    if not item:
        raise HTTPException(404, "Không tìm thấy câu hỏi trong release của phiên")
    if not isinstance(selected_option, int) or not 0 <= selected_option < len(item["options"]):
        raise HTTPException(422, "Lựa chọn không hợp lệ")
    persisted = (
        supabase_admin.table("grammar_diagnostic_responses").select("*")
        .eq("session_id", session_id).eq("user_id", user_id)
        .eq("item_id", item_id).limit(1).execute().data
    ) or []
    if persisted:
        previous = persisted[0]
        same_payload = (
            int(previous.get("selected_option")) == selected_option
            and bool(previous.get("assistance_used")) == bool(assistance_used)
        )
        if not same_payload:
            raise HTTPException(409, "Câu này đã được trả lời với dữ liệu khác")
        answered = len(_responses(session_id))
        complete = session["status"] == "completed" or answered >= int(session["objective_limit"])
        if complete and session["status"] != "completed":
            _require_session_accepting(user_id, session)
            finalize_session(user_id, session_id)
        return {
            "accepted": True, "complete": complete, "answered": answered,
            "remaining": max(0, int(session["objective_limit"]) - answered),
            "feedback_available": complete,
        }
    if session["status"] != "in_progress":
        raise HTTPException(409, "Phiên này đã đóng")
    _require_session_accepting(user_id, session)
    exposures = (
        supabase_admin.table("grammar_exposure_events").select("*")
        .eq("session_id", session_id).eq("user_id", user_id)
        .eq("item_id", item_id).limit(1).execute().data
    ) or []
    if not exposures:
        raise HTTPException(409, "Câu này chưa được cấp cho phiên hiện tại")
    row = {
        "session_id": session_id, "user_id": user_id,
        "release_id": session["release_id"], "item_id": item_id,
        "attribute_id": item["attribute_id"], "process_facet": item["process_facet"],
        "subdomain": item["subdomain"],
        "phase": exposures[0]["phase"], "selected_option": selected_option,
        "is_correct": selected_option == int(item["correct_index"]),
        "assistance_used": bool(assistance_used),
        "response_time_ms": response_time_ms,
    }
    responses_before = _responses(session_id)
    if len(responses_before) == int(session["objective_limit"]) - 1:
        learner, educator, evidence_sha = _build_reports(
            session, [*responses_before, row], content,
        )
        try:
            supabase_admin.rpc("record_and_finalize_grammar_diagnostic_session", {
                "p_session_id": session_id,
                "p_user_id": user_id,
                "p_item_id": item_id,
                "p_selected_option": selected_option,
                "p_assistance_used": bool(assistance_used),
                "p_response_time_ms": response_time_ms,
                "p_evidence_sha256": evidence_sha,
                "p_learner_report": learner,
                "p_educator_report": educator,
            }).execute()
        except Exception as exc:
            _translate_assignment_write_error(exc)
            raise
        canonical = (
            supabase_admin.table("grammar_diagnostic_reports").select("learner_report")
            .eq("session_id", session_id).eq("user_id", user_id).limit(1).execute().data
        ) or []
        if not canonical:
            raise HTTPException(500, "Báo cáo Grammar chưa được lưu sau câu cuối")
        return {
            "accepted": True, "complete": True,
            "answered": int(session["objective_limit"]), "remaining": 0,
            "feedback_available": True,
        }
    try:
        supabase_admin.table("grammar_diagnostic_responses").insert(row).execute()
    except Exception as exc:
        _translate_assignment_write_error(exc)
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            # A concurrent or lost-response retry may have committed the same
            # immutable payload. Re-read canonical truth and accept only an
            # exact replay; a changed answer remains a conflict.
            raced = (
                supabase_admin.table("grammar_diagnostic_responses").select("*")
                .eq("session_id", session_id).eq("user_id", user_id)
                .eq("item_id", item_id).limit(1).execute().data
            ) or []
            if not raced or not (
                int(raced[0].get("selected_option")) == selected_option
                and bool(raced[0].get("assistance_used")) == bool(assistance_used)
            ):
                raise HTTPException(409, "Câu này đã được trả lời với dữ liệu khác") from exc
        else:
            raise
    answered = len(_responses(session_id))
    complete = answered >= int(session["objective_limit"])
    if complete:
        finalize_session(user_id, session_id)
    return {
        "accepted": True, "complete": complete, "answered": answered,
        "remaining": max(0, int(session["objective_limit"]) - answered),
        "feedback_available": complete,
    }


def _classify(rows: list[dict[str, Any]]) -> dict[str, Any]:
    clean = [row for row in rows if not row.get("assistance_used")]
    wrong = [row for row in clean if not row.get("is_correct")]
    correct = [row for row in clean if row.get("is_correct")]
    facets = sorted({str(row["process_facet"]) for row in clean})
    if len(clean) >= 3 and len(wrong) >= 2 and len(facets) >= 2:
        state = "CONFIRMED_REVIEW_NEED"
    elif len(clean) >= 2 and wrong and correct:
        state = "UNSTABLE"
    elif len(clean) >= 3 and len(wrong) <= 1 and len(facets) >= 2:
        state = "CONFIRMED_STRENGTH"
    elif correct and not wrong:
        state = "PROVISIONAL_STRENGTH"
    else:
        state = "INSUFFICIENT_EVIDENCE"
    wrong_facets = Counter(str(row["process_facet"]) for row in wrong)
    dominant = [facet for facet, count in wrong_facets.items() if count == max(wrong_facets.values(), default=0)]
    return {
        "state": state, "independent_items": len(clean), "correct": len(correct),
        "incorrect": len(wrong), "process_facets": facets,
        "dominant_process_facets": sorted(dominant),
        "assisted_evidence_excluded": len(rows) - len(clean),
        "item_ids": [str(row["item_id"]) for row in clean],
    }


def _build_reports(session: dict[str, Any], responses: list[dict[str, Any]], content: dict[str, Any]) -> tuple[dict, dict, str]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in responses:
        grouped[str(row["attribute_id"])].append(row)
    states = {attribute: _classify(grouped.get(attribute, [])) for attribute in ATTRIBUTES}
    candidates = [attribute for attribute in ATTRIBUTES if states[attribute]["state"] in {"CONFIRMED_REVIEW_NEED", "UNSTABLE"}]
    roots = [attribute for attribute in candidates if not (set(PREREQUISITES.get(attribute, [])) & set(candidates))]
    ranked = sorted(roots or candidates, key=lambda attr: (
        0 if states[attr]["state"] == "CONFIRMED_REVIEW_NEED" else 1,
        -states[attr]["incorrect"], -states[attr]["independent_items"], attr,
    ))
    priorities = []
    for attribute in ranked[:3]:
        data = states[attribute]
        copy = content["learner_copy"].get(attribute, {})
        routes = content["route_by_attribute"].get(attribute, [])
        route = routes[0] if routes else None
        if attribute == "M14" and routes:
            observed_error_subdomains = {
                str(row.get("subdomain"))
                for row in grouped.get(attribute, [])
                if row.get("subdomain")
                and not row.get("assistance_used")
                and not row.get("is_correct")
            }
            route = next((row for row in routes if str(
                (row.get("route") or {}).get("subdomain")
            ) in observed_error_subdomains), routes[0])
        dominant = [PROCESS_LABELS.get(value, value) for value in data["dominant_process_facets"]]
        priorities.append({
            "attribute_id": attribute,
            "title": copy.get("learner_title_vi") or attribute,
            "state": data["state"],
            "confidence_label": "đã xác nhận" if data["state"] == "CONFIRMED_REVIEW_NEED" else "có khả năng",
            "observed_pattern": f"Câu trả lời chưa ổn định khi {', '.join(dominant) or 'vận dụng quy tắc trong ngữ cảnh'}.",
            "risk": copy.get("ielts_facing_risk_vi") or "Lỗi lặp có thể làm giảm độ chính xác và rõ nghĩa.",
            "next_action": copy.get("next_action_vi") or "Ôn tuyến gợi ý và kiểm tra lại bằng mẫu chưa thấy.",
            "contrast_example": copy.get("contrast_example") or "",
            "route_id": route.get("route_id") if route else None,
            "lesson_sources": str((route or {}).get("route", {}).get("teach_sources") or ""),
            "exit_condition": "Làm đúng các mẫu chưa từng thấy theo ít nhất hai cách kiểm tra; bài tạo câu chỉ được tính khi giáo viên duyệt.",
            "evidence_status": {"independent_items": data["independent_items"], "assisted_excluded": data["assisted_evidence_excluded"]},
        })
    strengths = []
    for attribute in ATTRIBUTES:
        data = states[attribute]
        if data["state"] not in {"CONFIRMED_STRENGTH", "PROVISIONAL_STRENGTH"}:
            continue
        copy = content["learner_copy"].get(attribute, {})
        strengths.append({
            "attribute_id": attribute, "title": copy.get("learner_title_vi") or attribute,
            "state": data["state"], "independent_items": data["independent_items"],
        })
    strengths.sort(key=lambda row: (0 if row["state"] == "CONFIRMED_STRENGTH" else 1, -row["independent_items"], row["attribute_id"]))
    insufficient = [{
        "attribute_id": attribute,
        "title": content["learner_copy"].get(attribute, {}).get("learner_title_vi") or attribute,
    } for attribute in ATTRIBUTES if states[attribute]["state"] == "INSUFFICIENT_EVIDENCE"]
    learner = {
        "profile_kind": "Grammar Readiness Profile",
        "calibration": "structural_alpha",
        "calibration_note": "Đây là hồ sơ sẵn sàng ngữ pháp theo quy tắc bằng chứng, không phải dự đoán band IELTS và chưa phải thang đo psychometric đã hiệu chỉnh trực tiếp.",
        "test_length": session["test_length"], "mode": session["mode"], "module": session["module"],
        "priorities": priorities, "strengths": strengths[:2],
        "insufficient_evidence": insufficient,
        "productive_note": "Bài tạo câu không nằm trong điểm chẩn đoán tự động. Chỉ bài do giáo viên giao và duyệt mới có nhận xét/điểm productive.",
    }
    educator = {
        **learner,
        "attribute_evidence": states,
        "objective_items": len(responses),
        "correct_items": sum(1 for row in responses if row.get("is_correct")),
        "release_id": session["release_id"],
    }
    evidence = [{key: row.get(key) for key in (
        "item_id", "attribute_id", "process_facet", "subdomain", "phase", "selected_option",
        "is_correct", "assistance_used",
    )} for row in responses]
    evidence_sha = hashlib.sha256(json.dumps(evidence, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    return learner, educator, evidence_sha


def finalize_session(user_id: str, session_id: str) -> dict[str, Any]:
    session = _session(user_id, session_id)
    existing = (
        supabase_admin.table("grammar_diagnostic_reports").select("learner_report")
        .eq("session_id", session_id).eq("user_id", user_id).limit(1).execute().data
    ) or []
    if existing:
        return existing[0]["learner_report"]
    _require_session_accepting(user_id, session)
    responses = _responses(session_id)
    if len(responses) < int(session["objective_limit"]):
        raise HTTPException(409, "Chưa đủ số câu để hoàn tất phiên")
    content = _content({"id": session["release_id"]})
    learner, educator, evidence_sha = _build_reports(session, responses, content)
    try:
        supabase_admin.rpc("finalize_grammar_diagnostic_session", {
            "p_session_id": session_id, "p_user_id": user_id,
            "p_evidence_sha256": evidence_sha,
            "p_learner_report": learner, "p_educator_report": educator,
        }).execute()
    except Exception as exc:
        _translate_assignment_write_error(exc)
        raise
    # Always return the immutable database winner. This makes two concurrent
    # finalizers converge even when this request waited behind the transaction
    # that inserted the report first.
    canonical = (
        supabase_admin.table("grammar_diagnostic_reports").select("learner_report")
        .eq("session_id", session_id).eq("user_id", user_id).limit(1).execute().data
    ) or []
    if not canonical:
        raise HTTPException(500, "Báo cáo Grammar chưa được lưu sau khi hoàn tất")
    return canonical[0]["learner_report"]


def learner_report(user_id: str, session_id: str) -> dict[str, Any]:
    session = _session(user_id, session_id)
    if session["status"] != "completed":
        raise HTTPException(409, "Phiên chưa hoàn tất")
    rows = (
        supabase_admin.table("grammar_diagnostic_reports").select("learner_report, created_at")
        .eq("session_id", session_id).eq("user_id", user_id).limit(1).execute().data
    ) or []
    if not rows:
        raise HTTPException(409, "Báo cáo chưa sẵn sàng")
    return {**rows[0]["learner_report"], "session_id": session_id, "created_at": rows[0].get("created_at")}


def educator_report(session_id: str) -> dict[str, Any]:
    rows = (
        supabase_admin.table("grammar_diagnostic_reports")
        .select("educator_report, created_at, session_id")
        .eq("session_id", session_id).limit(1).execute().data
    ) or []
    if not rows:
        raise HTTPException(404, "Không tìm thấy báo cáo Grammar")
    return {**rows[0]["educator_report"], "session_id": session_id, "created_at": rows[0].get("created_at")}


def learner_history(user_id: str) -> list[dict[str, Any]]:
    rows = (
        supabase_admin.table("grammar_diagnostic_sessions").select("*")
        .eq("user_id", user_id).order("started_at", desc=True).limit(20).execute().data
    ) or []
    visible = []
    for row in rows:
        try:
            _require_session_accepting(user_id, row)
        except HTTPException as exc:
            if row.get("class_assignment_item_id") and exc.status_code in {404, 409}:
                continue
            raise
        visible.append(session_summary(user_id, row))
    return visible
