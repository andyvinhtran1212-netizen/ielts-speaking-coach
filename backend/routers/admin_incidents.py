"""Incident inbox API (ADMINIA-0074 FR-070, FR-071; plan 5.4; G09-T07). Admin only.

* ``GET  /admin/incidents/groups?source=&status=open&sort=learners&page=``
  — groups of the three sources, 25 a page, default open (Mới + Đang xem)
  sorted by learners affected, then last record.
* ``GET  /admin/incidents/groups/{source}/{fingerprint}`` — one group: plain
  description, impact, learners (profile refs), collapsed technical block,
  notes.
* ``POST /admin/incidents/groups/bulk`` — claim · resolve · ignore · reopen
  many groups. Each group carries the ``expected_count`` the page showed; a
  group whose count changed since is not touched and comes back as a 409
  conflict. Every group conflicted → HTTP 409.

Grouping rules and states: ``services.error_log_grouping`` and
``services.incident_inbox``. The ``incident_group_action`` log line records
the action and counts, never note text.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import JSONResponse

from models.admin_incidents import (
    IncidentBulkIn,
    IncidentBulkOut,
    IncidentGroupDetail,
    IncidentGroupsOut,
)
from routers.admin import require_admin
from services import incident_inbox as inbox
from services import ops_thresholds
from services.error_log_grouping import SOURCES, Group

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/incidents", tags=["admin-incidents"])

_LEARNER_LIST_MAX = 50
_SORTS = {
    "learners": lambda g: (len(g.learner_ids), g.last_at or ""),
    "last": lambda g: (g.last_at or "", len(g.learner_ids)),
    "count": lambda g: (g.count, g.last_at or ""),
}


async def _thresholds() -> Optional[dict]:
    try:
        return await ops_thresholds.get()
    except ops_thresholds.ThresholdsUnavailable:
        logger.warning("incident inbox: thresholds unavailable; overdue flags off")
        return None


def _item(group: Group, stored: Optional[dict], thresholds, now, names: dict) -> dict:
    status, reopened = inbox.effective_status(group, stored)
    claimed = (stored or {}).get("claimed_by") if status == "in_review" else None
    return {
        "source": group.source, "fingerprint": group.fingerprint, "title": group.title,
        "area": group.area, "level": group.level, "count": group.count,
        "learners": len(group.learner_ids), "first_at": group.first_at, "last_at": group.last_at,
        "status": status, "claimed_by_name": names.get(str(claimed)) if claimed else None,
        "overdue": inbox.is_overdue(group, stored, status, reopened, thresholds, now),
    }


def _matches(status: str, wanted: str) -> bool:
    if wanted == "all":
        return True
    if wanted == "open":
        return status in inbox.OPEN_STATUSES
    return status == wanted


@router.get("/groups", response_model=IncidentGroupsOut)
async def list_groups(
    authorization: Optional[str] = Header(default=None),
    source: Optional[Literal["errors", "grading", "feedback"]] = None,
    status: Literal["open", "new", "in_review", "resolved", "ignored", "all"] = "open",
    sort: Literal["learners", "last", "count"] = "learners",
    page: int = Query(default=1, ge=1, le=10_000),
):
    await require_admin(authorization)
    snap = await asyncio.to_thread(inbox.snapshot)
    try:
        stored = await asyncio.to_thread(inbox.stored_states)
    except Exception as exc:
        logger.exception("incident inbox: incident_groups read failed")
        raise HTTPException(503, {"code": "incident_state_unavailable",
                                  "message": "Chưa tải được trạng thái sự cố. Thử lại sau ít phút."}) from exc
    thresholds = await _thresholds()
    now = datetime.now(timezone.utc)

    counts = {s: (None if s in snap.sources_failed else 0) for s in SOURCES}
    chosen: list[Group] = []
    for key, group in snap.groups.items():
        state, _ = inbox.effective_status(group, stored.get(key))
        if state in inbox.OPEN_STATUSES:
            counts[group.source] += 1
        if (source is None or group.source == source) and _matches(state, status):
            chosen.append(group)
    chosen.sort(key=_SORTS[sort], reverse=True)
    start = (page - 1) * inbox.PAGE_SIZE
    page_groups = chosen[start:start + inbox.PAGE_SIZE]

    claimer_ids = {(stored.get((g.source, g.fingerprint)) or {}).get("claimed_by") for g in page_groups}
    names = await asyncio.to_thread(inbox.user_names, [i for i in claimer_ids if i]) if any(claimer_ids) else {}
    try:
        review_open: Optional[int] = await asyncio.to_thread(inbox.review_items_open)
    except Exception:
        logger.exception("incident inbox: review_items_open count failed")
        review_open = None

    return {
        "items": [_item(g, stored.get((g.source, g.fingerprint)), thresholds, now, names) for g in page_groups],
        "total": len(chosen), "page": page, "page_size": inbox.PAGE_SIZE,
        "counts": counts, "review_items_open": review_open,
        "sources_failed": snap.sources_failed,
        "truncated": bool(snap.truncated), "sources_truncated": snap.truncated,
        "generated_at": now.isoformat(),
    }


def _description(group: Group) -> str:
    learners = len(group.learner_ids)
    impact = f"{group.count} lần ghi nhận, {learners} học viên bị ảnh hưởng."
    tech = group.technical
    if group.source == "errors":
        where = f" ở {tech['path']}" if tech.get("path") else ""
        side = "giao diện" if tech.get("origin") == "frontend" else "máy chủ"
        return f"Lỗi {side}{where}: \"{group.title}\". {impact}"
    if group.source == "grading":
        return f"Bài Speaking ({group.area.removeprefix('Chấm Speaking · ')}) dừng ở bước {tech.get('step')}. {impact}"
    return f"Học viên gửi phản hồi \"{group.title}\". {impact}"


@router.get("/groups/{source}/{fingerprint}", response_model=IncidentGroupDetail)
async def group_detail(
    source: Literal["errors", "grading", "feedback"],
    fingerprint: str,
    authorization: Optional[str] = Header(default=None),
):
    await require_admin(authorization)
    snap = await asyncio.to_thread(inbox.snapshot, (source,))
    if source in snap.sources_failed:
        raise HTTPException(503, {"code": "source_unavailable",
                                  "message": "Chưa tải được nguồn sự cố này. Thử lại sau ít phút."})
    group = snap.groups.get((source, fingerprint))
    try:
        stored = (await asyncio.to_thread(inbox.stored_states, [(source, fingerprint)])).get((source, fingerprint))
        notes = await asyncio.to_thread(inbox.notes, source, fingerprint) if stored else []
    except Exception as exc:
        logger.exception("incident inbox: group state read failed")
        raise HTTPException(503, {"code": "incident_state_unavailable",
                                  "message": "Chưa tải được trạng thái sự cố. Thử lại sau ít phút."}) from exc
    if group is None:
        if not stored:
            raise HTTPException(404, "Không tìm thấy nhóm sự cố")
        # Decided earlier, but no record left in the newest 5,000 rows.
        group = Group(source=source, fingerprint=fingerprint, title="(không còn bản ghi gần đây)", area="")

    learner_ids = sorted(group.learner_ids)
    people = learner_ids[:_LEARNER_LIST_MAX]
    actor_ids = {n.get("actor_id") for n in notes} | {(stored or {}).get("claimed_by")}
    names = await asyncio.to_thread(inbox.user_names, [i for i in set(people) | actor_ids if i])
    thresholds = await _thresholds()
    now = datetime.now(timezone.utc)
    item = _item(group, stored, thresholds, now, names)
    return {
        **item,
        "description": _description(group) if group.count else "Nhóm không còn bản ghi trong 5.000 dòng mới nhất.",
        "claimed_at": (stored or {}).get("claimed_at"),
        "resolved_at": (stored or {}).get("resolved_at") if item["status"] in ("resolved", "ignored") else None,
        "learner_list": [{"ref": f"u-{uid}", "name": names.get(uid) or "Học viên"} for uid in people],
        "technical": {**group.technical, "record_ids": group.record_ids[:20]},
        "notes": [{"body": n["body"], "auto": bool(n.get("auto")),
                   "actor_name": names.get(str(n.get("actor_id"))) if n.get("actor_id") else None,
                   "created_at": n.get("created_at")} for n in notes],
    }


@router.post("/groups/bulk", response_model=IncidentBulkOut)
async def bulk_action(body: IncidentBulkIn, authorization: Optional[str] = Header(default=None)):
    admin = await require_admin(authorization)
    sources = sorted({g.source for g in body.groups})
    snap = await asyncio.to_thread(inbox.snapshot, sources)
    keys = [(g.source, g.fingerprint) for g in body.groups]
    try:
        stored = await asyncio.to_thread(inbox.stored_states, keys)
    except Exception as exc:
        logger.exception("incident inbox: incident_groups read failed")
        raise HTTPException(503, {"code": "incident_state_unavailable",
                                  "message": "Chưa tải được trạng thái sự cố. Thử lại sau ít phút."}) from exc
    if snap.sources_failed:
        raise HTTPException(503, {"code": "source_unavailable",
                                  "message": "Chưa tải được nguồn sự cố để kiểm số lần. Thử lại sau ít phút."})

    changed, conflicts, dismiss_failed, write_failed = 0, [], [], 0
    note = (body.note or "").strip() or None
    seen: set = set()
    for ref in body.groups:
        key = (ref.source, ref.fingerprint)
        if key in seen:
            continue
        seen.add(key)
        group = snap.groups.get(key)
        actual = group.count if group else 0
        if group is None and key not in stored:
            conflicts.append({"source": ref.source, "fingerprint": ref.fingerprint, "status": 404,
                              "code": "not_found", "expected_count": ref.expected_count, "actual_count": None})
            continue
        if actual != ref.expected_count:
            conflicts.append({"source": ref.source, "fingerprint": ref.fingerprint, "status": 409,
                              "code": "count_changed", "expected_count": ref.expected_count,
                              "actual_count": actual})
            continue
        try:
            closed_before = key not in stored and group is not None and group.all_closed
            result = await asyncio.to_thread(inbox.transition, ref.source, ref.fingerprint, body.action,
                                             admin["id"], group.last_at if group else None, note,
                                             closed_before)
        except Exception:
            logger.exception("incident inbox: transition failed")
            write_failed += 1
            conflicts.append({"source": ref.source, "fingerprint": ref.fingerprint, "status": 503,
                              "code": "write_failed"})
            continue
        if not result.get("changed"):
            continue
        changed += 1
        if body.action == "resolve" and ref.source == "errors" and group and group.open_record_ids:
            try:
                await asyncio.to_thread(inbox.dismiss_error_rows, group.open_record_ids, admin["id"])
            except Exception:
                logger.exception("incident inbox: dismissing error_logs rows failed")
                dismiss_failed.append(ref.fingerprint)

    logger.info("incident_group_action action=%s groups=%d changed=%d conflicts=%d dismiss_failed=%d",
                body.action, len(seen), changed, len(conflicts), len(dismiss_failed))
    out = {"changed": changed, "conflicts": conflicts, "dismiss_failed": dismiss_failed}
    processed_ok = len(seen) - len(conflicts)
    if conflicts and processed_ok == 0:
        status_code = 503 if write_failed and write_failed == len(conflicts) else 409
        return JSONResponse(status_code=status_code, content=IncidentBulkOut(**out).model_dump())
    return out
