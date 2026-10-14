"""Shared content only; legacy wallet/SRS tables retain their owners."""
import re
from types import SimpleNamespace
from fastapi import HTTPException
from models.vocabulary_sets import SharedCard, SetOut, SessionOut, SessionBrief
from routers.exercises import _grade_d1
from services.srs import update_srs


def rpc(db, name, params):
    try:
        value = db.rpc(name, params).execute().data
        if isinstance(value, list):
            value = value[0] if value else None
        if value is None:
            raise RuntimeError("empty acknowledgement")
        return value
    except Exception as exc:
        for key, code, detail in (
            ("set_denied", 403, "Bộ từ chưa xuất bản hoặc bạn không còn thuộc lớp được phân."),
            ("session_missing", 404, "Không tìm thấy phiên học của bạn."),
            ("invalid_cards", 422, "Có từ không còn trong thư viện. Hãy chọn lại trước khi xuất bản."),
            ("invalid_audience", 422, "Khóa/lớp được chọn không còn hoạt động."),
            ("incomplete_set", 422, "Cần ít nhất một từ và chọn đối tượng học trước khi xuất bản."),
            ("progress_conflict", 409, "progress_conflict"),
            ("set_conflict", 409, "Bộ từ đã thay đổi. Tải lại trước khi lưu."),
            ("replay_conflict", 409, "Mã yêu cầu đã được dùng với nội dung khác."),
            ("answer_conflict", 409, "Câu này đã lưu hoặc chưa đến lượt. Hãy tải lại phiên."),
            ("session_completed", 409, "Phiên đã hoàn tất. Tải lại để xem kết quả đã lưu."),
        ):
            if key in str(exc):
                raise HTTPException(code, detail) from exc
        raise HTTPException(503, "Không lưu/tải được bộ từ. Vui lòng thử lại.") from exc


def paged(db, table, columns="*", order_by="id", **filters):
    rows, start = [], 0
    while True:
        query = db.table(table).select(columns)
        for key, value in filters.items():
            query = query.eq(key, value)
        page = query.order(order_by).range(start, start + 999).execute().data or []
        rows.extend(page)
        if len(page) < 1000:
            return rows
        start += 1000


def audience(db, user_id=None):
    if user_id is None:
        return (paged(db, "courses", "id,name", is_active=True), paged(db, "cohorts", "id,name,course_id", is_active=True))
    cohort_ids = set()
    for student in paged(db, "students", "id", user_id=user_id):
        for m in paged(db, "student_cohort_memberships", "id,cohort_id", student_id=student["id"], is_active=True):
            cohort_ids.add(m["cohort_id"])
    cohorts = [c for c in paged(db, "cohorts", "id,name,course_id", is_active=True) if c["id"] in cohort_ids]
    course_ids = {c.get("course_id") for c in cohorts}
    courses = [c for c in paged(db, "courses", "id,name", is_active=True) if c["id"] in course_ids]
    return courses, cohorts


def revision(db, row):
    data = (db.table("vocabulary_set_revisions").select("*").eq("set_id", row["id"])
            .eq("revision", row["published_revision"]).limit(1).execute().data or [])
    if not data:
        raise HTTPException(503, "Chưa tải được bản xuất bản của bộ từ.")
    return data[0]


def visible(row, courses, cohorts):
    return bool(row["library"] or set(row["course_ids"]) & {c["id"] for c in courses}
                or set(row["cohort_ids"]) & {c["id"] for c in cohorts})


def get_set(db, set_id, user_id=None):
    rows = db.table("vocabulary_sets").select("*").eq("id", set_id).limit(1).execute().data or []
    if not rows:
        raise HTTPException(404, "Không tìm thấy bộ từ.")
    row = rows[0]
    if user_id is not None:
        if row["status"] != "published":
            raise HTTPException(403, "Bộ từ chưa xuất bản hoặc đã lưu trữ.")
        if not visible(revision(db, row), *audience(db, user_id)):
            raise HTTPException(403, "Bộ từ chưa được phân cho khóa/lớp của bạn.")
    return row


def cards_by_ids(db, ids):
    if not ids:
        return []
    rows = db.table("vocab_cards").select(",".join(SharedCard.model_fields)).in_("id", ids).execute().data or []
    mapping = {c["id"]: c for c in rows}
    return [SharedCard.model_validate({k: v or "" for k, v in mapping[id].items()}).model_dump() for id in ids if id in mapping]


def study_items(cards, mode):
    items = []
    for card in cards:
        expected = card["headword"].strip()
        pattern = re.compile(r"(?<!\w)" + re.escape(expected) + r"(?!\w)", re.I)
        if mode == "flashcards":
            prompt = expected
        elif mode == "cloze":
            example = card.get("example") or ""
            if not example or not pattern.search(example):
                continue
            prompt = pattern.sub("____", example)
        else:
            prompt = card.get("gloss_vi") or card.get("definition_en") or ""
            if not prompt or pattern.search(prompt):
                continue
        items.append({"card_id": card["id"], "prompt": prompt, "expected": expected, "card": card})
    return items


def progress_rows(db, user_id, ids):
    if not ids:
        return []
    return (db.table("vocabulary_shared_progress").select("*").eq("user_id", user_id).in_("card_id", ids).execute().data or [])


