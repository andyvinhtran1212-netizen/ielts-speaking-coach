"""Admin authoring and learner APIs for VOCABSETS-0020."""
import asyncio
from uuid import UUID, uuid4
from datetime import datetime, timezone
from fastapi import APIRouter, Header, HTTPException, Query, BackgroundTasks, Response, Depends
from database import supabase_admin as db
from models.vocabulary_sets import (SetSave, SetAction, SetOut, CatalogOut, SessionStart, SessionOut,
    StudyAnswer, TestSubmit, CardCreate, SharedCard, CardSearchOut, OutcomesOut)
from routers.admin import require_admin
from routers.auth import get_supabase_user
from routers.admin_vocab import _reload_and_invalidate
from services.content_import_service import slugify
from services.topic_service import resolve_topic_id_for_category
from services import vocabulary_sets as svc

def private_response(response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Vary"] = "Authorization"


admin_router = APIRouter(prefix="/admin/vocabulary-sets", tags=["admin-vocabulary-sets"], dependencies=[Depends(private_response)])
router = APIRouter(prefix="/api/vocabulary-sets", tags=["vocabulary-sets"], dependencies=[Depends(private_response)])


@admin_router.get("", response_model=CatalogOut)
async def admin_catalog(authorization: str | None = Header(None)):
    await require_admin(authorization)

    def load_catalog():
        courses, cohorts = svc.audience(db)
        return CatalogOut(sets=[svc.set_out(db, r, detail=False) for r in svc.paged(db, "vocabulary_sets")],
                          courses=courses, cohorts=[{"id": c["id"], "name": c["name"], "course_id": c.get("course_id")} for c in cohorts])

    return await asyncio.to_thread(load_catalog)


@admin_router.get("/cards", response_model=CardSearchOut)
async def search_cards(q: str = Query(default="", max_length=120), authorization: str | None = Header(None)):
    await require_admin(authorization)

    def find_cards():
        query = db.table("vocab_cards").select(",".join(SharedCard.model_fields))
        if q:
            query = query.ilike("headword", "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
        rows = query.order("headword").limit(50).execute().data or []
        return {"cards": [{k: v or "" for k, v in r.items()} for r in rows]}

    return await asyncio.to_thread(find_cards)


@admin_router.post("/cards", response_model=SharedCard)
async def create_card(body: CardCreate, background_tasks: BackgroundTasks, authorization: str | None = Header(None)):
    await require_admin(authorization)

    def insert_card():
        category = slugify(body.category)
        row = {**body.model_dump(), "id": str(uuid4()), "slug": slugify(body.headword), "category": category,
               "topic_id": resolve_topic_id_for_category(category)}
        try:
            result = db.table("vocab_cards").insert(row).execute().data
        except Exception as exc:
            if "23505" in str(exc) or "duplicate" in str(exc).lower():
                raise HTTPException(409, "Từ này đã tồn tại. Tìm và chọn từ hiện có hoặc sửa ở Nội dung từ vựng.") from exc
            raise HTTPException(503, "Không thêm được từ. Vui lòng thử lại.") from exc
        if not result:
            raise HTTPException(503, "Chưa nhận được xác nhận lưu từ.")
        _reload_and_invalidate(background_tasks)
        return {k: result[0].get(k) or "" for k in SharedCard.model_fields}

    return await asyncio.to_thread(insert_card)


@admin_router.post("/{set_id}", response_model=SetOut)
async def save_set(set_id: UUID, body: SetSave, authorization: str | None = Header(None)):
    actor = await require_admin(authorization)

    def persist_set():
        row = svc.rpc(db, "fn_save_vocabulary_set", {"p_id": str(set_id), "p_actor": actor["id"],
            "p_expected": body.expected_version, "p_data": body.model_dump(mode="json"), "p_action": "save"})
        return svc.set_out(db, row)

    return await asyncio.to_thread(persist_set)


@admin_router.post("/{set_id}/publication", response_model=SetOut)
async def publication(set_id: UUID, body: SetAction, authorization: str | None = Header(None)):
    actor = await require_admin(authorization)

    def publish_set():
        row = svc.rpc(db, "fn_save_vocabulary_set", {"p_id": str(set_id), "p_actor": actor["id"],
            "p_expected": body.expected_version, "p_data": {}, "p_action": body.action})
        return svc.set_out(db, row)

    return await asyncio.to_thread(publish_set)


@admin_router.get("/{set_id}", response_model=SetOut)
async def admin_detail(set_id: UUID, authorization: str | None = Header(None)):
    await require_admin(authorization)

    def load_detail():
        return svc.set_out(db, svc.get_set(db, str(set_id)))

    return await asyncio.to_thread(load_detail)


@admin_router.get("/{set_id}/outcomes", response_model=OutcomesOut)
async def outcomes(set_id: UUID, authorization: str | None = Header(None)):
    await require_admin(authorization)

    def load_outcomes():
        svc.get_set(db, str(set_id))
        rows = svc.paged(db, "vocabulary_set_sessions", set_id=str(set_id))
        users, names = sorted({r["user_id"] for r in rows}), {}
        for start in range(0, len(users), 100):
            for s in db.table("students").select("user_id,full_name").in_("user_id", users[start:start+100]).execute().data or []:
                names[s["user_id"]] = s.get("full_name") or s["user_id"]
        return {"learners": [{"user_id": u, "name": names.get(u, u), "sessions": [svc.brief(r) for r in rows if r["user_id"] == u]} for u in users]}

    return await asyncio.to_thread(load_outcomes)


@router.get("", response_model=CatalogOut)
async def catalog(authorization: str | None = Header(None)):
    user = await get_supabase_user(authorization)

    def load_catalog():
        courses, cohorts = svc.audience(db, user["id"])
        sets = []
        rows = svc.paged(db, "vocabulary_sets", status="published")
        revisions = svc.published_rows(db, rows)
        all_progress = svc.paged(db, "vocabulary_shared_progress", order_by="card_id", user_id=user["id"])
        for row in rows:
            published = revisions.get(row["id"])
            if published is None:
                raise HTTPException(503, "Chưa tải đủ bản xuất bản. Vui lòng thử lại.")
            if svc.visible(published, courses, cohorts):
                sets.append(svc.set_out(db, row, user["id"], detail=False, published=published, all_progress=all_progress))
        sessions = db.table("vocabulary_set_sessions").select("*").eq("user_id", user["id"]).order("created_at", desc=True).limit(50).execute().data or []
        return CatalogOut(sets=sets, courses=courses, cohorts=[{"id": c["id"], "name": c["name"], "course_id": c.get("course_id")} for c in cohorts], sessions=[svc.brief(r) for r in sessions])

    return await asyncio.to_thread(load_catalog)


@router.get("/{set_id}", response_model=SetOut)
async def detail(set_id: UUID, authorization: str | None = Header(None)):
    user = await get_supabase_user(authorization)

    def load_detail():
        return svc.set_out(db, svc.get_set(db, str(set_id), user["id"]), user["id"])

    return await asyncio.to_thread(load_detail)


@router.post("/{set_id}/sessions", response_model=SessionOut)
async def start(set_id: UUID, body: SessionStart, authorization: str | None = Header(None)):
    user = await get_supabase_user(authorization)

    def start_session():
        row = svc.get_set(db, str(set_id), user["id"])
        existing = db.table("vocabulary_set_sessions").select("*").eq("id", str(body.client_id)).limit(1).execute().data or []
        payload = body.model_dump(mode="json")
        if existing:
            saved = existing[0]
            if saved["user_id"] != user["id"] or saved["set_id"] != str(set_id) or saved["start_payload"] != payload:
                raise HTTPException(409, "Mã yêu cầu đã được dùng với nội dung khác.")
            return svc.session_out(saved)
        cards = svc.revision(db, row)["cards"]
        if body.review_only:
            now = datetime.now(timezone.utc)
            due = {p["card_id"] for p in svc.progress_rows(db, user["id"], [c["id"] for c in cards])
                   if p.get("next_review_at") and datetime.fromisoformat(p["next_review_at"].replace("Z", "+00:00")) <= now}
            cards = [c for c in cards if c["id"] in due]
        items = svc.study_items(cards, body.mode)
        if not items:
            raise HTTPException(422, "Chưa có từ đến hạn ôn hoặc bộ chưa đủ nội dung cho chế độ này.")
        result = svc.rpc(db, "fn_start_vocabulary_session", {"p_user": user["id"], "p_id": str(body.client_id), "p_set": str(set_id),
                  "p_revision": row["published_revision"], "p_mode": body.mode, "p_payload": payload, "p_items": items})
        return svc.session_out(result)

    return await asyncio.to_thread(start_session)


@router.get("/sessions/{session_id}", response_model=SessionOut)
async def session_detail(session_id: UUID, authorization: str | None = Header(None)):
    user = await get_supabase_user(authorization)

    def load_session():
        return svc.session_out(svc.get_session(db, str(session_id), user["id"]))

    return await asyncio.to_thread(load_session)


@router.post("/sessions/{session_id}/answers", response_model=SessionOut)
async def answer(session_id: UUID, body: StudyAnswer, authorization: str | None = Header(None)):
    user = await get_supabase_user(authorization)

    def answer_session():
        row = svc.get_session(db, str(session_id), user["id"])
        if row["mode"] == "test":
            raise HTTPException(422, "Kiểm tra cần nộp toàn bộ câu trả lời một lần.")
        return svc.answer_session(db, row, user["id"], body.client_id, body.model_dump(mode="json"), [(body.index, body.answer, body.rating)])

    return await asyncio.to_thread(answer_session)


@router.post("/sessions/{session_id}/submit", response_model=SessionOut)
async def submit(session_id: UUID, body: TestSubmit, authorization: str | None = Header(None)):
    user = await get_supabase_user(authorization)

    def submit_session():
        row = svc.get_session(db, str(session_id), user["id"])
        if row["mode"] != "test" or len(body.answers) != len(row["items"]):
            raise HTTPException(422, "Cần trả lời đúng số câu của phiên kiểm tra.")
        return svc.answer_session(db, row, user["id"], body.client_id, body.model_dump(mode="json"), [(i, a.strip(), None) for i, a in enumerate(body.answers)])

    return await asyncio.to_thread(submit_session)
