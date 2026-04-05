from fastapi import APIRouter, HTTPException, Header

from database import supabase_admin
from routers.auth import get_supabase_user
from services.gemini import (
    generate_part1_questions,
    generate_part2_cuecard,
    generate_part3_questions,
)

router = APIRouter(tags=["questions"])

# Question counts per part
_PART1_COUNT = 5
_PART3_COUNT = 3

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


def _make_fallback_rows(session_id: str, part: int) -> list[dict]:
    """Build fallback question rows for the given part (not persisted to DB)."""
    base = {"session_id": session_id, "part": part, "_fallback": True}

    if part == 1:
        return [
            {**base, "order_num": i + 1,
             "question_text": q["question_text"], "question_type": q["question_type"],
             "cue_card_bullets": None, "cue_card_reflection": None}
            for i, q in enumerate(_FALLBACK_PART1)
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
            .select("id, part, topic, status")
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
    part: int = session["part"]
    topic: str = session["topic"]

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

    # ── Call Gemini ────────────────────────────────────────────────────────────
    try:
        if part == 1:
            raw = await generate_part1_questions(topic, count=_PART1_COUNT)
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
            cuecard = await generate_part2_cuecard(topic)
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
            raw = await generate_part3_questions(topic, count=_PART3_COUNT)
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
        # Gemini unavailable — return fallback questions without storing them.
        # Not persisted so the next load retries Gemini rather than caching stale data.
        print(f"[warn] Gemini failed (part={part}, topic={topic!r}): {e} — using fallback")
        return _make_fallback_rows(session_id, part)

    if not rows:
        # Gemini returned an empty list — same fallback path.
        print(f"[warn] Gemini returned empty list (part={part}, topic={topic!r}) — using fallback")
        return _make_fallback_rows(session_id, part)

    # ── Persist to DB ──────────────────────────────────────────────────────────
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
