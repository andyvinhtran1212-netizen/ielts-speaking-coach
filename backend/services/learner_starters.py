"""Starter papers of the skill hub (LEARNERCORE-0063 FR-112, FR-126; T25s).

"Bắt đầu với một bài" shows one fixed paper per skill to a learner who has
nothing to resume and no attempt yet. The owner sets the papers; nobody writes
the database directly. The value lives under the ``learner_starters`` key of
``admin_settings`` (migration 440)::

    {"speaking": {"topic_id": "<uuid>"} | null,
     "writing":  {"prompt_id": "<id>"} | null,
     "listening": {"test_uuid": "<uuid>"} | null,
     "reading":  {"test_uuid": "<uuid>"} | null}

A missing skill key reads as null.

* :func:`get` returns the four skills, cached for ``_TTL_SECONDS``; a stored
  entry of the wrong shape reads as null (logged, never trusted).
* :func:`set_many` checks every change, then merges only those skills through
  ``fn_admin_settings_merge`` (value and ``admin_settings_log`` row in one
  transaction, ``reason`` required). A paper must be open to public
  self-practice at write time, by the same rules as "Tự luyện bài này"
  (``class_self_practice.open_papers``): Listening/Reading in the public
  practice catalog, published, public and not held for an exam; Speaking a
  topic active in the topic library. Writing has no self-practice prompt bank
  until G08, so a Writing starter is refused (``starter_unsupported``).
* :func:`starter_for` re-checks at read time: a paper that is no longer open
  hides the block (FR-112).
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any, Dict, Iterable, Optional, Tuple

from database import supabase_admin

logger = logging.getLogger(__name__)

SETTINGS_KEY = "learner_starters"
SKILLS = ("speaking", "writing", "listening", "reading")
ID_FIELD = {"speaking": "topic_id", "writing": "prompt_id", "listening": "test_uuid", "reading": "test_uuid"}
LABELS = {"speaking": "Speaking", "writing": "Writing", "listening": "Listening", "reading": "Reading"}
_TTL_SECONDS = 60.0
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

_CATALOG = {"listening": "listening_public_practice_catalog",
            "reading": "reading_public_practice_catalog"}

UNAVAILABLE = ("starter_paper_unavailable", "Đề này hiện không mở cho tự luyện công khai, nên không đặt làm đề khởi đầu được.")
UNSUPPORTED = ("starter_unsupported", "Writing chưa có ngân hàng đề tự luyện, nên chưa đặt đề khởi đầu được.")


class StartersUnavailable(Exception):
    """The stored value could not be read and there is no previous copy."""


class StarterChangeError(Exception):
    """A change was refused before anything was written."""

    def __init__(self, code: str, message: str, skill: Optional[str] = None):
        super().__init__(message)
        self.code, self.message, self.skill = code, message, skill


_cache: Optional[Tuple[Dict[str, Optional[Dict[str, str]]], float]] = None


def clear_cache() -> None:
    global _cache
    _cache = None


def _entry(skill: str, value: Any) -> Optional[Dict[str, str]]:
    """`{id_field: id}` when `value` has exactly that shape, else None."""
    if not isinstance(value, dict) or set(value) != {ID_FIELD[skill]}:
        return None
    ident = value[ID_FIELD[skill]]
    if not isinstance(ident, str) or not ident.strip():
        return None
    if ID_FIELD[skill] != "prompt_id" and not _UUID_RE.match(ident):
        return None
    return {ID_FIELD[skill]: ident}


def _resolve(stored: Any) -> Dict[str, Optional[Dict[str, str]]]:
    stored = stored if isinstance(stored, dict) else {}
    out: Dict[str, Optional[Dict[str, str]]] = {}
    for skill in SKILLS:
        raw = stored.get(skill)
        entry = _entry(skill, raw) if raw is not None else None
        if raw is not None and entry is None:
            logger.warning("learner_starters: stored %s=%r has the wrong shape; read as null", skill, raw)
        out[skill] = entry
    return out


def _read_stored():
    return (supabase_admin.table("admin_settings").select("value")
            .eq("key", SETTINGS_KEY).limit(1).execute())


def _merge(changes: dict, reason: str, actor: Optional[str]):
    return supabase_admin.rpc("fn_admin_settings_merge", {
        "p_key": SETTINGS_KEY, "p_changes": changes, "p_reason": reason, "p_actor": actor,
    }).execute()


async def _read() -> Dict[str, Optional[Dict[str, str]]]:
    """The four skills, uncached."""
    res = await asyncio.to_thread(_read_stored)
    rows = getattr(res, "data", None) or []
    return _resolve(rows[0].get("value") if rows else None)


async def get() -> Dict[str, Optional[Dict[str, str]]]:
    """The four skills, cached; a failed read with a previous copy serves it."""
    global _cache
    now = time.monotonic()
    if _cache is not None and _cache[1] > now:
        return dict(_cache[0])
    try:
        values = await _read()
    except Exception as exc:
        if _cache is not None:
            logger.warning("learner_starters: read failed (%s); serving the previous copy", type(exc).__name__)
            return dict(_cache[0])
        raise StartersUnavailable("learner_starters_unavailable") from exc
    _cache = (values, now + _TTL_SECONDS)
    return dict(values)


# ── is the paper open to public self-practice? ────────────────────────────────


def open_paper(db, skill: str, entry: Optional[Dict[str, str]]) -> Optional[Dict[str, Any]]:
    """The paper row when `entry` names a paper open to public self-practice
    now, by the T30b rules; None otherwise. Writing is never open (no G08)."""
    from services.class_self_practice import open_papers

    if not entry or skill not in ("speaking", "listening", "reading"):
        return None
    ident = entry[ID_FIELD[skill]]
    paper = open_papers(db, {skill: {ident}})[skill].get(ident)
    if paper is None or skill == "speaking" or "title" in paper:
        return paper
    # open_papers selects only the columns its rules need; the starter also
    # shows the paper's title (same catalog view, one more small read).
    rows = (db.table(_CATALOG[skill]).select("id, title").eq("id", ident)
            .limit(1).execute().data) or []
    return {**paper, "title": (rows[0].get("title") if rows else None)}


def validate_changes(changes: Iterable[Tuple[str, Any]], db=None) -> Dict[str, Optional[Dict[str, str]]]:
    """``[(skill, value)]`` -> ``{skill: entry | None}``, or :class:`StarterChangeError`.
    Reads the papers (one read per skill) to refuse a paper not open now."""
    db = db or supabase_admin
    merged: Dict[str, Optional[Dict[str, str]]] = {}
    for skill, value in changes:
        if skill not in SKILLS:
            raise StarterChangeError("unknown_skill", "Kỹ năng này không có đề khởi đầu.", skill)
        if skill in merged:
            raise StarterChangeError("duplicate_skill", f"{LABELS[skill]} có hai giá trị trong cùng một lần lưu.", skill)
        if value is None:
            merged[skill] = None
            continue
        if skill == "writing":
            raise StarterChangeError(*UNSUPPORTED, skill)
        entry = _entry(skill, value)
        if entry is None:
            raise StarterChangeError(
                "invalid_value", f"{LABELS[skill]}: cần đúng một trường {ID_FIELD[skill]} hợp lệ.", skill)
        if open_paper(db, skill, entry) is None:
            raise StarterChangeError(*UNAVAILABLE, skill)
        merged[skill] = entry
    if not merged:
        raise StarterChangeError("no_changes", "Chưa có thay đổi nào để lưu.")
    return merged


async def set_many(changes: Iterable[Tuple[str, Any]], reason: str,
                   actor: Optional[str]) -> Dict[str, Optional[Dict[str, str]]]:
    """Check, then merge and log in one transaction; returns the new values.

    Only the requested skills are sent: a skill missing from the stored object
    reads as null, so nothing is padded. Padding from a read taken outside the
    merge's lock would let two first saves of different skills clear each other."""
    global _cache
    merged = await asyncio.to_thread(validate_changes, list(changes))
    res = await asyncio.to_thread(_merge, merged, reason, actor)
    answer = getattr(res, "data", None)
    if isinstance(answer, dict) and answer.get("changed") is False:
        raise StarterChangeError("no_changes", "Các đề này đã được lưu từ trước; không có gì thay đổi.")
    stored = answer.get("value") if isinstance(answer, dict) else None
    if not isinstance(stored, dict):
        clear_cache()
        return await get()
    values = _resolve(stored)
    _cache = (values, time.monotonic() + _TTL_SECONDS)
    return dict(values)


