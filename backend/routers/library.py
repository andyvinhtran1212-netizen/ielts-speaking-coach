"""Public Library API (LIBRARY-0061, task T006 = G06-T06).

Prefix ``/api/library``. Every route here is public (no account) and listed in
``services/activation_gate.ACTIVATION_EXEMPT_ROUTES`` with reason
"public Library"; the router is still registered behind ``_ACTIVE_LEARNER`` so
a route added later without an exemption is gated by default.

Routes in this task:

* ``GET /summary``                     shelf counts for ``/library`` (null = not countable)
* ``GET /writing-samples``             filtered, paged list with faceted counts
* ``GET /writing-samples/index``       ``[{slug, updated_at}]`` for the sitemap
* ``GET /writing-samples/{slug}``      one published set; old slug -> 308; else 404
* ``GET /media/{shelf}/{key}/{asset}`` figure/audio bytes, only while published (FR-064)

Added by T013 (G06-T13), Speaking questions with a synthetic-voice model answer:

* ``GET /speaking``                    filtered list (part, topic, video-only, q) with counts
* ``GET /speaking/index``              ``[{slug, updated_at}]`` for the sitemap
* ``GET /speaking/{slug}``             one published question with its answer; else 404

Source of truth is the database (migration 400) read as service_role. Only
``published = true`` rows are ever returned. The public payload is built from an
allow-list, so internal fields (``source_key``, ``content_hash``,
``source_review_status``, ``integrity_check``, ``difficulty_notes``, idea codes,
change-type codes, estimated per-criterion scores) never leave the backend
(FR-015). Criterion codes are expanded to their full English names (FR-014).

The 549-row corpus is small, so listing reads the published list columns once
per request and filters, facets and pages in Python: one query, exact counts,
no aggregate table.
"""

from __future__ import annotations

import functools
import logging
import unicodedata
from datetime import datetime, timezone
from email.utils import format_datetime
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response

from database import supabase_admin
from services import library_media
from services.public_cache import cacheable_json

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/library", tags=["library"])

PAGE_SIZE = 12
Q_MAX_LENGTH = 100
RELATED_LIMIT = 4

# URL value -> stored task_type (FR-010: Task 2 · Task 1).
TASK_PARAM = {"task2": "task2", "task1": "task1_academic"}
TASK_URL = {v: k for k, v in TASK_PARAM.items()}
# Stored question_type -> public code (URL ``dang``, JSON) and English label.
# Stored codes such as ``problem_solution`` never leave the backend (FR-015).
QUESTION_TYPE_PUBLIC = {
    "opinion": "opinion",
    "discussion": "discussion",
    "problem_solution": "problem-solution",
    "advantages_disadvantages": "advantages-disadvantages",
    "two_part": "two-part",
    "positive_negative": "positive-negative",
}
QUESTION_TYPE_STORED = {v: k for k, v in QUESTION_TYPE_PUBLIC.items()}
QUESTION_TYPE_LABELS = {
    "opinion": "Opinion",
    "discussion": "Discussion",
    "problem-solution": "Problem and Solution",
    "advantages-disadvantages": "Advantages and Disadvantages",
    "two-part": "Two-part Question",
    "positive-negative": "Positive or Negative Development",
}
QUESTION_TYPES = tuple(QUESTION_TYPE_STORED)  # public codes accepted by ``dang``

# JSON routes revalidate on every use (ETag -> 304), so an unpublished set is
# never replayed from a browser or CDN cache: the next request reaches the
# backend and gets 404 (FR-019). Error and redirect answers are not stored.
JSON_CACHE_CONTROL = "no-cache"
NO_STORE = "no-store"

