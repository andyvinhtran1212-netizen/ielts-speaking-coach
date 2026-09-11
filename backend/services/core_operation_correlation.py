"""Client retry hints paired with server-computed input/owner fingerprints.

Hints are not auth, organic attribution, idempotency keys, or coverage proof.
No raw request body/answer, actor identifier or anonymous capability is stored.
"""

import asyncio
import hashlib
import json
import logging
import re
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from config import settings
from database import get_supabase_async
from services.core_attempt_evidence import ReceiptStatus

logger = logging.getLogger(__name__)
HEADER_NAME = "X-Core-Operation-ID"
CORRELATION_BUDGET_SECONDS = 0.5
_hint: ContextVar[UUID | None] = ContextVar("core_operation_hint", default=None)
FORBIDDEN_INPUT_NAMES = frozenset({"authorization", "request", "background_tasks", "student", "x_reading_anon", "x_reading_password"})


@contextmanager
def operation_hint_scope(values):
    hint = None
    if len(values) == 1 and isinstance(values[0], str) and len(values[0]) == 36:
        try:
            hint = UUID(values[0])
        except ValueError:
            pass
    token = _hint.set(hint)
    try:
        yield
    finally:
        _hint.reset(token)


def current_operation_hint():
    return _hint.get()


def _json_value(value):
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, UUID):
        return str(value)
    if value is None or type(value) in (str, int, float, bool):
        return value
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    if isinstance(value, dict) and all(isinstance(key, str) for key in value):
        return {key: _json_value(item) for key, item in value.items()}
    # Never read UploadFile streams or stringify arbitrary request objects.
    raise ValueError("unsupported correlation input")


def input_fingerprint(endpoint, signature, fields, args, kwargs):
    try:
        bound = signature.bind(*args, **kwargs)
        bound.apply_defaults()
        payload = {"contract": "core-operation-input-v1", "endpoint": endpoint,
                   "inputs": {name: _json_value(bound.arguments[name]) for name in fields}}
        encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        return hashlib.sha256(encoded.encode()).hexdigest()
    except Exception:
        logger.warning("core_operation_input_unavailable")
        return None


def owner_fingerprint(row):
    """Only call on the already authorized, canonical source row."""
    try:
        value = row.get("user_id") or row.get("student_id")
        if value:
            actor = "user:" + str(UUID(str(value)))
        else:
            value = row.get("anon_id")
            if not isinstance(value, str) or re.fullmatch(r"[A-Za-z0-9_-]{32}", value) is None:
                return None
            actor = "anonymous:" + value
        return hashlib.sha256(actor.encode()).hexdigest()
    except (ValueError, TypeError, AttributeError):
        return None


def scoped_fingerprint(inputs, actor):
    if inputs is None or actor is None:
        return None
    return hashlib.sha256(f"core-operation-scope-v1:{actor}:{inputs}".encode()).hexdigest()


class _Correlation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    p_operation_id: UUID
    p_surface: Literal["speaking", "reading_exam", "listening_test", "listening_dictation", "writing_assignment"]
    p_attempt_kind: Literal["default", "speaking_session", "speaking_full_test"]
    p_canonical_attempt_id: UUID
    p_operation: Literal["start", "save", "submit", "grade", "finalize"]
    p_client_operation_id: UUID
    p_input_digest: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def consistent_namespace(self):
        if (self.p_surface == "speaking") != (self.p_attempt_kind != "default"):
            raise ValueError("invalid correlation namespace")
        return self


async def record_operation_correlation(*, operation_id, surface, attempt_kind, canonical_attempt_id,
                                       operation, client_operation_id, input_digest):
    if not settings.CORE_ATTEMPT_EVIDENCE_ENABLED:
        return ReceiptStatus.DISABLED
    try:
        payload = _Correlation(p_operation_id=operation_id, p_surface=surface, p_attempt_kind=attempt_kind,
                               p_canonical_attempt_id=canonical_attempt_id, p_operation=operation,
                               p_client_operation_id=client_operation_id, p_input_digest=input_digest).model_dump(mode="json")
    except (ValidationError, ValueError, TypeError):
        logger.warning("core_operation_correlation_invalid")
        return ReceiptStatus.INVALID
    try:
        async with asyncio.timeout(CORRELATION_BUDGET_SECONDS):
            db = await get_supabase_async()
            result = await db.rpc("fn_record_core_operation_correlation", payload).execute()
            if result.data != str(operation_id):
                raise ValueError("invalid correlation receipt")
            return ReceiptStatus.RECORDED
    except Exception as error:
        if getattr(error, "code", None) == "23505":
            logger.warning("core_operation_correlation_conflict")
            return ReceiptStatus.CONFLICT
        logger.warning("core_operation_correlation_unavailable")
        return ReceiptStatus.UNAVAILABLE
