"""Assignment-owned, practice-only MASTER30 lesson work."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from database import supabase_admin
from services.class_assignment_service import (
    is_accepting_submissions,
    is_assignment_open,
)
from services.class_membership_service import student_is_active_in_cohort
from services.grammar_diagnostic_service import APPROVED_MANIFEST_SHA256
from services.grammar_lesson_content import (
    CURRENT_VERSION,
    content_sha256,
    lesson_content,
    load_version,
    public_lesson,
)
from services import runtime_flags
from services.grammar_lesson_full_content import FULL_VERSION, question_counts


FLAG = "master30_grammar_lesson_assignments"
FULL_FLAG = "master30_original_full_banks"


def enabled() -> bool:
    return runtime_flags.is_enabled(FLAG, default=False)


def full_enabled() -> bool:
    return runtime_flags.is_enabled(FULL_FLAG, default=False)


def _version_enabled(version: str) -> bool:
    return enabled() and (version != FULL_VERSION or full_enabled())


def _current_version() -> str:
    return FULL_VERSION if full_enabled() else CURRENT_VERSION


def _current_content(lesson_id: str, version: str) -> dict | None:
    try:
        return (lesson_content(lesson_id) if version == CURRENT_VERSION
                else lesson_content(lesson_id, version))
    except (ValueError, OSError, KeyError) as exc:
        raise HTTPException(503, "Ngân hàng Grammar chưa có bản đầy đủ được duyệt đúng phiên bản.") from exc


def _unready_reason(lesson_id: str) -> str:
    if lesson_id in {"M30-B02", "M30-B07", "M30-B18"}:
        return (
            "Kho MASTER30 đã có câu hỏi cho bài này; web chưa nạp và rà soát "
            "một gói luyện riêng để giao lẻ."
        )
    return (
        "Kho MASTER30 đã có nguồn bài này; web chưa có gói luyện riêng "
        "được rà soát để giao lẻ."
    )


def _active_release() -> dict[str, Any]:
    rows = (
        supabase_admin.table("grammar_content_releases")
        .select("id, manifest_sha256, validation").eq("status", "active").limit(1)
        .execute().data
    ) or []
    if (not rows or rows[0].get("manifest_sha256") != APPROVED_MANIFEST_SHA256
            or not bool((rows[0].get("validation") or {}).get("passed"))):
        raise HTTPException(503, "Kho MASTER30 chưa có release đã kiểm tra.")
    return rows[0]


def catalog() -> list[dict[str, Any]]:
    release = _active_release()
    rows = (
        supabase_admin.table("grammar_lessons")
        .select("id, lesson_id, lesson_no, title")
        .eq("release_id", release["id"]).order("lesson_no")
        .execute().data
    ) or []
    if len(rows) != 30:
        raise HTTPException(503, "Kho MASTER30 chưa đủ 30 bài.")
    # Validate the frozen practice package once. An invalid package is an
    # operational error, never an apparently empty catalog.
    version = _current_version()
    try:
        load_version(version)
    except (ValueError, OSError, KeyError) as exc:
        raise HTTPException(503, "Ngân hàng Grammar chưa có bản đầy đủ được duyệt đúng phiên bản.") from exc
    available = enabled()
    result = []
    for row in rows:
        lesson_id = str(row["lesson_id"])
        content = _current_content(lesson_id, version)
        reason = (_unready_reason(lesson_id) if content is None else
                  "Tính năng giao bài Grammar lẻ đang tắt." if not available else None)
        result.append({
            "id": lesson_id,
            "lesson_no": row["lesson_no"],
            "title": row["title"],
            "ready": reason is None,
            "reason": reason,
            "focus": content["focus"] if content else None,
            "question_count": len(content["questions"]) if content else 0,
            "article": content["article"] if content else None,
            "content_version": version if content else None,
            "practice_kind": "full_original_bank" if version == FULL_VERSION else "mini_practice",
            **question_counts(content or {}),
        })
    return result


def prepare_assignment(lesson_id: str) -> tuple[str, dict[str, Any]]:
    if not enabled():
        raise HTTPException(503, "Giao bài Grammar lẻ đang tạm khóa.")
    release = _active_release()
    rows = (
        supabase_admin.table("grammar_lessons")
        .select("id, lesson_id, title")
        .eq("release_id", release["id"]).eq("lesson_id", lesson_id)
        .limit(1).execute().data
    ) or []
    if not rows:
        raise HTTPException(404, "Không tìm thấy bài Grammar này.")
    version = _current_version()
    content = _current_content(lesson_id, version)
    if content is None:
        raise HTTPException(409, "Bài Grammar này chưa có bài luyện riêng được rà soát.")
    snapshot = _snapshot(lesson_id, version)
    return str(rows[0]["id"]), {
        "assignment_type": "grammar_lesson",
        "release_id": str(release["id"]),
        "lesson_id": lesson_id,
        "lesson_title": rows[0]["title"],
        "content_version": version,
        "content_sha256": content_sha256(snapshot),
        "practice_focus": content["focus"],
        "question_count": len(content["questions"]),
        **question_counts(content),
    }


def _snapshot(lesson_id: str, version: str) -> dict[str, Any]:
    content = _current_content(lesson_id, version)
    if content is None:
        raise HTTPException(409, "Phiên bản bài Grammar được giao không còn sẵn sàng.")
    return {"lesson_id": lesson_id, "version": version, **content}


def _student_for_user(user_id: str) -> dict[str, Any]:
    rows = (
        supabase_admin.table("students").select("id, cohort_id")
        .eq("user_id", user_id).limit(1).execute().data
    ) or []
    if not rows:
        raise HTTPException(404, "Không tìm thấy hồ sơ học viên.")
    return rows[0]


def _entitlement(user_id: str, item_id: str) -> tuple[dict, dict]:
    student = _student_for_user(user_id)
    items = (
        supabase_admin.table("class_assignment_items").select("*")
        .eq("id", item_id).eq("student_id", student["id"])
        .limit(1).execute().data
    ) or []
    if not items:
        raise HTTPException(404, "Không tìm thấy bài Grammar được giao.")
    assignments = (
        supabase_admin.table("class_assignments").select("*")
        .eq("id", items[0]["assignment_id"]).limit(1).execute().data
    ) or []
    if (
        not assignments
        or assignments[0].get("skill") != "grammar"
        or (assignments[0].get("content_config") or {}).get("assignment_type")
        != "grammar_lesson"
        or not student_is_active_in_cohort(
            supabase_admin, str(student["id"]),
            str(assignments[0]["cohort_id"]),
            legacy_cohort_id=student.get("cohort_id"),
        )
    ):
        raise HTTPException(404, "Không tìm thấy bài Grammar được giao.")
    return items[0], assignments[0]


def _attempt(item_id: str) -> dict[str, Any] | None:
    rows = (
        supabase_admin.table("grammar_lesson_attempts").select("*")
        .eq("class_assignment_item_id", item_id).limit(1).execute().data
    ) or []
    return rows[0] if rows else None


def _owned_attempt(item_id: str, user_id: str) -> dict[str, Any] | None:
    attempt = _attempt(item_id)
    if attempt and str(attempt.get("user_id")) != str(user_id):
        raise HTTPException(404, "Không tìm thấy bài Grammar được giao.")
    return attempt


def _public_state(item: dict, assignment: dict, attempt: dict | None) -> dict:
    config = assignment.get("content_config") or {}
    version = (attempt or {}).get("content_version") or config.get("content_version") or CURRENT_VERSION
    active = _version_enabled(str(version))
    can_submit = active and is_accepting_submissions(assignment)
    if attempt:
        snapshot = attempt["content_snapshot"]
        lesson = public_lesson(snapshot, attempt.get("answers") or {})
        status = (
            "completed" if attempt["status"] == "completed" else
            "paused" if not active else
            "in_progress" if can_submit else "expired"
        )
        answered = len(attempt.get("answers") or {})
        correct = int(attempt.get("correct_count") or 0)
        total = int(attempt.get("question_count") or config["question_count"])
        counts = question_counts(snapshot, attempt.get("answers") or {})
        if not snapshot.get("questions"):
            counts["objective_count"] = total
            counts["core_count"] = total
    else:
        preview = _current_content(config["lesson_id"], config["content_version"])
        lesson = {
            "focus": config.get("practice_focus") or "",
            "article": preview.get("article") if preview else None,
            "lesson_notes": preview.get("lesson_notes") if preview else None,
            "learning_objectives": preview.get("learning_objectives", []) if preview else [],
            "questions": [],
        }
        status = (
            "paused" if not active else
            "not_started" if can_submit else
            "scheduled" if not is_assignment_open(assignment) else "expired"
        )
        answered = correct = 0
        total = int(config["question_count"])
        counts = {"objective_count": int(config.get("objective_count", total)),
                  "writing_count": int(config.get("writing_count", 0)),
                  "writing_answered_count": 0,
                  "core_count": int(config.get("core_count", total)),
                  "supplementary_count": int(config.get("supplementary_count", 0))}
    return {
        "assignment_item_id": str(item["id"]),
        "assignment_id": str(assignment["id"]),
        "lesson_id": config["lesson_id"],
        "title": config.get("lesson_title") or assignment["title"],
        "instructions": assignment.get("instructions"),
        "due_at": assignment.get("due_at"),
        "status": status,
        "can_submit": bool(can_submit and status != "completed"),
        "answered_count": answered,
        "correct_count": correct,
        "question_count": total,
        "content_version": version,
        **counts,
        "attempt_id": str(attempt["id"]) if attempt else None,
        **lesson,
    }


def read_item(user_id: str, item_id: str) -> dict:
    item, assignment = _entitlement(user_id, item_id)
    return _public_state(item, assignment, _owned_attempt(item_id, user_id))


def _translate_write_error(exc: Exception) -> None:
    message = str(exc).lower()
    if "grammar_lesson_not_accessible" in message:
        raise HTTPException(404, "Không tìm thấy bài Grammar được giao.") from exc
    if "grammar_lesson_not_accepting" in message:
        raise HTTPException(409, "Bài Grammar đã đóng hoặc quá hạn.") from exc
    if "grammar_lesson_not_started" in message:
        raise HTTPException(409, "Hãy mở bài Grammar trước khi trả lời.") from exc
    if "grammar_lesson_invalid_answer" in message:
        raise HTTPException(422, "Câu trả lời không hợp lệ.") from exc
    if "grammar_lesson_answer_conflict" in message:
        raise HTTPException(409, "Câu này đã được trả lời khác trước đó.") from exc
    if "grammar_practice_history_invalid" in message:
        raise HTTPException(503, detail={"error_code": "exposure_history_unavailable",
                                        "message": "Chưa kiểm tra được lịch sử bài Grammar. Vui lòng thử lại."}) from exc


def start_item(user_id: str, item_id: str) -> dict:
    item, assignment = _entitlement(user_id, item_id)
    config = assignment["content_config"]
    existing = _owned_attempt(item_id, user_id)
    if existing:
        return _public_state(item, assignment, existing)
    if not _version_enabled(config["content_version"]):
        raise HTTPException(503, "Ngân hàng Grammar đang tạm khóa. Lịch sử đã lưu vẫn được giữ.")
    if not is_accepting_submissions(assignment):
        raise HTTPException(409, "Bài Grammar đã đóng hoặc quá hạn.")
    snapshot = _snapshot(config["lesson_id"], config["content_version"])
    if content_sha256(snapshot) != config["content_sha256"]:
        raise HTTPException(409, "Nội dung bài Grammar đã thay đổi; không thể mở lượt cũ.")
    try:
        supabase_admin.rpc("create_assigned_grammar_lesson_attempt", {
            "p_user_id": user_id,
            "p_item_id": item_id,
            "p_release_id": config["release_id"],
            "p_lesson_id": config["lesson_id"],
            "p_content_version": config["content_version"],
            "p_content_sha256": config["content_sha256"],
            "p_content_snapshot": snapshot,
        }).execute()
    except Exception as exc:
        _translate_write_error(exc)
        raise
    attempt = _owned_attempt(item_id, user_id)
    if not attempt:
        raise HTTPException(500, "Không đọc được lượt Grammar vừa mở.")
    return _public_state(item, assignment, attempt)


def answer_item(user_id: str, item_id: str, question_id: str,
                selected_index: int | None = None, *, answer_text: str | None = None) -> dict:
    item, assignment = _entitlement(user_id, item_id)
    existing = _owned_attempt(item_id, user_id)
    version = (existing or {}).get("content_version") or (assignment.get("content_config") or {}).get("content_version", CURRENT_VERSION)
    if not _version_enabled(version):
        raise HTTPException(503, "Ngân hàng Grammar đang tạm khóa. Tiến độ đã lưu vẫn được giữ.")
    if (selected_index is None) == (answer_text is None):
        raise HTTPException(422, "Hãy gửi đúng một lựa chọn hoặc câu trả lời viết.")
    rpc = "record_assigned_grammar_lesson_answer"
    payload = {"p_user_id": user_id, "p_item_id": item_id, "p_question_id": question_id}
    if answer_text is not None:
        rpc = "record_assigned_grammar_lesson_writing_answer"
        payload["p_answer_text"] = answer_text
    else:
        payload["p_selected_index"] = selected_index
    try:
        supabase_admin.rpc(rpc, payload).execute()
    except Exception as exc:
        _translate_write_error(exc)
        raise
    attempt = _owned_attempt(item_id, user_id)
    if not attempt:
        raise HTTPException(500, "Không đọc được câu trả lời Grammar vừa lưu.")
    return _public_state(item, assignment, attempt)


def educator_report(attempt_id: str) -> dict:
    rows = (
        supabase_admin.table("grammar_lesson_attempts").select("*")
        .eq("id", attempt_id).limit(1).execute().data
    ) or []
    if not rows:
        raise HTTPException(404, "Không tìm thấy lượt làm Grammar.")
    attempt = rows[0]
    item_rows = (
        supabase_admin.table("class_assignment_items")
        .select("id, assignment_id, student_id, submitted_at")
        .eq("id", attempt["class_assignment_item_id"]).limit(1).execute().data
    ) or []
    if not item_rows:
        raise HTTPException(409, "Lượt Grammar thiếu bài giao gốc.")
    assignment_rows = (
        supabase_admin.table("class_assignments").select("id, title, cohort_id")
        .eq("id", item_rows[0]["assignment_id"]).limit(1).execute().data
    ) or []
    if not assignment_rows:
        raise HTTPException(409, "Lượt Grammar thiếu lớp gốc.")
    snapshot = attempt["content_snapshot"]
    return {
        "attempt_id": str(attempt["id"]),
        "assignment_item_id": str(attempt["class_assignment_item_id"]),
        "assignment_title": assignment_rows[0]["title"],
        "lesson_id": attempt["lesson_id"],
        "status": attempt["status"],
        "correct_count": attempt["correct_count"],
        "question_count": attempt["question_count"],
        "content_version": attempt["content_version"],
        **question_counts(snapshot, attempt.get("answers") or {}),
        "completed_at": attempt.get("completed_at"),
        **public_lesson(snapshot, attempt.get("answers") or {}),
    }
