"""ACCOUNTDATA-0100: account deletion requests (FR-001…FR-003).

The request side (T004): create, read and cancel one learner's request on
``account_deletion_requests``. The erasure steps that run after the grace
period (T005, plan section 5) follow below.

All SQL runs on the engine from ``services.account_data_db``; every function
takes it as an argument so tests run on a real PostgreSQL with migration 500.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import text

STAFF_ROLES = frozenset({"admin", "instructor"})


def export_lock_key(user_id: str) -> str:
    """``pg_advisory_xact_lock`` key shared by export requests and the
    erasure claim for one learner."""
    return f"account_data_export:{user_id}"


class AccountDataError(Exception):
    """A refusal with an HTTP status and a stable ``error_code``."""

    def __init__(self, status: int, error_code: str, message: str):
        super().__init__(error_code)
        self.status, self.error_code, self.message = status, error_code, message


@dataclass(frozen=True)
class DeletionRequest:
    id: str
    status: str
    requested_at: datetime
    erase_after: datetime
    cancelled_at: Optional[datetime] = None


def _iso(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def status_body(req: Optional[DeletionRequest]) -> dict:
    """``GET /api/account/deletion-request`` shape (plan section 4)."""
    if req is None or req.status not in ("pending", "erasing"):
        return {"status": "none", "requested_at": None, "erase_after": None}
    return {"status": req.status, "requested_at": _iso(req.requested_at), "erase_after": _iso(req.erase_after)}


def _row(row: Any) -> DeletionRequest:
    m = row._mapping
    return DeletionRequest(id=str(m["id"]), status=m["status"], requested_at=m["requested_at"],
                           erase_after=m["erase_after"], cancelled_at=m.get("cancelled_at"))


_COLUMNS = "id, status, requested_at, erase_after, cancelled_at"


async def open_request(engine: Any, user_id: str) -> Optional[DeletionRequest]:
    async with engine.connect() as conn:
        row = (await conn.execute(text(
            f"SELECT {_COLUMNS} FROM public.account_deletion_requests "
            "WHERE user_id = CAST(:uid AS uuid) AND status IN ('pending', 'erasing') LIMIT 1"
        ), {"uid": user_id})).first()
    return _row(row) if row else None


def normalise_email(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def check_can_request(*, role: Optional[str], login_email: Optional[str], confirm_email: Optional[str]) -> None:
    """FR-001 refusals, before anything is written."""
    if (role or "").strip().lower() in STAFF_ROLES:
        raise AccountDataError(403, "staff_account_not_self_deletable",
                               "Tài khoản nhân viên không tự xoá được. Bạn liên hệ admin nhé.")
    if not normalise_email(login_email) or normalise_email(confirm_email) != normalise_email(login_email):
        raise AccountDataError(422, "confirm_email_mismatch",
                               "Email bạn gõ không khớp email đăng nhập.")


async def create_request(engine: Any, user_id: str, *, grace_days: int) -> tuple[DeletionRequest, bool]:
    """Insert a ``pending`` request, or return the open one unchanged
    (``created`` False). The partial unique index settles a race between two
    POSTs: the loser re-reads the winner's row."""
    async with engine.begin() as conn:
        row = (await conn.execute(text(
            "INSERT INTO public.account_deletion_requests (user_id, erase_after) "
            "VALUES (CAST(:uid AS uuid), now() + make_interval(days => :days)) "
            "ON CONFLICT (user_id) WHERE status IN ('pending', 'erasing') DO NOTHING "
            f"RETURNING {_COLUMNS}"
        ), {"uid": user_id, "days": int(grace_days)})).first()
    if row is not None:
        return _row(row), True
    existing = await open_request(engine, user_id)
    if existing is None:  # pragma: no cover - the open row was erased between the two statements
        raise AccountDataError(409, "deletion_in_progress", "Tài khoản đang được xoá.")
    return existing, False


async def cancel_request(engine: Any, user_id: str) -> DeletionRequest:
    """FR-003: ``pending`` → ``cancelled``. 409 when nothing is pending or
    erasure already started."""
    async with engine.begin() as conn:
        row = (await conn.execute(text(
            "UPDATE public.account_deletion_requests SET status = 'cancelled', cancelled_at = now() "
            "WHERE user_id = CAST(:uid AS uuid) AND status = 'pending' "
            f"RETURNING {_COLUMNS}"
        ), {"uid": user_id})).first()
    if row is not None:
        return _row(row)
    existing = await open_request(engine, user_id)
    if existing is not None and existing.status == "erasing":
        raise AccountDataError(409, "deletion_in_progress", "Tài khoản đang được xoá, không huỷ được nữa.")
    raise AccountDataError(409, "no_pending_deletion_request", "Không có yêu cầu xoá nào đang chờ.")


async def account_is_erasing(engine: Any, user_id: str) -> bool:
    req = await open_request(engine, user_id)
    return req is not None and req.status == "erasing"
