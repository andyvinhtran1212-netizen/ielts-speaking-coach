"""routers.admin._common — shared helpers of the admin package (BACKENDSPLIT-0076 T009).

Lines 245–710 of the former single-file routers/admin.py, cut and pasted
unchanged: topic-question replacement helpers, storage signing, request models
and the topic serialization/generation helpers. The staff guards, ``_actor_id``
and ``_require_db_engine`` stay defined in ``routers/admin/__init__.py``. The
package re-exports every name; tests patch ``routers.admin``, never this module
(see __init__.py).
"""

import json

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query, Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text

from database import supabase_admin
from services.errors import clip_user_value, clip_user_values, new_ref, safe_error
from services.gemini import (
    generate_part1_questions,
    generate_part2_cuecard,
    generate_part3_questions,
)

from routers.admin import (  # noqa: E402 — defined above the cut in __init__.py
    logger,
    _db_engine,
    _utc_now_iso,
    _max_iso,
    _topic_status,
    _touch_topic,
    _require_db_engine,
)


async def _replace_topic_questions_transactionally(topic_id: str, rows: list[dict]) -> list[dict]:
    if not rows:
        raise HTTPException(500, "Không tạo được bộ câu hỏi mới để thay thế bộ hiện tại.")

    engine = _require_db_engine()
    inserted_rows: list[dict] = []
    insert_sql = text(
        """
        INSERT INTO topic_questions (
            topic_id,
            part,
            order_num,
            question_text,
            question_type,
            cue_card_bullets,
            cue_card_reflection,
            is_active
        ) VALUES (
            :topic_id,
            :part,
            :order_num,
            :question_text,
            :question_type,
            CAST(:cue_card_bullets AS jsonb),
            :cue_card_reflection,
            TRUE
        )
        RETURNING
            id,
            topic_id,
            part,
            order_num,
            question_text,
            question_type,
            cue_card_bullets,
            cue_card_reflection,
            is_active,
            created_at
        """
    )

    try:
        async with engine.begin() as conn:
            await conn.execute(
                text("DELETE FROM topic_questions WHERE topic_id = :topic_id"),
                {"topic_id": topic_id},
            )
            for row in rows:
                params = {
                    "topic_id": row.get("topic_id"),
                    "part": row.get("part"),
                    "order_num": row.get("order_num", 0),
                    "question_text": row.get("question_text", ""),
                    "question_type": row.get("question_type", ""),
                    "cue_card_bullets": (
                        json.dumps(row.get("cue_card_bullets"))
                        if row.get("cue_card_bullets") is not None
                        else None
                    ),
                    "cue_card_reflection": row.get("cue_card_reflection"),
                }
                result = await conn.execute(insert_sql, params)
                inserted_rows.extend([dict(record._mapping) for record in result.fetchall()])
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "[admin.topics] transactional rotate failed topic=%s",
            topic_id,
            exc_info=True,
        )
        raise HTTPException(
            500,
            "Lỗi khi thay thế bộ câu hỏi. Hệ thống đã giữ nguyên bộ câu hỏi trước đó.",
        ) from exc

    return inserted_rows