_LIST_COLUMNS = (
    "slug, title_en, task_type, question_type, task1_subtype, topic_slug, "
    "prompt_text, updated_at"
)
_DETAIL_COLUMNS = (
    "id, slug, title_en, task_type, question_type, task1_subtype, topic_slug, "
    "prompt_text, prompt_image_path, essays, delta_75_70, delta_70_60, "
    "justification, task1_data, published_at, updated_at"
)
_BANDS = ("7.5", "7.0", "6.0")
_ESSAY_KEYS = ("text", "word_count", "outline", "vocab_table", "structures")
_DELTA_KEYS = ("before", "after", "why")
_CHANGE_KEYS = ("lower_form", "higher_form", "why_vi")

_CRITERION_NAMES = {
    "CC": "Coherence and Cohesion",
    "LR": "Lexical Resource",
    "GRA": "Grammatical Range and Accuracy",
    "TA": "Task Achievement",
}


# ── helpers ─────────────────────────────────────────────────────────────────


def criterion_name(code: Any, task_type: str) -> Optional[str]:
    """Full English criterion name for a stored code (TR depends on the task)."""
    if not isinstance(code, str) or not code.strip():
        return None
    raw = code.strip()
    upper = raw.upper()
    if upper == "TR":
        return "Task Achievement" if task_type == "task1_academic" else "Task Response"
    if upper in _CRITERION_NAMES:
        return _CRITERION_NAMES[upper]
    # Already a full name (or an unknown label): never echo a short code.
    return raw if len(raw) > 4 else None


def _http_date(values: list[Any]) -> str:
    newest: Optional[datetime] = None
    for value in values:
        if not isinstance(value, str) or not value:
            continue
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        if newest is None or parsed > newest:
            newest = parsed
    return format_datetime(newest or datetime.now(timezone.utc), usegmt=True)


def _default_order_key(row: dict) -> tuple:
    """Default list order (FR-017 prev/next): Task 2 before Task 1, then title."""
    return (0 if row.get("task_type") == "task2" else 1, str(row.get("title_en") or "").casefold(), row.get("slug") or "")


def _published_list() -> list[dict]:
    rows = (
        supabase_admin.table("writing_samples")
        .select(_LIST_COLUMNS)
        .eq("published", True)
        .execute()
        .data
        or []
    )
    return sorted(rows, key=_default_order_key)


def _writing_topics() -> dict[str, dict]:
    rows = (
        supabase_admin.table("library_topics")
        .select("slug, label_vi, shelves, display_order")
        .execute()
        .data
        or []
    )
    return {
        r["slug"]: r for r in rows
        if isinstance(r, dict) and "writing" in (r.get("shelves") or [])
    }


def _public_question_type(row: dict) -> Optional[str]:
    return QUESTION_TYPE_PUBLIC.get(row.get("question_type"))


def _kind_fields(row: dict) -> dict:
    """Public task / type fields: no stored code (``task1_academic``,
    ``problem_solution``) is echoed (FR-015)."""
    qtype = _public_question_type(row)
    return {
        "task": TASK_URL.get(row.get("task_type")),
        "question_type": qtype,
        "question_type_label": QUESTION_TYPE_LABELS.get(qtype) if qtype else None,
        "task1_subtype": row.get("task1_subtype"),
    }


def _unavailable() -> JSONResponse:
    return JSONResponse(
        status_code=503, content={"detail": "library_unavailable"}, headers={"Cache-Control": NO_STORE}
    )


def _db_guard(handler):
    """A database read that fails (e.g. tables not migrated yet, Supabase down)
    answers 503 ``library_unavailable`` with no-store, logged, instead of a bare
    500; validation errors (422) are raised before any read and pass through."""

    @functools.wraps(handler)
    def wrapper(*args, **kwargs):
        try:
            return handler(*args, **kwargs)
        except HTTPException:
            raise
        except Exception:  # noqa: BLE001 - every client/DB error maps to one answer
            logger.exception("[library] %s failed", handler.__name__)
            return _unavailable()

    return wrapper


def _json(data: Any, request: Request, *, last_modified: str) -> Response:
    return cacheable_json(data, request, last_modified=last_modified, cache_control=JSON_CACHE_CONTROL)


