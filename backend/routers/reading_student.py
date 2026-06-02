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

  L3 Full Test (Sprint 20.5 + 20.6 resilience)
    GET   /api/reading/test                                       — list published L3 tests
    GET   /api/reading/test/{test_id}                             — test + 3 passages + 40 Qs (keys stripped)
    POST  /api/reading/test/{test_id}/attempts                    — start: create attempt (started_at NOW)
    GET   /api/reading/test/{test_id}/attempts/in-progress  (20.6)— resume: user's open attempt for this test
    PATCH /api/reading/test/attempts/{attempt_id}/answers   (20.6)— auto-save one answer (debounced client-side)
    POST  /api/reading/test/attempts/{attempt_id}/submit          — submit + grade + finalize attempt

L1/L2 are ungraded practice (instant per-Q feedback, no attempt rows). L3 is the
graded path: ONE attempt per test (Q7 — continuous 60-min, 3 parts, 40 Qs in a
single reading_test_attempts row), with a 1-active-attempt invariant per (user,
test) — starting a new attempt abandons any open one. Answer keys are STRIPPED
from every student detail fetch (column selection — strip-keys watch-item) and
grading is server-side via `answer_matches`.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

from config import settings
from database import supabase_admin
from routers.auth import get_supabase_user
from services.listening_test_grader import answer_matches
from services.reading_diagnostic_engine import build_reading_diagnostic

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


# ── reading-access-tracking Part B — share-link + anonymous helpers ───

async def _optional_auth(authorization: str | None) -> Optional[dict]:
    """Return the user dict for a valid Bearer token, else None — never raises.
    Anonymous (share-link) callers have no token, so submit/review must not hard-
    require auth; ownership is then established by the anon_id capability token."""
    if not authorization:
        return None
    try:
        return await get_supabase_user(authorization)
    except Exception:
        return None


def _gen_anon_id() -> str:
    """An unguessable capability token that OWNS an anonymous attempt (sent back
    on submit/review). Secret + random — never sequential/guessable."""
    return secrets.token_urlsafe(24)


def _client_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()      # first hop = the real client
    return request.client.host if request.client else None


def _hash_anon_src(ip: str | None) -> str | None:
    """Salted hash of the client IP for the attempts dashboard (Part C). NEVER
    stores the raw IP. Fail-LOUD in production when READING_ANON_SALT is unset
    (an empty salt would make the hash brute-forceable → defeats the privacy
    purpose); a clearly dev-only fallback keeps local development working."""
    if not ip:
        return None
    salt = settings.READING_ANON_SALT
    if not salt:
        if (settings.ENVIRONMENT or "").lower() == "production":
            raise HTTPException(
                500,
                "READING_ANON_SALT is not configured — refusing to record an "
                "anonymous source unsalted (privacy).",
            )
        salt = "dev-only-insecure-salt"
    return hashlib.sha256((salt + "|" + str(ip)).encode("utf-8")).hexdigest()[:16]


def _fetch_attempt_owned(attempt_id: str, user: Optional[dict], anon_id: str | None) -> dict:
    """Fetch an attempt with ownership enforced for BOTH attempt kinds:
      • authenticated attempt (user_id set) → the caller's auth user_id must
        match (403 otherwise);
      • anonymous attempt (user_id NULL) → the caller must present the matching
        secret anon_id capability token (403 otherwise — NOT "any anonymous").
    Replaces the user_id-only _fetch_attempt_or_404 on the shared (auth+anon)
    paths (submit / review / answers)."""
    # No credential at all (no auth token AND no anon_id) → 401 before any DB
    # work. A caller must present *something* that could own an attempt; this
    # also preserves the pre-Part-B "requires auth" contract for bare requests.
    if user is None and not anon_id:
        raise HTTPException(401, "Authentication required")
    res = (
        supabase_admin.table("reading_test_attempts")
        .select("*").eq("id", attempt_id).limit(1).execute()
    )
    if not res.data:
        raise HTTPException(404, "Attempt not found")
    row = res.data[0]
    owner = row.get("user_id")
    if owner:
        if not user or user.get("id") != owner:
            raise HTTPException(403, "Attempt belongs to another user")
    else:
        stored = row.get("anon_id")
        if not anon_id or not stored or not secrets.compare_digest(str(anon_id), str(stored)):
            raise HTTPException(403, "Attempt belongs to another session")
    return row