async def _replace_topic_questions_with_visibility_swap(
    topic_id: str,
    rows: list[dict],
    existing_rows: list[dict],
) -> list[dict]:
    if not rows:
        raise HTTPException(500, "Không tạo được bộ câu hỏi mới để thay thế bộ hiện tại.")

    staged_rows = []
    for row in rows:
        staged_row = dict(row)
        staged_row["is_active"] = False
        staged_rows.append(staged_row)

    try:
        inserted_res = supabase_admin.table("topic_questions").insert(staged_rows).execute()
    except Exception as exc:
        logger.error("[admin] insert staged questions failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi lưu questions mới. Vui lòng thử lại.") from None

    inserted_rows = inserted_res.data or []
    inserted_ids = [row["id"] for row in inserted_rows if row.get("id")]
    old_ids = [row["id"] for row in (existing_rows or []) if row.get("id")]

    try:
        if old_ids:
            supabase_admin.table("topic_questions").update({"is_active": False}).in_("id", old_ids).execute()
    except Exception as exc:
        try:
            if inserted_ids:
                supabase_admin.table("topic_questions").delete().in_("id", inserted_ids).execute()
        except Exception:
            logger.warning("[admin.topics] failed to remove staged rotate rows topic=%s", topic_id, exc_info=True)
        raise HTTPException(
            500,
            "Lỗi khi thay thế bộ câu hỏi. Hệ thống đã giữ nguyên bộ câu hỏi trước đó.",
        ) from exc

    try:
        if inserted_ids:
            supabase_admin.table("topic_questions").update({"is_active": True}).in_("id", inserted_ids).execute()
    except Exception as exc:
        try:
            if old_ids:
                supabase_admin.table("topic_questions").update({"is_active": True}).in_("id", old_ids).execute()
        except Exception:
            logger.error("[admin.topics] failed to reactivate old questions topic=%s", topic_id, exc_info=True)
        try:
            if inserted_ids:
                supabase_admin.table("topic_questions").delete().in_("id", inserted_ids).execute()
        except Exception:
            logger.warning("[admin.topics] failed to clean staged rotate rows topic=%s", topic_id, exc_info=True)
        raise HTTPException(
            500,
            "Lỗi khi thay thế bộ câu hỏi. Hệ thống đã giữ nguyên bộ câu hỏi trước đó.",
        ) from exc

    try:
        supabase_admin.table("topic_questions").delete().eq("topic_id", topic_id).eq("is_active", False).execute()
    except Exception:
        logger.warning("[admin.topics] failed to clean inactive rotate rows topic=%s", topic_id, exc_info=True)

    return [{**row, "is_active": True} for row in inserted_rows]


async def _replace_topic_questions_failure_safe(
    topic_id: str,
    rows: list[dict],
    existing_rows: list[dict],
) -> list[dict]:
    if _db_engine is not None:
        return await _replace_topic_questions_transactionally(topic_id, rows)
    return await _replace_topic_questions_with_visibility_swap(topic_id, rows, existing_rows)


def _sign_storage_url(bucket: str, storage_path: str | None) -> str | None:
    if not storage_path:
        return None
    try:
        resp = supabase_admin.storage.from_(bucket).create_signed_url(storage_path, 3600)
        if hasattr(resp, "data") and resp.data:
            return resp.data.get("signedUrl") or resp.data.get("signedURL")
        if isinstance(resp, dict):
            return resp.get("signedUrl") or resp.get("signedURL")
    except Exception:
        logger.warning("[admin.audio] failed to sign storage path=%s", storage_path, exc_info=True)
    return None


# ── Request models ─────────────────────────────────────────────────────────────

class GenerateCodesRequest(BaseModel):
    count:         int              = Field(ge=1, le=100, description="Số mã cần tạo (1–100)")
    permissions:   list[str]        = Field(default=["all"], description='Danh sách quyền, ví dụ ["all"] hoặc ["practice","test_part"]')
    session_limit: int | None       = Field(default=None, ge=1, description="Giới hạn số sessions (null = không giới hạn)")
    expires_at:    str | None       = Field(default=None, description="Ngày hết hạn ISO 8601 (null = không hết hạn)")
    # Sprint 12.2 — code_type discriminator + cohort link + admin notes.
    code_type:     str              = Field(default="mass", description='"mass" | "direct" | "staff"')
    cohort_id:     str | None       = Field(default=None, description="UUID của lớp (bắt buộc khi code_type='direct')")
    notes:         str | None       = None
    # W-2 (Option B) — mint an email-bound instructor-promote code. grants_role
    # 'instructor' + intended_email auto-promotes the matching user at activation
    # (email verified against the token, not the body). NULL = ordinary code.
    grants_role:    str | None      = Field(default=None, description="null | 'instructor' (mã promote vai trò)")
    intended_email: str | None      = Field(default=None, description="email ràng buộc (BẮT BUỘC khi grants_role='instructor')")


class PatchCodeRequest(BaseModel):
    permissions:   list[str] | None = None
    session_limit: int | None       = None
    expires_at:    str | None       = None
    is_active:     bool | None      = None
    # Sprint 12.2 — admins can flip these post-create.
    code_type:     str | None       = None
    cohort_id:     str | None       = None
    notes:         str | None       = None


_VALID_CODE_TYPES = ("mass", "direct", "staff")


