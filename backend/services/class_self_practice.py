"""'Tự luyện bài này' for a closed class assignment (LEARNERCORE-0063 amendment
3, T30b, FR-100, FR-101).

A class assignment that no longer takes hand-ins can still be practised on
one's own, but only on a paper that is open to public self-practice right now.
The assignment may have opened a non-public paper (``delivery_mode =
'assigned_practice'``); self-practice never borrows that right. The checks are
the public self-pick rules, read at call time:

- Listening / Reading: the paper is in the canonical public-practice catalog
  (``listening_public_practice_catalog`` / ``reading_public_practice_catalog``,
  migration 306: published, public, and no protected mock dependency without a
  valid overlap approval), the same views the public catalogs list from; plus
  audio (Listening) or a public paper code (Reading).
- Speaking: the topic is active in the topic library (``topics.is_active``),
  the same library ``POST /sessions`` draws questions from.
- No resumable class-linked attempt on that paper: opening a paper from the
  library without ``class_item`` resumes the caller's newest in-progress
  attempt even when it belongs to homework (``reading_student.
  _fetch_in_progress_payload``, by design), so a "self-practice" launch would
  continue the homework attempt instead of a separate one. That case answers
  409 ``homework_attempt_in_progress`` and the button stays hidden.
- Writing: the G08 self-practice prompt bank does not exist yet, so Writing is
  ``self_practice_unsupported``. Vocab, grammar and course have no
  self-practice path at all.

Nothing here writes. The launch parameters carry no
``class_assignment_item_id`` / ``class_item``, so the attempt or session the
learner creates is ordinary self-practice: the completion hooks never touch the
class ledger, and quota, daily caps and the one-session gate apply as for any
self-practice (FR-101), because the existing create routes enforce them.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, List, Optional, Set
from urllib.parse import quote

logger = logging.getLogger(__name__)

SUPPORTED = frozenset({"speaking", "listening", "reading"})
# Writing is a self-practice skill in the spec, but its source (G08) is not
# built yet: until then it answers like an unsupported skill.
_ID_CHUNK = 200


class SelfPracticeError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(code)
        self.status, self.code, self.message = status, code, message


UNSUPPORTED = ("self_practice_unsupported", "Bài này không có chế độ tự luyện.")
PAPER_UNAVAILABLE = ("self_practice_paper_unavailable", "Đề của bài này hiện không mở cho tự luyện.")
STILL_OPEN = ("assignment_still_open", "Bài vẫn còn nhận bài, hãy làm bài được giao.")
HOMEWORK_IN_PROGRESS = ("homework_attempt_in_progress",
                        "Bạn còn một lượt làm bài được giao đang dở trên đề này.")

_CATALOG = {"listening": "listening_public_practice_catalog",
            "reading": "reading_public_practice_catalog"}
_ATTEMPTS = {"listening": "listening_test_attempts", "reading": "reading_test_attempts"}


def _paper_is_public(row: Dict[str, Any]) -> bool:
    from routers.class_student import _paper_is_public as rule
    return rule(row)


def _chunks(ids: List[str]) -> Iterable[List[str]]:
    for i in range(0, len(ids), _ID_CHUNK):
        yield ids[i:i + _ID_CHUNK]


def _rows(db, table: str, columns: str, ids: List[str]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for chunk in _chunks(ids):
        out.extend((db.table(table).select(columns).in_("id", chunk).execute().data) or [])
    return out


def _listening_open(row: Dict[str, Any]) -> bool:
    return ((row.get("status") or "") == "published" and _paper_is_public(row)
            and bool(row.get("assembled_audio_storage_path") or row.get("full_audio_storage_path")))


def _reading_open(row: Dict[str, Any]) -> bool:
    return ((row.get("status") or "") == "published" and _paper_is_public(row)
            and bool(row.get("test_id")))


_LISTENING_COLUMNS = ("id, status, exam_only, is_public, public_practice_enabled, "
                      "full_audio_storage_path, assembled_audio_storage_path")
_READING_COLUMNS = "id, test_id, status, exam_only, is_public, public_practice_enabled"


def open_papers(db, by_skill: Dict[str, Set[str]]) -> Dict[str, Dict[str, Dict[str, Any]]]:
    """{skill: {paper_id: paper row}} for the papers open to self-practice,
    one read per skill for the whole list."""
    out: Dict[str, Dict[str, Dict[str, Any]]] = {"listening": {}, "reading": {}, "speaking": {}}
    if by_skill.get("listening"):
        for row in _rows(db, _CATALOG["listening"], _LISTENING_COLUMNS, sorted(by_skill["listening"])):
            if _listening_open(row):
                out["listening"][str(row["id"])] = row
    if by_skill.get("reading"):
        for row in _rows(db, _CATALOG["reading"], _READING_COLUMNS, sorted(by_skill["reading"])):
            if _reading_open(row):
                out["reading"][str(row["id"])] = row
    if by_skill.get("speaking"):
        for row in _rows(db, "topics", "id, title, part, is_active", sorted(by_skill["speaking"])):
            if row.get("is_active"):
                out["speaking"][str(row["id"])] = row
    return out


def papers_with_homework_attempt(db, user_id: str, skill: str, paper_ids: Iterable[str],
                                 now=None) -> Set[str]:
    """Paper ids on which `user_id` has a resumable in-progress attempt linked
    to a class item (one read for the list). `now` is the caller's clock, so the
    whole request judges expiry at one instant (None reads the real clock)."""
    from services.active_player_lifecycle import is_resume_active

    ids = sorted({str(p) for p in paper_ids if p})
    if skill not in _ATTEMPTS or not ids:
        return set()
    found: Set[str] = set()
    for chunk in _chunks(ids):
        rows = (db.table(_ATTEMPTS[skill])
                .select("id, test_id, status, resume_expires_at, class_assignment_item_id")
                .eq("user_id", user_id).eq("status", "in_progress").in_("test_id", chunk)
                .not_.is_("class_assignment_item_id", "null").execute().data) or []
        found.update(str(r["test_id"]) for r in rows
                     if r.get("class_assignment_item_id") and is_resume_active(r, now=now))
    return found


def paper_open_for_self_practice(db, rows: List[Dict[str, Any]], user_id: Optional[str] = None,
                                 now=None) -> Set[str]:
    """Item ids of `rows` (elements of `_visible_assignments`) whose paper is
    open for self-practice now. Writing rows never are (no G08 bank yet).

    `_decorate` does not return `content_id`, so the assignments are read once
    (id, skill, content_id) to find the papers."""
    ledger = [r for r in rows if (r.get("assignment") or {}).get("skill") in SUPPORTED]
    if not ledger:
        return set()
    a_ids = sorted({str(r["assignment"]["id"]) for r in ledger})
    content = {str(a["id"]): a for a in _rows(db, "class_assignments", "id, skill, content_id", a_ids)}
    by_skill: Dict[str, Set[str]] = {}
    for a in content.values():
        if a.get("skill") in SUPPORTED and a.get("content_id"):
            by_skill.setdefault(a["skill"], set()).add(str(a["content_id"]))
    papers = open_papers(db, by_skill)
    if user_id:
        for skill in _ATTEMPTS:
            for paper_id in papers_with_homework_attempt(db, user_id, skill, papers[skill], now=now):
                papers[skill].pop(paper_id, None)
    open_ids: Set[str] = set()
    for r in ledger:
        a = content.get(str(r["assignment"]["id"])) or {}
        if a.get("skill") in SUPPORTED and str(a.get("content_id") or "") in papers[a["skill"]]:
            open_ids.add(str(r["item_id"]))
    return open_ids


def launch_for(skill: str, assignment: Dict[str, Any], paper: Dict[str, Any]) -> Dict[str, Any]:
    """Self-practice launch parameters: the public self-pick entry, with no
    class item, so nothing created from it is tied to the assignment."""
    if skill == "listening":
        return {"href": f"/core-player/launch?surface=listening_test&id={quote(str(paper['id']))}"}
    if skill == "reading":
        return {"href": f"/core-player/launch?surface=reading_exam&test_id={quote(str(paper['test_id']))}"}
    cfg = assignment.get("content_config") or {}
    return {"session_params": {
        "mode": cfg.get("mode") or "practice",
        "part": cfg.get("part") or 1,
        "topic": cfg.get("topic") or paper.get("title") or "",
    }}


def self_practice(db, *, student: Dict[str, Any], item_id: str, now,
                  user_id: Optional[str] = None) -> Dict[str, Any]:
    """POST /api/class/assignments/{item_id}/self-practice. Reads only.

    Order: ownership and visibility (404), active membership of the class that
    gave it (404, the same first gate as `start_assignment`), skill (422), still
    accepting (409), paper open now (422), no resumable homework attempt on the
    paper (409). An archived class is fine: it only
    reviews and self-practises."""
    from services.class_assignment_service import is_accepting_submissions, is_assignment_open
    from services.class_membership_service import student_is_active_in_cohort

    rows = (db.table("class_assignment_items").select("id, assignment_id, student_id, submitted_at")
            .eq("id", item_id).eq("student_id", student["id"]).limit(1).execute().data) or []
    if not rows:
        writing = (db.table("writing_assignments").select("id")
                   .eq("id", item_id).eq("student_id", student["id"]).limit(1).execute().data) or []
        if writing:
            raise SelfPracticeError(422, *UNSUPPORTED)
        raise SelfPracticeError(404, "not_found", "Không tìm thấy bài tập của bạn.")
    item = rows[0]
    a_rows = (db.table("class_assignments").select("*")
              .eq("id", item["assignment_id"]).limit(1).execute().data) or []
    if not a_rows or not is_assignment_open(a_rows[0], now=now):
        raise SelfPracticeError(404, "not_found", "Không tìm thấy bài tập của bạn.")
    assignment = a_rows[0]
    if not student_is_active_in_cohort(db, student["id"], str(assignment.get("cohort_id") or ""),
                                       student.get("cohort_id")):
        raise SelfPracticeError(404, "not_found", "Bạn không còn thuộc lớp đã giao bài này.")
    skill = assignment.get("skill")
    if skill not in SUPPORTED:
        raise SelfPracticeError(422, *UNSUPPORTED)
    if is_accepting_submissions(assignment, now=now):
        raise SelfPracticeError(409, *STILL_OPEN)
    paper_id = str(assignment.get("content_id") or "")
    paper: Optional[Dict[str, Any]] = (
        open_papers(db, {skill: {paper_id}})[skill].get(paper_id) if paper_id else None)
    if not paper:
        raise SelfPracticeError(422, *PAPER_UNAVAILABLE)
    if user_id and papers_with_homework_attempt(db, user_id, skill, [paper_id], now=now):
        raise SelfPracticeError(409, *HOMEWORK_IN_PROGRESS)
    return {"skill": skill, "launch": launch_for(skill, assignment, paper)}