def _list_item(row: dict) -> dict:
    return {
        "slug": row.get("slug"),
        "title_en": row.get("title_en"),
        **_kind_fields(row),
        "topic_slug": row.get("topic_slug"),
        "prompt_text": row.get("prompt_text"),
    }


def _matches(row: dict, *, task: Optional[str], dang: Optional[str], chude: Optional[str], needle: Optional[str]) -> bool:
    if task and row.get("task_type") != TASK_PARAM[task]:
        return False
    if dang and row.get("question_type") != QUESTION_TYPE_STORED[dang]:
        return False
    if chude and row.get("topic_slug") != chude:
        return False
    if needle:
        hay = f"{row.get('title_en') or ''}\n{row.get('prompt_text') or ''}".casefold()
        if needle not in hay:
            return False
    return True


def _count(rows: list[dict], key) -> dict[str, int]:
    out: dict[str, int] = {}
    for row in rows:
        value = key(row)
        if value:
            out[value] = out.get(value, 0) + 1
    return out


# ── summary ─────────────────────────────────────────────────────────────────


def _safe(fn):
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001 - one shelf must not break the page
        logger.warning("[library] summary count failed: %s", type(exc).__name__)
        return None


def _count_writing_samples() -> dict:
    rows = _published_list()
    return {
        "total": len(rows),
        "task2": sum(1 for r in rows if r.get("task_type") == "task2"),
        "task1": sum(1 for r in rows if r.get("task_type") == "task1_academic"),
    }


def _count_writing_guides() -> dict:
    rows = (
        supabase_admin.table("writing_tips")
        .select("id")
        .eq("published", True)
        .in_("content_type", ["knowledge", "tip"])
        .execute()
        .data
        or []
    )
    return {"total": len(rows)}


def _count_speaking() -> dict:
    rows = (
        supabase_admin.table("speaking_samples")
        .select("id, video_source")
        .eq("published", True)
        .execute()
        .data
        or []
    )
    return {"total": len(rows), "with_video": sum(1 for r in rows if r.get("video_source"))}


def _count_grammar() -> dict:
    from services.grammar_content import grammar_service

    return {"total": len(grammar_service.articles_by_slug)}


def _count_vocabulary() -> dict:
    from services.vocab_content import vocab_service

    return {"total": len(vocab_service.get_curated_articles())}


@router.get("/summary")
def library_summary(request: Request):
    """Counts for the five shelves of ``/library``. A shelf that cannot be
    counted is ``null`` so the page shows no number (FR-004)."""
    data = {
        "writing_samples": _safe(_count_writing_samples),
        "writing_guides": _safe(_count_writing_guides),
        "speaking": _safe(_count_speaking),
        "grammar": _safe(_count_grammar),
        "vocabulary": _safe(_count_vocabulary),
    }
    return _json(data, request, last_modified=_http_date([]))


# ── writing samples ─────────────────────────────────────────────────────────