def items(db, values: Dict[str, Optional[Dict[str, str]]]) -> list[Dict[str, Any]]:
    """API rows for the admin: each skill's value, the paper title and whether
    it is still open (a starter that closed since it was set is hidden from
    learners and shown here as unavailable)."""
    out = []
    for skill in SKILLS:
        entry = values.get(skill)
        paper = None
        if entry and skill != "writing":
            try:
                paper = open_paper(db, skill, entry)
            except Exception:
                logger.warning("learner_starters: paper read failed for %s", skill)
                out.append({"skill": skill, "value": entry, "title": None, "available": None})
                continue
        out.append({
            "skill": skill, "value": entry,
            "title": (paper or {}).get("title") if paper else None,
            "available": None if entry is None else paper is not None,
        })
    return out


# ── learner side (FR-112) ─────────────────────────────────────────────────────

_SPEAKING_ALL = "/speaking?view=all"


def starter_for(db, skill: str, values: Dict[str, Optional[Dict[str, str]]]) -> Optional[Dict[str, Any]]:
    """The hub's `starter` for `skill`, or None when unset or no longer open."""
    from urllib.parse import urlencode

    entry = values.get(skill)
    paper = open_paper(db, skill, entry)
    if paper is None:
        return None
    if skill == "listening":
        href = "/core-player/launch?" + urlencode({"surface": "listening_test", "id": str(paper["id"])})
        return {"title": paper.get("title") or "Đề Listening khởi đầu", "meta": "Listening · đề đầy đủ",
                "uses_credit": False, "href": href}
    if skill == "reading":
        href = "/core-player/launch?" + urlencode({"surface": "reading_exam", "test_id": str(paper["test_id"])})
        return {"title": paper.get("title") or "Đề Reading khởi đầu", "meta": "Reading · đề đầy đủ",
                "uses_credit": False, "href": href}
    part = paper.get("part") if paper.get("part") in (1, 2, 3) else 1
    title = (paper.get("title") or "").strip()
    if not title:
        return None
    return {"title": title, "meta": f"Speaking Part {part}", "uses_credit": True,
            "href": _SPEAKING_ALL,
            "session_params": {"mode": "practice", "part": part, "topic": title}}