def _resolve_share(test_id_or_token: str, *, by_token: bool) -> dict:
    """Resolve a published test for share-link access. by_token=True looks the
    test up by its metadata.share.token and validates expiry (expired/rotated →
    403); by_token=False is a direct test_id (used after the token check). A
    valid share-link is itself the access grant — it BYPASSES the F1 password
    lock by design (D0-approved)."""
    if by_token:
        res = (
            supabase_admin.table("reading_tests")
            .select("id,test_id,title,module,time_limit_minutes,passage_count,"
                    "total_questions,band_target,status,updated_at,metadata")
            .eq("metadata->share->>token", test_id_or_token)
            .eq("status", "published")
            .limit(1)
            .execute()
        )
        if not res.data:
            raise HTTPException(404, "Liên kết không hợp lệ hoặc đã bị thay thế.")
        test = res.data[0]
    else:
        test = _fetch_published_test(test_id_or_token)
    share = ((test.get("metadata") or {}).get("share") or {})
    token = share.get("token")
    if not token or token != (test_id_or_token if by_token else share.get("token")):
        raise HTTPException(404, "Liên kết không hợp lệ hoặc đã bị thay thế.")
    expires = share.get("expires_at")
    if expires:
        try:
            exp = datetime.fromisoformat(str(expires).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            raise HTTPException(403, "Liên kết có thời hạn không hợp lệ.")
        if datetime.now(timezone.utc) > exp:
            raise HTTPException(403, "Liên kết đã hết hạn.")
    return test


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
                "image_url,glossary,skill_focus,word_count,estimated_minutes,metadata")
        .eq("slug", slug)
        .eq("library", library)
        .eq("status", "published")
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Reading passage not found or not published")
    row = res.data[0]
    # Surface the full Vietnamese translation + grammar_focus as clean top-level
    # fields; the raw metadata blob stays server-side (reading-translation-vi /
    # reading-l1l2-grammar-toggle). Absent → None / [], so the frontend hides the
    # corresponding toggle gracefully.
    meta = row.pop("metadata", None) or {}
    row["translation_vi"] = meta.get("translation_vi")
    row["grammar_focus"] = meta.get("grammar_focus") or []
    return row


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
_DIAGNOSTIC_ATTEMPT_LIMIT = 8


def _strip_solution_from_payload(questions: list[dict]) -> None:
    """In-place: drop payload.solution from each question (reading-rich-test-
    solution). The rich solution reveals the answer + source, so it must never
    ship during the test — only the post-submit chữa-bài review surfaces it."""
    for q in questions:
        pl = q.get("payload")
        if isinstance(pl, dict) and "solution" in pl:
            pl = dict(pl)
            pl.pop("solution", None)
            q["payload"] = pl


