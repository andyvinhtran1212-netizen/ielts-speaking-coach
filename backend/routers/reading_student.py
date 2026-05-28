"""routers/reading_student.py — student-facing Reading reads (Sprint 20.2 + 20.3).

Two libraries, six endpoints (all auth-gated, mirroring the listening user_router):

  L1 Vocab (Sprint 20.2)
    GET  /api/reading/vocab              — list published L1 passages (cards)
    GET  /api/reading/vocab/{slug}       — passage + glossary + light Qs
    POST /api/reading/vocab/{slug}/check — grade Qs server-side, instant feedback

  L2 Skill (Sprint 20.3)
    GET  /api/reading/skill              — list published L2 skill exercises
    GET  /api/reading/skill/{slug}       — exercise + skill-tagged Qs
    POST /api/reading/skill/{slug}/check — grade Qs server-side

In all cases the answer keys are STRIPPED from the detail fetch (column
selection — strip_answer_keys precedent) and grading happens server-side via
`answer_matches` so DevTools can't reveal answers. Neither library persists
attempts; that's the L3 path (Sprint 20.5).
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from database import supabase_admin
from routers.auth import get_supabase_user
from services.listening_test_grader import answer_matches

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reading", tags=["reading"])

_DIFFICULTY_VALUES = {"foundation", "intermediate", "advanced"}
_SKILL_TAG_VALUES = {
    "skimming", "scanning", "detail", "main_idea", "inference",
    "vocabulary_in_context", "reference_cohesion", "writer_view_TFNG",
}
_EXCERPT_CHARS = 180


async def _require_auth(authorization: str | None) -> dict:
    return await get_supabase_user(authorization)


def _excerpt(body_markdown: str | None) -> str:
    """First ~180 chars of the passage body as a plain-text card preview.
    Strips heading/emphasis markers so the card reads cleanly."""
    import re
    s = (body_markdown or "").strip()
    s = re.sub(r"[#>*_`~\[\]()]", "", s)          # drop common markdown markers
    s = re.sub(r"\s+", " ", s).strip()
    return s[:_EXCERPT_CHARS] + ("…" if len(s) > _EXCERPT_CHARS else "")


# ── List ──────────────────────────────────────────────────────────────


@router.get("/vocab")
async def list_vocab_passages(
    difficulty: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    authorization: str | None = Header(default=None),
):
    """List published L1 vocab-reading passages for the browse page. Returns
    card metadata + a derived excerpt (not the full body)."""
    await _require_auth(authorization)

    if difficulty is not None and difficulty not in _DIFFICULTY_VALUES:
        raise HTTPException(422, f"difficulty must be one of {sorted(_DIFFICULTY_VALUES)}")

    q = (
        supabase_admin.table("reading_passages")
        .select(
            "id,slug,title,body_markdown,difficulty_level,topic_tags,"
            "image_url,word_count,estimated_minutes,created_at",
            count="exact",
        )
        .eq("library", "l1_vocab")
        .eq("status", "published")
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
    )
    if difficulty:
        q = q.eq("difficulty_level", difficulty)
    if tag:
        q = q.contains("topic_tags", [tag])

    res = q.execute()
    items = []
    for row in (res.data or []):
        items.append({
            "id":                row["id"],
            "slug":              row["slug"],
            "title":             row["title"],
            "excerpt":           _excerpt(row.get("body_markdown")),
            "difficulty_level":  row.get("difficulty_level"),
            "topic_tags":        row.get("topic_tags") or [],
            "image_url":         row.get("image_url"),
            "word_count":        row.get("word_count"),
            "estimated_minutes": row.get("estimated_minutes"),
        })
    return {
        "items":  items,
        "total":  getattr(res, "count", None) or 0,
        "limit":  limit,
        "offset": offset,
    }


# ── Detail ────────────────────────────────────────────────────────────


def _fetch_published_passage(slug: str, library: str) -> dict:
    """Fetch one published passage by slug for the given library. The column
    list deliberately excludes the answer key and explanation — student fetches
    never carry those (strip-keys watch-item)."""
    res = (
        supabase_admin.table("reading_passages")
        .select("id,slug,title,body_markdown,difficulty_level,topic_tags,"
                "image_url,glossary,skill_focus,word_count,estimated_minutes")
        .eq("slug", slug)
        .eq("library", library)
        .eq("status", "published")
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Reading passage not found or not published")
    return res.data[0]


@router.get("/vocab/{slug}")
async def get_vocab_passage(
    slug: str,
    authorization: str | None = Header(default=None),
):
    """One published L1 passage + its glossary + light comprehension Qs with
    the answer key STRIPPED (answer + explanation withheld until /check)."""
    await _require_auth(authorization)
    passage = _fetch_published_passage(slug, "l1_vocab")

    q = (
        supabase_admin.table("reading_questions")
        .select("q_num,question_type,prompt,payload,skill_tag,sub_skill,order_num")
        .eq("passage_id", passage["id"])
        .order("order_num")
        .execute()
    )
    passage["questions"] = q.data or []
    return passage


# ── Check (instant feedback, server-side) ─────────────────────────────


class _CheckItem(BaseModel):
    q_num:       int
    user_answer: Optional[str] = Field(default="")


class _CheckRequest(BaseModel):
    answers: list[_CheckItem] = Field(default_factory=list)


def _grade_one(question_row: dict, user_answer: str | None) -> dict:
    """Grade a single answer against a reading_questions row's answer key."""
    key = question_row.get("answer") or {}
    primary = key.get("answer")
    alternatives = key.get("alternatives") or []
    candidates = primary if isinstance(primary, list) else [primary]
    candidates = [c for c in candidates if c is not None]

    correct = any(answer_matches(user_answer, str(c), alternatives) for c in candidates)
    expected_display = ", ".join(str(c) for c in candidates) if candidates else ""
    return {
        "q_num":       question_row["q_num"],
        "correct":     correct,
        "expected":    expected_display,
        "explanation": question_row.get("explanation"),
        "skill_tag":   question_row.get("skill_tag"),
    }


