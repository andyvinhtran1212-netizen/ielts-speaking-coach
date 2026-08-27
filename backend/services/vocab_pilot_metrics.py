"""Canonical lifecycle mutations and anonymised pilot metrics for Vocab Curated."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from database import supabase_admin

ALLOWED_PERIOD_DAYS = frozenset({30, 90, 180})


class VocabPilotMetricsError(Exception):
    """The canonical pilot metrics contract could not be fulfilled."""


class VocabRecommendationNotFound(VocabPilotMetricsError):
    """The recommendation does not belong to the learner/unit pair."""


class VocabPilotUserNotFound(VocabPilotMetricsError):
    """The requested cohort member does not exist."""


def _one(result: Any) -> dict[str, Any] | None:
    data = getattr(result, "data", None)
    if isinstance(data, dict):
        return data
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0]
    return None


def open_recommendation(
    *, user_id: str, recommendation_id: str, unit_slug: str,
) -> dict[str, Any]:
    """Idempotently mark one owned recommendation opened without regressing terminal state."""
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        row = _one(supabase_admin.rpc("fn_open_vocab_unit_recommendation", {
            "p_user": user_id,
            "p_recommendation": recommendation_id,
            "p_unit_slug": unit_slug,
            "p_now": now_iso,
        }).execute())
    except Exception as exc:
        if "recommendation_not_found" in str(exc):
            raise VocabRecommendationNotFound(
                "Không tìm thấy recommendation phù hợp với bài học này"
            ) from exc
        raise
    if not row:
        raise VocabPilotMetricsError("Không ghi nhận được lượt mở recommendation")
    return row


def get_metrics(*, days: int) -> dict[str, Any]:
    """Return an aggregate-only measurement snapshot from the database RPC."""
    if days not in ALLOWED_PERIOD_DAYS:
        raise VocabPilotMetricsError("Khoảng đo phải là 30, 90 hoặc 180 ngày")
    row = _one(supabase_admin.rpc("fn_vocab_curated_pilot_metrics", {
        "p_days": days,
        "p_as_of": datetime.now(timezone.utc).isoformat(),
    }).execute())
    if not row:
        raise VocabPilotMetricsError("Database không trả snapshot đo lường")
    return row


def set_cohort_flag(
    *, user_id: str, enabled: bool, changed_by: str,
) -> dict[str, Any]:
    """Atomically update the canonical user flag and append an audit event."""
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        row = _one(supabase_admin.rpc("fn_set_vocab_curated_cohort", {
            "p_user": user_id,
            "p_enabled": enabled,
            "p_changed_by": changed_by,
            "p_now": now_iso,
        }).execute())
    except Exception as exc:
        if "user_not_found" in str(exc):
            raise VocabPilotUserNotFound("Không tìm thấy học viên") from exc
        raise
    if not row:
        raise VocabPilotMetricsError("Không cập nhật được cohort Vocab Curated")
    return row

