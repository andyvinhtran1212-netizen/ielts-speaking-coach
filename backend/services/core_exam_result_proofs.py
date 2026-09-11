"""Optional result witnesses after a committed Reading/Listening submission.

No learner answer text or identity is sent. The private RPC stores only a digest
of validated grading metadata and the canonical attempt ID. Lost proof writes
leave current readback unverified; they never roll back a learner submission.
"""

import asyncio
import logging
import re
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StrictBool, StrictInt, ValidationError, model_validator

from config import settings
from database import get_supabase_async
from services.core_attempt_evidence import ReceiptStatus

logger = logging.getLogger(__name__)
PROOF_BUDGET_SECONDS = 0.5


class _Question(BaseModel):
    model_config = ConfigDict(extra="forbid")
    q_num: StrictInt = Field(gt=0)
    correct: StrictBool


class _Metadata(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["submitted"]
    submitted_at: AwareDatetime
    score: float = Field(strict=True, ge=0, le=40, allow_inf_nan=False)
    band_estimate: float | None = Field(strict=True, ge=0, le=9, allow_inf_nan=False)
    grading_details: list[_Question] = Field(min_length=1)


class _Proof(BaseModel):
    model_config = ConfigDict(extra="forbid")
    p_surface: Literal["reading_exam", "listening_test"]
    p_canonical_attempt_id: UUID
    p_metadata: _Metadata
    p_expected_qnums: list[StrictInt] = Field(min_length=1)

    @model_validator(mode="after")
    def consistent_result(self):
        actual = [q.q_num for q in self.p_metadata.grading_details]
        expected = self.p_expected_qnums
        if (len(set(actual)) != len(actual) or len(set(expected)) != len(expected)
                or sorted(actual) != sorted(expected)
                or self.p_metadata.score != sum(q.correct for q in self.p_metadata.grading_details)):
            raise ValueError("inconsistent result proof")
        return self


async def record_exam_result_proof(surface: str, canonical_id: UUID, metadata: dict, expected_qnums: list[int]) -> ReceiptStatus:
    if not settings.CORE_ATTEMPT_EVIDENCE_ENABLED:
        return ReceiptStatus.DISABLED
    try:
        payload = _Proof(p_surface=surface, p_canonical_attempt_id=canonical_id,
                         p_metadata=metadata, p_expected_qnums=expected_qnums).model_dump(mode="json")
    except (ValidationError, TypeError, ValueError):
        logger.warning("core_exam_result_proof_invalid")
        return ReceiptStatus.INVALID
    try:
        async with asyncio.timeout(PROOF_BUDGET_SECONDS):
            db = await get_supabase_async()
            response = await db.rpc("fn_record_core_exam_result_proof", payload).execute()
            if not isinstance(response.data, str) or re.fullmatch(r"[a-f0-9]{64}", response.data) is None:
                raise ValueError("invalid proof receipt")
            return ReceiptStatus.RECORDED
    except Exception as error:
        if getattr(error, "code", None) in {"22023", "22P02", "22003", "22007"}:
            logger.warning("core_exam_result_proof_rejected")
            return ReceiptStatus.INVALID
        logger.warning("core_exam_result_proof_unavailable")
        return ReceiptStatus.UNAVAILABLE
