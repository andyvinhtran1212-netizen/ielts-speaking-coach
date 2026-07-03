"""
routers/questions.py — Question generation + retrieval endpoints

The ``questions.subtopic`` column is added by migration 016_add_questions_subtopic.sql.
It stores the per-question subtopic label for Full Test Part 1
(3 subtopics × 3 questions = 9 per full-test session).
"""

import logging
from typing import Literal, Union

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field

from database import supabase_admin

logger = logging.getLogger(__name__)
from routers.auth import get_supabase_user
from services.gemini import (
    generate_part1_questions,
    generate_part2_cuecard,
    generate_part3_questions,
)

router = APIRouter(tags=["questions"])


def _is_unique_violation(exc: Exception) -> bool:
    """True when a Supabase/PostgREST insert failed on the unique index.

    Backs the L6 race fix: (session_id, part, order_num) is UNIQUE (migration
    124), so a concurrent generate that loses the race raises 23505 here.
    """
    s = str(getattr(exc, "message", "") or exc)
    return "23505" in s or "duplicate key" in s.lower() or "uq_questions_session_part_order" in s


def _load_existing_questions(session_id: str) -> list[dict]:
    """Return the questions already persisted for a session, order_num-sorted.

    Used as the fast-path check AND as the conflict resolver: when an insert
    hits the unique index because a concurrent caller already generated the
    set, we return that winning set instead of surfacing a 500.
    """
    existing = (
        supabase_admin.table("questions")
        .select("*")
        .eq("session_id", session_id)
        .order("order_num")
        .execute()
    )
    return existing.data or []


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
                # L6: a concurrent generate already inserted this session's set —
                # return the winner's rows instead of double-inserting via Gemini.
                if _is_unique_violation(e):
                    winner = _load_existing_questions(session_id)
                    if winner:
                        logger.info("[questions] library insert lost race session=%s — returning existing set", session_id)
                        return sorted(winner, key=lambda q: q["order_num"])
                # Library insert failed for another reason — fall through to Gemini
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
        # L6: lost a concurrent generate race — return the winner's set rather
        # than a 500 (the unique index on session_id,part,order_num rejected us).
        if _is_unique_violation(e):
            winner = _load_existing_questions(session_id)
            if winner:
                logger.info("[questions] generate insert lost race session=%s — returning existing set", session_id)
                return sorted(winner, key=lambda q: q["order_num"])
        raise HTTPException(status_code=500, detail=f"Không thể lưu câu hỏi: {e}")

    saved = sorted(result.data, key=lambda q: q["order_num"])

    # Tag fallback rows in-memory so the frontend banner still works.
    # _fallback is not a DB column — it's a transient signal for this response only.
    if is_fallback:
        for q in saved:
            q["_fallback"] = True

    return saved


# ── POST /sessions/{session_id}/questions/custom ──────────────────────────────


# Sprint 14.4 — accept both legacy `list[str]` payloads (pre-14.4
# clients) and the new structured `list[str | CueCardQuestion]` shape
# (Sprint 14.4+ clients sending a detected cue card). The cue-card
# branch lights up the existing `cue_card_bullets` jsonb column so
# practice.js Part 2 state machine renders the cue card UI properly.
class CueCardQuestion(BaseModel):
    type:    Literal["cue_card"]
    prompt:  str = Field(..., min_length=1)
    topic:   str = ""
    bullets: list[str] = Field(default_factory=list)


# Per-item union: plain string (legacy) or structured cue card dict.
# A future single-question struct (e.g. with explicit part_num) plugs
# in here without breaking either older or 14.4 callers.
CustomQuestionItem = Union[str, CueCardQuestion]


class _CustomQBody(BaseModel):
    questions: list[CustomQuestionItem]


