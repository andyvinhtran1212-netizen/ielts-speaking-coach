"""services/topic_service.py — content topics (the topic-centric content spine).

Pha 0 of the Quick-Check quiz / topic-centric content plan
(docs/research/QUICK_CHECK_QUIZ_AND_TOPIC_CONTENT_PLAN.md).

A topic (chủ đề) organizes content by theme; vocab cards (now) and quiz banks +
grammar exercises (later) hang off a topic. `skill_area` scopes a topic to one
content area (UNIQUE is per skill_area). Writes go through `supabase_admin`
(service-role) — the table is SELECT-public, writes service-role only (mig 117).

Pure-ish service functions so the router stays thin and these are unit-testable
with a mocked supabase_admin (see tests/test_topic_service.py).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import HTTPException

from database import supabase_admin
from services.content_import_service import slugify

logger = logging.getLogger(__name__)

# Content areas a topic may belong to. 'grammar' lands in Pha 4 but is accepted
# now so the spine is forward-compatible; extend (e.g. 'reading') as needed.
VALID_SKILL_AREAS = ("vocab", "grammar")

# Columns an admin may edit. skill_area is intentionally immutable (re-scoping a
# topic across areas would orphan its content); id/created_at/updated_at managed.
_EDITABLE_FIELDS = ("slug", "title", "title_vi", "description", "order", "is_published")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def list_topics(skill_area: str | None = None) -> list[dict]:
    """All topics (optionally filtered by skill_area), ordered for display."""
    q = supabase_admin.table("content_topics").select("*")
    if skill_area:
        q = q.eq("skill_area", skill_area)
    try:
        rows = q.order("skill_area").order("order").order("title").execute().data or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn topics: {exc}")
    return rows


def get_topic(topic_id: str) -> dict:
    try:
        rows = (
            supabase_admin.table("content_topics")
            .select("*").eq("id", topic_id).limit(1).execute()
        ).data
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn topic: {exc}")
    if not rows:
        raise HTTPException(404, "Không tìm thấy topic")
    return rows[0]


def create_topic(
    *,
    title: str,
    slug: str | None = None,
    skill_area: str = "vocab",
    title_vi: str | None = None,
    description: str | None = None,
    order: int = 0,
    is_published: bool = True,
) -> dict:
    """Create a topic. slug auto-derives from title (slugify) when omitted.
    409 when (skill_area, slug) already exists."""
    title = (title or "").strip()
    if not title:
        raise HTTPException(422, "Thiếu tiêu đề topic")
    if skill_area not in VALID_SKILL_AREAS:
        raise HTTPException(422, f"skill_area không hợp lệ: {skill_area!r}")

    slug = (slug or "").strip() or slugify(title)
    if not slug:
        raise HTTPException(422, "Không tạo được slug từ tiêu đề")

    payload = {
        "slug": slug,
        "skill_area": skill_area,
        "title": title,
        "title_vi": title_vi,
        "description": description,
        "order": order,
        "is_published": is_published,
    }
    try:
        res = supabase_admin.table("content_topics").insert(payload).execute()
    except Exception as exc:  # noqa: BLE001
        msg = str(exc).lower()
        if "duplicate" in msg or "unique" in msg or "23505" in msg:
            raise HTTPException(409, f"Topic đã tồn tại: {skill_area}/{slug}")
        raise HTTPException(500, f"Lỗi tạo topic: {exc}")
    if not res.data:
        raise HTTPException(500, "Insert topic không trả về dòng nào")
    return res.data[0]


def update_topic(topic_id: str, data: dict) -> dict:
    """Partial update — only the editable fields present in `data` are written."""
    get_topic(topic_id)  # 404 guard

    patch = {k: data[k] for k in _EDITABLE_FIELDS if k in data}
    if "slug" in patch:
        patch["slug"] = (str(patch["slug"]).strip() or "") or slugify(str(data.get("title", "")))
        if not patch["slug"]:
            raise HTTPException(422, "slug rỗng không hợp lệ")
    if not patch:
        return get_topic(topic_id)

    try:
        res = (
            supabase_admin.table("content_topics")
            .update(patch).eq("id", topic_id).execute()
        )
    except Exception as exc:  # noqa: BLE001
        msg = str(exc).lower()
        if "duplicate" in msg or "unique" in msg or "23505" in msg:
            raise HTTPException(409, "Trùng (skill_area, slug) với topic khác")
        raise HTTPException(500, f"Lỗi cập nhật topic: {exc}")
    return res.data[0] if res.data else get_topic(topic_id)


def _vocab_card_count(topic_id: str) -> int:
    try:
        res = (
            supabase_admin.table("vocab_cards")
            .select("id", count="exact").eq("topic_id", topic_id).execute()
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi đếm vocab_cards: {exc}")
    return res.count if res.count is not None else len(res.data or [])


def delete_topic(topic_id: str) -> dict:
    """Delete a topic. Blocked (409) while vocab cards still reference it — the
    admin must reassign/clear those cards first, so a topic is never deleted out
    from under live content."""
    get_topic(topic_id)  # 404 guard
    n = _vocab_card_count(topic_id)
    if n > 0:
        raise HTTPException(
            409,
            f"Không thể xoá: còn {n} từ vựng thuộc topic này. "
            f"Hãy chuyển/bỏ gán các từ đó trước.",
        )
    try:
        supabase_admin.table("content_topics").delete().eq("id", topic_id).execute()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi xoá topic: {exc}")
    return {"id": topic_id, "deleted": True}


def get_topic_bundle(topic_id: str) -> dict:
    """Topic + the content hanging off it, for the topic-centric admin console.

    Pha 0: vocab cards only. Forward-compatible — `quiz_banks` is returned as an
    empty list until Pha 1 adds the table, so the frontend shape is stable."""
    topic = get_topic(topic_id)
    try:
        cards = (
            supabase_admin.table("vocab_cards")
            .select("id, slug, headword, category, level, part_of_speech, audio_status, updated_at")
            .eq("topic_id", topic_id)
            .order("headword")
            .execute()
        ).data or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn vocab_cards: {exc}")

    return {
        "topic": topic,
        "vocab_cards": cards,
        "quiz_banks": [],  # Pha 1
        "counts": {"vocab_cards": len(cards), "quiz_banks": 0},
    }
