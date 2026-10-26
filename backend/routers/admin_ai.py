"""Admin AI dashboard endpoints (AIOPS-0024).

All routes are restricted by ``require_admin``. Reads and writes go through
the backend service role; the tables have RLS on and no client grants.
"""

from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Query

from config import settings
from database import supabase_admin
from models.admin_ai import (
    AdminAiFailuresOut,
    AdminAiModelsOut,
    AdminAiOverrideIn,
    AdminAiUsageOut,
)
from routers.admin import _actor_id, require_admin
from services import admin_ai_dashboard, ai_model_overrides, ai_router

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/ai", tags=["admin", "admin-ai"])

WindowParam = Literal["today", "7d", "30d"]


def _client():
    """Sync service-role client; the dashboard service runs it in a thread."""
    return supabase_admin


@router.get("/models", response_model=AdminAiModelsOut)
async def get_ai_models(authorization: str | None = Header(default=None)):
    """Effective provider order and models per routed feature, with sources."""
    await require_admin(authorization)
    client = _client()
    return await admin_ai_dashboard.models_view(client, settings)


@router.patch("/models/{feature}", response_model=AdminAiModelsOut)
async def patch_ai_model_override(
    feature: str,
    body: AdminAiOverrideIn,
    authorization: str | None = Header(default=None),
):
    """Set or clear (null) a feature's preferred provider / Claude model."""
    admin = await require_admin(authorization)
    bypass = ai_router.routing_bypass_reason(feature, settings)
    if bypass and (body.preferred_provider is not None or body.anthropic_model is not None):
        # Clearing (both null) stays allowed so a stale row can be removed.
        raise HTTPException(422, detail={
            "error_code": "ai_override_invalid", "field": "feature", "message": bypass,
        })
    try:
        await ai_model_overrides.save(
            feature,
            preferred_provider=body.preferred_provider,
            anthropic_model=body.anthropic_model,
            actor_id=_actor_id(admin),
        )
    except ai_model_overrides.OverrideValidationError as exc:
        raise HTTPException(422, detail={
            "error_code": "ai_override_invalid", "field": exc.field, "message": str(exc),
        })
    except ai_model_overrides.OverrideStoreUnavailable as exc:
        raise HTTPException(503, detail={
            "error_code": "ai_override_store_unavailable",
            "status": exc.status,
            "message": ("Chưa áp dụng migration 321 — không lưu được lựa chọn model."
                        if exc.status == "not_migrated"
                        else "Không lưu được lựa chọn model; cấu hình hiện tại không đổi."),
        })
    client = _client()
    return await admin_ai_dashboard.models_view(client, settings)


@router.get("/usage", response_model=AdminAiUsageOut)
async def get_ai_usage_summary(
    window: WindowParam = Query("today"),
    authorization: str | None = Header(default=None),
):
    """Tokens and estimated cost per feature/provider for a Saigon-day window."""
    await require_admin(authorization)
    client = _client()
    try:
        return await admin_ai_dashboard.usage_view(client, window)
    except admin_ai_dashboard.DashboardNotMigrated:
        raise HTTPException(503, detail={
            "error_code": "ai_dashboard_not_migrated",
            "message": "Chưa áp dụng migration 321 — chưa có tổng hợp token.",
        })
    except Exception as exc:
        logger.warning("[admin-ai] usage rollup failed: %s", type(exc).__name__)
        raise HTTPException(503, detail={
            "error_code": "ai_usage_unavailable",
            "message": "Không tải được thống kê token AI. Thử lại sau.",
        })


@router.get("/failures", response_model=AdminAiFailuresOut)
async def get_ai_failures(
    window: WindowParam = Query("today"),
    authorization: str | None = Header(default=None),
):
    """Failure/fallback counts per provider × feature and the latest 50 rows."""
    await require_admin(authorization)
    client = _client()
    try:
        return await admin_ai_dashboard.failures_view(client, window)
    except Exception as exc:
        logger.warning("[admin-ai] failure log read failed: %s", type(exc).__name__)
        raise HTTPException(503, detail={
            "error_code": "ai_failures_unavailable",
            "message": "Không tải được nhật ký lỗi gọi AI. Thử lại sau.",
        })
