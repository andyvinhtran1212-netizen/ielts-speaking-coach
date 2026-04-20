"""
routers/questions.py — Question generation + retrieval endpoints

The ``questions.subtopic`` column is added by migration 016_add_questions_subtopic.sql.
It stores the per-question subtopic label for Full Test Part 1
(3 subtopics × 3 questions = 9 per full-test session).
"""

import logging

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from database import supabase_admin

logger = logging.getLogger(__name__)
from routers.auth import get_supabase_user
from services.gemini import (
    generate_part1_questions,
    generate_part2_cuecard,
    generate_part3_questions,
)

router = APIRouter(tags=["questions"])

# Question counts per part (practice / test_part modes)
_PART1_COUNT = 3
_PART3_COUNT = 3

# Full test mode uses a higher count to simulate a real exam
_FULL_TEST_PART1_COUNT = 9
_FULL_TEST_PART3_COUNT = 5

# ── Fallback questions ─────────────────────────────────────────────────────────
# Used when Gemini is unavailable.  Intentionally NOT stored in the database so
# that the next page-load retries Gemini rather than caching stale fallbacks.
# The frontend detects `_fallback: True` and shows a warning banner.

_FALLBACK_PART1 = [
    {"question_text": "Do you enjoy spending time outdoors?",               "question_type": "personal"},
    {"question_text": "How often do you use public transportation?",        "question_type": "time"},
    {"question_text": "What kind of music do you like listening to?",       "question_type": "personal"},
    {"question_text": "Do you think technology has improved daily life?",   "question_type": "opinion"},
    {"question_text": "Where did you grow up, and do you still live there?","question_type": "place"},
]

_FALLBACK_PART2 = {
    "question_text":       "Describe an interesting place you have visited.",
    "cue_card_bullets":    [
        "Where the place is located",
        "When you visited and who you went with",
        "What you saw or did there",
    ],
    "cue_card_reflection": "and explain why this place was so memorable to you.",
}

_FALLBACK_PART3 = [
    {"question_text": "Do you think tourism has a positive impact on local communities?", "question_type": "opinion"},
    {"question_text": "How has the way people travel changed over the past few decades?", "question_type": "comparison"},
    {"question_text": "What could governments do to make tourism more sustainable?",      "question_type": "solution"},
]


def _make_fallback_rows(session_id: str, part: int, is_full_test: bool = False) -> list[dict]:
    """
    Build fallback question rows for DB insert (no _fallback key — not a DB column).
    Caller is responsible for tagging returned DB rows with _fallback=True in-memory.
    """
    base = {"session_id": session_id, "part": part}

    if part == 1:
        if is_full_test:
            # Full test needs 9 questions in 3 groups of 3
            subtopic_labels = ["Daily Life", "Technology", "Society"]
            rows = []
            for group_idx, label in enumerate(subtopic_labels):
                for q_idx, q in enumerate(_FALLBACK_PART1):
                    order = group_idx * 3 + q_idx + 1
                    rows.append({
                        **base, "order_num": order,
                        "question_text": q["question_text"],
                        "question_type": q["question_type"],
                        "cue_card_bullets": None, "cue_card_reflection": None,
                        "subtopic": label,
                    })
                    if q_idx == 2:
                        break  # exactly 3 per group
            return rows
        return [
            {**base, "order_num": i + 1,
             "question_text": q["question_text"], "question_type": q["question_type"],
             "cue_card_bullets": None, "cue_card_reflection": None}
            for i, q in enumerate(_FALLBACK_PART1[:_PART1_COUNT])
        ]

    if part == 2:
        c = _FALLBACK_PART2
        return [{
            **base, "order_num": 1, "question_type": "cuecard",
            "question_text":       c["question_text"],
            "cue_card_bullets":    c["cue_card_bullets"],
            "cue_card_reflection": c["cue_card_reflection"],
        }]

    # part == 3
    return [
        {**base, "order_num": i + 1,
         "question_text": q["question_text"], "question_type": q["question_type"],
         "cue_card_bullets": None, "cue_card_reflection": None}
        for i, q in enumerate(_FALLBACK_PART3)
    ]


# ── Library helper ────────────────────────────────────────────────────────────

