"""Incident grouping (ADMINIA-0074 FR-071; plan 5.4 "Nội dung, sự cố"; G09-T07).

Pure functions: no database. ``services.incident_inbox`` reads the rows and
the stored group states; this module turns rows into groups.

* ``errors`` (``error_logs``): one group per
  ``sha1(source|level|path with uuids/numbers → :id|message with uuids,
  numbers and quoted strings → ?)``, so two errors that differ only in an id
  fall into the same group.
* ``grading`` (failed Speaking sessions and responses, the rows the old
  ``/admin/alerts`` page listed): one group per (skill, step, kind of task).
* ``feedback`` (``user_feedback`` ratings and flags): one group per (skill,
  test or screen, reason). Answer reports (``type = 'report'``) never form a
  group: they belong to the "Câu cần kiểm" queue (T36), and the inbox shows
  only their count.

Every fingerprint is a 40-character sha1 hex string, the shape migration 451
checks.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional
from urllib.parse import urlsplit

SOURCES = ("errors", "grading", "feedback")

_UUID = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
_PATH_ID_RE = re.compile(rf"{_UUID}|(?<=/)\d+(?=/|$)")
_QUOTED_RE = re.compile(r"'[^']*'|\"[^\"]*\"|`[^`]*`|“[^”]*”|‘[^’]*’")
_MSG_ID_RE = re.compile(rf"{_UUID}|\d+(?:\.\d+)?")
_SPACE_RE = re.compile(r"\s+")
_MESSAGE_MAX = 500
_TITLE_MAX = 140

KIND_LABELS = {"practice": "Luyện tập", "test_part": "Thi thử một phần", "test_full": "Thi thử đầy đủ"}
SKILL_LABELS = {"speaking": "Speaking", "reading": "Reading", "listening": "Listening",
                "vocabulary": "Từ vựng"}
FEEDBACK_REASONS = {"rating_low": "Đánh giá thấp (1–2 sao)", "flag": "Đánh dấu bài giải"}
LOW_RATING_MAX = 2


def fingerprint(*parts: Any) -> str:
    return hashlib.sha1("|".join("" if p is None else str(p) for p in parts).encode("utf-8")).hexdigest()


def normalize_path(url: Optional[str]) -> str:
    """The path of ``url`` (no host, query or fragment) with ids replaced by ``:id``."""
    if not url:
        return ""
    try:
        path = urlsplit(str(url)).path or str(url)
    except ValueError:
        path = str(url)
    return _PATH_ID_RE.sub(":id", path)


def normalize_message(message: Optional[str]) -> str:
    text = _QUOTED_RE.sub("?", str(message or ""))
    text = _MSG_ID_RE.sub("?", text)
    return _SPACE_RE.sub(" ", text).strip()[:_MESSAGE_MAX]


def _short(text: str) -> str:
    return text if len(text) <= _TITLE_MAX else text[: _TITLE_MAX - 1].rstrip() + "…"


@dataclass
class Group:
    source: str
    fingerprint: str
    title: str
    area: str
    level: Optional[str] = None
    count: int = 0
    learner_ids: set = field(default_factory=set)
    times: list = field(default_factory=list)          # ISO strings of every record
    record_ids: list = field(default_factory=list)     # newest first
    open_record_ids: list = field(default_factory=list)  # records not yet dismissed/resolved
    technical: dict = field(default_factory=dict)

    @property
    def first_at(self) -> Optional[str]:
        return min(self.times) if self.times else None

    @property
    def last_at(self) -> Optional[str]:
        return max(self.times) if self.times else None

    @property
    def all_closed(self) -> bool:
        """Every record was already triaged one by one (legacy pages)."""
        return self.count > 0 and not self.open_record_ids

    def add(self, record_id: Any, at: Optional[str], learner: Any, is_open: bool) -> None:
        self.count += 1
        if at:
            self.times.append(str(at))
        if learner:
            self.learner_ids.add(str(learner))
        if record_id is not None:
            self.record_ids.append(str(record_id))
            if is_open:
                self.open_record_ids.append(str(record_id))


def _collect(groups: dict, key: str, make) -> Group:
    group = groups.get(key)
    if group is None:
        group = groups[key] = make()
    return group


def group_errors(rows: Iterable[dict]) -> dict[str, Group]:
    groups: dict[str, Group] = {}
    for row in rows:
        origin = row.get("source") or ""
        level = row.get("level") or ""
        path = normalize_path(row.get("url"))
        message = normalize_message(row.get("message"))
        fp = fingerprint(origin, level, path, message)
        group = _collect(groups, fp, lambda: Group(
            source="errors", fingerprint=fp, title=_short(message or "(không có thông báo)"),
            area=" · ".join(x for x in ("Lỗi " + ("giao diện" if origin == "frontend" else "máy chủ"), path) if x),
            level=level or None,
            technical={"origin": origin, "level": level, "path": path, "message": message,
                       "sample_message": str(row.get("message") or "")[:_MESSAGE_MAX]}))
        group.add(row.get("id"), row.get("occurred_at"), row.get("user_id"), not row.get("dismissed_at"))
    return groups


def grading_kind(session: dict) -> str:
    mode = session.get("mode") or "unknown"
    part = session.get("part")
    return f"{mode}:part{part}" if part not in (None, "") else str(mode)


def _kind_label(kind: str) -> str:
    mode, _, part = kind.partition(":")
    label = KIND_LABELS.get(mode, mode)
    return f"{label} · Part {part[4:]}" if part.startswith("part") else label


def group_grading(session_errors: Iterable[dict], response_failures: Iterable[tuple[dict, dict]]) -> dict[str, Group]:
    """``session_errors``: failed sessions; ``response_failures``: (response, its session) pairs.

    Only Speaking produces these rows today, so the skill is ``speaking``.
    A session-level failure's step is ``failed_step`` (else ``error_code``);
    a response-level failure's step is ``stt`` when transcription failed,
    else ``grading``.
    """
    groups: dict[str, Group] = {}

    def add(step: str, session: dict, record_id: Any, error_code: Optional[str]) -> None:
        kind = grading_kind(session)
        fp = fingerprint("speaking", step, kind)
        group = _collect(groups, fp, lambda: Group(
            source="grading", fingerprint=fp,
            title=_short(f"Bài Speaking lỗi ở bước {step}"),
            area=f"Chấm Speaking · {_kind_label(kind)}",
            technical={"skill": "speaking", "step": step, "kind": kind, "error_codes": []}))
        if error_code and error_code not in group.technical["error_codes"]:
            group.technical["error_codes"].append(error_code)
        at = session.get("last_error_at") or session.get("started_at")
        group.add(record_id, at, session.get("user_id"), True)

    for session in session_errors:
        code = session.get("error_code") or ("grading_failed" if session.get("status") == "grading_failed" else None)
        step = session.get("failed_step") or code or "unknown"
        add(step, session, f"session:{session.get('id')}", code)
    for response, session in response_failures:
        step = "stt" if response.get("stt_status") == "failed" else "grading"
        add(step, session, f"response:{response.get('id')}", None)
    return groups


def feedback_reason(row: dict) -> Optional[str]:
    """The inbox reason of a feedback row, or None when it is not an incident."""
    kind = row.get("type")
    if kind == "flag":
        return "flag"
    if kind == "rating":
        ratings = [r for r in (row.get("rating_de"), row.get("rating_audio")) if isinstance(r, int)]
        return "rating_low" if ratings and min(ratings) <= LOW_RATING_MAX else None
    return None   # 'report' → Câu cần kiểm (T36), never a group here


def group_feedback(rows: Iterable[dict]) -> dict[str, Group]:
    groups: dict[str, Group] = {}
    for row in rows:
        reason = feedback_reason(row)
        if reason is None:
            continue
        skill = row.get("skill") or ""
        place = row.get("test_id") or ""
        fp = fingerprint(skill, place or "-", reason)
        group = _collect(groups, fp, lambda: Group(
            source="feedback", fingerprint=fp,
            title=_short(f"{FEEDBACK_REASONS[reason]} · {place or 'màn chung'}"),
            area=f"Phản hồi {SKILL_LABELS.get(skill, skill)}",
            technical={"skill": skill, "test_id": place or None, "reason": reason}))
        group.add(row.get("id"), row.get("created_at"), row.get("created_by"), row.get("status") != "resolved")
    return groups
