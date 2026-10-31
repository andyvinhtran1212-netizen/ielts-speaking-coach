"""services/instructor_give_service.py — INSTRUCTORGIVE-0044 idempotent /instructor gives.

Both /instructor give routes (one learner, a class fan-out) carry a required
client `request_id`. Migration 360's RPC owns the request ledger
(`instructor_writing_assignment_requests`) and the insert in one transaction:

  • same request_id + same body + same owner → the first receipt, no new row;
  • same request_id + another body             → 409;
  • a request_id first used by another account → 409.

The ledger is deliberately NOT `writing_assignment_requests`: a receipt there
is the W-05 marker for admin-tool gives (routers/writing_student.py), which
would move an admin's /instructor give out of the "Chấm bài" queue.

The routes keep their W-3 pre-checks (instructor_access) as the fast path and
for their specific messages; the RPC re-checks ownership inside the
transaction. A replay is answered before those pre-checks, so a completed give
replays even if the class or learner changed since (canonical ledger truth).
"""

from __future__ import annotations

import logging
from typing import Any, Literal, Optional
from uuid import UUID

from fastapi import HTTPException

from services.student_service import raise_if_student_archived

logger = logging.getLogger(__name__)

GiveKind = Literal["individual", "fan_out"]

LEDGER = "instructor_writing_assignment_requests"
RPC = "fn_create_instructor_writing_give_idempotent"

REQUEST_MISMATCH_MESSAGE = "Yêu cầu giao bài này đã được gửi trước đó với nội dung khác. Vui lòng tải lại trang rồi giao lại."
REQUEST_OTHER_OWNER_MESSAGE = "Yêu cầu giao bài này không thuộc tài khoản của bạn. Vui lòng tải lại trang rồi thử lại."
REQUEST_INCOMPLETE_MESSAGE = "Yêu cầu giao bài đang được xử lý. Vui lòng thử lại."
EMPTY_ROSTER_MESSAGE = "Lớp này chưa có học viên nào."

# The fan-out response shape the dashboard reads (unchanged by 0044).
FAN_OUT_KEYS = ("student_count", "created_count", "group_id", "duplicates_warning", "assignment_ids")


def _response(give_kind: GiveKind, receipt: dict) -> dict:
    """The stored result, without ledger metadata: a replay answers exactly
    what the first request answered."""
    if give_kind == "individual":
        assignment = receipt.get("assignment")
        if not isinstance(assignment, dict):
            raise HTTPException(500, "Idempotent assignment receipt is malformed")
        return assignment
    if any(key not in receipt for key in FAN_OUT_KEYS):
        raise HTTPException(500, "Idempotent assignment receipt is malformed")
    return {key: receipt[key] for key in FAN_OUT_KEYS}


def replay_give(
    db,
    request_id: UUID,
    *,
    owner: str,
    give_kind: GiveKind,
    request_payload: dict,
) -> Optional[dict]:
    """The completed give for `request_id`, or None when the id is unused.

    Read before the route's pre-checks: membership, ownership or archive state
    may legitimately change between a committed give and the retry of its lost
    response; the ledger is the canonical truth for that retry."""
    rows = (
        db.table(LEDGER)
        .select("assigned_by,give_kind,request_payload,receipt")
        .eq("id", str(request_id))
        .limit(1)
        .execute()
    ).data or []
    if not rows:
        return None
    row = rows[0]
    if str(row.get("assigned_by") or "") != str(owner):
        raise HTTPException(409, REQUEST_OTHER_OWNER_MESSAGE)
    if row.get("give_kind") != give_kind or row.get("request_payload") != request_payload:
        raise HTTPException(409, REQUEST_MISMATCH_MESSAGE)
    receipt = row.get("receipt")
    if not isinstance(receipt, dict):
        raise HTTPException(409, REQUEST_INCOMPLETE_MESSAGE)
    logger.info("[instructor-give] replayed request=%s kind=%s by=%s", request_id, give_kind, owner)
    return _response(give_kind, receipt)


def create_give(
    db,
    request_id: UUID,
    *,
    owner: str,
    give_kind: GiveKind,
    request_payload: dict,
    prompt_ids: list[str],
    candidate_student_ids: list[str],
    cohort_id: Optional[str] = None,
    student_id: Optional[str] = None,
    name: Optional[str] = None,
    allow_soft_check: bool = False,
    deadline: Optional[str] = None,
    instructions: Optional[str] = None,
    analysis_level: int = 3,
    grading_tier: str = "standard",
) -> dict:
    """Run the idempotent RPC and map its refusals to the route contract.

    `candidate_student_ids` are the learners the pre-check expects, used only
    to name them in a 331 `student_archived` 409."""
    params: dict[str, Any] = {
        "p_request_id": str(request_id),
        "p_owner": str(owner),
        "p_give_kind": give_kind,
        "p_request_payload": request_payload,
        "p_prompt_ids": prompt_ids,
        "p_cohort_id": cohort_id,
        "p_student_id": student_id,
        "p_name": name,
        "p_allow_soft_check": allow_soft_check,
        "p_deadline": deadline,
        "p_instructions": instructions,
        "p_analysis_level": analysis_level,
        "p_grading_tier": grading_tier,
    }
    try:
        receipt = db.rpc(RPC, params).execute().data
    except Exception as exc:
        # 331: archived after the pre-check → the whole RPC (ledger row too) rolled back.
        raise_if_student_archived(db, exc, candidate_student_ids)
        message = str(exc)
        if "instructor_give_request_payload_mismatch" in message:
            raise HTTPException(409, REQUEST_MISMATCH_MESSAGE) from exc
        if "instructor_give_request_owned_by_other" in message:
            raise HTTPException(409, REQUEST_OTHER_OWNER_MESSAGE) from exc
        if "instructor_give_request_incomplete" in message:
            raise HTTPException(409, REQUEST_INCOMPLETE_MESSAGE) from exc
        if "instructor_give_request_invalid" in message:
            # Backstop only: the route models validate these bounds first.
            raise HTTPException(422, "Dữ liệu giao bài không hợp lệ.") from exc
        if "instructor_give_roster_empty" in message:
            raise HTTPException(400, EMPTY_ROSTER_MESSAGE) from exc
        if "instructor_give_not_owned" in message or "instructor_give_owner_not_staff" in message:
            # Same generic 403 as the W-3 pre-checks (main.py PermissionError handler).
            raise PermissionError(f"instructor give: ownership changed for request {request_id}") from exc
        raise
    if not isinstance(receipt, dict):
        raise HTTPException(500, "Idempotent assignment receipt is malformed")
    if receipt.get("replayed"):
        logger.info("[instructor-give] replayed request=%s kind=%s by=%s", request_id, give_kind, owner)
    return _response(give_kind, receipt)
