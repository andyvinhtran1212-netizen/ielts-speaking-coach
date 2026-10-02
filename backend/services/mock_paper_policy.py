"""Purpose-bound paper access and canonical, transactional policy receipts.

Keys live exclusively in the service-only admission snapshot. A failed new
contract lookup never falls back to the old public/sitting fast paths.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException


class PaperPolicyError(RuntimeError):
    def __init__(self, detail: dict, status_code: int = 409):
        self.detail = detail
        self.status_code = status_code
        super().__init__(detail.get("reason", "paper_policy_conflict"))


def unavailable(operation: str, skill: str, paper_id: str) -> PaperPolicyError:
    return PaperPolicyError({
        "operation": operation, "reason": "verification_unavailable",
        "kind": skill, "content_id": str(paper_id), "current_revision": None,
        "dependencies": [], "next_actions": ["retry"],
    }, 503)


def database_policy_error(exc: Exception) -> PaperPolicyError | None:
    """Recognize only our SQL marker; never reinterpret an unrelated failure."""
    if isinstance(exc, PaperPolicyError):
        return exc
    message = getattr(exc, "message", None) or str(exc)
    marker = "mock_paper_policy:"
    if marker not in message:
        return None
    try:
        detail, _ = json.JSONDecoder().raw_decode(message.split(marker, 1)[1])
        if not isinstance(detail, dict) or not isinstance(detail.get("reason"), str):
            return None
    except (ValueError, TypeError):
        return None
    return PaperPolicyError(detail, 503 if detail["reason"] == "verification_unavailable" else 409)


def _rpc(db, name: str, params: dict, *, operation: str, skill: str, paper_id: str) -> dict:
    try:
        result = db.rpc(name, params).execute().data
    except Exception as exc:
        if "public_test_not_found" in str(exc):
            raise HTTPException(404, "Paper not found") from exc
        if "invalid_mock_paper_policy_field" in str(exc):
            raise HTTPException(422, "Invalid paper policy field") from exc
        raise database_policy_error(exc) or unavailable(operation, skill, paper_id) from exc
    if isinstance(result, list) and len(result) == 1:
        result = result[0]
    if not isinstance(result, dict):
        raise unavailable(operation, skill, paper_id)
    return result


def authorize(db, skill: str, paper_id: str, user_id=None, *,
              purpose: str = "delivery", class_item_id=None,
              sitting_id=None, allow_admission: bool = False) -> dict:
    result = _rpc(db, "fn_resolve_mock_paper_access", {
        "p_skill": skill, "p_test_id": str(paper_id),
        "p_user_id": str(user_id) if user_id else None,
        "p_purpose": purpose,
        "p_class_item_id": str(class_item_id) if class_item_id else None,
        "p_sitting_id": str(sitting_id) if sitting_id else None,
        "p_allow_admission": allow_admission,
    }, operation=purpose, skill=skill, paper_id=paper_id)
    if result.get("allowed") is not True:
        if result.get("reason") in {"admission_required", "ambiguous_orphan", "ambiguous_entitlement"}:
            raise HTTPException(409, {
                "operation": purpose, "reason": result["reason"],
                "next_actions": ["admit_attempt"] if result["reason"] == "admission_required"
                else ["contact_operator"],
            })
        raise HTTPException(404, "Paper not found or unavailable")
    if result.get("attempt_purpose") not in {"practice", "assigned_practice", "mock_delivery"}:
        raise unavailable(purpose, skill, paper_id)
    return result


def admit_mock_attempt(db, skill: str, paper_id: str, user_id: str,
                       sitting_id: str, *, affinity_protocol=None) -> dict:
    result = _rpc(db, "fn_admit_mock_paper_attempt", {
        "p_skill": skill, "p_test_id": str(paper_id), "p_user_id": str(user_id),
        "p_sitting_id": str(sitting_id),
        "p_renderer_affinity_protocol": affinity_protocol or "legacy",
    }, operation="admission", skill=skill, paper_id=paper_id)
    if not result.get("attempt_id") or result.get("mock_sitting_id") != str(sitting_id):
        raise unavailable("admission", skill, paper_id)
    return result


def mutate(db, skill: str, paper_id: str, patch: dict, actor_id=None, *,
           expected_revision=None, overlap=None, snapshot_id=None) -> dict:
    result = _rpc(db, "fn_mutate_mock_paper_policy", {
        "p_skill": skill, "p_test_id": str(paper_id), "p_patch": patch,
        "p_actor_id": str(actor_id) if actor_id else None,
        "p_expected_revision": expected_revision,
        "p_overlap": overlap, "p_snapshot_id": str(snapshot_id) if snapshot_id else None,
    }, operation="restore" if snapshot_id else "policy_update", skill=skill, paper_id=paper_id)
    if str(result.get("id", "")) != str(paper_id) or not isinstance(result.get("policy_revision"), int):
        raise unavailable("restore" if snapshot_id else "policy_update", skill, paper_id)
    return result


def inspect_policy(db, skill: str, paper_id: str) -> dict:
    return _rpc(db,"fn_inspect_mock_paper_policy",{"p_skill":skill,"p_test_id":str(paper_id)},
                operation="inspect_policy",skill=skill,paper_id=paper_id)


def load_marking_snapshot(db, skill: str, attempt: dict) -> dict | None:
    """Legacy active/submitted attempts are never silently upgraded."""
    if attempt.get("paper_revision") is None:
        return None
    try:
        rows = db.table("mock_paper_attempt_snapshots").select("*").eq(
            "skill", skill).eq("attempt_id", str(attempt["id"])).limit(1).execute().data or []
    except Exception as exc:
        raise unavailable("marking_snapshot", skill, attempt.get("test_id", "")) from exc
    if (len(rows) != 1 or not isinstance(rows[0].get("marking_rows"), list)
            or not isinstance(rows[0].get("paper_row"), dict)
            or not isinstance(rows[0].get("source_rows"), list)
            or not isinstance(rows[0].get("passage_order_by_id"), dict)
            or not isinstance(rows[0].get("scoring_override_rows"), list)):
        raise unavailable("marking_snapshot", skill, attempt.get("test_id", ""))
    return rows[0]


def frozen_answer_key(db, skill: str, attempt: dict) -> list[dict] | None:
    snapshot = load_marking_snapshot(db, skill, attempt)
    if snapshot is None:
        return None
    from services.mock_response_policy import authored_response_policies, attach_response_policies
    from services import mock_correction_service
    policies = authored_response_policies(skill, snapshot["marking_rows"])
    if skill == "reading":
        from services import reading_test_grader as grader
        key = grader.collect_answer_key(snapshot["marking_rows"], snapshot["passage_order_by_id"],
                                       pinned_policies=policies)
    else:
        from services import listening_test_grader as grader
        key = grader.collect_answer_key(snapshot["marking_rows"], pinned_policies=policies)
    effective = mock_correction_service.apply_scoring_overrides(
        skill, attempt["test_id"], key, frozen_rows=snapshot["scoring_override_rows"])
    return attach_response_policies(effective, policies)


def attempt_receipt(attempt: dict) -> dict:
    return {"attempt_purpose": attempt.get("attempt_purpose"),
            "mock_sitting_id": attempt.get("sitting_id"),
            "paper_revision": attempt.get("paper_revision"),
            "policy_revision": attempt.get("policy_revision")}


def safe_database_error(exc: Exception, *, operator: bool) -> tuple[int, dict] | None:
    error = database_policy_error(exc)
    if error is None:
        return None
    detail = error.detail if operator else {
        "operation": "paper_access", "reason": "verification_unavailable"
        if error.status_code == 503 else "paper_unavailable", "next_actions": ["retry"],
    }
    return error.status_code, detail


def guard_owned_attempt(db, skill: str, attempt: dict, *, purpose: str = "resume") -> None:
    """Call only after HTTP owner/capability authentication, before private reads."""
    result = _rpc(db, "fn_guard_owned_mock_attempt", {
        "p_skill": skill, "p_attempt": attempt, "p_purpose": purpose,
    }, operation=purpose, skill=skill, paper_id=attempt["test_id"])
    if result.get("allowed") is not True:
        raise unavailable(purpose, skill, attempt["test_id"])
