"""services/class_archive_service.py — class archive and restore (CLASSARCHIVE-0030).

Migration 337 owns the invariants: ``fn_archive_cohort`` / ``fn_restore_cohort``
lock the class row, write the flag, the archive metadata and one
``class_lifecycle_audit`` row in one transaction, and are idempotent (a repeat
writes no audit row). ``fn_cohort_archive_counts`` feeds the confirm dialog.
All three are service-role only and return NULL for an unknown class.

Definitions (spec §Definitions):
- archived class: ``is_active = false AND archived_at IS NOT NULL``;
- legacy inactive class: ``is_active = false AND archived_at IS NULL``. It was
  inactive before 337 and keeps today's behaviour until an admin applies the
  archive ("Áp dụng lưu trữ") or restores it.

Every helper here is synchronous; async routes call them through
``asyncio.to_thread``.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

from fastapi import HTTPException

ARCHIVE_REASON_MAX = 500

COHORT_ARCHIVED_CODE = "cohort_archived"
# research.md §4.1 — one message per audience.
COHORT_ARCHIVED_STAFF_MESSAGE = (
    "Lớp đã lưu trữ — khôi phục lớp trước khi thêm học viên hoặc giao bài."
)
COHORT_ARCHIVED_LEARNER_MESSAGE = (
    "Lớp đã lưu trữ — bài này không nhận bài nộp mới. Bài và bản nháp của em vẫn được giữ."
)

_COUNT_KEYS = ("active_members", "open_writing_gives", "open_class_items", "unused_class_codes")
_ARCHIVE_STATUSES = ("archived", "already_archived")
_RESTORE_STATUSES = ("restored", "not_archived")


class ClassArchiveReceiptError(RuntimeError):
    """An RPC answered with a shape this backend does not understand."""


# ── State ────────────────────────────────────────────────────────────────

def is_cohort_archived(row: Optional[Mapping[str, Any]]) -> bool:
    """True for an archived class only; a legacy inactive class is not."""
    if not row:
        return False
    return row.get("is_active") is False and row.get("archived_at") is not None


def is_legacy_inactive(row: Optional[Mapping[str, Any]]) -> bool:
    """True for a class that was inactive before 337 and is not enforced."""
    if not row:
        return False
    return row.get("is_active") is False and row.get("archived_at") is None


def cohort_accepts_work(db, cohort_id: Optional[str]) -> bool:
    """False only when ``cohort_id`` names an archived class.

    Reads ``select("*")`` so a schema without the 337 columns still answers
    (every class then accepts work, as before 337). An unknown class or a NULL
    id accepts work here; the caller's own lookup decides the 404. A DB error
    propagates: a gate must not open on a failed read.
    """
    if not cohort_id:
        return True
    rows = (
        db.table("cohorts").select("*").eq("id", str(cohort_id)).limit(1).execute()
    ).data or []
    return not (rows and is_cohort_archived(rows[0]))


# ── 409 mapping ──────────────────────────────────────────────────────────

def cohort_archived_error(*, learner: bool = False) -> HTTPException:
    """The one 409 shape for a write refused because the class is archived."""
    return HTTPException(409, {
        "code": COHORT_ARCHIVED_CODE,
        "message": COHORT_ARCHIVED_LEARNER_MESSAGE if learner else COHORT_ARCHIVED_STAFF_MESSAGE,
    })


def is_cohort_archived_error(exc: BaseException) -> bool:
    """True for the ``cohort_archived`` raise of the 337/346 guards."""
    if isinstance(exc, HTTPException):
        return False
    return COHORT_ARCHIVED_CODE in str(exc)


def raise_if_cohort_archived(exc: BaseException, *, learner: bool = False) -> None:
    """Re-raise a ``cohort_archived`` DB refusal as the 409; a no-op otherwise.

    Callers check ``student_service.raise_if_student_archived`` first
    (research.md §4.1 precedence).
    """
    if is_cohort_archived_error(exc):
        raise cohort_archived_error(learner=learner) from None


# ── Reason ───────────────────────────────────────────────────────────────

def normalize_reason(reason: Optional[str]) -> Optional[str]:
    """Trimmed reason, ``None`` when empty (D5). Raises ``ValueError`` past 500."""
    if reason is None:
        return None
    text = reason.strip()
    if not text:
        return None
    if len(text) > ARCHIVE_REASON_MAX:
        raise ValueError("archive_reason_too_long")
    return text


def is_reason_too_long_error(exc: BaseException) -> bool:
    return "archive_reason_too_long" in str(exc)


# ── RPCs ─────────────────────────────────────────────────────────────────

def _rpc_object(data: Any) -> Any:
    # PostgREST returns a scalar jsonb as the value itself; tolerate a
    # one-element list as other RPC callers do.
    if isinstance(data, list):
        return data[0] if data else None
    return data


def _check_counts(counts: Any) -> dict:
    if not isinstance(counts, dict) or any(
        not isinstance(counts.get(key), int) or isinstance(counts.get(key), bool)
        for key in _COUNT_KEYS
    ):
        raise ClassArchiveReceiptError("counts")
    return {key: counts[key] for key in _COUNT_KEYS}


def archive_preview(db, cohort_id: str) -> Optional[dict]:
    """What an archive would close now; ``None`` for an unknown class."""
    data = _rpc_object(
        db.rpc("fn_cohort_archive_counts", {"p_cohort_id": cohort_id}).execute().data
    )
    if data is None:
        return None
    return _check_counts(data)


def archive_class(db, *, cohort_id: str, actor_id: str,
                  reason: Optional[str] = None) -> Optional[dict]:
    """``fn_archive_cohort``; ``None`` for an unknown class.

    ``status`` is ``archived`` (one audit row; ``legacy_upgrade`` is true for
    "Áp dụng lưu trữ" on a legacy inactive class) or ``already_archived`` (no
    audit row).
    """
    data = _rpc_object(db.rpc("fn_archive_cohort", {
        "p_cohort_id": cohort_id,
        "p_actor": actor_id,
        "p_reason": reason,
    }).execute().data)
    if data is None:
        return None
    if not isinstance(data, dict) or data.get("status") not in _ARCHIVE_STATUSES:
        raise ClassArchiveReceiptError("archive")
    if data["status"] == "archived":
        _check_counts(data.get("counts"))
        if not isinstance(data.get("legacy_upgrade"), bool):
            raise ClassArchiveReceiptError("archive")
    return data


def restore_class(db, *, cohort_id: str, actor_id: str,
                  reason: Optional[str] = None) -> Optional[dict]:
    """``fn_restore_cohort``; ``None`` for an unknown class.

    ``status`` is ``restored`` (one audit row; ``was_legacy`` is true when a
    legacy inactive class is cleared) or ``not_archived`` (no audit row).
    """
    data = _rpc_object(db.rpc("fn_restore_cohort", {
        "p_cohort_id": cohort_id,
        "p_actor": actor_id,
        "p_reason": reason,
    }).execute().data)
    if data is None:
        return None
    if not isinstance(data, dict) or data.get("status") not in _RESTORE_STATUSES:
        raise ClassArchiveReceiptError("restore")
    if data["status"] == "restored":
        _check_counts(data.get("counts"))
        if not isinstance(data.get("was_legacy"), bool):
            raise ClassArchiveReceiptError("restore")
    return data