def _fetch_published_test(test_id: str) -> dict:
    """Fetch one published L3 test by test_id (TEXT UNIQUE — mig 086).
    404 on missing/draft/archived so admins can stage tests without exposing
    them to students.

    ``updated_at`` is included so the exam UI can version-gate its
    per-test localStorage cache (Sprint 20.13c, Interactive HTML
    Standards §5.1). Bumping the row (re-import, admin edit) invalidates
    any stale cached highlights/notes/etc.
    """
    res = (
        supabase_admin.table("reading_tests")
        .select("id,test_id,title,module,time_limit_minutes,passage_count,"
                "total_questions,band_target,status,updated_at,metadata")
        .eq("test_id", test_id)
        .eq("status", "published")
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Reading test not found or not published")
    return res.data[0]


def _require_test_unlocked(test: dict, password: str | None) -> None:
    """reading-access-tracking F1 — server-side password gate. If the test is
    locked (metadata.access.locked), the caller MUST supply the matching
    password; wrong/absent → 403. The lock is real: the bundle is never
    returned without the password (no frontend-only hiding). A valid share-link
    bypasses this (handled on the /share route, not here)."""
    access = (test.get("metadata") or {}).get("access") or {}
    if not access.get("locked"):
        return
    expected = access.get("password")
    if not expected or not password or str(password).strip() != str(expected):
        raise HTTPException(403, "Bài thi đang khoá — cần nhập đúng mật khẩu để truy cập.")


def _build_reading_test_detail(test_id: str, password: str | None = None) -> dict:
    """Return the student-safe L3 test bundle with answer keys stripped.
    Enforces the lock gate (F1) then drops the raw metadata (never leak the
    password to the client)."""
    test = dict(_fetch_published_test(test_id))
    _require_test_unlocked(test, password)
    locked = bool(((test.get("metadata") or {}).get("access") or {}).get("locked"))
    test.pop("metadata", None)
    test["locked"] = locked
    return _assemble_test_detail(test)


def _assemble_test_detail(test: dict) -> dict:
    """Assemble the student-safe bundle (passages + questions, answer keys +
    solution stripped) for an already-resolved, access-checked test row. Shared
    by the authed fetch (lock-gated) and the anonymous /share route (lock-
    bypassed). The caller must have already dropped metadata / set `locked`."""
    test.pop("metadata", None)

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
            # Sprint 20.14f-α — include `id` so the admin diagram-image
            # manager can address rows by UUID. The id column is public
            # (mig 086 has no policy restricting it) and the student
            # client ignores fields it doesn't use, so the additive
            # projection is safe.
            .select("id,q_num,question_type,prompt,payload,skill_tag,sub_skill,"
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

    # Sprint 20.14f-α — sign + emit `payload.image_url` for diagram /
    # flow-chart questions that carry an admin-uploaded image. The on-
    # row source-of-truth is `payload.template.image_storage_path`
    # (written by the admin upload endpoint); we mint a 2h signed URL
    # per request — never persist the signed URL. Matches the listening
    # `_sign_map_image_url` 2h student-fetch TTL.
    _stamp_diagram_image_urls(questions)

    # reading-rich-test-solution — the detailed solution rides payload.solution
    # (steps, source excerpt, answer reasoning). It MUST NOT leak during the
    # test: strip it here, same spirit as the answer-key strip. It's surfaced
    # only post-submit via the chữa-bài review endpoint (Part C).
    _strip_solution_from_payload(questions)

    test["passages"] = passages
    test["questions"] = questions
    return test


# Sprint 20.14f-α — student fetch helper. Lives at module scope so the
# unit tests can patch the signer without going through the full route.
_DIAGRAM_FLOW_TYPES = ("diagram_label_completion", "flow_chart_completion")
_DIAGRAM_IMAGE_TTL_STUDENT = 2 * 3600   # 2h — matches listening student fetch


def _stamp_diagram_image_urls(questions: list[dict]) -> None:
    """In-place: for each diagram_label / flow_chart question that has
    `payload.template.image_storage_path`, mint a signed URL and
    surface it as `payload.image_url`. Other questions are untouched.

    Best-effort: failures (bucket missing, signing error) leave
    `image_url` unset and the frontend falls back to the legacy
    ASCII mono-block render. The empty bucket case is the most likely
    production miss (bucket creation is the one out-of-band deploy
    step); the renderer handles `image_url` absent cleanly.
    """
    from config import settings

    bucket = settings.READING_IMAGES_BUCKET
    for q in questions:
        if q.get("question_type") not in _DIAGRAM_FLOW_TYPES:
            continue
        payload = q.get("payload") or {}
        template = payload.get("template") or {}
        storage_path = template.get("image_storage_path")
        if not storage_path:
            continue
        try:
            signed = supabase_admin.storage.from_(bucket).create_signed_url(
                storage_path, _DIAGRAM_IMAGE_TTL_STUDENT,
            )
            url = (signed or {}).get("signedURL") or (signed or {}).get("signed_url")
        except Exception as exc:                                              # pragma: no cover
            logger.warning(
                "[reading_image] sign URL for q_num=%s failed: %s",
                q.get("q_num"), exc,
            )
            url = None
        if url:
            # Use a mutable copy so the row's stored payload (already a
            # reference to the JSONB dict from supabase-py) isn't
            # mutated in a way that confuses upstream callers.
            payload = dict(payload)
            payload["image_url"] = url
            q["payload"] = payload


def _fetch_in_progress_payload(
    user_id: str | None,
    test_id: str,
    test: dict,
    *,
    raise_on_missing: bool,
    anon_id: str | None = None,
) -> dict | None:
    """Return the open in-progress attempt payload for ``test`` if present.
    Owned EITHER by an authenticated user (``user_id``) OR — for share-link
    takers — by an anonymous capability token (``anon_id``). Exactly one of the
    two is set by the caller; the other filter is omitted."""
    q = supabase_admin.table("reading_test_attempts").select("id,started_at,status")
    # Owner filter FIRST (the authed user_id, or the anonymous anon_id token),
    # then test + status. Exactly one ownership filter is applied.
    if anon_id is not None:
        q = q.eq("anon_id", anon_id)
    else:
        q = q.eq("user_id", user_id)
    res = (
        q.eq("test_id", test["id"])
        .eq("status", "in_progress")
        .order("started_at", desc=True)
        .limit(1)
        .execute()
    )
    if not res.data:
        if raise_on_missing:
            raise HTTPException(404, "No in-progress attempt for this test")
        return None

    row = res.data[0]
    persisted_res = (
        supabase_admin.table("reading_attempt_answers")
        .select("q_num,user_answer,answered_at")
        .eq("attempt_id", row["id"])
        .order("q_num")
        .execute()
    )
    answers = [
        {
            "q_num":       a["q_num"],
            "user_answer": a.get("user_answer") or "",
            "answered_at": a.get("answered_at"),
        }
        for a in (persisted_res.data or [])
    ]
    return {
        "attempt_id":         row["id"],
        "test_id":            test_id,
        "status":             row["status"],
        "started_at":         row.get("started_at"),
        "answers":            answers,
        "time_limit_minutes": test["time_limit_minutes"],
    }


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
    x_reading_password: str | None = Header(default=None, alias="X-Reading-Password"),
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
    return _build_reading_test_detail(test_id, x_reading_password)


@router.get("/test/{test_id}/boot")
async def boot_reading_test(
    test_id: str,
    authorization: str | None = Header(default=None),
    x_reading_password: str | None = Header(default=None, alias="X-Reading-Password"),
):
    """Combined exam boot payload.

    Perf-1 collapses the previous frontend waterfall:
    GET /api/reading/test/{id} → GET /attempts/in-progress.
    The response keeps the existing detail payload under ``test`` and returns
    ``in_progress`` as either the existing resume payload or ``null``.
    """
    user = await _require_auth(authorization)
    test = _build_reading_test_detail(test_id, x_reading_password)
    in_progress = _fetch_in_progress_payload(
        user["id"], test_id, test, raise_on_missing=False
    )
    return {"test": test, "in_progress": in_progress}


@router.post("/test/{test_id}/unlock")
async def unlock_reading_test(
    test_id: str,
    body: dict,
    authorization: str | None = Header(default=None),
):
    """reading-access-tracking F1 — verify a locked test's password. Returns
    {ok: true} so the client can proceed (and then send X-Reading-Password on
    the boot/fetch/start calls); wrong/absent password → 403. Unlocked tests
    return ok:true immediately."""
    await _require_auth(authorization)
    test = _fetch_published_test(test_id)
    _require_test_unlocked(test, (body or {}).get("password"))
    return {"ok": True}


# ── reading-access-tracking Part B — anonymous share-link access ──────
# NO auth: a valid, unexpired share-token IS the access grant (it bypasses the
# F1 lock by design). The bundle is still answer-key + solution stripped.


@router.get("/test/share/{share_token}/boot")
async def boot_shared_reading_test(
    share_token: str,
    x_reading_anon: str | None = Header(default=None, alias="X-Reading-Anon"),
):
    """Anonymous boot via share-link. Validates the token + expiry, returns the
    student-safe bundle (lock bypassed), and — if the caller already holds an
    anon_id for an in-progress attempt on this test — the resume payload."""
    test = _resolve_share(share_token, by_token=True)
    test_text_id = test.get("test_id")
    detail = dict(test)
    detail["locked"] = False              # the valid share token IS the grant (bypass F1)
    detail = _assemble_test_detail(detail)

    in_progress = None
    if x_reading_anon:
        in_progress = _fetch_in_progress_payload(
            None, test_text_id, detail, raise_on_missing=False,
            anon_id=x_reading_anon,
        )
    return {"test": detail, "in_progress": in_progress}


@router.post("/test/share/{share_token}/attempts")
async def start_shared_reading_test_attempt(
    share_token: str,
    request: Request,
    x_reading_anon: str | None = Header(default=None, alias="X-Reading-Anon"),
):
    """Anonymous start via share-link. Validates the token, mints a NEW anon_id
    capability token (the client stores + replays it on submit/review) when one
    isn't supplied, records a SALTED IP hash (anon_src — never the raw IP), and
    creates an attempt with user_id NULL. Returns attempt_id + anon_id."""
    import uuid as _uuid
    test = _resolve_share(share_token, by_token=True)
    test_uuid = test["id"]
    share = ((test.get("metadata") or {}).get("share") or {})

    anon_id = x_reading_anon or _gen_anon_id()
    # Maintain one active anonymous attempt per (anon_id, test): abandon any
    # open one this session held (mirror of the authed invariant, anon-scoped).
    (
        supabase_admin.table("reading_test_attempts")
        .update({"status": "abandoned"})
        .eq("anon_id", anon_id).eq("test_id", test_uuid).eq("status", "in_progress")
        .execute()
    )
    attempt_id = str(_uuid.uuid4())
    started_at = datetime.now(timezone.utc).isoformat()
    supabase_admin.table("reading_test_attempts").insert({
        "id":          attempt_id,
        "test_id":     test_uuid,
        "user_id":     None,                       # anonymous
        "anon_id":     anon_id,
        "share_token": share.get("token"),
        "anon_src":    _hash_anon_src(_client_ip(request)),
        "status":      "in_progress",
        "answers":     [],
        "started_at":  started_at,
    }).execute()
    return {
        "attempt_id":         attempt_id,
        "anon_id":            anon_id,             # client MUST keep this (ownership)
        "started_at":         started_at,
        "time_limit_minutes": test.get("time_limit_minutes") or 60,
    }


def _abandon_open_attempts(user_id: str, test_uuid: str) -> None:
    """Maintain the 1-active-attempt invariant per (user, test). Mirrors the
    listening pattern (mig 068 / listening.py:4914) — any prior in-progress
    attempt for the same (user, test) is marked abandoned before a new one
    is created.

    Sprint 20.9 D2 — this is now the *application* leg of a two-layer
    invariant. The *database* leg is migration 088's partial unique index
    `uniq_reading_test_attempts_active`. Together they enforce Q7 even
    under concurrent POSTs: the abandon step usually wins; on the rare
    race where two starts both observe no in-progress row, the unique
    index rejects the second INSERT and the router retries (see
    `start_reading_test_attempt`)."""
    (
        supabase_admin.table("reading_test_attempts")
        .update({"status": "abandoned"})
        .eq("user_id", user_id)
        .eq("test_id", test_uuid)
        .eq("status", "in_progress")
        .execute()
    )


# Sprint 20.9 D2 — the partial unique index in mig 088 surfaces collisions as
# Postgres error 23505 (unique_violation); supabase-py wraps that in APIError
# with `code='23505'` on `.code` or `.details`. Bound the retry loop tightly:
# the abandon step on the next iteration will always succeed (it sees the row
# the other request inserted) and the next insert wins. Three tries is plenty
# headroom; we raise 503 only if the system is genuinely contended.
_START_RETRY_MAX = 3


def _is_unique_violation(exc: Exception) -> bool:
    """True when a supabase-py exception is a Postgres unique-constraint
    violation. supabase-py / postgrest-py surface this with PG error code
    `23505`; the exact attribute name varies across client versions, so we
    sniff both the attribute and the stringified payload."""
    code = getattr(exc, "code", None) or getattr(exc, "pgcode", None)
    if code == "23505":
        return True
    msg = str(exc)
    return "23505" in msg or "duplicate key" in msg.lower()


@router.post("/test/{test_id}/attempts")
async def start_reading_test_attempt(
    test_id: str,
    authorization: str | None = Header(default=None),
    x_reading_password: str | None = Header(default=None, alias="X-Reading-Password"),
):
    """Open a new student attempt (Q7: one row per attempt; abandon any
    prior open attempt for this user+test). Returns the attempt_id +
    started_at + time_limit_minutes so the client can drive the countdown.
    The server's started_at is the authoritative anchor for the submit-time
    elapsed-check (Q5 server-guard, with a generous grace window).

    Sprint 20.9 D2: race-safe via the partial unique index in mig 088.
    Semantics under contention: newest start wins, prior in-progress is
    abandoned. Two concurrent POSTs from the same (user, test) will produce
    exactly one in_progress row in the DB; the loser retries its
    abandon-then-insert and wins next iteration."""
    import uuid
    from datetime import datetime, timezone

    user = await _require_auth(authorization)
    test = _fetch_published_test(test_id)
    _require_test_unlocked(test, x_reading_password)   # F1 gate on start too
    test_uuid = test["id"]

    last_exc: Exception | None = None
    for _retry in range(_START_RETRY_MAX):
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
        try:
            supabase_admin.table("reading_test_attempts").insert(payload).execute()
        except Exception as exc:
            if _is_unique_violation(exc):
                # Another concurrent POST just inserted an in_progress row
                # between our abandon and our insert. Loop: re-abandon
                # (which will now see + abandon their row) and try again.
                last_exc = exc
                continue
            raise

        return {
            "attempt_id":         attempt_id,
            "test_id":            test_id,
            "status":             "in_progress",
            "started_at":         started_at,
            "time_limit_minutes": test["time_limit_minutes"],
        }

    logger.error(
        "start_reading_test_attempt: unique-violation retry budget exhausted "
        "for user=%s test=%s; last_exc=%s",
        user["id"], test_uuid, last_exc,
    )
    raise HTTPException(503, "Concurrent start contention — please retry.")


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
    x_reading_anon: str | None = Header(default=None, alias="X-Reading-Anon"),
):
    """Finalize an L3 attempt: load the answer key, grade, write the
    immutable grading payload to the attempt row, return the result.

    Ownership is auth user_id (authenticated) OR the anon_id capability token
    (anonymous share-link attempts) — reading-access-tracking B.

    Q5 server-guard: if (now − started_at) exceeds the test's time_limit
    plus a 5-minute grace, the submit is rejected as expired. The grace
    absorbs clock skew + network latency between the client countdown
    hitting zero and the POST arriving."""
    from datetime import datetime, timezone

    from services import reading_test_grader as grader

    user = await _optional_auth(authorization)
    attempt = _fetch_attempt_owned(attempt_id, user, x_reading_anon)
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
    #
    # Sprint 20.9 D4 — fail closed on malformed started_at (audit P2-1). The
    # 20.5 implementation defaulted elapsed_seconds=0 on parse failure or
    # missing value, which silently disabled the Q5 guard. A corrupted
    # `started_at` (e.g. a manual DB edit, a botched migration, or a future
    # storage-format change) would let a stale attempt grade as if it had
    # just started. Now we 422 instead — the guard fails closed, the
    # operator notices, and the integrity invariant survives.
    started_at_str = attempt.get("started_at")
    now = datetime.now(timezone.utc)
    if not started_at_str:
        logger.error("submit: attempt %s has no started_at — fail-closed (422)",
                     attempt_id)
        raise HTTPException(422, "Attempt thiếu started_at — không thể chấm điểm an toàn.")
    try:
        started = datetime.fromisoformat(started_at_str.replace("Z", "+00:00"))
    except (TypeError, ValueError) as exc:
        logger.error("submit: attempt %s has unparseable started_at=%r (%s) — fail-closed (422)",
                     attempt_id, started_at_str, exc)
        raise HTTPException(422, "Attempt có started_at không hợp lệ — không thể chấm điểm an toàn.")
    elapsed_seconds = int((now - started).total_seconds())
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

    # Sprint 20.9 D3 — gather authoritative answers from reading_attempt_answers
    # (where PATCH /answers has been atomically upserting per (attempt, q_num)
    # since mig 088). The submit body is still accepted as a final-batch
    # fallback: anything in the body overrides the persisted row for that q_num
    # (last-write-wins), which preserves the 20.5 contract that "the body is
    # graded" — but the persisted per-q_num rows fill the gap when the body is
    # incomplete (the common case after auto-save).
    persisted_res = (
        supabase_admin.table("reading_attempt_answers")
        .select("q_num,user_answer")
        .eq("attempt_id", attempt_id)
        .execute()
    )
    answers_by_qnum: dict[int, str] = {}
    for row in (persisted_res.data or []):
        try:
            qn = int(row["q_num"])
        except (KeyError, TypeError, ValueError):
            continue
        answers_by_qnum[qn] = row.get("user_answer") or ""
    for a in body.answers:
        answers_by_qnum[int(a.q_num)] = a.user_answer or ""
    user_answers = [
        {"q_num": qn, "user_answer": ua}
        for qn, ua in sorted(answers_by_qnum.items())
    ]
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


# ── reading-rich Part C — post-submit chữa-bài (solution review) ──────


@router.get("/test/attempts/{attempt_id}/review")
async def review_reading_test_attempt(
    attempt_id: str,
    authorization: str | None = Header(default=None),
    x_reading_anon: str | None = Header(default=None, alias="X-Reading-Anon"),
):
    """Post-submit solution review ("chữa bài"). Returns, ONLY for a SUBMITTED
    attempt owned by the caller: the score/band/skill breakdown, the per-Q
    grading (user vs correct), and — now REVEALED — each question's rich
    `payload.solution` (steps / source / vocab / paraphrase / trap / tips) plus
    the passage bodies + VI translation.

    Ownership = auth user_id OR the anon_id capability token (anonymous share-
    link attempts can review THEIR OWN attempt only — another anon_id 403s;
    reading-access-tracking B).

    Security boundary (reading-rich Part A): the solution is stripped from the
    DURING-test fetch; this endpoint is the only place it surfaces, and it
    HARD-gates on status == 'submitted' (409 otherwise) so an in-progress or
    abandoned attempt can never leak the answers."""
    user = await _optional_auth(authorization)
    attempt = _fetch_attempt_owned(attempt_id, user, x_reading_anon)
    if attempt.get("status") != "submitted":
        raise HTTPException(409, "Chưa có chữa bài — attempt chưa submit.")

    test_uuid = attempt["test_id"]
    test_res = (
        supabase_admin.table("reading_tests")
        .select("test_id,title,module")
        .eq("id", test_uuid).limit(1).execute()
    )
    test_row = (test_res.data or [{}])[0]

    passages_res = (
        supabase_admin.table("reading_passages")
        .select("id,slug,title,body_markdown,passage_order,metadata")
        .eq("test_id", test_uuid)
        .eq("library", "l3_test")
        .order("passage_order")
        .execute()
    )
    passages: list[dict] = []
    for p in (passages_res.data or []):
        meta = p.pop("metadata", None) or {}
        p["translation_vi"] = meta.get("translation_vi")
        passages.append(p)

    # Per-Q rich solution + prompt/type for context (joined by q_num).
    sol_by_qnum: dict = {}
    ctx_by_qnum: dict = {}
    passage_ids = [p["id"] for p in passages]
    if passage_ids:
        q_res = (
            supabase_admin.table("reading_questions")
            .select("q_num,question_type,prompt,payload,passage_id")
            .in_("passage_id", passage_ids)
            .execute()
        )
        for q in (q_res.data or []):
            qn = q.get("q_num")
            sol = (q.get("payload") or {}).get("solution")
            if sol:
                sol_by_qnum[qn] = sol
            ctx_by_qnum[qn] = {
                "prompt": q.get("prompt"), "question_type": q.get("question_type"),
            }

    grading = attempt.get("grading_details") or []
    review: list[dict] = []
    by_part: dict = {}
    for g in grading:
        qn = g.get("q_num")
        ctx = ctx_by_qnum.get(qn) or {}
        item = dict(g)
        item["prompt"] = ctx.get("prompt")
        item["question_type"] = ctx.get("question_type")
        item["solution"] = sol_by_qnum.get(qn)
        review.append(item)
        po = g.get("passage_order")
        bucket = by_part.setdefault("p%s" % po if po else "p?", {"correct": 0, "total": 0})
        bucket["total"] += 1
        if g.get("correct"):
            bucket["correct"] += 1

    return {
        "attempt_id":       attempt_id,
        "status":           attempt.get("status"),
        "test_id":          test_row.get("test_id"),
        "title":            test_row.get("title"),
        "score":            attempt.get("score"),
        "max_score":        len(grading),
        "band_estimate":    attempt.get("band_estimate"),
        "skill_breakdown":  attempt.get("skill_breakdown") or {},
        "by_part":          by_part,
        "passages":         passages,
        "review":           review,
    }


# ── Sprint 20.6 — resilience: in-progress lookup + auto-save PATCH ────


@router.get("/test/{test_id}/attempts/in-progress")
async def get_in_progress_reading_attempt(
    test_id: str,
    authorization: str | None = Header(default=None),
):
    """Find the user's open attempt for this test, if any. Used by the exam
    page on (re)load to **resume** an interrupted attempt: returns the same
    shape as POST .../attempts (attempt_id, started_at, time_limit_minutes)
    plus the saved `answers` array so the client can repaint state. 404 when
    no in-progress attempt exists — the client then calls POST attempts to
    start fresh. The Q7 invariant (≤1 active attempt per user+test) makes
    this lookup unambiguous."""
    user = await _require_auth(authorization)
    test = _fetch_published_test(test_id)
    return _fetch_in_progress_payload(
        user["id"], test_id, test, raise_on_missing=True
    )


class _AnswerPatchItem(BaseModel):
    q_num:       int = Field(..., ge=1, le=40)
    user_answer: Optional[str] = Field(default="")


@router.patch("/test/attempts/{attempt_id}/answers")
async def patch_reading_test_attempt_answer(
    attempt_id: str,
    body: _AnswerPatchItem,
    authorization: str | None = Header(default=None),
    x_reading_anon: str | None = Header(default=None, alias="X-Reading-Anon"),
):
    """Upsert a single answer (auto-save). Idempotent by q_num — re-PATCH
    of the same q_num overwrites the prior value.

    Sprint 20.9 D3 (audit P1-3) — atomic by design. Writes go to
    `reading_attempt_answers` keyed by (attempt_id, q_num) PK, so two
    overlapping PATCHes for DIFFERENT q_nums never see each other and
    cannot lose data. (The pre-20.9 implementation read the whole answers
    JSONB array, filtered, appended, and wrote back — classic
    read-modify-write race that could drop concurrent edits.)

    Same q_num concurrency is last-write-wins — acceptable for autosave
    (the latest user input is the intended answer), and the per-q_num
    `answered_at` timestamp preserves an audit trail if anyone cares to
    inspect it later.

    Rejected when the attempt is not in_progress (422) so a stale tab
    can't accidentally write to a submitted/abandoned attempt."""
    from datetime import datetime, timezone

    user = await _optional_auth(authorization)
    attempt = _fetch_attempt_owned(attempt_id, user, x_reading_anon)
    if attempt.get("status") != "in_progress":
        raise HTTPException(422, "Attempt đã submit hoặc abandoned — không thể edit.")

    # PK upsert — supabase-py routes this to PostgREST's `Prefer:
    # resolution=merge-duplicates` semantics. PostgreSQL handles the conflict
    # against the (attempt_id, q_num) PK in a single statement; no concurrent
    # PATCH for a different q_num can see a stale snapshot.
    supabase_admin.table("reading_attempt_answers").upsert({
        "attempt_id":  attempt_id,
        "q_num":       body.q_num,
        "user_answer": body.user_answer or "",
        "answered_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="attempt_id,q_num").execute()

    # Echo a small ack with the persisted-row count for the test surface to
    # verify state. We don't echo the whole answers array — the client
    # already knows its own input and the GET /attempts/in-progress route
    # is the canonical hydrator for a fresh tab.
    count_res = (
        supabase_admin.table("reading_attempt_answers")
        .select("q_num", count="exact")
        .eq("attempt_id", attempt_id)
        .execute()
    )
    return {
        "attempt_id": attempt_id,
        "q_num":      body.q_num,
        "answered":   getattr(count_res, "count", None) or 0,
    }


def _fetch_submitted_attempts_for_user(user_id: str, limit: int = _DIAGNOSTIC_ATTEMPT_LIMIT) -> list[dict]:
    res = (
        supabase_admin.table("reading_test_attempts")
        .select("id,status,submitted_at,score,band_estimate,skill_breakdown")
        .eq("user_id", user_id)
        .eq("status", "submitted")
        .order("submitted_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


def _fetch_l2_skill_exercises(skill_tags: list[str]) -> list[dict]:
    tags = sorted({tag for tag in skill_tags if tag in _SKILL_TAG_VALUES})
    if not tags:
        return []
    res = (
        supabase_admin.table("reading_passages")
        .select("id,slug,title,skill_focus,difficulty_level,estimated_minutes,topic_tags,created_at")
        .eq("library", "l2_skill")
        .eq("status", "published")
        .in_("skill_focus", tags)
        .order("created_at", desc=True)
        .execute()
    )
    return res.data or []


@router.get("/diagnostic")
async def get_reading_diagnostic(
    attempt_id: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    """Rule-based learner diagnostic over submitted L3 attempts.

    The selected attempt (explicit attempt_id or latest submitted attempt)
    drives the "current" weakness view; prior submitted attempts provide the
    trend signal. L2 recommendations are exact skill_tag → skill_focus matches.
    """
    user = await _require_auth(authorization)
    attempts = _fetch_submitted_attempts_for_user(user["id"])
    if not attempts and attempt_id:
        selected = _fetch_attempt_or_404(attempt_id, user["id"])
        if selected.get("status") != "submitted":
            raise HTTPException(422, "Diagnostic chỉ hỗ trợ submitted attempts.")
        attempts = [selected]
    elif not attempts:
        return build_reading_diagnostic([], [], selected_attempt_id=attempt_id)

    selected_attempt_id = attempt_id
    if selected_attempt_id:
        if not any(a.get("id") == selected_attempt_id for a in attempts):
            selected = _fetch_attempt_or_404(selected_attempt_id, user["id"])
            if selected.get("status") != "submitted":
                raise HTTPException(422, "Diagnostic chỉ hỗ trợ submitted attempts.")
            attempts = [selected] + [a for a in attempts if a.get("id") != selected_attempt_id]

    current_attempt = attempts[0]
    if selected_attempt_id:
        for attempt in attempts:
            if attempt.get("id") == selected_attempt_id:
                current_attempt = attempt
                break

    current_skills = list((current_attempt.get("skill_breakdown") or {}).keys())
    exercises = _fetch_l2_skill_exercises(current_skills)
    return build_reading_diagnostic(
        attempts,
        exercises,
        selected_attempt_id=selected_attempt_id or current_attempt.get("id"),
    )
