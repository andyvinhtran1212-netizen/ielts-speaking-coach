"""routers.admin.topics — topic and topic-question CRUD and generation (BACKENDSPLIT-0076 T009).

Cut and pasted unchanged from the former single-file routers/admin.py. The
package re-exports every name; tests patch ``routers.admin``, never this module
(see __init__.py).
"""

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query, Response
from starlette.concurrency import run_in_threadpool
from database import supabase_admin
from services.errors import clip_user_value, clip_user_values, new_ref, safe_error
from services import speaking_question_audio as speaking_audio

from routers.admin import (  # noqa: E402 — defined above this block in the package
    logger,
    router,
    require_admin,
    _uniq_topic_ids,
    _touch_topic,
)
from ._common import (  # noqa: E402
    CreateTopicRequest,
    PatchTopicRequest,
    BulkAddTopicsRequest,
    GenerateTopicQuestionsRequest,
    BulkTopicIdsRequest,
    BulkGenerateTopicsRequest,
    CreateTopicQuestionRequest,
    UpdateTopicQuestionRequest,
    _serialize_topics_with_metadata,
    _generate_questions_for_topic,
)


# ── GET /admin/topics ──────────────────────────────────────────────────────────

@router.get("/topics")
async def list_topics(authorization: str | None = Header(default=None)):
    await require_admin(authorization)

    try:
        res = (
            supabase_admin.table("topics")
            .select("*")
            .order("part")
            .order("title")
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] list topics failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải topics. Vui lòng thử lại.") from None

    return _serialize_topics_with_metadata(res.data or [])


# ── POST /admin/topics ─────────────────────────────────────────────────────────

