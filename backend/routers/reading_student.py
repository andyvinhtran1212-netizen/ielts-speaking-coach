"""routers/reading_student.py — student-facing Reading reads (Sprint 20.2 + 20.3 + 20.5).

Three libraries, ten endpoints (all auth-gated, mirroring the listening user_router):

  L1 Vocab (Sprint 20.2)
    GET  /api/reading/vocab                       — list published L1 passages (cards)
    GET  /api/reading/vocab/{slug}                — passage + glossary + light Qs
    POST /api/reading/vocab/{slug}/check          — grade Qs server-side, instant feedback

  L2 Skill (Sprint 20.3)
    GET  /api/reading/skill                       — list published L2 skill exercises
    GET  /api/reading/skill/{slug}                — exercise + skill-tagged Qs
    POST /api/reading/skill/{slug}/check          — grade Qs server-side

  L3 Full Test (Sprint 20.5)
    GET  /api/reading/test                        — list published L3 tests
    GET  /api/reading/test/{test_id}              — test + 3 passages + 40 Qs (keys stripped)
    POST /api/reading/test/{test_id}/attempts     — start: create attempt row (started_at NOW)
    POST /api/reading/test/attempts/{attempt_id}/submit  — submit + grade + finalize attempt

L1/L2 are ungraded practice (instant per-Q feedback, no attempt rows). L3 is the
graded path: ONE attempt per test (Q7 — continuous 60-min, 3 parts, 40 Qs in a
single reading_test_attempts row), with a 1-active-attempt invariant per (user,
test) — starting a new attempt abandons any open one. Answer keys are STRIPPED
from every student detail fetch (column selection — strip-keys watch-item) and
grading is server-side via `answer_matches`.
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


# ── Sprint 20.5 — L3 Full Test ────────────────────────────────────────


_READING_MODULES = {"academic", "general_training"}
# Time-limit grace: how much over the limit we tolerate at submit time
# (clock skew, network latency between countdown-zero and the POST). The
# client's countdown is the primary UX guard; this is just a backstop.
_SUBMIT_GRACE_SECONDS = 5 * 60


def _fetch_published_test(test_id: str) -> dict:
    """Fetch one published L3 test by test_id (TEXT UNIQUE — mig 086).
    404 on missing/draft/archived so admins can stage tests without exposing
    them to students."""
    res = (
        supabase_admin.table("reading_tests")
        .select("id,test_id,title,module,time_limit_minutes,passage_count,"
                "total_questions,band_target,status")
        .eq("test_id", test_id)
        .eq("status", "published")
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Reading test not found or not published")
    return res.data[0]


@router.get("/test")
async def list_reading_tests(
    module: str | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    authorization: str | None = Header(default=None),
):
    """List published L3 full tests for the browse page. Returns card-shaped
    metadata only — passage bodies + questions live behind GET .../{test_id}."""
    await _require_auth(authorization)
    if module is not None and module not in _READING_MODULES:
        raise HTTPException(422, f"module must be one of {sorted(_READING_MODULES)}")

    q = (
        supabase_admin.table("reading_tests")
        .select("id,test_id,title,module,time_limit_minutes,passage_count,"
                "total_questions,band_target,created_at",
                count="exact")
        .eq("status", "published")
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
    )
    if module:
        q = q.eq("module", module)
    res = q.execute()
    return {
        "items":  res.data or [],
        "total":  getattr(res, "count", None) or 0,
        "limit":  limit,
        "offset": offset,
    }


@router.get("/test/{test_id}")
async def get_reading_test(
    test_id: str,
    authorization: str | None = Header(default=None),
):
    """One L3 test — full bundle for the exam UI:
      • test metadata (module, time_limit_minutes, total_questions)
      • 3 passages (passage_order 1–3, body_markdown, title, slug)
      • their questions (answer keys STRIPPED — strip-keys watch-item;
        the column list deliberately excludes `answer` + `explanation`)

    Q7 (cluster 20.4c approval gate): ONE continuous attempt covers all
    three parts. The exam UI scrolls between them; the backend doesn't
    enforce a per-part lock here — that's a UX call in 20.6."""
    await _require_auth(authorization)
    test = _fetch_published_test(test_id)

    passages_res = (
        supabase_admin.table("reading_passages")
        .select("id,slug,title,body_markdown,passage_order,word_count,"
                "estimated_minutes,topic_tags")
        .eq("test_id", test["id"])
        .eq("library", "l3_test")
        .order("passage_order")
        .execute()
    )
    passages = passages_res.data or []

    passage_ids = [p["id"] for p in passages]
    questions: list[dict] = []
    if passage_ids:
        q_res = (
            supabase_admin.table("reading_questions")
            .select("q_num,question_type,prompt,payload,skill_tag,sub_skill,"
                    "order_num,passage_id")
            .in_("passage_id", passage_ids)
            .order("q_num")
            .execute()
        )
        questions = q_res.data or []

    # Stamp each question with its passage's order — saves the client a
    # second lookup when rendering the part header above each block.
    passage_order_by_id = {p["id"]: p.get("passage_order") for p in passages}
    for q in questions:
        q["passage_order"] = passage_order_by_id.get(q.get("passage_id"))

    test["passages"] = passages
    test["questions"] = questions
    return test