@router.get("/writing-samples")
@_db_guard
def list_writing_samples(
    request: Request,
    task: Optional[str] = Query(default=None),
    dang: Optional[str] = Query(default=None),
    chude: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None, max_length=Q_MAX_LENGTH),
    trang: int = Query(default=1, ge=1),
):
    """Published Writing sample sets, 12 per page (FR-010, FR-011).

    Facets follow the usual faceted-search rule: each group is counted over the
    rows that match every OTHER active filter (its own filter is left out), so
    the counts say what choosing that value would return.
    """
    if task is not None and task not in TASK_PARAM:
        raise HTTPException(422, "task must be task2 or task1")
    if dang is not None and dang not in QUESTION_TYPES:
        raise HTTPException(422, "dang is not a Task 2 question type (" + ", ".join(QUESTION_TYPES) + ")")
    if dang is not None and task == "task1":
        raise HTTPException(422, "dang applies to Task 2 only")
    needle = (q or "").strip().casefold() or None

    rows = _published_list()
    topics = _writing_topics()
    if chude is not None and chude not in topics:
        raise HTTPException(422, "chude is not a Writing topic")

    filters = {"task": task, "dang": dang, "chude": chude, "needle": needle}
    matched = [r for r in rows if _matches(r, **filters)]

    facet_task = _count(
        [r for r in rows if _matches(r, **{**filters, "task": None})],
        lambda r: TASK_URL.get(r.get("task_type")),
    )
    facet_type = _count(
        [r for r in rows if _matches(r, **{**filters, "dang": None})],
        _public_question_type,
    )
    facet_topic = _count(
        [r for r in rows if _matches(r, **{**filters, "chude": None})],
        lambda r: r.get("topic_slug"),
    )

    start = (trang - 1) * PAGE_SIZE
    data = {
        "items": [_list_item(r) for r in matched[start:start + PAGE_SIZE]],
        "total": len(matched),
        "page": trang,
        "page_size": PAGE_SIZE,
        "facets": {"task": facet_task, "question_type": facet_type, "topic": facet_topic},
        "topics": [
            {"slug": t["slug"], "label_vi": t.get("label_vi")}
            for t in sorted(topics.values(), key=lambda t: (t.get("display_order") or 0, t["slug"]))
        ],
    }
    return _json(data, request, last_modified=_http_date([r.get("updated_at") for r in rows]))


@router.get("/writing-samples/index")
@_db_guard
def writing_samples_index(request: Request):
    """``[{slug, updated_at}]`` of every published set, for the sitemap."""
    rows = _published_list()
    data = [{"slug": r.get("slug"), "updated_at": r.get("updated_at")} for r in rows]
    return _json(data, request, last_modified=_http_date([r.get("updated_at") for r in rows]))


def _public_essays(raw: Any) -> dict:
    essays = raw if isinstance(raw, dict) else {}
    out = {}
    for band in _BANDS:
        essay = essays.get(band)
        if isinstance(essay, dict):
            out[band] = {k: essay.get(k) for k in _ESSAY_KEYS}
    return out


def _public_delta(raw: Any, task_type: str) -> list[dict]:
    out = []
    for entry in raw if isinstance(raw, list) else []:
        if not isinstance(entry, dict):
            continue
        item = {k: entry.get(k) for k in _DELTA_KEYS}
        item["criterion"] = criterion_name(entry.get("criterion"), task_type)
        out.append(item)
    return out


def _public_justification(raw: Any, task_type: str) -> list[dict]:
    blocks = raw.get("by_criterion") if isinstance(raw, dict) else None
    out = []
    for block in blocks if isinstance(blocks, list) else []:
        if not isinstance(block, dict):
            continue
        jumps = []
        for jump in block.get("jumps") or []:
            if not isinstance(jump, dict):
                continue
            changes = [
                {k: change.get(k) for k in _CHANGE_KEYS}
                for change in jump.get("changes") or []
                if isinstance(change, dict)
            ]
            jumps.append({"pair": jump.get("pair"), "changes": changes})
        out.append({
            "criterion": criterion_name(block.get("criterion"), task_type),
            "summary_vi": block.get("summary_vi"),
            "jumps": jumps,
        })
    return out


def _neighbour(row: Optional[dict]) -> Optional[dict]:
    return {"slug": row.get("slug"), "title_en": row.get("title_en")} if row else None


def _related(current: dict, rows: list[dict]) -> list[dict]:
    """Same question type or same topic, max 4: both first, then type, then topic."""
    others = [r for r in rows if r.get("slug") != current.get("slug")]

    def rank(row: dict) -> Optional[int]:
        same_type = bool(current.get("question_type")) and row.get("question_type") == current.get("question_type")
        same_task1 = current.get("task_type") == "task1_academic" and row.get("task1_subtype") == current.get("task1_subtype")
        same_topic = row.get("topic_slug") == current.get("topic_slug")
        kind = same_type or same_task1
        if kind and same_topic:
            return 0
        if kind:
            return 1
        if same_topic:
            return 2
        return None

    ranked = [(rank(r), i, r) for i, r in enumerate(others)]
    picked = sorted((t for t in ranked if t[0] is not None), key=lambda t: (t[0], t[1]))
    return [_list_item(r) for _, _, r in picked[:RELATED_LIMIT]]