@router.post("/sessions/{session_id}/questions/custom")
async def save_custom_questions(
    session_id: str,
    body: _CustomQBody,
    authorization: str | None = Header(default=None),
):
    """
    Lưu câu hỏi do người dùng tự nhập vào DB (bỏ qua Gemini).

    Body shapes accepted (Sprint 14.4 L8 backward compat):
      - Legacy:  {"questions": ["Q1?", "Q2?", ...]}
      - 14.4:    {"questions": [{"type": "cue_card",
                                  "prompt": "Describe …",
                                  "topic":  "Describe …",
                                  "bullets": ["who", "how", …]}]}
      - Mixed list[str | dict] is also accepted.
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

    rows = []
    order = 0
    for q in body.questions:
        if isinstance(q, CueCardQuestion):
            text = (q.prompt or "").strip()
            if not text:
                continue
            order += 1
            # Sprint 14.4 — cue cards belong to Part 2. If the session
            # was created for a different part the frontend should have
            # forced part=2 on /sessions POST; surface the mismatch
            # here as a 422 so a stale client can't strand the user in
            # a wrong-part session.
            if part != 2:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "Cue card chỉ dùng cho Part 2. "
                        f"Session hiện đang là Part {part}."
                    ),
                )
            rows.append({
                "session_id":          session_id,
                "part":                2,
                "order_num":           order,
                "question_text":       text,
                "question_type":       "cue_card",
                "cue_card_bullets":    list(q.bullets) or None,
                "cue_card_reflection": None,
            })
        else:
            text = (q or "").strip()
            if not text:
                continue
            order += 1
            rows.append({
                "session_id":          session_id,
                "part":                part,
                "order_num":           order,
                "question_text":       text,
                "question_type":       "custom",
                "cue_card_bullets":    None,
                "cue_card_reflection": None,
            })

    if not rows:
        raise HTTPException(status_code=422, detail="Cần ít nhất 1 câu hỏi hợp lệ")

    try:
        result = supabase_admin.table("questions").insert(rows).execute()
    except Exception as e:
        # L6: concurrent insert already populated this session — return that set.
        if _is_unique_violation(e):
            winner = _load_existing_questions(session_id)
            if winner:
                logger.info("[questions] custom insert lost race session=%s — returning existing set", session_id)
                return sorted(winner, key=lambda q: q["order_num"])
        raise HTTPException(status_code=500, detail=f"Không thể lưu câu hỏi: {e}")

    return sorted(result.data, key=lambda q: q["order_num"])


# ── POST /sessions/cuecard/generate ──────────────────────────────────────────


class _GenerateCueCardBody(BaseModel):
    """Sprint 14.6.2 — input shape for AI cue-card generation.

    The frontend captures whatever the user typed into the textarea
    (single line, often "Describe a ..."); the backend hands it to
    services.gemini.generate_part2_cuecard which already caches by
    topic + returns the canonical question_text + bullets + closing.
    """
    trigger: str = Field(..., min_length=1, max_length=400)


@router.post("/sessions/cuecard/generate")
async def generate_cuecard_endpoint(
    body: _GenerateCueCardBody,
    authorization: str | None = Header(default=None),
):
    """Generate an IELTS Part 2 cue card from a single-line trigger.

    Returns the structured shape the Sprint 14.4 frontend already
    submits via /sessions/{id}/questions/custom — so the client can
    POST what we return back to the questions endpoint verbatim, with
    no schema translation. Cache is reused from
    services.gemini._cache_get / _cache_set (Supabase question_cache
    table) which already exists in production.

    On Gemini failure or quota exhaustion this returns HTTP 503 —
    the frontend then falls back to "paste cue card manually" UX,
    never blocking the user from proceeding.
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    trigger = body.trigger.strip()
    if not trigger:
        raise HTTPException(status_code=422, detail="Trigger trống")

    # Sprint 14.6.2 — reuse production cue-card generator. It already:
    #   - caches by `(part=2, topic)` via Supabase question_cache
    #   - logs token usage via ai_usage_logger.log_gemini
    #   - retries once on JSON-parse failure (see services.gemini)
    # No new infra; the only new code is the shape translator below.
    from services.gemini import generate_part2_cuecard

    try:
        gen = await generate_part2_cuecard(trigger, user_id=user_id)
    except Exception as exc:
        # services.gemini raises ValueError after exhausting its own
        # one retry, or bubbles up Gemini API errors. Surface as 503
        # so the frontend can route the user to the manual-paste
        # workaround instead of stranding them on an error screen.
        raise HTTPException(
            status_code=503,
            detail={
                "code":    "cue_card_generation_unavailable",
                "message": "Dịch vụ tạo cue card tạm thời không khả dụng. "
                           "Vui lòng paste cue card trọn vẹn hoặc thử lại sau.",
                "trigger": trigger,
            },
        ) from exc

    question_text = (gen.get("question_text") or trigger).strip()
    bullets       = [str(b).strip() for b in (gen.get("cue_card_bullets") or []) if str(b).strip()]
    closing       = (gen.get("cue_card_reflection") or "").strip()

    # Assemble the canonical cue-card prompt the frontend will display
    # + ship to /sessions/{id}/questions/custom. Format matches the
    # Cambridge convention so the existing practice.js Part 2 state
    # machine (which already reads cue_card_bullets) sees no surprises.
    bullet_lines = "\n".join("- " + b for b in bullets)
    prompt_parts = [question_text, "You should say:", bullet_lines]
    if closing:
        prompt_parts.append(closing)
    full_prompt = "\n".join(part for part in prompt_parts if part)

    return {
        "type":    "cue_card",
        "topic":   question_text,
        "bullets": bullets,
        "prompt":  full_prompt,
        "trigger": trigger,           # audit trail — what the user typed
        "source":  "ai_generated",    # provenance — distinguishes from user_pasted
    }


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