def _load_from_library(
    topic: str,
    part: int,
    session_id: str,
    is_full_test: bool,
    mode: str,
) -> list[dict]:
    """
    Try to load pre-generated questions from the admin topic library.
    Returns a list of question rows ready to insert into the questions table,
    or [] if the topic is not in the library / not enough questions.
    """
    try:
        # Look up the topic by title (case-insensitive)
        t_res = (
            supabase_admin.table("topics")
            .select("id")
            .eq("part", part)
            .ilike("title", topic.strip())
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        if not t_res.data:
            return []

        topic_id = t_res.data[0]["id"]

        # Load library questions for this topic/part
        q_res = (
            supabase_admin.table("topic_questions")
            .select("*")
            .eq("topic_id", topic_id)
            .eq("part", part)
            .eq("is_active", True)
            .order("order_num")
            .execute()
        )
        lib_qs = q_res.data or []

        required = {1: _PART1_COUNT, 2: 1, 3: _PART3_COUNT}.get(part, _PART1_COUNT)
        if len(lib_qs) < required:
            return []

        rows: list[dict] = []
        for i, q in enumerate(lib_qs[:required]):
            row: dict = {
                "session_id":          session_id,
                "part":                part,
                "order_num":           i + 1,
                "question_text":       q["question_text"],
                "question_type":       q.get("question_type") or "personal",
                "cue_card_bullets":    q.get("cue_card_bullets"),
                "cue_card_reflection": q.get("cue_card_reflection"),
            }
            rows.append(row)

        logger.info("[library] Loaded %d questions from library for part=%d topic=%r", len(rows), part, topic)
        return rows

    except Exception as exc:
        logger.warning("[library] Library lookup failed: %s", exc)
        return []


# ── POST /sessions/{session_id}/questions/generate ────────────────────────────

@router.post("/sessions/{session_id}/questions/generate")
async def generate_questions(
    session_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Gọi Gemini để tạo câu hỏi phù hợp với part/topic của session, lưu vào DB.
    Nếu session đã có câu hỏi → trả ngay câu hỏi đó (không sinh lại).
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    # Fetch + ownership check
    try:
        s_result = (
            supabase_admin.table("sessions")
            .select("id, part, topic, mode, status")
            .eq("id", session_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi tải session: {e}")

    if not s_result.data:
        raise HTTPException(status_code=404, detail="Session không tồn tại")

    session = s_result.data[0]
    part: int  = session["part"]
    topic: str = session["topic"]
    mode: str  = session.get("mode", "practice")
    is_full_test = (mode == "test_full")

    # Return existing questions if already generated
    try:
        existing = (
            supabase_admin.table("questions")
            .select("*")
            .eq("session_id", session_id)
            .order("order_num")
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi kiểm tra câu hỏi: {e}")

    if existing.data:
        return existing.data

    # ── Check topic library first ──────────────────────────────────────────────
    # If the topic exists in the admin-managed library and has pre-generated
    # questions, use those instead of calling Gemini.
    if not is_full_test and part in (1, 2, 3):
        library_rows = _load_from_library(topic, part, session_id, is_full_test, mode)
        if library_rows:
            try:
                result = supabase_admin.table("questions").insert(library_rows).execute()
                return sorted(result.data, key=lambda q: q["order_num"])
            except Exception as e:
                # Library insert failed — fall through to Gemini
                logger.warning("[warn] Library insert failed: %s — falling back to Gemini", e)

    # ── Call Gemini ────────────────────────────────────────────────────────────
    is_fallback = False
    rows: list[dict] = []

    try:
        if part == 1:
            if is_full_test:
                # 3 topics × 3 questions = 9 total; each row tagged with subtopic
                subtopics = [t.strip() for t in topic.split("|||") if t.strip()]
                if len(subtopics) < 3:
                    fallback = subtopics[0] if subtopics else topic
                    subtopics = (subtopics + [fallback] * 3)[:3]
                rows = []
                order = 1
                for st in subtopics:
                    qs = await generate_part1_questions(st, count=3, user_id=user_id)
                    for q in qs[:3]:
                        rows.append({
                            "session_id": session_id,
                            "part": 1,
                            "order_num": order,
                            "question_text": q["question_text"],
                            "question_type": q.get("question_type", "personal"),
                            "cue_card_bullets": None,
                            "cue_card_reflection": None,
                            "subtopic": st,
                        })
                        order += 1
            else:
                raw = await generate_part1_questions(topic, count=_PART1_COUNT, user_id=user_id)
                rows = [
                    {
                        "session_id": session_id,
                        "part": 1,
                        "order_num": i + 1,
                        "question_text": q["question_text"],
                        "question_type": q.get("question_type", "personal"),
                        "cue_card_bullets": None,
                        "cue_card_reflection": None,
                    }
                    for i, q in enumerate(raw)
                ]

        elif part == 2:
            cuecard = await generate_part2_cuecard(topic, user_id=user_id)
            rows = [
                {
                    "session_id": session_id,
                    "part": 2,
                    "order_num": 1,
                    "question_text": cuecard["question_text"],
                    "question_type": "cuecard",
                    # stored as jsonb — pass as Python list, Supabase serialises it
                    "cue_card_bullets": cuecard.get("cue_card_bullets"),
                    "cue_card_reflection": cuecard.get("cue_card_reflection"),
                }
            ]

        elif part == 3:
            count3 = _FULL_TEST_PART3_COUNT if is_full_test else _PART3_COUNT
            raw = await generate_part3_questions(topic, count=count3, user_id=user_id)
            rows = [
                {
                    "session_id": session_id,
                    "part": 3,
                    "order_num": i + 1,
                    "question_text": q["question_text"],
                    "question_type": q.get("question_type", "opinion"),
                    "cue_card_bullets": None,
                    "cue_card_reflection": None,
                }
                for i, q in enumerate(raw)
            ]

        else:
            raise HTTPException(status_code=422, detail=f"Part không hợp lệ: {part}")

    except HTTPException:
        raise
    except Exception as e:
        logger.warning("[warn] Gemini failed (part=%s, topic=%r): %s — using fallback", part, topic, e)
        rows = _make_fallback_rows(session_id, part, is_full_test=is_full_test)
        is_fallback = True

    if not rows:
        logger.warning("[warn] Gemini returned empty list (part=%s, topic=%r) — using fallback", part, topic)
        rows = _make_fallback_rows(session_id, part, is_full_test=is_full_test)
        is_fallback = True

    # ── Persist to DB (always — fallbacks also need real IDs for grading) ──────
    try:
        result = supabase_admin.table("questions").insert(rows).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Không thể lưu câu hỏi: {e}")

    saved = sorted(result.data, key=lambda q: q["order_num"])

    # Tag fallback rows in-memory so the frontend banner still works.
    # _fallback is not a DB column — it's a transient signal for this response only.
    if is_fallback:
        for q in saved:
            q["_fallback"] = True

    return saved


# ── POST /sessions/{session_id}/questions/custom ──────────────────────────────

class _CustomQBody(BaseModel):
    questions: list[str]


@router.post("/sessions/{session_id}/questions/custom")
async def save_custom_questions(
    session_id: str,
    body: _CustomQBody,
    authorization: str | None = Header(default=None),
):
    """
    Lưu câu hỏi do người dùng tự nhập vào DB (bỏ qua Gemini).
    Body: {"questions": ["Q1?", "Q2?", ...]}
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    try:
        s_result = (
            supabase_admin.table("sessions")
            .select("id, part")
            .eq("id", session_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi tải session: {e}")

    if not s_result.data:
        raise HTTPException(status_code=404, detail="Session không tồn tại")

    part = s_result.data[0]["part"]

    rows = [
        {
            "session_id":        session_id,
            "part":              part,
            "order_num":         i + 1,
            "question_text":     q.strip(),
            "question_type":     "custom",
            "cue_card_bullets":  None,
            "cue_card_reflection": None,
        }
        for i, q in enumerate(body.questions)
        if q.strip()
    ]

    if not rows:
        raise HTTPException(status_code=422, detail="Cần ít nhất 1 câu hỏi hợp lệ")

    try:
        result = supabase_admin.table("questions").insert(rows).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Không thể lưu câu hỏi: {e}")

    return sorted(result.data, key=lambda q: q["order_num"])


# ── GET /sessions/{session_id}/questions ──────────────────────────────────────

@router.get("/sessions/{session_id}/questions")
async def list_questions(
    session_id: str,
    authorization: str | None = Header(default=None),
):
    """Trả danh sách câu hỏi của session, sắp xếp theo order_num."""
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    # Verify ownership
    try:
        s_result = (
            supabase_admin.table("sessions")
            .select("id")
            .eq("id", session_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi tải session: {e}")

    if not s_result.data:
        raise HTTPException(status_code=404, detail="Session không tồn tại")

    try:
        result = (
            supabase_admin.table("questions")
            .select("*")
            .eq("session_id", session_id)
            .order("order_num")
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Không thể tải câu hỏi: {e}")

    return result.data
