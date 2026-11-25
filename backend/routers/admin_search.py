"""Quick search (ADMINIA-0074 FR-075, FR-102; plan 5.4; G09-T05). Read only.

* ``POST /admin/search`` with ``{"q": ...}`` — admin. Learners, classes, submissions, content,
  orders; at most three rows each.
* ``POST /instructor/search`` with ``{"q": ...}`` — a teacher (or an admin through the same
  scope). Learners, classes and submissions of the caller's classes only
  (``services.staff_scope``); no content and no orders.

``q`` is sent in the JSON body, not the URL: the hosting platform's HTTP
log keeps request URLs, and no app filter reaches it (a deviation from plan
5.4's ``GET ?q=``; no page called the GET form). ``q`` must have at least two characters after trimming, else 422
``query_too_short``. The ``admin_search`` log line records the length of
``q`` and the number of results, never ``q`` itself.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from models.admin_search import AdminSearchOut, InstructorSearchOut, SearchIn
from routers.admin import require_admin
from services import admin_search, test_data_visibility
from services.staff_scope import resolve_staff_scope

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-search"])


def _query(q: str) -> str:
    q = (q or "").strip()
    if len(q) < admin_search.MIN_QUERY:
        raise HTTPException(422, {"code": "query_too_short",
                                  "message": "Nhập ít nhất 2 ký tự để tìm."})
    return q


async def _run(q: str, *, role: str, cohort_ids, hide: bool, viewer_id=None) -> dict:
    try:
        out = await asyncio.to_thread(admin_search.search, q, cohort_ids=cohort_ids, hide_test=hide,
                                      viewer_id=viewer_id)
    except Exception as exc:
        logger.exception("admin search: search failed")
        raise HTTPException(503, {"code": "search_unavailable",
                                  "message": "Chưa tìm được lúc này. Thử lại sau ít phút."}) from exc
    # Never log q: it can be a learner's name or e-mail.
    logger.info("admin_search role=%s q_len=%d results=%s failed=%s", role, len(q),
                admin_search.counts(out), out["sources_failed"])
    return out


@router.post("/admin/search", response_model=AdminSearchOut)
async def search_admin(body: SearchIn, authorization: Optional[str] = Header(default=None)):
    admin = await require_admin(authorization)
    q = _query(body.q)
    hide = await asyncio.to_thread(test_data_visibility.hide_for, email=admin.get("email"), is_admin=True)
    return await _run(q, role="admin", cohort_ids=None, hide=hide)


@router.post("/instructor/search", response_model=InstructorSearchOut)
async def search_instructor(body: SearchIn, authorization: Optional[str] = Header(default=None)):
    scope = await resolve_staff_scope(authorization)
    q = _query(body.q)
    hide = await asyncio.to_thread(test_data_visibility.hide_for, user_id=scope.user_id, is_admin=scope.is_admin)
    out = await _run(q, role=scope.role, cohort_ids=scope.cohort_ids, hide=hide,
                     viewer_id=scope.user_id)
    # An admin on the teacher door still gets the teacher shape.
    shaped = {k: out[k] for k in InstructorSearchOut.model_fields}
    shaped["unavailable"] = []   # orders are not part of this door
    return shaped