def _abandon_open_attempts(user_id: str, test_uuid: str) -> None:
    """Maintain the 1-active-attempt invariant per (user, test). Mirrors the
    listening pattern (mig 068 / listening.py:4914) — any prior in-progress
    attempt for the same (user, test) is marked abandoned before a new one
    is created."""
    (
        supabase_admin.table("reading_test_attempts")
        .update({"status": "abandoned"})
        .eq("user_id", user_id)
        .eq("test_id", test_uuid)
        .eq("status", "in_progress")
        .execute()
    )


@router.post("/test/{test_id}/attempts")
async def start_reading_test_attempt(
    test_id: str,
    authorization: str | None = Header(default=None),
):
    """Open a new student attempt (Q7: one row per attempt; abandon any
    prior open attempt for this user+test). Returns the attempt_id +
    started_at + time_limit_minutes so the client can drive the countdown.
    The server's started_at is the authoritative anchor for the submit-time
    elapsed-check (Q5 server-guard, with a generous grace window)."""
    import uuid
    from datetime import datetime, timezone

    user = await _require_auth(authorization)
    test = _fetch_published_test(test_id)
    test_uuid = test["id"]
    _abandon_open_attempts(user["id"], test_uuid)

    attempt_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc).isoformat()
    payload = {
        "id":         attempt_id,
        "test_id":    test_uuid,
        "user_id":    user["id"],
        "status":     "in_progress",
        "answers":    [],
        "started_at": started_at,
    }
    supabase_admin.table("reading_test_attempts").insert(payload).execute()
    return {
        "attempt_id":         attempt_id,
        "test_id":            test_id,
        "status":             "in_progress",
        "started_at":         started_at,
        "time_limit_minutes": test["time_limit_minutes"],
    }


