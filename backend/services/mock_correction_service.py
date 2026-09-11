"""Versioned Cambridge explanations, release gates and learning observations.

This module contains no FastAPI imports. Existing Reading/Listening rows remain
the canonical source and score; web-explanation objects are an optional,
versioned review layer controlled by the admin-selected delivery policy.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Iterable
from uuid import uuid4

from database import supabase_admin

logger = logging.getLogger(__name__)

SKILLS = {"reading", "listening"}
PRACTICE_EXPLANATION_MODES = {"disabled", "immediate_after_capture", "admin_release"}
MOCK_EXPLANATION_MODES = {"disabled", "with_result", "admin_release"}
SELF_ATTRIBUTION_CODES = {
    "SA_GUESSED", "SA_DID_NOT_KNOW_WORD", "SA_COULD_NOT_LOCATE",
    "SA_DID_NOT_PARSE_SENTENCE", "SA_MISSED_PARAPHRASE",
    "SA_CHOSE_MENTIONED_DISTRACTOR", "SA_LOST_AUDIO_POSITION",
    "SA_COULD_NOT_HEAR_CHUNK", "SA_FORGOT_BEFORE_ANSWERING",
    "SA_ANSWER_FORM_OR_SPELLING", "SA_RAN_OUT_OF_TIME",
    "SA_CHANGED_FROM_RIGHT_TO_WRONG", "SA_TECHNICAL_PROBLEM", "SA_OTHER",
}
READY_RIGHTS = {"APPROVED", "RIGHTS_APPROVED"}
READY_EDITORIAL = {"APPROVED", "EDITORIAL_APPROVED"}
AUTO_SERVABLE = {"ELIGIBLE_AFTER_GLOBAL_RELEASE_GATES"}
CORRECTION_EVENT_NAMES = {
    "correction_result_seen",
    "evidence_attempt_submitted",
    "hint_revealed",
    "full_explanation_opened",
    "correction_output_submitted",
}
CORRECTION_STATE_RANK = {
    "RESULT_ONLY": 0,
    "EVIDENCE_ATTEMPTED": 1,
    "LOCATION_HINT_SEEN": 2,
    "DECISIVE_HINT_SEEN": 3,
    "FULL_EXPLANATION_SEEN": 4,
    "CORRECTION_OUTPUT_SUBMITTED": 5,
    "CORRECTION_VERIFIED": 6,
    "TRANSFER_PASSED": 7,
    "RETEST_SCHEDULED": 8,
    "MASTERED": 9,
    "REOPENED": 0,
}


class CorrectionError(Exception):
    pass


class NotFoundError(CorrectionError):
    pass


class PolicyError(CorrectionError):
    pass


class CaptureConflictError(CorrectionError):
    pass


class EventConflictError(CorrectionError):
    pass


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _attempt_table(skill: str) -> str:
    if skill not in SKILLS:
        raise PolicyError("Kỹ năng chỉ có thể là reading hoặc listening.")
    return f"{skill}_test_attempts"


def _test_table(skill: str) -> str:
    if skill not in SKILLS:
        raise PolicyError("Kỹ năng chỉ có thể là reading hoặc listening.")
    return f"{skill}_tests"


def _attempt_fk(skill: str) -> str:
    return f"{skill}_attempt_id"


def _test_fk(skill: str) -> str:
    return f"{skill}_test_id"


def _one(table: str, row_id: str, columns: str = "*") -> dict | None:
    rows = (supabase_admin.table(table).select(columns)
            .eq("id", str(row_id)).limit(1).execute().data) or []
    return rows[0] if rows else None


def fetch_owned_submitted_attempt(skill: str, attempt_id: str, learner_id: str) -> dict:
    rows = (supabase_admin.table(_attempt_table(skill)).select("*")
            .eq("id", str(attempt_id)).eq("user_id", str(learner_id))
            .limit(1).execute().data) or []
    if not rows:
        raise NotFoundError("Không tìm thấy lượt làm bài của học viên.")
    if rows[0].get("status") != "submitted":
        raise PolicyError("Chỉ thu post-test capture sau khi bài đã được nộp.")
    return rows[0]


def class_item_entitles_exam_only(
    user_id: str,
    class_item_id: str | None,
    *,
    skill: str,
    test_id: str,
) -> bool:
    """Return whether this exact class item grants the reserved paper.

    This is an admission capability, not a broad ``exam_only`` bypass. It binds
    user → student → item → assignment → skill/test and requires the assignment
    to opt into ``assigned_practice``.
    """
    if not class_item_id or skill not in SKILLS:
        return False
    students = (supabase_admin.table("students").select("id")
                .eq("user_id", str(user_id)).limit(1).execute().data) or []
    if not students:
        return False
    items = (supabase_admin.table("class_assignment_items")
             .select("id,assignment_id")
             .eq("id", str(class_item_id)).eq("student_id", students[0]["id"])
             .limit(1).execute().data) or []
    if not items:
        return False
    assignments = (supabase_admin.table("class_assignments").select(
        "id,skill,content_id,content_config,status,publish_at,due_at",
    ).eq("id", items[0]["assignment_id"]).limit(1).execute().data) or []
    if not assignments:
        return False
    assignment = assignments[0]
    cfg = assignment.get("content_config") or {}
    publish_at = assignment.get("publish_at")
    if publish_at:
        try:
            published = datetime.fromisoformat(str(publish_at).replace("Z", "+00:00"))
            if published.tzinfo is None:
                published = published.replace(tzinfo=timezone.utc)
            if published > datetime.now(timezone.utc):
                return False
        except (TypeError, ValueError):
            # A malformed schedule is never an entitlement.
            return False
    due_at = assignment.get("due_at")
    if due_at:
        try:
            due = datetime.fromisoformat(str(due_at).replace("Z", "+00:00"))
            if due.tzinfo is None:
                due = due.replace(tzinfo=timezone.utc)
            if due < datetime.now(timezone.utc):
                return False
        except (TypeError, ValueError):
            return False
    return bool(
        assignment.get("status") == "published"
        and assignment.get("skill") == skill
        and str(assignment.get("content_id")) == str(test_id)
        and cfg.get("delivery_mode") == "assigned_practice"
    )


def public_practice_enabled(test: dict) -> bool:
    return bool(test.get("public_practice_enabled"))


def non_public_reserved_ids(skill: str, reserved_ids: Iterable[str]) -> set[str]:
    """Keep the live-exam backstop, except for papers explicitly made public."""
    ids = {str(value) for value in reserved_ids if value}
    if not ids:
        return set()
    try:
        rows = (supabase_admin.table(_test_table(skill))
                .select("id,public_practice_enabled").in_("id", list(ids))
                .execute().data) or []
        public_ids = {str(row["id"]) for row in rows if row.get("public_practice_enabled")}
        return ids - public_ids
    except Exception:  # fail closed: a lookup failure never publishes an exam paper
        logger.exception("[mock-correction] public reservation lookup failed skill=%s", skill)
        return ids


def scored_paper_blockers(skill: str, test_id: str, *, db=None) -> list[str]:
    """Return item ids that must not enter an auto-scored delivery."""
    rows = _current_explanation_rows(
        skill, test_id, db=db, tolerate_unavailable=False
    )
    if not rows:  # non-Cambridge/legacy content keeps the existing contract
        return []
    if len(rows) != 40:
        return ["paper_missing_web_objects"]
    return [
        str(row.get("object_id")) for row in rows
        if row.get("serving_status") not in AUTO_SERVABLE
    ]


def assert_scored_paper_ready(skill: str, test_id: str, *, db=None) -> None:
    blockers = scored_paper_blockers(skill, test_id, db=db)
    if blockers:
        raise PolicyError(
            "Đề còn câu bị khóa khỏi bài chấm điểm: " + ", ".join(blockers[:5])
        )


def assert_explanation_content_ready(
    skill: str, test_id: str, version: str | None = None,
) -> str:
    """Public guard for policies that promise explanations can be revealed."""
    return _assert_public_content_ready(skill, test_id, version)


def apply_scoring_overrides(skill: str, test_id: str, answer_key: list[dict]) -> list[dict]:
    """Overlay only human-adjudicated matcher variants on the runtime key."""
    overrides: dict[int, dict] = {}
    for row in _current_explanation_rows(skill, test_id):
        payload = row.get("payload") or {}
        adjudication = (payload.get("audit") or {}).get("release_adjudication") or {}
        if adjudication.get("override_version") != "cambridge-release-overrides/1.0":
            continue
        answer = (payload.get("item") or {}).get("answer") or {}
        accepted = [str(value) for value in (answer.get("accepted_forms") or []) if value is not None]
        if accepted:
            overrides[int(row["question_number"])] = {
                "answer": str(answer.get("canonical") or accepted[0]),
                "alternatives": accepted,
            }
    if not overrides:
        return answer_key
    out: list[dict] = []
    for source in answer_key:
        item = dict(source)
        try:
            override = overrides.get(int(item.get("q_num")))
        except (TypeError, ValueError):
            override = None
        if override:
            item.update(override)
        out.append(item)
    return out


def record_answer_commit(
    skill: str,
    attempt_id: str,
    learner_id: str | None,
    question_number: int,
    answer: str,
    *,
    client_occurred_at: str | None = None,
    event_id: str | None = None,
) -> bool:
    """Append answer evidence without making autosave depend on analytics."""
    if not learner_id:
        return False
    try:
        result = supabase_admin.rpc("fn_record_mock_item_answer", {
            "p_skill": skill,
            "p_attempt_id": str(attempt_id),
            "p_learner_id": str(learner_id),
            "p_question_number": int(question_number),
            "p_answer": answer or "",
            "p_client_occurred_at": client_occurred_at,
            "p_event_id": event_id or str(uuid4()),
        }).execute().data
        return bool(result)
    except Exception:  # noqa: BLE001 — learning ledger failure is surfaced in ACK
        logger.exception(
            "[mock-correction] answer observation failed skill=%s attempt=%s q=%s",
            skill, attempt_id, question_number,
        )
        return False


def _current_explanation_rows(
    skill: str,
    test_id: str,
    *,
    db=None,
    tolerate_unavailable: bool = True,
) -> list[dict]:
    client = db or supabase_admin
    try:
        return (client.table("web_explanation_objects").select(
            "object_id,question_number,content_version,payload,rights_status,"
            "editorial_status,serving_status",
        ).eq(_test_fk(skill), str(test_id)).eq("is_current", True)
         .order("question_number").execute().data) or []
    except Exception:
        if not tolerate_unavailable:
            raise CorrectionError("Không kiểm tra được item-level serving gates.")
        # Additive rollout: legacy reads keep their old contract if migration
        # has not landed yet. Admission callers use fail-closed strict mode.
        logger.warning(
            "[mock-correction] explanation lookup unavailable skill=%s test=%s",
            skill, test_id,
        )
        return []


def _capture_row(skill: str, attempt_id: str) -> dict | None:
    rows = (supabase_admin.table("mock_post_test_captures").select("*")
            .eq(_attempt_fk(skill), str(attempt_id)).limit(1).execute().data) or []
    return rows[0] if rows else None


def _class_policy(attempt: dict) -> dict:
    item_id = attempt.get("class_assignment_item_id")
    if not item_id:
        return {}
    items = (supabase_admin.table("class_assignment_items")
             .select("assignment_id").eq("id", item_id).limit(1).execute().data) or []
    if not items:
        return {}
    assignment = _one("class_assignments", items[0]["assignment_id"], "id,content_config") or {}
    return ((assignment.get("content_config") or {}).get("correction_policy") or {})


def _effective_policy(skill: str, attempt: dict) -> dict:
    if attempt.get("sitting_id"):
        sitting = _one(
            "mock_exam_sittings", attempt["sitting_id"],
            "id,mock_exam_id,status,sealed",
        ) or {}
        exam = _one(
            "mock_exams", sitting.get("mock_exam_id"),
            "id,web_explanation_mode,web_explanations_released_at,"
            "web_explanation_content_version,post_test_capture_required",
        ) or {}
        return {
            "scope": "mock_exam",
            "mode": exam.get("web_explanation_mode") or "disabled",
            "released_at": exam.get("web_explanations_released_at"),
            "content_version": exam.get("web_explanation_content_version"),
            "capture_required": bool(exam.get("post_test_capture_required")),
            "result_released": sitting.get("status") == "released" and not sitting.get("sealed"),
        }
    class_policy = _class_policy(attempt)
    if class_policy:
        return {
            "scope": "class_assignment",
            "mode": class_policy.get("web_explanation_mode") or "disabled",
            "released_at": class_policy.get("released_at"),
            "content_version": class_policy.get("content_version"),
            "capture_required": bool(class_policy.get("post_test_capture_required", True)),
            "result_released": True,
        }
    test = _one(
        _test_table(skill), attempt.get("test_id"),
        "id,public_practice_enabled,web_explanation_mode,"
        "web_explanations_released_at,web_explanation_content_version",
    ) or {}
    return {
        "scope": "public_practice",
        "mode": test.get("web_explanation_mode") or "disabled",
        "released_at": test.get("web_explanations_released_at"),
        "content_version": test.get("web_explanation_content_version"),
        "capture_required": True,
        "result_released": bool(test.get("public_practice_enabled")),
    }


def explanation_access(skill: str, attempt: dict, *, admin_preview: bool = False) -> dict | None:
    rows = _current_explanation_rows(skill, attempt.get("test_id"))
    if not rows:
        return None  # no new content: preserve the legacy review contract
    policy = _effective_policy(skill, attempt)
    version = policy.get("content_version") or rows[0].get("content_version")
    selected = [row for row in rows if row.get("content_version") == version]
    if not selected:
        return {
            "has_content": True, "allowed": False, "reason": "content_version_unavailable",
            "content_version": version, "items": {}, "policy": policy,
        }
    ready = [row for row in selected if row.get("rights_status") in READY_RIGHTS
             and row.get("editorial_status") in READY_EDITORIAL
             and row.get("serving_status") in AUTO_SERVABLE]
    if admin_preview:
        return {
            "has_content": True, "allowed": True, "reason": "admin_preview",
            "content_version": version,
            "items": {row["question_number"]: row for row in selected},
            "policy": policy,
        }
    # Release is a paper-level gate. A partial manual approval must never turn
    # into a partially visible answer set just because one row is ready.
    if len(selected) != 40 or len(ready) != len(selected):
        return {
            "has_content": True, "allowed": False, "reason": "content_release_gates_blocked",
            "content_version": version, "items": {}, "policy": policy,
        }
    mode = policy.get("mode") or "disabled"
    if mode == "disabled":
        allowed, reason = False, "disabled_by_admin"
    elif mode == "with_result":
        allowed = bool(policy.get("result_released"))
        reason = "released_with_result" if allowed else "waiting_for_admin_result_release"
    elif mode == "admin_release":
        allowed = bool(policy.get("released_at"))
        reason = "released_by_admin" if allowed else "waiting_for_admin_explanation_release"
    elif mode == "immediate_after_capture":
        allowed, reason = True, "immediate_after_capture"
    else:
        allowed, reason = False, "invalid_policy"
    if allowed and policy.get("capture_required") and not _capture_row(skill, attempt["id"]):
        allowed, reason = False, "post_test_capture_required"
    return {
        "has_content": True,
        "allowed": allowed,
        "reason": reason,
        "content_version": version,
        "items": {row["question_number"]: row for row in ready} if allowed else {},
        "policy": policy,
    }


def public_access_metadata(access: dict | None) -> dict | None:
    """Return the learner-safe release state without leaking internal policy data."""
    if not access:
        return None
    return {
        "has_content": bool(access.get("has_content")),
        "allowed": bool(access.get("allowed")),
        "reason": access.get("reason"),
        "content_version": access.get("content_version"),
    }


def attach_web_explanations(
    skill: str,
    attempt: dict,
    review: list[dict],
    *,
    admin_preview: bool = False,
) -> dict | None:
    """Attach the versioned object only after every serving gate passes."""
    access = explanation_access(skill, attempt, admin_preview=admin_preview)
    if not access or not access.get("allowed"):
        return public_access_metadata(access)
    by_question = access.get("items") or {}
    for item in review:
        try:
            question_number = int(item.get("q_num") or item.get("question_number"))
        except (TypeError, ValueError):
            continue
        row = by_question.get(question_number)
        if row:
            item["web_explanation_object"] = row.get("payload") or {}
    return public_access_metadata(access)


def capture_required_envelope(skill: str, attempt: dict, grading: Iterable[dict]) -> dict | None:
    if not attempt.get("user_id"):
        return None
    rows = _current_explanation_rows(skill, attempt.get("test_id"))
    if not rows:
        return None
    policy = _effective_policy(skill, attempt)
    if (not policy.get("capture_required")
            or (policy.get("mode") or "disabled") == "disabled"
            or _capture_row(skill, attempt["id"])):
        return None
    states = []
    for row in grading:
        states.append({
            "question_number": int(row.get("q_num") or 0),
            "blank": not bool(str(row.get("user_answer") or "").strip()),
        })
    return {
        "attempt_id": attempt["id"],
        "post_test_capture_required": True,
        "question_states": states,
        "result_withheld": True,
    }


def finalize_item_observations(skill: str, attempt: dict, grading: Iterable[dict]) -> bool:
    learner_id = attempt.get("user_id")
    if not learner_id:
        return False
    fk = _attempt_fk(skill)
    submitted_at = attempt.get("submitted_at") or _now_iso()
    rows = []
    object_ids = {
        row["question_number"]: row["object_id"]
        for row in _current_explanation_rows(skill, attempt.get("test_id"))
    }
    for grade in grading:
        question_number = int(grade.get("q_num") or 0)
        if not 1 <= question_number <= 40:
            continue
        rows.append({
            "learner_id": learner_id,
            "skill": skill,
            fk: attempt["id"],
            "object_id": object_ids.get(question_number),
            "question_number": question_number,
            "final_submitted_answer": grade.get("user_answer") or "",
            "is_correct": bool(grade.get("correct")),
            "score_awarded": 1 if grade.get("correct") else 0,
            "submitted_at": submitted_at,
        })
    try:
        if rows:
            supabase_admin.table("mock_item_attempts").upsert(
                rows, on_conflict=f"{fk},question_number",
            ).execute()
        return True
    except Exception:  # noqa: BLE001
        logger.exception("[mock-correction] final observation sync failed attempt=%s", attempt.get("id"))
        return False


def _payload_hash(items: list[dict], skipped_reason: str | None) -> str:
    canonical = json.dumps(
        {"items": items, "skipped_reason": skipped_reason},
        ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def record_post_test_capture(
    skill: str,
    attempt_id: str,
    learner_id: str,
    items: list[dict],
    *,
    skipped_reason: str | None = None,
) -> dict:
    attempt = fetch_owned_submitted_attempt(skill, attempt_id, learner_id)
    expected = len(attempt.get("grading_details") or [])
    normalized: list[dict] = []
    seen: set[int] = set()
    for item in items:
        q = int(item.get("question_number") or 0)
        confidence = item.get("confidence")
        attribution = list(item.get("self_attribution") or [])
        if q in seen or not 1 <= q <= 40:
            raise PolicyError("Post-test capture có số câu trùng hoặc ngoài 1–40.")
        if not isinstance(confidence, int) or not 1 <= confidence <= 5:
            raise PolicyError("Confidence của mọi câu phải nằm trong 1–5.")
        if len(attribution) > 2 or any(code not in SELF_ATTRIBUTION_CODES for code in attribution):
            raise PolicyError("Self-attribution không hợp lệ hoặc vượt quá hai lựa chọn.")
        seen.add(q)
        normalized.append({
            "question_number": q,
            "confidence": confidence,
            "self_attribution": attribution,
        })
    if not skipped_reason and expected and len(normalized) != expected:
        raise PolicyError(f"Cần confidence cho đủ {expected} câu trước khi xem chữa bài.")
    digest = _payload_hash(normalized, skipped_reason)
    existing = _capture_row(skill, attempt_id)
    if existing:
        if existing.get("payload_hash") != digest:
            raise CaptureConflictError("Post-test capture đã chốt với nội dung khác.")
        return {"capture": existing, "attempt": attempt, "replayed": True}

    fk = _attempt_fk(skill)
    for item in normalized:
        patch = {
            "learner_id": learner_id,
            "skill": skill,
            fk: attempt_id,
            "question_number": item["question_number"],
            "post_test_confidence": item["confidence"],
            "pre_reveal_self_attribution": item["self_attribution"],
        }
        supabase_admin.table("mock_item_attempts").upsert(
            patch, on_conflict=f"{fk},question_number",
        ).execute()
    capture = {
        "learner_id": learner_id,
        "skill": skill,
        fk: attempt_id,
        "status": "skipped" if skipped_reason else "completed",
        "payload_hash": digest,
        "item_count": len(normalized),
        "skipped_reason": skipped_reason,
    }
    inserted = supabase_admin.table("mock_post_test_captures").insert(capture).execute().data or []
    if not inserted:
        raise CorrectionError("Không chốt được post-test capture.")
    return {"capture": inserted[0], "attempt": attempt, "replayed": False}


def _validate_correction_payload(event_name: str, payload: dict) -> dict:
    if event_name not in CORRECTION_EVENT_NAMES:
        raise PolicyError("Correction event không hợp lệ.")
    if not isinstance(payload, dict):
        raise PolicyError("Payload correction event phải là object.")

    normalized = dict(payload)

    def required_text(key: str, limit: int) -> str:
        value = str(normalized.get(key) or "").strip()
        if not value or len(value) > limit:
            raise PolicyError(f"Trường {key} bắt buộc và không được vượt quá {limit} ký tự.")
        return value

    def evidence_selection() -> dict:
        raw = normalized.get("evidence_selection")
        if raw is None:
            return {}
        if not isinstance(raw, dict):
            raise PolicyError("evidence_selection phải là object.")
        kind = str(raw.get("kind") or "")
        if kind == "reading_text":
            selected = str(raw.get("selected_text") or "").strip()
            passage = raw.get("passage_order")
            paragraph = raw.get("paragraph_index")
            if (not 8 <= len(selected) <= 800 or not isinstance(passage, int)
                    or isinstance(passage, bool) or passage < 1):
                raise PolicyError("Vùng evidence Reading không hợp lệ.")
            if paragraph is not None and (not isinstance(paragraph, int)
                                          or isinstance(paragraph, bool) or paragraph < 1):
                raise PolicyError("Vị trí đoạn Reading không hợp lệ.")
            return {
                "kind": kind, "passage_order": passage,
                "paragraph_index": paragraph, "selected_text": selected,
            }
        if kind == "audio_timestamp":
            seconds = raw.get("seconds")
            if not isinstance(seconds, (int, float)) or isinstance(seconds, bool) or not 0 <= seconds <= 21600:
                raise PolicyError("Mốc audio evidence không hợp lệ.")
            return {"kind": kind, "seconds": round(float(seconds), 2)}
        if kind in {"not_found", "restored"}:
            return {"kind": kind}
        raise PolicyError("Loại evidence_selection không hợp lệ.")

    if event_name == "evidence_attempt_submitted":
        normalized["evidence_response"] = required_text("evidence_response", 2000)
        if "evidence_selection" in normalized:
            normalized["evidence_selection"] = evidence_selection()
    elif event_name == "hint_revealed":
        if normalized.get("hint_type") not in {"location", "decisive"}:
            raise PolicyError("hint_type phải là location hoặc decisive.")
    elif event_name == "correction_output_submitted":
        normalized["corrected_answer"] = required_text("corrected_answer", 2000)
        normalized["evidence_response"] = required_text("evidence_response", 2000)
        normalized["error_mechanism"] = required_text("error_mechanism", 1000)
        normalized["next_action"] = required_text("next_action", 1000)
        if "evidence_selection" in normalized:
            normalized["evidence_selection"] = evidence_selection()
        code_patterns = {
            "error_mechanism_code": r"(?:[a-z0-9][a-z0-9_\-]*|[RL]\d{2}-[A-Z0-9][A-Z0-9_\-]*)",
            "next_action_code": r"[a-z0-9][a-z0-9_\-]*",
        }
        for key, pattern in code_patterns.items():
            if key in normalized:
                value = str(normalized.get(key) or "").strip()
                if not value or len(value) > 80 or not re.fullmatch(pattern, value):
                    raise PolicyError(f"{key} không hợp lệ.")
                normalized[key] = value
    return normalized


def record_correction_event(
    skill: str,
    attempt_id: str,
    learner_id: str,
    question_number: int,
    *,
    event_id: str,
    event_name: str,
    payload: dict,
    client_occurred_at: str | None = None,
    client_version: str | None = None,
) -> dict:
    """Persist one learner action through the DB-owned correction state machine."""
    attempt = fetch_owned_submitted_attempt(skill, attempt_id, learner_id)
    access = explanation_access(skill, attempt)
    if not access or not access.get("allowed"):
        raise PolicyError("Web explanation chưa được admin cho phép hiển thị cho lượt làm này.")
    if int(question_number) not in (access.get("items") or {}):
        raise NotFoundError("Không tìm thấy web explanation cho câu hỏi này.")
    normalized = _validate_correction_payload(event_name, payload)
    try:
        result = supabase_admin.rpc("fn_record_mock_correction_event", {
            "p_event_id": str(event_id),
            "p_skill": skill,
            "p_attempt_id": str(attempt_id),
            "p_learner_id": str(learner_id),
            "p_question_number": int(question_number),
            "p_event_name": event_name,
            "p_payload": normalized,
            "p_client_occurred_at": client_occurred_at,
            "p_client_version": client_version,
        }).execute().data
    except Exception as exc:  # noqa: BLE001 — translate stable DB contract errors
        message = str(exc)
        if "event_id_conflict" in message or "23505" in message:
            raise EventConflictError("Event id đã được dùng cho một nội dung khác.") from exc
        if "transition_requires" in message:
            raise PolicyError("Thứ tự mở gợi ý không hợp lệ; hãy tiếp tục từ bước đã lưu.") from exc
        if "item_not_found" in message or "P0002" in message:
            raise NotFoundError("Không tìm thấy item đã nộp để ghi tiến trình sửa bài.") from exc
        if "evidence_required" in message or "output_incomplete" in message:
            raise PolicyError("Nội dung sửa bài chưa đầy đủ hoặc vượt giới hạn.") from exc
        raise CorrectionError("Không ghi được tiến trình sửa bài.") from exc
    if not isinstance(result, dict) or not result.get("state"):
        raise CorrectionError("Backend không trả lại correction state canonical.")
    return result


def result_payload(skill: str, attempt: dict) -> dict:
    grading = attempt.get("grading_details") or []
    payload = {
        "attempt_id": attempt["id"],
        "score": attempt.get("score"),
        "max_score": len(grading),
        "band_estimate": attempt.get("band_estimate"),
        "per_question": grading,
    }
    if skill == "reading":
        payload["skill_breakdown"] = attempt.get("skill_breakdown") or {}
        by_part: dict[str, dict[str, int]] = {}
        for row in grading:
            key = f"p{row.get('passage_order') or '?'}"
            bucket = by_part.setdefault(key, {"correct": 0, "total": 0})
            bucket["total"] += 1
            bucket["correct"] += int(bool(row.get("correct")))
        payload["by_part"] = by_part
    else:
        payload["trap_analytics"] = attempt.get("trap_analytics") or {}
        section_breakdown: dict[str, dict[str, int]] = {}
        for row in grading:
            key = str(row.get("section") or row.get("section_number") or "unknown")
            bucket = section_breakdown.setdefault(key, {"correct": 0, "total": 0})
            bucket["total"] += 1
            bucket["correct"] += int(bool(row.get("correct")))
        payload["section_breakdown"] = section_breakdown
    return payload


def learner_result_payload(skill: str, attempt: dict) -> dict | None:
    """Return a score only when its canonical release boundary permits it."""
    policy = _effective_policy(skill, attempt)
    if policy.get("scope") == "mock_exam" and not policy.get("result_released"):
        return None
    return result_payload(skill, attempt)


def _log_release(scope_type: str, scope_id: str, action: str, before: dict,
                 after: dict, actor_id: str, reason: str | None = None) -> None:
    supabase_admin.table("mock_correction_release_events").insert({
        "scope_type": scope_type,
        "scope_id": str(scope_id),
        "action": action,
        "previous_state": before,
        "new_state": after,
        "reason": reason,
        "actor_id": actor_id,
    }).execute()


def update_class_assignment_policy(assignment_id: str, patch: dict, actor_id: str) -> dict:
    assignment = _one(
        "class_assignments", assignment_id, "id,skill,content_id,content_config",
    )
    if not assignment:
        raise NotFoundError("Không tìm thấy bài giao.")
    if assignment.get("skill") not in SKILLS:
        raise PolicyError("Correction policy chỉ áp dụng cho Reading/Listening.")
    config = dict(assignment.get("content_config") or {})
    before = dict(config.get("correction_policy") or {})
    after = {**before, **patch}
    mode = after.get("web_explanation_mode", "disabled")
    if mode not in PRACTICE_EXPLANATION_MODES:
        raise PolicyError("Chế độ explanation của bài luyện không hợp lệ.")
    if patch.get("release_now"):
        if mode != "admin_release":
            raise PolicyError("Chỉ phát tay explanation ở chế độ chờ admin duyệt.")
        version = assert_explanation_content_ready(
            assignment["skill"],
            assignment.get("content_id"),
            after.get("content_version"),
        )
        after["content_version"] = version
        after["released_at"] = _now_iso()
        after["released_by"] = actor_id
    elif mode == "admin_release" and (
        before.get("web_explanation_mode") != "admin_release"
        or before.get("content_version") != after.get("content_version")
    ):
        # Entering admin-release mode, or selecting a new version, requires a
        # fresh explicit approval. Never carry a stale release timestamp.
        after.pop("released_at", None)
        after.pop("released_by", None)
    after.pop("release_now", None)
    config["correction_policy"] = after
    rows = (supabase_admin.table("class_assignments").update({"content_config": config})
            .eq("id", assignment_id).execute().data) or []
    if not rows:
        raise CorrectionError("Không cập nhật được chính sách chữa bài.")
    _log_release("class_assignment", assignment_id, "policy_updated", before, after, actor_id)
    return rows[0]


def update_mock_exam_policy(exam_id: str, patch: dict, actor_id: str) -> dict:
    exam = _one("mock_exams", exam_id)
    if not exam:
        raise NotFoundError("Không tìm thấy mock exam.")
    mode = patch.get("web_explanation_mode", exam.get("web_explanation_mode") or "with_result")
    if mode not in MOCK_EXPLANATION_MODES:
        raise PolicyError("Chế độ explanation của mock exam không hợp lệ.")
    before = {
        "web_explanation_mode": exam.get("web_explanation_mode"),
        "web_explanations_released_at": exam.get("web_explanations_released_at"),
        "web_explanation_content_version": exam.get("web_explanation_content_version"),
        "post_test_capture_required": exam.get("post_test_capture_required"),
    }
    update = {k: v for k, v in patch.items() if k in {
        "web_explanation_mode", "web_explanation_content_version", "post_test_capture_required",
    }}
    if patch.get("release_now"):
        update["web_explanations_released_at"] = _now_iso()
        update["web_explanations_released_by"] = actor_id
    elif mode == "admin_release" and (
        before.get("web_explanation_mode") != "admin_release"
        or update.get("web_explanation_content_version", before.get("web_explanation_content_version"))
        != before.get("web_explanation_content_version")
    ):
        update["web_explanations_released_at"] = None
        update["web_explanations_released_by"] = None
    rows = (supabase_admin.table("mock_exams").update(update)
            .eq("id", exam_id).execute().data) or []
    if not rows:
        raise CorrectionError("Không cập nhật được chính sách mock exam.")
    after = {k: rows[0].get(k) for k in before}
    _log_release("mock_exam", exam_id, "policy_updated", before, after, actor_id)
    return rows[0]


def _assert_public_content_ready(skill: str, test_id: str, version: str | None) -> str:
    rows = _current_explanation_rows(skill, test_id)
    if version:
        rows = [row for row in rows if row.get("content_version") == version]
    if len(rows) != 40:
        raise PolicyError("Đề chưa có đủ 40 web explanation objects ở version đã chọn.")
    blocked = [row["object_id"] for row in rows
               if row.get("rights_status") not in READY_RIGHTS
               or row.get("editorial_status") not in READY_EDITORIAL
               or row.get("serving_status") not in AUTO_SERVABLE]
    if blocked:
        raise PolicyError(
            "Đề còn item chưa qua rights/editorial/matcher gate: " + ", ".join(blocked[:5])
        )
    return rows[0]["content_version"]


def update_public_test_policy(skill: str, test_id: str, patch: dict, actor_id: str) -> dict:
    test = _one(_test_table(skill), test_id)
    if not test:
        raise NotFoundError("Không tìm thấy đề.")
    mode = patch.get("web_explanation_mode", test.get("web_explanation_mode") or "disabled")
    if mode not in PRACTICE_EXPLANATION_MODES:
        raise PolicyError("Chế độ explanation public không hợp lệ.")
    version = patch.get("web_explanation_content_version") or test.get("web_explanation_content_version")
    if patch.get("public_practice_enabled"):
        version = _assert_public_content_ready(skill, test_id, version)
    before = {k: test.get(k) for k in (
        "public_practice_enabled", "web_explanation_mode",
        "web_explanations_released_at", "web_explanation_content_version",
    )}
    update = {k: v for k, v in patch.items() if k in {
        "public_practice_enabled", "web_explanation_mode", "web_explanation_content_version",
    }}
    if version:
        update["web_explanation_content_version"] = version
    if patch.get("release_now"):
        update["web_explanations_released_at"] = _now_iso()
        update["web_explanations_released_by"] = actor_id
    elif mode == "admin_release" and (
        before.get("web_explanation_mode") != "admin_release"
        or update.get("web_explanation_content_version", before.get("web_explanation_content_version"))
        != before.get("web_explanation_content_version")
    ):
        update["web_explanations_released_at"] = None
        update["web_explanations_released_by"] = None
    rows = (supabase_admin.table(_test_table(skill)).update(update)
            .eq("id", test_id).execute().data) or []
    if not rows:
        raise CorrectionError("Không cập nhật được chính sách public practice.")
    after = {k: rows[0].get(k) for k in before}
    _log_release(f"{skill}_test", test_id, "public_policy_updated", before, after, actor_id)
    return rows[0]


def approve_content_version(
    content_version: str,
    actor_id: str,
    *,
    rights_approved: bool,
    editorial_approved: bool,
    reason: str | None = None,
) -> dict:
    before_rows: list[dict] = []
    start = 0
    while True:
        page = (supabase_admin.table("web_explanation_objects")
                .select("id,rights_status,editorial_status,binding_status")
                .eq("content_version", content_version)
                .range(start, start + 999).execute().data) or []
        before_rows.extend(page)
        if len(page) < 1000:
            break
        start += 1000
    if len(before_rows) != 2880:
        raise PolicyError("Chỉ duyệt collection hoàn chỉnh 2.880 objects.")
    unbound = [row for row in before_rows if row.get("binding_status") != "BOUND"]
    if unbound:
        raise PolicyError("Không thể duyệt collection còn object UNBOUND_INTERNAL_QA.")
    update: dict[str, Any] = {}
    if rights_approved:
        update["rights_status"] = "APPROVED"
    if editorial_approved:
        update["editorial_status"] = "APPROVED"
    if not update:
        raise PolicyError("Cần chọn ít nhất một gate để duyệt.")
    supabase_admin.table("web_explanation_objects").update(update).eq(
        "content_version", content_version,
    ).execute()
    before = {
        "objects": len(before_rows),
        "rights_statuses": sorted({row.get("rights_status") for row in before_rows}),
        "editorial_statuses": sorted({row.get("editorial_status") for row in before_rows}),
    }
    after = {**before, **update}
    _log_release("content_version", content_version, "content_gate_approved",
                 before, after, actor_id, reason)
    return {"content_version": content_version, "updated": len(before_rows), **update}


def content_health(content_version: str | None = None) -> dict:
    """Return complete, paginated release-gate counts for admin QA."""
    rows: list[dict] = []
    start = 0
    while True:
        query = supabase_admin.table("web_explanation_objects").select(
            "content_version,skill,rights_status,editorial_status,serving_status,"
            "binding_status,is_current"
        )
        if content_version:
            query = query.eq("content_version", content_version)
        page = query.range(start, start + 999).execute().data or []
        rows.extend(page)
        if len(page) < 1000:
            break
        start += 1000

    counts: dict[str, int] = {}
    versions: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = "/".join(str(row.get(name)) for name in (
            "skill", "rights_status", "editorial_status", "serving_status"
        ))
        counts[key] = counts.get(key, 0) + 1
        version = str(row.get("content_version") or "unknown")
        bucket = versions.setdefault(version, {
            "object_count": 0,
            "current_count": 0,
            "rights_blocked": 0,
            "editorial_blocked": 0,
            "serving_blocked": 0,
            "unbound_internal_qa": 0,
        })
        bucket["object_count"] += 1
        bucket["current_count"] += int(bool(row.get("is_current")))
        bucket["rights_blocked"] += int(row.get("rights_status") not in READY_RIGHTS)
        bucket["editorial_blocked"] += int(row.get("editorial_status") not in READY_EDITORIAL)
        bucket["serving_blocked"] += int(row.get("serving_status") not in AUTO_SERVABLE)
        bucket["unbound_internal_qa"] += int(row.get("binding_status") == "UNBOUND_INTERNAL_QA")
    return {
        "content_version": content_version,
        "object_count": len(rows),
        "counts": counts,
        "versions": versions,
    }


def _rows_by_ids(table: str, select: str, column: str, values: list[str]) -> list[dict]:
    rows: list[dict] = []
    for index in range(0, len(values), 200):
        rows.extend((supabase_admin.table(table).select(select)
                     .in_(column, values[index:index + 200]).execute().data) or [])
    return rows


def admin_item_timeline(item_attempt_id: str) -> dict:
    item = _one("mock_item_attempts", item_attempt_id)
    if not item:
        raise NotFoundError("Không tìm thấy item attempt.")
    sessions = (supabase_admin.table("mock_correction_sessions").select("*")
                .eq("item_attempt_id", item_attempt_id).limit(1).execute().data) or []
    events = (supabase_admin.table("mock_runtime_events").select(
        "event_id,event_name,schema_version,sequence_no,client_occurred_at,"
        "server_received_at,client_version,payload"
    ).eq("item_attempt_id", item_attempt_id)
              .order("sequence_no").order("server_received_at").limit(500).execute().data) or []
    objects = []
    if item.get("object_id"):
        objects = (supabase_admin.table("web_explanation_objects").select(
            "object_id,content_version,source_test_key,skill,book_number,test_number,"
            "question_number,audit_verdict,rights_status,editorial_status,serving_status,is_current"
        ).eq("object_id", item["object_id"]).eq("is_current", True)
                   .limit(1).execute().data) or []
    return {
        "item": item,
        "correction": sessions[0] if sessions else None,
        "content": objects[0] if objects else None,
        "events": events,
        "events_truncated": len(events) == 500,
    }


def admin_performance_summary(
    *,
    learner_id: str | None = None,
    skill: str | None = None,
    class_assignment_id: str | None = None,
    mock_exam_id: str | None = None,
) -> dict:
    """Aggregate the pre-reveal evidence the spec asks admins to monitor."""
    if skill is not None and skill not in SKILLS:
        raise PolicyError("Kỹ năng chỉ có thể là reading hoặc listening.")
    if class_assignment_id and mock_exam_id:
        raise PolicyError("Chỉ lọc theo một scope: class assignment hoặc mock exam.")
    columns = (
        "id,learner_id,skill,reading_attempt_id,listening_attempt_id,object_id,"
        "question_number,first_committed_answer,final_submitted_answer,revision_count,"
        "post_test_confidence,pre_reveal_self_attribution,is_correct,score_awarded,submitted_at"
    )

    scoped_attempts: dict[str, set[str]] | None = None
    if class_assignment_id:
        class_items = (supabase_admin.table("class_assignment_items").select("id")
                       .eq("assignment_id", class_assignment_id).execute().data) or []
        item_ids = [row["id"] for row in class_items]
        scoped_attempts = {"reading": set(), "listening": set()}
        if item_ids:
            for current_skill in SKILLS:
                attempts = (supabase_admin.table(_attempt_table(current_skill)).select("id")
                            .in_("class_assignment_item_id", item_ids).execute().data) or []
                scoped_attempts[current_skill] = {str(row["id"]) for row in attempts}
    elif mock_exam_id:
        sittings = (supabase_admin.table("mock_exam_sittings").select(
            "reading_attempt_id,listening_attempt_id"
        ).eq("mock_exam_id", mock_exam_id).execute().data) or []
        scoped_attempts = {
            current_skill: {
                str(row.get(_attempt_fk(current_skill))) for row in sittings
                if row.get(_attempt_fk(current_skill))
            }
            for current_skill in SKILLS
        }

    def load_rows(current_skill: str | None, attempt_ids: set[str] | None = None) -> list[dict]:
        if attempt_ids is not None and not attempt_ids:
            return []
        query = supabase_admin.table("mock_item_attempts").select(columns)
        if learner_id:
            query = query.eq("learner_id", learner_id)
        if current_skill:
            query = query.eq("skill", current_skill)
        if attempt_ids is not None and current_skill:
            query = query.in_(_attempt_fk(current_skill), list(attempt_ids))
        return (query.order("submitted_at", desc=True).limit(5001).execute().data) or []

    if scoped_attempts is None:
        rows = load_rows(skill)
    else:
        rows = []
        for current_skill in sorted(SKILLS if skill is None else {skill}):
            rows.extend(load_rows(current_skill, scoped_attempts[current_skill]))
        rows.sort(key=lambda row: str(row.get("submitted_at") or ""), reverse=True)
    truncated = len(rows) > 5000
    rows = rows[:5000]

    scored = [row for row in rows if row.get("is_correct") is not None]
    revisions = [row for row in rows if int(row.get("revision_count") or 0) > 0]
    confidences = [int(row["post_test_confidence"]) for row in rows
                   if row.get("post_test_confidence") is not None]
    attributions: dict[str, int] = {}
    for row in rows:
        for code in row.get("pre_reveal_self_attribution") or []:
            attributions[str(code)] = attributions.get(str(code), 0) + 1
    high_confidence_errors = [row for row in scored
                              if not row.get("is_correct")
                              and int(row.get("post_test_confidence") or 0) >= 4]
    item_ids = [str(row["id"]) for row in rows]
    sessions = _rows_by_ids(
        "mock_correction_sessions",
        "id,item_attempt_id,state,last_sequence_no,updated_at",
        "item_attempt_id",
        item_ids,
    ) if item_ids else []
    session_by_item = {str(row["item_attempt_id"]): row for row in sessions}
    for row in rows:
        session = session_by_item.get(str(row["id"]))
        row["correction_state"] = session.get("state") if session else None
        row["correction_updated_at"] = session.get("updated_at") if session else None
        row["correction_event_count"] = int(session.get("last_sequence_no") or 0) if session else 0

    def reached(rank: int) -> int:
        return sum(
            1 for session in sessions
            if CORRECTION_STATE_RANK.get(str(session.get("state")), 0) >= rank
        )

    wrong_items = [row for row in scored if not row.get("is_correct")]
    wrong_item_ids = {str(row["id"]) for row in wrong_items}
    correction_output_items = sum(
        1 for session in sessions
        if str(session.get("item_attempt_id")) in wrong_item_ids
        and CORRECTION_STATE_RANK.get(str(session.get("state")), 0) >= 5
    )
    return {
        "filters": {
            "learner_id": learner_id,
            "skill": skill,
            "class_assignment_id": class_assignment_id,
            "mock_exam_id": mock_exam_id,
        },
        "truncated": truncated,
        "summary": {
            "observed_items": len(rows),
            "scored_items": len(scored),
            "correct_items": sum(1 for row in scored if row.get("is_correct")),
            "accuracy": (round(sum(1 for row in scored if row.get("is_correct")) / len(scored), 4)
                         if scored else None),
            "revised_items": len(revisions),
            "revision_rate": round(len(revisions) / len(rows), 4) if rows else None,
            "average_confidence": (round(sum(confidences) / len(confidences), 2)
                                   if confidences else None),
            "high_confidence_errors": len(high_confidence_errors),
            "self_attribution_counts": dict(sorted(attributions.items())),
            "wrong_items": len(wrong_items),
            "correction_output_items": correction_output_items,
            "correction_completion_rate": (
                round(correction_output_items / len(wrong_items), 4) if wrong_items else None
            ),
            "correction_funnel": {
                "result_seen": len(sessions),
                "evidence_attempted": reached(1),
                "location_hint_seen": reached(2),
                "decisive_hint_seen": reached(3),
                "full_explanation_seen": reached(4),
                "correction_output_submitted": correction_output_items,
                "correction_verified": reached(6),
                "transfer_passed": reached(7),
            },
        },
        "items": rows,
    }
