"""Canonical flags live outside answer/grade rows and are written by one RPC.

The router must resolve owner and delivery purpose before using these helpers.
The write RPC repeats owner/status/expiry checks under the attempt row lock.
"""
from __future__ import annotations

import logging
from typing import Literal

from fastapi import HTTPException
from pydantic import ValidationError

from models.mock_attempt_flags import (
    QuestionReviewFlag, ReviewFlagPatchRequest, ReviewFlagStateResponse,
    ReviewFlagWriteResponse,
)

logger = logging.getLogger(__name__)
Skill = Literal["reading", "listening"]


def review_flag_state(db, skill: Skill, attempt: dict) -> dict:
    """Safe fields for an already-authorized boot/start/resume response.

    False tombstones keep revisions available to a second supported client;
    filtering to true flags would let it mistake an unflagged revision for0.
    """
    if skill not in {"reading", "listening"}:
        raise ValueError("invalid review flag skill")
    try:
        rows = (db.table("mock_attempt_review_flags")
                .select("q_num,question_id,flagged,revision,updated_at")
                .eq("skill", skill).eq("attempt_id", str(attempt["id"]))
                .order("q_num").execute().data)
        if not isinstance(rows, list):
            raise ValueError("invalid flag read projection")
        flags = [QuestionReviewFlag.model_validate(row) for row in rows]
        if len({flag.q_num for flag in flags}) != len(flags):
            raise ValueError("duplicate canonical flag")
    except Exception as exc:
        logger.warning("Review flags unavailable for %s attempt %s: %s", skill, attempt.get("id"), type(exc).__name__)
        raise HTTPException(503, "Chưa đọc được dấu xem lại. Hãy thử lại; đáp án vẫn được giữ.") from exc
    return {"flag_protocol": "question-cas-v1", "review_flags": [f.model_dump(mode="json") for f in flags]}


def flag_state_response(db, skill: Skill, attempt: dict) -> ReviewFlagStateResponse:
    data = review_flag_state(db, skill, attempt)
    return ReviewFlagStateResponse(attempt_id=attempt["id"], review_flags=data["review_flags"])


def patch_review_flag(db, skill: Skill, attempt: dict, body: ReviewFlagPatchRequest,
                      *, user_id: str | None, anon_id: str | None = None) -> ReviewFlagWriteResponse:
    if skill not in {"reading", "listening"}:
        raise ValueError("invalid review flag skill")
    try:
        result = db.rpc("fn_patch_mock_attempt_review_flag", {
            "p_skill": skill, "p_attempt_id": str(attempt["id"]),
            "p_user_id": user_id, "p_anon_id": anon_id,
            "p_q_num": body.q_num, "p_flagged": body.flagged,
            "p_expected_revision": body.expected_revision,
            "p_operation_id": str(body.operation_id),
        }).execute().data
    except Exception as exc:
        message = str(exc)
        if "mock_paper_policy:" in message:
            from services.mock_paper_policy import database_policy_error
            policy_error = database_policy_error(exc)
            if policy_error is not None:
                raise HTTPException(policy_error.status_code, policy_error.detail) from exc
        mappings = {
            "review_flag_owner_mismatch": (403, "Không có quyền với lượt làm này."),
            "review_flag_attempt_missing": (404, "Không tìm thấy lượt làm."),
            "review_flag_attempt_closed": (422, "Lượt làm đã đóng; dấu xem lại chưa được thay đổi."),
            "active_player_expired": (410, "Lượt làm đã hết thời gian tiếp tục."),
            "review_flag_question_missing": (422, "Câu hỏi không thuộc lượt làm này."),
            "review_flag_operation_reused": (422, "Mã thao tác đã dùng cho trạng thái khác."),
            "review_flag_question_changed": (409, "Nguồn câu hỏi đã thay đổi; hãy đọc lại trạng thái."),
        }
        for marker, (code, detail) in mappings.items():
            if marker in message:
                raise HTTPException(code, detail) from exc
        logger.warning("Review flag write unavailable for %s attempt %s: %s", skill, attempt.get("id"), type(exc).__name__)
        raise HTTPException(503, "Chưa xác nhận lưu dấu xem lại. Hãy đọc lại hoặc thử lại cùng thao tác.") from exc
    try:
        if isinstance(result, list):
            if len(result) != 1:
                raise ValueError("invalid flag write receipt count")
            result = result[0]
        receipt = ReviewFlagWriteResponse.model_validate(result)
        if str(receipt.attempt_id) != str(attempt["id"]) or receipt.q_num != body.q_num:
            raise ValueError("flag receipt identity mismatch")
        if receipt.accepted and (receipt.flagged != body.flagged or receipt.operation_id != body.operation_id):
            raise ValueError("flag receipt operation mismatch")
        if receipt.accepted != (receipt.reason in {"applied", "replayed"}):
            raise ValueError("flag receipt acceptance mismatch")
    except (ValidationError, ValueError, TypeError) as exc:
        raise HTTPException(503, "Chưa xác nhận trạng thái dấu xem lại. Hãy đọc lại lượt làm.") from exc
    return receipt