def _sample_not_found() -> JSONResponse:
    return JSONResponse(
        status_code=404, content={"detail": "sample_not_found"}, headers={"Cache-Control": NO_STORE}
    )


@router.get("/writing-samples/{slug}")
@_db_guard
def get_writing_sample(slug: str, request: Request):
    """One published set (FR-013–FR-019). A slug renamed after publishing
    redirects with 308 to the current slug; anything else is 404."""
    found = (
        supabase_admin.table("writing_samples")
        .select(_DETAIL_COLUMNS)
        .eq("slug", slug)
        .eq("published", True)
        .execute()
        .data
        or []
    )
    if not found:
        history = (
            supabase_admin.table("writing_sample_slug_history")
            .select("sample_id")
            .eq("old_slug", slug)
            .execute()
            .data
            or []
        )
        if history:
            target = (
                supabase_admin.table("writing_samples")
                .select("slug")
                .eq("id", history[0].get("sample_id"))
                .eq("published", True)
                .execute()
                .data
                or []
            )
            if target and target[0].get("slug") and target[0]["slug"] != slug:
                return RedirectResponse(
                    url=f"/api/library/writing-samples/{target[0]['slug']}",
                    status_code=308,
                    headers={"Cache-Control": NO_STORE},
                )
        return _sample_not_found()

    row = found[0]
    task_type = row.get("task_type") or ""
    rows = _published_list()
    index = next((i for i, r in enumerate(rows) if r.get("slug") == row.get("slug")), None)
    prev_row = rows[index - 1] if index is not None and index > 0 else None
    next_row = rows[index + 1] if index is not None and index + 1 < len(rows) else None

    data = {
        "slug": row.get("slug"),
        "title_en": row.get("title_en"),
        **_kind_fields(row),
        "topic_slug": row.get("topic_slug"),
        "prompt_text": row.get("prompt_text"),
        "figure_url": (
            library_media.media_path("writing-sample", row["slug"], "figure")
            if row.get("prompt_image_path") else None
        ),
        "essays": _public_essays(row.get("essays")),
        "delta_75_70": _public_delta(row.get("delta_75_70"), task_type),
        "delta_70_60": _public_delta(row.get("delta_70_60"), task_type),
        "justification": _public_justification(row.get("justification"), task_type),
        "task1_data": row.get("task1_data") if task_type == "task1_academic" else None,
        "published_at": row.get("published_at"),
        "updated_at": row.get("updated_at"),
        "related": _related(row, rows),
        "prev": _neighbour(prev_row),
        "next": _neighbour(next_row),
    }
    return _json(data, request, last_modified=_http_date([row.get("updated_at")]))


# ── speaking (T013: FR-030–FR-036) ─────────────────────────────────────────

SPEAKING_PARTS = (1, 2, 3)
_SPEAKING_LIST_COLUMNS = (
    "slug, part, title_en, title_vi, topic_slug, video_source, duration_s, "
    "audio_path, sample_text, voice, updated_at"
)
_SPEAKING_DETAIL_COLUMNS = (
    "id, slug, part, title_en, title_vi, topic_slug, topic_id, cue_card, video_source, "
    "youtube_id, video_url, duration_s, transcript, sample_text, audio_path, voice, "
    "outline, vocabulary, related_part3, published_at, updated_at"
)
_MARK_KINDS = ("vocab", "structure")
_CUE_KEYS = ("prompt", "bullets", "reflection", "questions")
_VOCAB_KEYS = ("term", "meaning_vi", "note")


def _speaking_topics() -> dict[str, dict]:
    rows = (
        supabase_admin.table("library_topics")
        .select("slug, label_vi, shelves, display_order")
        .execute()
        .data
        or []
    )
    return {
        r["slug"]: r for r in rows
        if isinstance(r, dict) and "speaking" in (r.get("shelves") or [])
    }