def set_out(db, row, user_id=None, detail=True, published=None, all_progress=None):
    published = published or (revision(db, row) if row["published_revision"] else None)
    source = {**row, **{k: published[k] for k in ("title", "description", "library", "course_ids", "cohort_ids")}} if user_id is not None and published else row
    cards = published["cards"] if user_id is not None and published else cards_by_ids(db, row["card_ids"])
    ids = [c["id"] for c in cards]
    progress = ([p for p in all_progress if p["card_id"] in ids] if all_progress is not None else progress_rows(db, user_id, ids)) if user_id else []
    return SetOut(**{k: source[k] for k in ("id", "title", "description", "status", "version", "published_revision", "library", "course_ids", "cohort_ids")},
                  card_ids=ids, cards=cards if detail else [],
                  progress=[{k: p[k] for k in ("card_id", "familiar", "recall_attempts", "recall_correct", "next_review_at", "review_count")} for p in progress],
                  mode_counts={m: len(study_items(cards, m)) for m in ("flashcards", "learn", "cloze", "test")},
                  published={k: published[k] for k in ("title", "library", "course_ids", "cohort_ids")} if published else None)


def published_rows(db, rows):
    """Fetch only current revisions, avoiding a request per set or old-history truncation."""
    result = {}
    for start in range(0, len(rows), 50):
        batch = rows[start:start + 50]
        filters = ",".join(f"and(set_id.eq.{r['id']},revision.eq.{int(r['published_revision'])})" for r in batch if r["published_revision"])
        if not filters:
            continue
        for revision_row in db.table("vocabulary_set_revisions").select("*").or_(filters).execute().data or []:
            result[revision_row["set_id"]] = revision_row
    return result


def brief(row):
    return SessionBrief(id=row["id"], set_id=row["set_id"], title=row["title"], mode=row["mode"], completed=row["completed"],
                        answered=len(row["answers"]), total=len(row["items"]), created_at=row["created_at"],
                        correct=sum(a.get("correct") is True for a in row["answers"]) if row["completed"] and row["mode"] != "flashcards" else None)


def session_out(row):
    # Withhold private answers/content for every unanswered recall item.
    answered = {a["index"] for a in row["answers"]}
    items = [{"card_id": item["card_id"], "prompt": item["prompt"],
              "card": item["card"] if row["mode"] == "flashcards" or i in answered else None} for i, item in enumerate(row["items"])]
    return SessionOut(id=row["id"], set_id=row["set_id"], title=row["title"], revision=row["revision"], mode=row["mode"],
                      items=items, answers=row["answers"], completed=row["completed"],
                      correct=sum(a.get("correct") is True for a in row["answers"]) if row["completed"] and row["mode"] != "flashcards" else None)


def get_session(db, session_id, user_id):
    rows = db.table("vocabulary_set_sessions").select("*").eq("id", session_id).eq("user_id", user_id).limit(1).execute().data or []
    if not rows:
        raise HTTPException(404, "Không tìm thấy phiên học của bạn.")
    return rows[0]


def answer_session(db, row, user_id, client_id, payload, raw_answers):
    mode, answers = row["mode"], []
    for index, answer, rating in raw_answers:
        if index >= len(row["items"]):
            raise HTTPException(422, "Câu hỏi không thuộc phiên học.")
        item = row["items"][index]
        if mode == "flashcards" and rating is None:
            raise HTTPException(422, "Chọn mức độ nhớ của thẻ.")
        if mode != "flashcards" and rating is not None:
            raise HTTPException(422, "Phiên luyện nhớ dùng câu trả lời, không dùng tự đánh giá.")
        answers.append({"index": index, "answer": answer, "expected": item["expected"],
                        "correct": None if mode == "flashcards" else _grade_d1(answer, item["expected"]), "rating": rating})
    for _ in range(4):
        old = {p["card_id"]: p for p in progress_rows(db, user_id, [row["items"][a["index"]]["card_id"] for a in answers])}
        changes = []
        for a in answers:
            card_id = row["items"][a["index"]]["card_id"]
            p = old.get(card_id, {})
            rating = a["rating"] or ("good" if a["correct"] else "again")
            srs = update_srs(SimpleNamespace(interval_days=p.get("interval_days", 0), ease_factor=p.get("ease_factor", 2.5),
                                            lapse_count=p.get("lapse_count", 0), review_count=p.get("review_count", 0)), rating)
            changes.append({"card_id": card_id, "expected_version": p.get("version", 0), **srs,
                            "familiar": rating in ("good", "easy") if mode == "flashcards" else p.get("familiar", False),
                            "recall_attempts": p.get("recall_attempts", 0) + (mode != "flashcards"),
                            "recall_correct": p.get("recall_correct", 0) + (a["correct"] is True)})
        try:
            return session_out(rpc(db, "fn_answer_vocabulary_session", {"p_user": user_id, "p_session": row["id"],
                              "p_client": str(client_id), "p_payload": payload, "p_answers": answers, "p_progress": changes}))
        except HTTPException as exc:
            if exc.status_code == 403:
                # An accepted receipt is immutable, private history, not a new
                # write. Reconcile a lost ACK even after membership/archive
                # changes, while the RPC still denies every unaccepted write.
                try:
                    receipts = (db.table("vocabulary_set_receipts").select("session_id,payload,response")
                                .eq("user_id", user_id).eq("client_id", str(client_id)).limit(1).execute().data or [])
                except Exception as read_error:
                    raise HTTPException(503, "Chưa đối chiếu được biên nhận đã lưu. Vui lòng thử lại.") from read_error
                if receipts:
                    receipt = receipts[0]
                    if receipt["session_id"] != row["id"] or receipt["payload"] != payload:
                        raise HTTPException(409, "Mã yêu cầu đã được dùng với nội dung khác.") from exc
                    return session_out(receipt["response"])
            if exc.detail != "progress_conflict":
                raise
    raise HTTPException(409, "Tiến độ đang được cập nhật ở phiên khác. Thử lại cùng yêu cầu.")
