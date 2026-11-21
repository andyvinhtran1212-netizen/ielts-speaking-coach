"""Admin settings: the operations-threshold table and the settings log
(ADMINIA-0074 FR-080, FR-081, FR-084; plan 5.4 and 5.6; G09-T22).

* ``GET  /admin/settings/thresholds`` — admin, or a teacher read-only.
* ``PATCH /admin/settings/thresholds`` — admin (AAL2 through ``require_admin``).
  Plan 5.4 names this ``PUT``; the API's CORS allow-list (``main._CORS_METHODS``)
  has no PUT and every other update endpoint is PATCH (see routers/admin_flags),
  so a PUT would fail the browser preflight from the admin frontend.
* ``GET  /admin/settings/log`` — admin; newest first, ``cursor`` pages back.

The other sections of plan 5.4 (``email``, ``notices``, ``payment``) arrive
with the page that edits them (G09-T23); the GOI-11 ``trial`` tab owns its own
routes. Keep every fixed path above any future ``/{section}`` route.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from database import supabase_admin
from routers.admin import _actor_id, require_admin, require_instructor
from services import ops_thresholds

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-settings"])

# admin_settings key -> the settings tab it belongs to (FR-080).
_SECTION_OF_KEY = {ops_thresholds.SETTINGS_KEY: "thresholds"}
_KEY_OF_SECTION = {section: key for key, section in _SECTION_OF_KEY.items()}
_LOG_PAGE = 50


class ThresholdItem(BaseModel):
    key: str
    group: str
    label: str
    anchor: str
    value: Optional[int]
    unit: str
    min: Optional[int]
    max: Optional[int]
    fixed: bool


class ThresholdList(BaseModel):
    items: list[ThresholdItem]


class ThresholdChange(BaseModel):
    key: str = Field(min_length=1, max_length=64)
    # Strict int so "48" or 48.0 is refused rather than coerced.
    value: Optional[int] = Field(strict=True)


class ThresholdUpdate(BaseModel):
    changes: list[ThresholdChange] = Field(min_length=1, max_length=50)
    reason: str = Field(min_length=1, max_length=500)


class SettingsLogChange(BaseModel):
    key: str
    label: str
    old: Any = None
    new: Any = None


class SettingsLogItem(BaseModel):
    id: int
    at: str
    actor_name: Optional[str]
    section: str
    changes: list[SettingsLogChange]
    reason: str


class SettingsLog(BaseModel):
    items: list[SettingsLogItem]
    next_cursor: Optional[int]


def _unavailable() -> HTTPException:
    return HTTPException(503, {"code": "thresholds_unavailable",
                               "message": "Chưa đọc được bảng ngưỡng. Thử tải lại sau ít phút."})


@router.get("/admin/settings/thresholds", response_model=ThresholdList)
async def get_thresholds(authorization: str | None = Header(default=None)):
    await require_instructor(authorization)
    try:
        values = await ops_thresholds.get()
    except ops_thresholds.ThresholdsUnavailable:
        raise _unavailable()
    return {"items": ops_thresholds.items(values)}


@router.patch("/admin/settings/thresholds", response_model=ThresholdList)
async def patch_thresholds(body: ThresholdUpdate, authorization: str | None = Header(default=None)):
    admin = await require_admin(authorization)
    reason = body.reason.strip()
    if not reason:
        raise HTTPException(422, {"code": "reason_required", "message": "Ghi lý do thay đổi."})
    try:
        values = await ops_thresholds.set_many(
            [(c.key, c.value) for c in body.changes], reason, _actor_id(admin))
    except ops_thresholds.ThresholdChangeError as exc:
        raise HTTPException(422, {"code": exc.code, "message": exc.message, "key": exc.key})
    except ops_thresholds.ThresholdsUnavailable:
        raise _unavailable()
    except Exception as exc:
        logger.exception("admin settings: threshold write failed")
        raise HTTPException(503, {"code": "settings_write_failed",
                                  "message": "Chưa lưu được. Không có thay đổi nào được ghi; thử lại."}) from exc
    return {"items": ops_thresholds.items(values)}


def _label(key: str) -> str:
    t = ops_thresholds.BY_KEY.get(key)
    return t.label if t else key


def _diff(old: Any, new: Any) -> list[dict[str, Any]]:
    old = old if isinstance(old, dict) else {}
    new = new if isinstance(new, dict) else {}
    keys = [k for k in new if k not in old or old[k] != new[k]] + [k for k in old if k not in new]
    return [{"key": k, "label": _label(k), "old": old.get(k), "new": new.get(k)} for k in keys]


@router.get("/admin/settings/log", response_model=SettingsLog)
async def get_settings_log(
    section: Optional[str] = Query(default=None, pattern="^[a-z_]{1,32}$"),
    cursor: Optional[int] = Query(default=None, ge=1),
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    if section is not None and section not in _KEY_OF_SECTION:
        raise HTTPException(422, {"code": "unknown_section", "message": "Không có thẻ cài đặt này."})

    def read_log():
        q = supabase_admin.table("admin_settings_log").select(
            "id, key, old_value, new_value, reason, actor_id, created_at")
        if section is not None:
            q = q.eq("key", _KEY_OF_SECTION[section])
        if cursor is not None:
            q = q.lt("id", cursor)
        return q.order("id", desc=True).limit(_LOG_PAGE + 1).execute()

    try:
        rows = (await asyncio.to_thread(read_log)).data or []
    except Exception as exc:
        logger.exception("admin settings: log read failed")
        raise HTTPException(503, {"code": "settings_log_unavailable",
                                  "message": "Chưa đọc được nhật ký cài đặt."}) from exc
    page, more = rows[:_LOG_PAGE], len(rows) > _LOG_PAGE

    actor_ids = sorted({r["actor_id"] for r in page if r.get("actor_id")})
    names: dict[str, str] = {}
    if actor_ids:
        try:
            users = (await asyncio.to_thread(
                lambda: supabase_admin.table("users").select("id, display_name, email")
                .in_("id", actor_ids).execute()
            )).data or []
            names = {u["id"]: (u.get("display_name") or u.get("email") or "") for u in users}
        except Exception:
            # The log itself is canonical; a missing name shows as unknown
            # (actor_name null), never as someone else's.
            logger.warning("admin settings: actor names unavailable for the log page")

    return {
        "items": [
            {
                "id": r["id"], "at": r["created_at"],
                "actor_name": names.get(r.get("actor_id")) or None,
                "section": _SECTION_OF_KEY.get(r["key"], r["key"]),
                "changes": _diff(r.get("old_value"), r.get("new_value")),
                "reason": r["reason"],
            }
            for r in page
        ],
        "next_cursor": page[-1]["id"] if more and page else None,
    }