def _has_answer(row: dict) -> bool:
    """FR-031: a question with no model answer never reaches the shelf."""
    text = row.get("sample_text")
    return isinstance(text, str) and bool(text.strip())


def _answer_kind(row: dict) -> str:
    """How the model answer is delivered, so the page can say it in words
    (FR-031): ``video``, ``audio`` or ``text``."""
    if row.get("video_source") in ("youtube", "self_hosted"):
        return "video"
    if row.get("audio_path"):
        return "audio"
    return "text"


def _published_speaking(topics: dict[str, dict]) -> list[dict]:
    """Published questions with an answer, in shelf order (FR-030, FR-035):
    topic display order (unassigned topics last), then Part 1 → 2 → 3, then title."""
    rows = (
        supabase_admin.table("speaking_samples")
        .select(_SPEAKING_LIST_COLUMNS)
        .eq("published", True)
        .execute()
        .data
        or []
    )

    def key(row: dict) -> tuple:
        topic = topics.get(row.get("topic_slug") or "")
        return (
            0 if topic else 1,
            (topic or {}).get("display_order") or 0,
            row.get("topic_slug") or "" if topic else "",
            row.get("part") or 0,
            str(row.get("title_en") or "").casefold(),
            row.get("slug") or "",
        )

    return sorted((r for r in rows if _has_answer(r)), key=key)


def _speaking_item(row: dict, topics: dict[str, dict]) -> dict:
    kind = _answer_kind(row)
    return {
        "slug": row.get("slug"),
        "part": row.get("part"),
        "title_en": row.get("title_en"),
        "title_vi": row.get("title_vi"),
        # A topic that is not on the Speaking shelf reads as "no topic"
        # (the page groups it under "Chủ đề khác").
        "topic_slug": row.get("topic_slug") if row.get("topic_slug") in topics else None,
        "answer_kind": kind,
        "duration_s": row.get("duration_s") if kind != "text" else None,
        "voice": row.get("voice") or "synthetic",
    }


def fold_text(text: str) -> str:
    """Case- and accent-insensitive form for search ("Nơi chốn" -> "noi chon")."""
    decomposed = unicodedata.normalize("NFKD", text.replace("đ", "d").replace("Đ", "D"))
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def _speaking_matches(row: dict, *, part: Optional[int], chude: Optional[str],
                      video: bool, needle: Optional[str], labels: dict[str, str]) -> bool:
    if part is not None and row.get("part") != part:
        return False
    if chude and row.get("topic_slug") != chude:
        return False
    if video and _answer_kind(row) != "video":
        return False
    if needle:
        hay = fold_text("\n".join((
            row.get("title_en") or "", row.get("title_vi") or "", labels.get(row.get("topic_slug") or "", ""),
        )))
        if needle not in hay:
            return False
    return True