@router.post("/vocab/{slug}/check")
async def check_vocab_answers(
    slug: str,
    body: _CheckRequest,
    authorization: str | None = Header(default=None),
):
    """Grade submitted answers for a passage's light Qs and return per-question
    feedback (correct + expected + explanation + skill_tag). No persistence —
    L1 is ungraded practice."""
    await _require_auth(authorization)
    return _check_for(slug, "l1_vocab", body)


# ── Sprint 20.3 — L2 Skill Practice ────────────────────────────────────


@router.get("/skill")
async def list_skill_exercises(
    difficulty: str | None = Query(default=None),
    skill: str | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    authorization: str | None = Header(default=None),
):
    """List published L2 skill-practice exercises. The L2-specific filter is
    `skill` (`reading_passages.skill_focus`) — the primary IELTS reading skill
    the exercise targets, one of the D2 enum (skimming, scanning, detail,
    main_idea, inference, vocabulary_in_context, reference_cohesion,
    writer_view_TFNG). Returns card metadata + a derived excerpt; not the body."""
    await _require_auth(authorization)

    if difficulty is not None and difficulty not in _DIFFICULTY_VALUES:
        raise HTTPException(422, f"difficulty must be one of {sorted(_DIFFICULTY_VALUES)}")
    if skill is not None and skill not in _SKILL_TAG_VALUES:
        raise HTTPException(422, f"skill must be one of {sorted(_SKILL_TAG_VALUES)}")

    q = (
        supabase_admin.table("reading_passages")
        .select(
            "id,slug,title,body_markdown,difficulty_level,topic_tags,"
            "image_url,skill_focus,word_count,estimated_minutes,created_at",
            count="exact",
        )
        .eq("library", "l2_skill")
        .eq("status", "published")
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
    )
    if difficulty:
        q = q.eq("difficulty_level", difficulty)
    if skill:
        q = q.eq("skill_focus", skill)

    res = q.execute()
    items = []
    for row in (res.data or []):
        items.append({
            "id":                row["id"],
            "slug":              row["slug"],
            "title":             row["title"],
            "excerpt":           _excerpt(row.get("body_markdown")),
            "difficulty_level":  row.get("difficulty_level"),
            "topic_tags":        row.get("topic_tags") or [],
            "image_url":         row.get("image_url"),
            "skill_focus":       row.get("skill_focus"),
            "word_count":        row.get("word_count"),
            "estimated_minutes": row.get("estimated_minutes"),
        })
    return {
        "items":  items,
        "total":  getattr(res, "count", None) or 0,
        "limit":  limit,
        "offset": offset,
    }


@router.get("/skill/{slug}")
async def get_skill_exercise(
    slug: str,
    authorization: str | None = Header(default=None),
):
    """One published L2 exercise (passage body + skill-tagged Qs, answer
    keys stripped from the fetch — strip-keys watch-item)."""
    await _require_auth(authorization)
    passage = _fetch_published_passage(slug, "l2_skill")

    q = (
        supabase_admin.table("reading_questions")
        .select("q_num,question_type,prompt,payload,skill_tag,sub_skill,order_num")
        .eq("passage_id", passage["id"])
        .order("order_num")
        .execute()
    )
    passage["questions"] = q.data or []
    return passage


@router.post("/skill/{slug}/check")
async def check_skill_answers(
    slug: str,
    body: _CheckRequest,
    authorization: str | None = Header(default=None),
):
    """Grade L2 exercise answers server-side, return per-question feedback.
    No persistence (L2 is ungraded practice; the graded path is L3, 20.5)."""
    await _require_auth(authorization)
    return _check_for(slug, "l2_skill", body)


# ── Shared check helper (DRY across L1 + L2) ──────────────────────────


def _check_for(slug: str, library: str, body: "_CheckRequest") -> dict:
    """Library-agnostic check: look up the passage by slug+library, load its
    questions with their answer keys (server-side only), grade each submitted
    answer via _grade_one. The fetch column list intentionally INCLUDES
    `answer`/`explanation` here — those never leave the server (they're used
    to grade + the grading response includes only the public-safe fields)."""
    passage = _fetch_published_passage(slug, library)
    rows = (
        supabase_admin.table("reading_questions")
        .select("q_num,answer,explanation,skill_tag")
        .eq("passage_id", passage["id"])
        .execute()
    )
    by_qnum = {r["q_num"]: r for r in (rows.data or [])}

    results = []
    for item in body.answers:
        qrow = by_qnum.get(item.q_num)
        if qrow is None:
            continue  # ignore answers to unknown q_nums
        results.append(_grade_one(qrow, item.user_answer))
    return {"results": results}