@router.post("/topics", status_code=201)
async def create_topic(
    body: CreateTopicRequest,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    title = body.title.strip()
    if not title:
        raise HTTPException(400, "Tên topic không được để trống")

    try:
        res = (
            supabase_admin.table("topics")
            .insert({
                "title":     title,
                "category":  (body.category or "").strip(),
                "part":      body.part,
                "is_active": body.is_active,
            })
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] create topic failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tạo topic. Vui lòng thử lại.") from None

    return _serialize_topics_with_metadata(res.data or [])[0]


# ── PATCH /admin/topics/{topic_id} ────────────────────────────────────────────

@router.patch("/topics/{topic_id}")
async def patch_topic(
    topic_id: str,
    body: PatchTopicRequest,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)

    update: dict = {}
    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(400, "Tên topic không được để trống")
        update["title"] = title
    if body.category  is not None: update["category"]  = body.category.strip()
    if body.part      is not None: update["part"]       = body.part
    if body.is_active is not None: update["is_active"]  = body.is_active

    if not update:
        raise HTTPException(400, "Không có trường nào để cập nhật")

    try:
        res = (
            supabase_admin.table("topics")
            .update(update)
            .eq("id", topic_id)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] update topic failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi cập nhật topic. Vui lòng thử lại.") from None

    if not res.data:
        raise HTTPException(404, "Topic không tồn tại")

    return _serialize_topics_with_metadata(res.data or [])[0]


# ── DELETE /admin/topics/{topic_id} ───────────────────────────────────────────

@router.delete("/topics/{topic_id}", status_code=204)
async def delete_topic(
    topic_id: str,
    authorization: str | None = Header(default=None),
):
    """Hard-delete a topic and its library questions (cascade via FK)."""
    await require_admin(authorization)
    try:
        supabase_admin.table("topics").delete().eq("id", topic_id).execute()
        remaining = (
            supabase_admin.table("topics")
            .select("id")
            .eq("id", topic_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] delete topic failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi xóa topic. Vui lòng thử lại.") from None
    if remaining.data:
        raise HTTPException(500, "Topic chưa được xóa hoàn tất")


@router.post("/topics/bulk-delete")
async def bulk_delete_topics(
    body: BulkTopicIdsRequest,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)

    topic_ids = _uniq_topic_ids(body.topic_ids)
    if not topic_ids:
        raise HTTPException(400, "Không có topic IDs hợp lệ")

    try:
        existing = (
            supabase_admin.table("topics")
            .select("id, title")
            .in_("id", topic_ids)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] load topics for bulk delete failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải topics. Vui lòng thử lại.") from None

    existing_rows = existing.data or []
    title_by_id = {row["id"]: (row.get("title") or row["id"]) for row in existing_rows if row.get("id")}
    existing_ids = [row["id"] for row in existing_rows if row.get("id")]
    missing_ids = [topic_id for topic_id in topic_ids if topic_id not in existing_ids]
    errors = [
        {
            "topic_id": topic_id,
            "topic_title": None,
            "message": "Topic không tồn tại",
            "code": "not_found",
        }
        for topic_id in missing_ids
    ]

    deleted_ids: list[str] = []
    failed_ids = list(missing_ids)

    if existing_ids:
        try:
            supabase_admin.table("topics").delete().in_("id", existing_ids).execute()
            remaining = (
                supabase_admin.table("topics")
                .select("id")
                .in_("id", existing_ids)
                .execute()
            )
            remaining_ids = {row["id"] for row in (remaining.data or []) if row.get("id")}
            deleted_ids = [topic_id for topic_id in existing_ids if topic_id not in remaining_ids]
            undeleted_ids = [topic_id for topic_id in existing_ids if topic_id in remaining_ids]
            failed_ids.extend(undeleted_ids)
            errors.extend([
                {
                    "topic_id": topic_id,
                    "topic_title": title_by_id.get(topic_id),
                    "message": "Topic chưa được xóa hoàn tất",
                    "code": "delete_not_confirmed",
                }
                for topic_id in undeleted_ids
            ])
        except Exception:
            ref = new_ref()
            logger.error("[admin] bulk delete topics failed ref=%s", ref, exc_info=True)
            failed_ids.extend(existing_ids)
            errors.append({
                "topic_id": None,
                "topic_title": None,
                "message": "Không xóa được topics, vui lòng thử lại.",
                "code": "delete_failed",
                "ref": ref,
            })

    return {
        "processed_count": len(topic_ids),
        "deleted_count": len(deleted_ids),
        "deleted_ids": deleted_ids,
        "failed_ids": failed_ids,
        "errors": errors,
        "delete_semantics": "Deleting a topic hard-deletes the topic and cascades to all of its library questions.",
    }


# ── POST /admin/topics/bulk ────────────────────────────────────────────────────

@router.post("/topics/bulk", status_code=201)
async def bulk_add_topics(
    body: BulkAddTopicsRequest,
    authorization: str | None = Header(default=None),
):
    """
    Thêm hàng loạt topics cho một Part.
    Body: { part: 1|2|3, lines: "Topic A\\nTopic B\\nTopic C" }
    """
    await require_admin(authorization)

    titles = [l.strip() for l in body.lines.splitlines() if l.strip()]
    if not titles:
        raise HTTPException(400, "Không có dòng nào hợp lệ")

    rows = [{"title": t, "category": "", "part": body.part, "is_active": True} for t in titles]
    try:
        res = supabase_admin.table("topics").insert(rows).execute()
    except Exception as exc:
        logger.error("[admin] bulk add topics failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi thêm topics. Vui lòng thử lại.") from None

    topics = _serialize_topics_with_metadata(res.data or [])
    created_count = len(topics)
    return {
        "created": created_count,
        "created_count": created_count,
        "topics": topics,
    }


# ── GET /admin/topics/{topic_id}/questions ─────────────────────────────────────

@router.get("/topics/{topic_id}/questions")
async def list_topic_questions(
    topic_id: str,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    try:
        res = (
            supabase_admin.table("topic_questions")
            .select("*")
            .eq("topic_id", topic_id)
            .eq("is_active", True)
            .order("part")
            .order("order_num")
            .execute()
        )
        rows = res.data or []
        if not rows:
            return rows
        topic = (supabase_admin.table("topics")
                 .select("title").eq("id", topic_id).limit(1).execute()).data or []
        if not topic:
            raise HTTPException(404, "Topic không tồn tại")
        title = topic[0]["title"]
        return [{**row, "audio_ready": (
            speaking_audio.audio_matches_question(row, title)
            if row.get("part") in speaking_audio.AUDIO_PARTS else False)}
                for row in rows]
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[admin] list topic questions failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải questions. Vui lòng thử lại.") from None


# ── POST /admin/topics/{topic_id}/questions ────────────────────────────────────

@router.post("/topics/{topic_id}/questions", status_code=201)
async def create_topic_question(
    topic_id: str,
    body: CreateTopicQuestionRequest,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    question_text = body.question_text.strip()
    if not question_text:
        raise HTTPException(400, "Câu hỏi không được để trống")

    # Auto order_num if not provided
    order = body.order_num
    if order == 0:
        try:
            cnt = (
                supabase_admin.table("topic_questions")
                .select("id", count="exact")
                .eq("topic_id", topic_id)
                .eq("part", body.part)
                .eq("is_active", True)
                .execute()
            )
            order = (cnt.count or 0) + 1
        except Exception as exc:
            logger.error("[admin] count topic questions for order failed: %s", exc, exc_info=True)
            raise HTTPException(500, "Không xác định được thứ tự câu hỏi. Vui lòng thử lại.") from None

    cue_card_bullets = [item.strip() for item in (body.cue_card_bullets or []) if item.strip()] or None
    cue_card_reflection = (body.cue_card_reflection or "").strip() or None
    if body.part != 2:
        cue_card_bullets = None
        cue_card_reflection = None

    row = {
        "topic_id":            topic_id,
        "part":                body.part,
        "order_num":           order,
        "question_text":       question_text,
        "question_type":       body.question_type.strip(),
        "cue_card_bullets":    cue_card_bullets,
        "cue_card_reflection": cue_card_reflection,
    }
    try:
        res = supabase_admin.table("topic_questions").insert(row).execute()
    except Exception as exc:
        logger.error("[admin] create topic question failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tạo question. Vui lòng thử lại.") from None
    _touch_topic(topic_id)
    return res.data[0]


# ── PATCH /admin/topics/{topic_id}/questions/{question_id} ────────────────────

@router.patch("/topics/{topic_id}/questions/{question_id}")
async def update_topic_question(
    topic_id: str,
    question_id: str,
    body: UpdateTopicQuestionRequest,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)

    try:
        current_res = (
            supabase_admin.table("topic_questions")
            .select("id, part, question_text, cue_card_bullets, cue_card_reflection")
            .eq("id", question_id)
            .eq("topic_id", topic_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] load topic question failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải question hiện tại. Vui lòng thử lại.") from None
    if not current_res.data:
        raise HTTPException(404, "Question không tồn tại")
    current = current_res.data[0]

    if not body.model_fields_set:
        raise HTTPException(400, "Không có trường nào để cập nhật")

    update: dict = {}
    part_changed = body.part is not None and body.part != current.get("part")
    if body.part                is not None: update["part"]                = body.part
    if body.question_text is not None:
        question_text = body.question_text.strip()
        if not question_text:
            raise HTTPException(400, "Câu hỏi không được để trống")
        update["question_text"] = question_text
        # ĐỔI LỜI CÂU HỎI THÌ BẢN ĐỌC CŨ HẾT GIÁ TRỊ. Không xoá thì audio vẫn đọc
        # đề CŨ trong khi bộ chấm đọc đề MỚI: học viên trả lời cái mình nghe rồi
        # bị chấm theo một câu khác — nhận xét sai mà không ai truy ra được vì
        # hai bên đều "có dữ liệu".
        #
        # Xoá chứ không render lại tại đây: render mất vài giây và endpoint này
        # là một lần bấm Lưu của admin. Xoá làm câu đó lập tức KHÔNG giao được
        # (backend chặn), và mẻ render sau sẽ dựng lại.
        if question_text != (current.get("question_text") or "").strip():
            update["audio_url"] = None
            update["audio_path"] = None
    # Part là một phần của script TTS (lời dẫn/cấu trúc cue-card khác nhau), nên
    # giữ audio cũ sau khi chuyển Part cũng nguy hiểm như giữ audio của lời cũ.
    if part_changed:
        update["audio_url"] = None
        update["audio_path"] = None
    if body.question_type       is not None: update["question_type"]       = body.question_type.strip()
    if body.order_num           is not None: update["order_num"]           = body.order_num
    effective_part = body.part if body.part is not None else current.get("part")
    if effective_part != 2:
        update["cue_card_bullets"] = None
        update["cue_card_reflection"] = None
    else:
        if "cue_card_bullets" in body.model_fields_set:
            update["cue_card_bullets"] = [item.strip() for item in (body.cue_card_bullets or []) if item.strip()] or None
        if "cue_card_reflection" in body.model_fields_set:
            update["cue_card_reflection"] = (body.cue_card_reflection or "").strip() or None

    if not update:
        raise HTTPException(400, "Không có trường nào để cập nhật")

    try:
        res = (
            supabase_admin.table("topic_questions")
            .update(update)
            .eq("id", question_id)
            .eq("topic_id", topic_id)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] update topic question failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi cập nhật question. Vui lòng thử lại.") from None

    if not res.data:
        raise HTTPException(404, "Question không tồn tại")
    _touch_topic(topic_id)
    return res.data[0]


# ── DELETE /admin/topics/{topic_id}/questions/{question_id} ───────────────────

@router.post("/topics/{topic_id}/questions/{question_id}/render-audio")
async def render_topic_question_audio(
    topic_id: str,
    question_id: str,
    authorization: str | None = Header(default=None),
):
    """Make one Part 1/3 bank question assignable after an editorial review.

    Rendering runs off the event loop. Recheck the topic title and conditionally
    update the question so an edit during synthesis cannot attach stale audio.
    """
    await require_admin(authorization)
    try:
        topic_rows = (supabase_admin.table("topics").select("id, title")
                      .eq("id", topic_id).limit(1).execute().data or [])
        question_rows = (supabase_admin.table("topic_questions")
                         .select("id, topic_id, part, question_text, is_active")
                         .eq("id", question_id).eq("topic_id", topic_id)
                         .limit(1).execute().data or [])
    except Exception as exc:
        logger.error("[admin] render question audio lookup failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Không đọc được câu hỏi. Vui lòng thử lại.") from None
    if not topic_rows or not question_rows:
        raise HTTPException(404, "Topic hoặc câu hỏi không tồn tại")
    question = dict(question_rows[0])
    if question.get("is_active") is not True or question.get("part") not in (1, 3):
        raise HTTPException(400, "Chỉ tạo audio cho câu Part 1/3 đang bật")
    topic_title = topic_rows[0]["title"]
    try:
        audio = await run_in_threadpool(
            speaking_audio.render_question_audio, question, topic_title,
            engine=speaking_audio.ADMIN_ENGINE, voice=speaking_audio.ADMIN_VOICE,
        )
        current_topic_rows = (supabase_admin.table("topics").select("id, title")
                              .eq("id", topic_id).limit(1).execute().data or [])
    except Exception as exc:
        logger.error("[admin] render question audio failed: %s", exc, exc_info=True)
        raise HTTPException(502, "Không tạo được audio. Vui lòng thử lại.") from None
    if not current_topic_rows or current_topic_rows[0]["title"] != topic_title:
        raise HTTPException(409, "Tên topic đã đổi trong lúc tạo audio; tải lại rồi thử lại")
    try:
        updated = (supabase_admin.table("topic_questions")
                   .update({"audio_url": audio["audio_url"], "audio_path": audio["audio_path"]})
                   .eq("id", question_id).eq("topic_id", topic_id)
                   .eq("part", question["part"])
                   .eq("question_text", question["question_text"])
                   .eq("is_active", True).execute().data or [])
    except Exception as exc:
        logger.error("[admin] render question audio save failed: %s", exc, exc_info=True)
        raise HTTPException(502, "Không tạo được audio. Vui lòng thử lại.") from None
    if not updated:
        raise HTTPException(409, "Câu hỏi đã đổi trong lúc tạo audio; tải lại rồi thử lại")
    return {"id": question_id, "topic_id": topic_id,
            "audio_ready": True, "synthesized": audio["synthesized"]}


@router.delete("/topics/{topic_id}/questions/{question_id}", status_code=204)
async def delete_topic_question(
    topic_id: str,
    question_id: str,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    try:
        supabase_admin.table("topic_questions").delete().eq("id", question_id).eq("topic_id", topic_id).execute()
        remaining = (
            supabase_admin.table("topic_questions")
            .select("id")
            .eq("id", question_id)
            .eq("topic_id", topic_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] delete topic question failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi xóa question. Vui lòng thử lại.") from None
    if remaining.data:
        raise HTTPException(500, "Question chưa được xóa hoàn tất")
    _touch_topic(topic_id)


# ── POST /admin/topics/{topic_id}/generate-questions ──────────────────────────

@router.post("/topics/{topic_id}/generate-questions")
async def generate_topic_questions(
    topic_id: str,
    body: GenerateTopicQuestionsRequest | None = None,
    authorization: str | None = Header(default=None),
):
    """
    Generate questions for a topic.
    - mode=missing_only: only create when the topic has no questions yet.
    - mode=replace_all: delete current questions, then generate a fresh set.
    """
    auth_user = await require_admin(authorization)
    mode = (body.mode if body else "missing_only").strip().lower()
    if mode not in {"missing_only", "replace_all"}:
        raise HTTPException(400, "mode phải là missing_only hoặc replace_all")

    return await _generate_questions_for_topic(
        topic_id,
        auth_user["id"],
        replace_existing=(mode == "replace_all"),
    )


@router.post("/topics/{topic_id}/rotate-questions")
async def rotate_topic_questions(
    topic_id: str,
    authorization: str | None = Header(default=None),
):
    auth_user = await require_admin(authorization)
    return await _generate_questions_for_topic(
        topic_id,
        auth_user["id"],
        replace_existing=True,
    )


@router.post("/topics/bulk-generate-questions")
async def bulk_generate_topic_questions(
    body: BulkGenerateTopicsRequest,
    authorization: str | None = Header(default=None),
):
    auth_user = await require_admin(authorization)

    topic_ids = _uniq_topic_ids(body.topic_ids)
    if not topic_ids:
        raise HTTPException(400, "Không có topic IDs hợp lệ")

    mode = (body.mode or "missing_only").strip().lower()
    if mode not in {"missing_only", "replace_all"}:
        raise HTTPException(400, "mode phải là missing_only hoặc replace_all")

    title_by_id: dict[str, str | None] = {}
    try:
        t_res = (
            supabase_admin.table("topics")
            .select("id, title")
            .in_("id", topic_ids)
            .execute()
        )
        title_by_id = {
            row["id"]: row.get("title")
            for row in (t_res.data or [])
            if row.get("id")
        }
    except Exception:
        logger.warning("[admin.topics] failed to load topic titles for bulk action", exc_info=True)

    success_ids: list[str] = []
    failed_ids: list[str] = []
    errors: list[dict] = []

    for topic_id in topic_ids:
        try:
            await _generate_questions_for_topic(
                topic_id,
                auth_user["id"],
                replace_existing=(mode == "replace_all"),
            )
            success_ids.append(topic_id)
        except HTTPException as exc:
            failed_ids.append(topic_id)
            errors.append({
                "topic_id": topic_id,
                "topic_title": title_by_id.get(topic_id),
                "message": exc.detail,
                "code": "already_has_questions" if exc.status_code == 409 else "request_failed",
                "status_code": exc.status_code,
            })
        except Exception as exc:
            failed_ids.append(topic_id)
            errors.append({
                "topic_id": topic_id,
                "topic_title": title_by_id.get(topic_id),
                "message": str(exc),
                "code": "unexpected_error",
                "status_code": 500,
            })

    return {
        "processed_count": len(topic_ids),
        "success_count": len(success_ids),
        "success_ids": success_ids,
        "failed_ids": failed_ids,
        "errors": errors,
        "mode": mode,
        "semantics": (
            "Generate creates questions only for topics that do not already have any library questions."
            if mode == "missing_only"
            else "Rotate replaces the current library questions with a fresh generated set."
        ),
    }


@router.post("/topics/bulk-rotate-questions")
async def bulk_rotate_topic_questions(
    body: BulkTopicIdsRequest,
    authorization: str | None = Header(default=None),
):
    # ADMINAAL2-0032 — guard before building the delegated request.
    await require_admin(authorization)
    return await bulk_generate_topic_questions(
        BulkGenerateTopicsRequest(topic_ids=body.topic_ids, mode="replace_all"),
        authorization=authorization,
    )