@router.get("/speaking")
@_db_guard
def list_speaking(
    request: Request,
    part: Optional[int] = Query(default=None),
    chude: Optional[str] = Query(default=None),
    video: bool = Query(default=False),
    q: Optional[str] = Query(default=None, max_length=Q_MAX_LENGTH),
):
    """Every published Speaking question with a model answer, in shelf order
    (FR-030). The shelf holds at most a few hundred rows, so there is no paging;
    the page groups by ``topic_slug``. ``q`` matches the English title, the
    Vietnamese title and the topic name, ignoring case and accents. Facets are counted over the rows that
    match every OTHER active filter, like the Writing list."""
    if part is not None and part not in SPEAKING_PARTS:
        raise HTTPException(422, "part must be 1, 2 or 3")
    needle = fold_text((q or "").strip()) or None

    topics = _speaking_topics()
    if chude is not None and chude not in topics:
        raise HTTPException(422, "chude is not a Speaking topic")
    rows = _published_speaking(topics)

    labels = {slug: str(t.get("label_vi") or "") for slug, t in topics.items()}
    filters = {"part": part, "chude": chude, "video": video, "needle": needle, "labels": labels}
    matched = [r for r in rows if _speaking_matches(r, **filters)]
    facet_part = _count(
        [r for r in rows if _speaking_matches(r, **{**filters, "part": None})],
        lambda r: str(r.get("part")) if r.get("part") in SPEAKING_PARTS else None,
    )
    facet_topic = _count(
        [r for r in rows if _speaking_matches(r, **{**filters, "chude": None})],
        lambda r: r.get("topic_slug") if r.get("topic_slug") in topics else None,
    )
    with_video = sum(
        1 for r in rows
        if _speaking_matches(r, **{**filters, "video": False}) and _answer_kind(r) == "video"
    )

    # How many questions dropping ONE active condition would show: the "Bỏ …"
    # suggestions of an empty result. Only active conditions get a count.
    relax_off = {"part": None, "chude": None, "video": False, "q": None}
    relaxed = {
        name: sum(
            1 for r in rows
            if _speaking_matches(r, **{**filters, ("needle" if name == "q" else name): relax_off[name]})
        )
        for name, active in (("part", part), ("chude", chude), ("video", video), ("q", needle))
        if active
    }

    data = {
        "items": [_speaking_item(r, topics) for r in matched],
        "total": len(matched),
        "facets": {"part": facet_part, "topic": facet_topic, "video": with_video},
        "relaxed": relaxed,
        "topics": [
            {"slug": t["slug"], "label_vi": t.get("label_vi")}
            for t in sorted(topics.values(), key=lambda t: (t.get("display_order") or 0, t["slug"]))
        ],
    }
    return _json(data, request, last_modified=_http_date([r.get("updated_at") for r in rows]))


@router.get("/speaking/index")
@_db_guard
def speaking_index(request: Request):
    """``[{slug, updated_at}]`` of every published question, for the sitemap."""
    rows = _published_speaking(_speaking_topics())
    data = [{"slug": r.get("slug"), "updated_at": r.get("updated_at")} for r in rows]
    return _json(data, request, last_modified=_http_date([r.get("updated_at") for r in rows]))


def _int_or_none(value: Any) -> Optional[int]:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _public_transcript(raw: Any) -> tuple[list[dict], bool]:
    """Allow-listed lines and whether every line has a start time.

    The importer refuses mixed or non-increasing times, but the page must never
    seek on bad data either, so anything less than "every line timed and
    strictly increasing" is served without times (FR-033)."""
    lines = []
    for entry in raw if isinstance(raw, list) else []:
        if not isinstance(entry, dict) or not isinstance(entry.get("text"), str):
            continue
        text = entry["text"]
        marks = []
        for mark in entry.get("marks") or []:
            if not isinstance(mark, dict) or mark.get("kind") not in _MARK_KINDS:
                continue
            start, end = _int_or_none(mark.get("start")), _int_or_none(mark.get("end"))
            if start is None or end is None or not 0 <= start < end <= len(text):
                continue
            marks.append({"kind": mark["kind"], "start": start, "end": end, "note": mark.get("note")})
        lines.append({"start_ms": _int_or_none(entry.get("start_ms")), "text": text, "marks": marks})
    times = [line["start_ms"] for line in lines]
    timed = bool(lines) and all(t is not None and t >= 0 for t in times) and all(
        a < b for a, b in zip(times, times[1:])
    )
    if not timed:
        for line in lines:
            line["start_ms"] = None
    return lines, timed


def _public_cue_card(raw: Any) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    return {k: raw.get(k) for k in _CUE_KEYS if raw.get(k) is not None} or None


def _public_vocabulary(raw: Any) -> list[dict]:
    return [
        {k: entry.get(k) for k in _VOCAB_KEYS}
        for entry in raw if isinstance(entry, dict) and entry.get("term")
    ] if isinstance(raw, list) else []