def _fetch_attempt_or_404(attempt_id: str, user_id: str) -> dict:
    res = (
        supabase_admin.table("reading_test_attempts")
        .select("*")
        .eq("id", attempt_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Attempt not found")
    row = res.data[0]
    if row.get("user_id") != user_id:
        raise HTTPException(403, "Attempt belongs to another user")
    return row


class _SubmitAnswerItem(BaseModel):
    q_num:       int
    user_answer: Optional[str] = Field(default="")


class _SubmitRequest(BaseModel):
    """Submit input. The 20.5 backend accepts the full answer set in the body
    (no PATCH-based incremental save yet — that's a 20.6 UX addition); the
    server discards anything not in the test's answer key, so partial sets
    are graded as "missing = incorrect" without rejecting the submit."""
    answers: list[_SubmitAnswerItem] = Field(default_factory=list)


@router.post("/test/attempts/{attempt_id}/submit")
async def submit_reading_test_attempt(
    attempt_id: str,
    body: _SubmitRequest,
    authorization: str | None = Header(default=None),
):
    """Finalize an L3 attempt: load the answer key, grade, write the
    immutable grading payload to the attempt row, return the result.

    Q5 server-guard: if (now − started_at) exceeds the test's time_limit
    plus a 5-minute grace, the submit is rejected as expired. The grace
    absorbs clock skew + network latency between the client countdown
    hitting zero and the POST arriving."""
    from datetime import datetime, timezone

    from services import reading_test_grader as grader

    user = await _require_auth(authorization)
    attempt = _fetch_attempt_or_404(attempt_id, user["id"])
    if attempt.get("status") == "submitted":
        raise HTTPException(422, "Attempt đã submit rồi — không thể submit lại.")
    if attempt.get("status") != "in_progress":
        raise HTTPException(422, "Attempt status không hợp lệ.")

    # Resolve the test for the time-limit guard + Academic/GT routing.
    test_uuid = attempt["test_id"]
    test_res = (
        supabase_admin.table("reading_tests")
        .select("id,test_id,time_limit_minutes,module")
        .eq("id", test_uuid).limit(1).execute()
    )
    if not test_res.data:
        raise HTTPException(500, "Test row cho attempt này đã biến mất.")
    test_row = test_res.data[0]

    # Q5 server-guard: enforce the limit at submit (client countdown is the
    # primary UX layer; this is the backstop).
    started_at_str = attempt.get("started_at")
    now = datetime.now(timezone.utc)
    elapsed_seconds = 0
    if started_at_str:
        try:
            started = datetime.fromisoformat(started_at_str.replace("Z", "+00:00"))
            elapsed_seconds = int((now - started).total_seconds())
        except Exception:
            elapsed_seconds = 0
    limit_seconds = int(test_row["time_limit_minutes"]) * 60
    if elapsed_seconds > limit_seconds + _SUBMIT_GRACE_SECONDS:
        raise HTTPException(422, "Time limit exceeded — attempt expired.")

    # Pull every passage's reading_questions for this test, stamp each row
    # with its passage's passage_order so the grader's by_part rollup works.
    passages_res = (
        supabase_admin.table("reading_passages")
        .select("id,passage_order")
        .eq("test_id", test_uuid)
        .eq("library", "l3_test")
        .execute()
    )
    passages = passages_res.data or []
    if not passages:
        raise HTTPException(500, "Test bundle thiếu passage rows.")
    passage_order_by_id = {p["id"]: p.get("passage_order") for p in passages}

    q_res = (
        supabase_admin.table("reading_questions")
        .select("q_num,answer,skill_tag,explanation,passage_id")
        .in_("passage_id", list(passage_order_by_id.keys()))
        .execute()
    )
    answer_key = grader.collect_answer_key(q_res.data or [], passage_order_by_id)

    user_answers = [{"q_num": a.q_num, "user_answer": a.user_answer} for a in body.answers]
    result = grader.grade_attempt(user_answers, answer_key, module=test_row.get("module") or "academic")

    submitted_at = now.isoformat()
    supabase_admin.table("reading_test_attempts").update({
        "status":             "submitted",
        "answers":            user_answers,
        "score":              result["score"],
        "grading_details":    result["per_question"],
        "skill_breakdown":    result["skill_breakdown"],
        "band_estimate":      result["band_estimate"],
        "submitted_at":       submitted_at,
        "time_spent_seconds": max(0, elapsed_seconds),
    }).eq("id", attempt_id).execute()

    return {
        "attempt_id":         attempt_id,
        "score":              result["score"],
        "max_score":          result["max_score"],
        "band_estimate":      result["band_estimate"],
        "per_question":       result["per_question"],
        "skill_breakdown":    result["skill_breakdown"],
        "by_part":            result["by_part"],
        "time_spent_seconds": max(0, elapsed_seconds),
    }