def _validate_code_type_combo(code_type: str, cohort_id: str | None) -> None:
    """Sprint 12.2 — direct codes MUST have a cohort; mass/staff MUST NOT.

    Raises HTTPException(422) on mismatch. Server-side belt to the
    frontend's client-side guard; the DB also has a CHECK on code_type
    domain but doesn't enforce the cross-column rule.
    """
    if code_type not in _VALID_CODE_TYPES:
        raise HTTPException(422, f"code_type phải là một trong {_VALID_CODE_TYPES}, got {clip_user_value(code_type)!r}")
    if code_type == "direct" and not cohort_id:
        raise HTTPException(422, "code_type='direct' bắt buộc phải có cohort_id")
    if code_type in ("mass", "staff") and cohort_id:
        raise HTTPException(422, f"code_type={code_type!r} không được gắn cohort_id")


class CreateTopicRequest(BaseModel):
    title:    str
    category: str | None = ""   # nullable for legacy clients; persisted as ""
    part:     int = Field(ge=1, le=3)
    is_active: bool = True


class PatchTopicRequest(BaseModel):
    title:     str | None = None
    part:      int | None = Field(default=None, ge=1, le=3)
    is_active: bool | None = None
    category:  str | None = None


class BulkAddTopicsRequest(BaseModel):
    part:  int = Field(ge=1, le=3)
    lines: str  # newline-separated topic titles


class GenerateTopicQuestionsRequest(BaseModel):
    mode: str = Field(default="missing_only", description="missing_only | replace_all")


class BulkTopicIdsRequest(BaseModel):
    topic_ids: list[str]


class BulkGenerateTopicsRequest(BaseModel):
    topic_ids: list[str]
    mode: str = Field(default="missing_only", description="missing_only | replace_all")


class CreateTopicQuestionRequest(BaseModel):
    part:                int   = Field(ge=1, le=3)
    question_text:       str
    question_type:       str   = ""
    order_num:           int   = Field(default=0, ge=0)
    cue_card_bullets:    list[str] | None = None
    cue_card_reflection: str | None       = None


class UpdateTopicQuestionRequest(BaseModel):
    part:                int | None        = Field(default=None, ge=1, le=3)
    question_text:       str | None       = None
    question_type:       str | None       = None
    order_num:           int | None       = Field(default=None, ge=1)
    cue_card_bullets:    list[str] | None = None
    cue_card_reflection: str | None       = None


def _serialize_topics_with_metadata(topics: list[dict]) -> list[dict]:
    rows = topics or []
    if not rows:
        return []

    topic_ids = [t["id"] for t in rows if t.get("id")]
    question_counts: dict[str, int] = {}
    latest_question_at: dict[str, str] = {}
    question_metadata_lookup_failed = False

    if topic_ids:
        try:
            # A single PostgREST read stops at the server's row cap. The dated
            # Speaking bank exceeds 1,000 questions, so paginate on a stable ID
            # order and keep topic-ID filters short enough for request URLs.
            for start in range(0, len(topic_ids), 50):
                chunk = topic_ids[start:start + 50]
                offset = 0
                while True:
                    q_res = (
                        supabase_admin.table("topic_questions")
                        .select("id, topic_id, created_at")
                        .in_("topic_id", chunk)
                        .eq("is_active", True)
                        .order("id")
                        .range(offset, offset + 499)
                        .execute()
                    )
                    questions = q_res.data or []
                    for q in questions:
                        topic_id = q.get("topic_id")
                        if not topic_id:
                            continue
                        question_counts[topic_id] = question_counts.get(topic_id, 0) + 1
                        latest_question_at[topic_id] = _max_iso(
                            latest_question_at.get(topic_id), q.get("created_at"),
                        ) or latest_question_at.get(topic_id)
                    if len(questions) < 500:
                        break
                    offset += 500
        except Exception:
            question_metadata_lookup_failed = True
            logger.warning("[admin.topics] failed to aggregate question metadata", exc_info=True)

    enriched: list[dict] = []
    for topic in rows:
        item = dict(topic)
        topic_id = item.get("id")
        count = None if question_metadata_lookup_failed else question_counts.get(topic_id, 0)
        status_code, status_label = _topic_status(item, count)
        item["question_count"] = count
        item["question_metadata_lookup_failed"] = question_metadata_lookup_failed
        item["status"] = status_code
        item["status_label"] = status_label
        item["last_question_created_at"] = latest_question_at.get(topic_id)
        item["last_updated_at"] = _max_iso(
            item.get("updated_at"),
            item.get("last_rotated_at"),
            latest_question_at.get(topic_id),
        )
        enriched.append(item)

    return enriched