def _strings(raw: Any) -> list[str]:
    return [s for s in raw if isinstance(s, str) and s.strip()] if isinstance(raw, list) else []


def _speaking_not_found() -> JSONResponse:
    return JSONResponse(
        status_code=404, content={"detail": "speaking_not_found"}, headers={"Cache-Control": NO_STORE}
    )


@router.get("/speaking/{slug}")
@_db_guard
def get_speaking(slug: str, request: Request):
    """One published question with its model answer (FR-031–FR-036).

    Video and audio are described, never proxied here: YouTube by id (the page
    embeds youtube-nocookie.com), self-hosted video by its https URL, audio by
    the media route path. Slugs are frozen after publishing (no history table),
    so an unknown, draft or answer-less slug is 404."""
    found = (
        supabase_admin.table("speaking_samples")
        .select(_SPEAKING_DETAIL_COLUMNS)
        .eq("slug", slug)
        .eq("published", True)
        .execute()
        .data
        or []
    )
    if not found or not _has_answer(found[0]):
        return _speaking_not_found()
    row = found[0]
    topics = _speaking_topics()
    rows = _published_speaking(topics)
    index = next((i for i, r in enumerate(rows) if r.get("slug") == row.get("slug")), None)
    prev_row = rows[index - 1] if index is not None and index > 0 else None
    next_row = rows[index + 1] if index is not None and index + 1 < len(rows) else None

    kind = _answer_kind(row)
    video_source = row.get("video_source") if kind == "video" else None
    transcript, timed = _public_transcript(row.get("transcript"))
    topic = topics.get(row.get("topic_slug") or "")
    data = {
        **_speaking_item(row, topics),
        "topic_label_vi": topic.get("label_vi") if topic else None,
        "topic_id": row.get("topic_id"),
        "cue_card": _public_cue_card(row.get("cue_card")),
        "media": {
            "video_source": video_source,
            "youtube_id": row.get("youtube_id") if video_source == "youtube" else None,
            "video_url": row.get("video_url") if video_source == "self_hosted" else None,
            "audio_url": (
                library_media.media_path("speaking-sample", row["slug"], "audio")
                if kind == "audio" else None
            ),
        },
        "sample_text": row.get("sample_text"),
        "transcript": transcript,
        "timed": timed,
        "outline": _strings(row.get("outline")),
        "vocabulary": _public_vocabulary(row.get("vocabulary")),
        "related_part3": _strings(row.get("related_part3")),
        "published_at": row.get("published_at"),
        "updated_at": row.get("updated_at"),
        "prev": _neighbour(prev_row),
        "next": _neighbour(next_row),
    }
    return _json(data, request, last_modified=_http_date([row.get("updated_at")]))


# ── media (FR-064) ──────────────────────────────────────────────────────────


@router.get("/media/{shelf}/{key}/{asset}")
@_db_guard
def get_library_media(shelf: str, key: str, asset: str, request: Request) -> Response:
    """Figure or audio bytes of a PUBLISHED item, read fresh on every request.

    Never cached (``no-store``) and never a redirect to Storage, so unpublishing
    takes effect on the next request to the same URL. Unknown shelf/asset,
    unpublished or missing item, and missing object are all 404.
    """
    target = library_media.MEDIA_ASSETS.get((shelf, asset))
    if target is None:
        return library_media.not_found()
    table, column = target
    rows = (
        supabase_admin.table(table)
        .select(f"slug, {column}")
        .eq("slug", key)
        .eq("published", True)
        .execute()
        .data
        or []
    )
    object_path = rows[0].get(column) if rows else None
    if not isinstance(object_path, str) or not object_path:
        return library_media.not_found()
    content_type = library_media.content_type_for(object_path)
    if content_type is None:
        logger.warning("[library_media] unsupported object type path=%s", object_path)
        return library_media.not_found()
    data = library_media.download(supabase_admin, object_path)
    if data is None:
        return library_media.not_found()
    return library_media.build_response(data, content_type, request.headers.get("range"))
