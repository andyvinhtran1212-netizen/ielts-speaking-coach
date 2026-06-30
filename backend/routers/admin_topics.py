"""routers/admin_topics.py — Admin console for content topics (the topic spine).

Pha 0 of the Quick-Check quiz / topic-centric content plan. All endpoints
require_admin; writes via supabase_admin bypass the SELECT-public RLS (mig 117).

Prefix is /admin/content-topics (NOT /admin/topics) — routers/admin.py already
owns /admin/topics for the speaking-topics table and is mounted first, so reusing
that prefix would shadow these routes. Keep both surfaces reachable.

  GET    /admin/content-topics              — list (optional ?skill_area=).
  POST   /admin/content-topics              — create (slug auto-derives from title).
  GET    /admin/content-topics/{id}         — single topic.
  PATCH  /admin/content-topics/{id}         — partial update.
  DELETE /admin/content-topics/{id}         — delete (409 while vocab cards reference it).
  GET    /admin/content-topics/{id}/bundle  — topic + its content (vocab cards now;
                                              quiz banks land in Pha 1).
"""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Header, Query
from pydantic import BaseModel

from routers.admin import require_admin
from services import topic_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/content-topics", tags=["admin-content-topics"])


class TopicCreate(BaseModel):
    title: str
    slug: str | None = None
    skill_area: str = "vocab"
    title_vi: str | None = None
    description: str | None = None
    order: int = 0
    is_published: bool = True


class TopicUpdate(BaseModel):
    slug: str | None = None
    title: str | None = None
    title_vi: str | None = None
    description: str | None = None
    order: int | None = None
    is_published: bool | None = None


@router.get("")
async def list_topics(
    skill_area: str | None = Query(default=None),
    authorization: str | None = Header(None),
):
    await require_admin(authorization)
    return topic_service.list_topics(skill_area=skill_area)


@router.post("", status_code=201)
async def create_topic(body: TopicCreate, authorization: str | None = Header(None)):
    await require_admin(authorization)
    return topic_service.create_topic(
        title=body.title,
        slug=body.slug,
        skill_area=body.skill_area,
        title_vi=body.title_vi,
        description=body.description,
        order=body.order,
        is_published=body.is_published,
    )


@router.get("/{topic_id}")
async def get_topic(topic_id: UUID, authorization: str | None = Header(None)):
    await require_admin(authorization)
    return topic_service.get_topic(str(topic_id))


@router.patch("/{topic_id}")
async def update_topic(
    topic_id: UUID, body: TopicUpdate, authorization: str | None = Header(None)
):
    await require_admin(authorization)
    # Only forward fields the caller actually set (partial update).
    data = body.model_dump(exclude_unset=True)
    return topic_service.update_topic(str(topic_id), data)


@router.delete("/{topic_id}")
async def delete_topic(topic_id: UUID, authorization: str | None = Header(None)):
    await require_admin(authorization)
    return topic_service.delete_topic(str(topic_id))


@router.get("/{topic_id}/bundle")
async def get_topic_bundle(topic_id: UUID, authorization: str | None = Header(None)):
    await require_admin(authorization)
    return topic_service.get_topic_bundle(str(topic_id))