async def _generate_questions_for_topic(
    topic_id: str,
    user_id: str,
    *,
    replace_existing: bool,
) -> dict:
    try:
        t_res = (
            supabase_admin.table("topics")
            .select("id, title, part")
            .eq("id", topic_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] load topic failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải topic. Vui lòng thử lại.") from None

    if not t_res.data:
        raise HTTPException(404, "Topic không tồn tại")

    topic = t_res.data[0]
    title = topic["title"]
    part = topic["part"]

    try:
        existing_res = (
            supabase_admin.table("topic_questions")
            .select("*", count="exact")
            .eq("topic_id", topic_id)
            .eq("is_active", True)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] load existing questions failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi kiểm tra questions hiện tại. Vui lòng thử lại.") from None

    existing_count = existing_res.count or len(existing_res.data or [])
    existing_rows = existing_res.data or []
    if existing_count > 0 and not replace_existing:
        raise HTTPException(409, "Topic đã có câu hỏi. Dùng Rotate để thay thế bộ câu hỏi hiện tại.")

    rows: list[dict] = []

    if part == 1:
        qs = await generate_part1_questions(title, count=7, user_id=user_id)
        for i, q in enumerate(qs):
            rows.append({
                "topic_id": topic_id,
                "part": 1,
                "order_num": i + 1,
                "question_text": q["question_text"],
                "question_type": q.get("question_type", "personal"),
            })
    elif part == 2:
        cuecard = await generate_part2_cuecard(title, user_id=user_id)
        rows.append({
            "topic_id": topic_id,
            "part": 2,
            "order_num": 1,
            "question_text": cuecard["question_text"],
            "question_type": "cuecard",
            "cue_card_bullets": cuecard.get("cue_card_bullets"),
            "cue_card_reflection": cuecard.get("cue_card_reflection"),
        })
        p3qs = await generate_part3_questions(title, count=5, user_id=user_id)
        for i, q in enumerate(p3qs):
            rows.append({
                "topic_id": topic_id,
                "part": 3,
                "order_num": i + 1,
                "question_text": q["question_text"],
                "question_type": q.get("question_type", "opinion"),
            })
    elif part == 3:
        qs = await generate_part3_questions(title, count=5, user_id=user_id)
        for i, q in enumerate(qs):
            rows.append({
                "topic_id": topic_id,
                "part": 3,
                "order_num": i + 1,
                "question_text": q["question_text"],
                "question_type": q.get("question_type", "opinion"),
            })

    if rows:
        if replace_existing:
            saved_rows = await _replace_topic_questions_failure_safe(topic_id, rows, existing_rows)
        else:
            try:
                supabase_admin.table("topic_questions").insert(rows).execute()
            except Exception as exc:
                logger.error("[admin] insert questions failed: %s", exc, exc_info=True)
                raise HTTPException(500, "Lỗi khi lưu questions. Vui lòng thử lại.") from None
            saved_rows = None
    else:
        saved_rows = None

    if replace_existing:
        try:
            supabase_admin.table("topics").update({"last_rotated_at": _utc_now_iso()}).eq("id", topic_id).execute()
        except Exception:
            logger.warning("[admin.topics] failed to update last_rotated_at topic=%s", topic_id, exc_info=True)
    _touch_topic(topic_id)

    if saved_rows is None:
        try:
            saved = (
                supabase_admin.table("topic_questions")
                .select("*")
                .eq("topic_id", topic_id)
                .eq("is_active", True)
                .order("part")
                .order("order_num")
                .execute()
            )
            saved_rows = saved.data or []
        except Exception as exc:
            logger.error("[admin] load saved questions failed: %s", exc, exc_info=True)
            raise HTTPException(500, "Lỗi khi tải questions đã lưu. Vui lòng thử lại.") from None

    saved_rows = sorted(
        saved_rows or [],
        key=lambda row: (row.get("part") or 0, row.get("order_num") or 0, row.get("created_at") or ""),
    )

    return {
        "topic_id": topic_id,
        "topic_title": title,
        "mode": "replace_all" if replace_existing else "missing_only",
        "replaced_existing": replace_existing,
        "question_count": len(saved_rows),
        "questions": saved_rows,
    }
