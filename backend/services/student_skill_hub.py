"""services/student_skill_hub.py — one skill hub payload (LEARNERCORE-0063 T25).

    GET /api/student/skill-hub?skill=speaking|writing|listening|reading
        -> get_skill_hub_concurrent(...)

Read-only. Homework suggestions read the learner’s submission state without
repairing the class ledger. Every query filters by the caller.
Each part runs in its own worker thread on its own service-role client; a part
that raises lands in `degraded` with its empty default (FR-118). A source that
does not exist yet returns empty and is not degraded.

Join points (one function each, FR-111..117 and plan "Hub kỹ năng"):
  _credits_for     G04 charge_plan + fn_credit_balance (Speaking, Writing only);
                   None until G04-T03 (#2485) is merged
  _resume_for      T13 resume sources for this skill + the Writing draft
  _suggestions_for course lesson (COURSELESSON-0064, not yet), assigned (T13),
                   error book (GOI-12, not yet), least practised (30 days)
  _catalog_for     the reads the skill's list page uses
  _history_for     TEMPORARY own read of submitted attempts. Replace with the
                   T16 `results` source once T16 has a PR (coordinator, 23/11).
  _starter_for     None until T25s (FR-126)
  _access_for      {blocked: False} until G04 has a per-skill rule (FR-117)
"""

from __future__ import annotations

import asyncio
import logging
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import urlencode

from services import student_today as today

logger = logging.getLogger(__name__)

SKILLS = ("speaking", "writing", "listening", "reading")
RESUME_LIMIT = 3
SUGGESTION_LIMIT = 3
HISTORY_LIMIT = 5
LEAST_PRACTISED_WINDOW = timedelta(days=30)
LEAST_PRACTISED_MIN_ATTEMPTS = 3
_PAGE = 1000

# The legacy page stays reachable behind ?view=all while the flag shows the hub
# (Speaking and Writing have no separate list or history page).
SPEAKING_ALL = "/speaking?view=all"
WRITING_ALL = "/writing/dashboard?view=all"
WRITING_BANK = "/writing/dashboard?view=all&tab=prompt-bank"

CATALOG_HREF = {
    "speaking": SPEAKING_ALL,
    "writing": WRITING_BANK,
    "listening": "/listening/tests",
    "reading": "/reading/test",
}
HISTORY_HREF = {
    "speaking": SPEAKING_ALL,
    "writing": WRITING_ALL,
    "listening": "/listening/analytics",
    "reading": "/reading/test",
}
_GRADING_FEATURE = {"speaking": "speaking_grading", "writing": "writing_grading"}
_TEST_TYPE_LABEL = {"full": "Full test", "mini": "Mini test"}
_TEST_TYPE_HREF = {
    "listening": {"full": "/listening/tests", "mini": "/listening/mini-test"},
    "reading": {"full": "/reading/test", "mini": "/reading/mini-test"},
}


def _paged(build: Callable[[], Any]) -> List[Dict[str, Any]]:
    """PostgREST caps a response at 1000 rows: read on until a short page."""
    rows: List[Dict[str, Any]] = []
    start = 0
    while True:
        batch = build().range(start, start + _PAGE - 1).execute().data or []
        rows.extend(batch)
        if len(batch) < _PAGE:
            return rows
        start += _PAGE


def _student_ids(sb, user_id: str) -> List[str]:
    return [str(r["id"]) for r in (
        sb.table("students").select("id").eq("user_id", user_id).execute().data or [])]


def _count(query) -> int:
    return int(getattr(query.limit(1).execute(), "count", None) or 0)


# ── credits (FR-111, FR-116) ──────────────────────────────────────────────────


_G04_MODULES = frozenset({"services.credits", "routers.me_access"})


def _credits_for(user_id: str, skill: str) -> Tuple[Optional[Dict[str, Any]], bool]:
    """(credits, degraded). Listening and Reading never spend credits → None."""
    feature = _GRADING_FEATURE.get(skill)
    if feature is None:
        return None, False
    try:
        from routers.me_access import fetch_credit_balance
        from services.credits import CreditUnavailable, charge_plan
    except ModuleNotFoundError as exc:
        # G04-T03 (#2485) not merged yet: no source, so no line and no
        # `degraded` (FR-118: a source that does not exist yet is empty).
        # Only those two modules missing counts; any other import failure
        # (a real bug inside them, a missing name) degrades the part.
        if exc.name in _G04_MODULES:
            return None, False
        raise

    total = int(fetch_credit_balance(user_id).get("total") or 0)  # raises → degraded, no line
    try:
        metering = "metered" if charge_plan(user_id, feature).metered else "not_metered"
    except CreditUnavailable as exc:
        logger.warning("[skill-hub] charge_plan unavailable user=%s skill=%s: %s", user_id, skill, exc)
        return {"total": total, "metering": "unknown"}, True
    return {"total": total, "metering": metering}, False


# ── resume (FR-112) ───────────────────────────────────────────────────────────

_RESUME_KINDS = {"speaking": ("speaking",), "listening": ("listening", "dictation"),
                 "reading": ("reading",), "writing": ()}


def _resume_for(sb, user_id: str, skill: str, now: datetime) -> List[Dict[str, Any]]:
    kinds = _RESUME_KINDS[skill]
    items: List[Tuple[datetime, Dict[str, Any]]] = []
    for kind, table, extra in today._RESUME_SOURCES:
        if kind not in kinds:
            continue
        rows = (
            sb.table(table)
            .select(f"id, status, started_at, resume_expires_at, {extra}")
            .eq("user_id", user_id)
            .eq("status", "in_progress")
            .gt("resume_expires_at", today._iso(now))
            .order("started_at", desc=True)
            .limit(RESUME_LIMIT)
            .execute()
        ).data or []
        if kind == "speaking":
            for r in rows:
                part = r.get("part")
                items.append(_resume_row(kind, f"Speaking Part {part}" if part else "Speaking", r,
                                         today._launch("speaking", session_id=str(r["id"]))))
            continue
        tests_table = "reading_tests" if kind == "reading" else "listening_tests"
        test_ids = sorted({str(r["test_id"]) for r in rows if r.get("test_id")})
        titles = today._titles(sb, tests_table, test_ids)
        codes = today._reading_codes(sb, test_ids) if kind == "reading" else {}
        for r in rows:
            test_id = str(r.get("test_id") or "")
            if not test_id:
                continue
            title = titles.get(test_id) or {"reading": "Bài Reading", "listening": "Bài Listening",
                                            "dictation": "Chép chính tả"}[kind]
            class_item = r.get("class_assignment_item_id")
            scope = {"class_item": str(class_item)} if class_item else {}
            if kind == "reading":
                code = codes.get(test_id)
                if not code:
                    continue  # no live paper to resume into: never a 404 link
                href = today._launch("reading_exam", test_id=code, **scope)
            elif kind == "listening":
                href = today._launch("listening_test", id=test_id, **scope)
            else:
                query = {"test_id": test_id}
                if r.get("section_num"):
                    query["section"] = str(r["section_num"])
                href = today._launch("listening_dictation", **query, **scope)
            items.append(_resume_row(kind, title, r, href))
    if skill == "writing":
        draft = _writing_draft(sb, user_id)
        if draft:
            items.append(draft)
    epoch = datetime.min.replace(tzinfo=timezone.utc)
    items.sort(key=lambda pair: pair[0] or epoch, reverse=True)
    return [item for _ts, item in items[:RESUME_LIMIT]]


def _resume_row(kind: str, title: str, row: Dict[str, Any], href: str):
    started = today._parse_ts(row.get("started_at"))
    return started, {"kind": kind, "title": title, "state": "in_progress", "href": href,
                     "updated_at": today._iso(started) if started else None}


def _writing_draft(sb, user_id: str):
    """The newest unsubmitted Writing draft. Submit deletes the draft row
    (routers/writing_student), so a row with words is unsubmitted."""
    student_ids = _student_ids(sb, user_id)
    if not student_ids:
        return None
    rows = (
        sb.table("writing_drafts").select("assignment_id, word_count, updated_at")
        .in_("student_id", student_ids).gt("word_count", 0)
        .order("updated_at", desc=True).limit(1).execute()
    ).data or []
    if not rows or not rows[0].get("assignment_id"):
        return None
    draft = rows[0]
    assignment_id = str(draft["assignment_id"])
    title = "Bản nháp Writing"
    assignment = (sb.table("writing_assignments").select("id, prompt_id, status")
                  .eq("id", assignment_id).limit(1)
                  .execute()).data or []
    if not assignment or assignment[0].get("status") in ("submitted", "graded", "delivered"):
        return None
    prompt_id = assignment[0].get("prompt_id")
    if prompt_id:
        prompt = (sb.table("writing_prompts").select("title, task_type").eq("id", prompt_id)
                  .limit(1).execute()).data or []
        if prompt:
            title = prompt[0].get("title") or today._TASK_LABELS.get(prompt[0].get("task_type"), title)
    updated = today._parse_ts(draft.get("updated_at"))
    href = f"/writing/dashboard?{urlencode({'view': 'all', 'assignment_id': assignment_id})}"
    return updated, {"kind": "writing", "title": title, "state": "draft", "href": href,
                     "updated_at": today._iso(updated) if updated else None}


# ── submitted attempts (catalog `done`, least practised, history) ─────────────


def _speaking_group(row: Dict[str, Any]) -> Optional[str]:
    if row.get("mode") == "test_full":
        return "full_test"
    part = row.get("part")
    return f"part{part}" if part in (1, 2, 3) else None


def _attempts_for(sb, user_id: str, skill: str) -> List[Dict[str, Any]]:
    """Every self-practice submission of the skill (mock sittings belong to
    Thi thử), each as {group, at, key}. `key` names the paper for `done`."""
    out: List[Dict[str, Any]] = []
    if skill == "speaking":
        rows = _paged(lambda: (
            sb.table("sessions").select("id, part, mode, topic, full_test_attempt_id, completed_at")
            .eq("user_id", user_id).eq("status", "completed").is_("sitting_id", "null")
            .order("completed_at")))
        for r in rows:
            group = _speaking_group(r)
            if group:
                key = (r.get("full_test_attempt_id") if group == "full_test" else r.get("topic")) or r["id"]
                out.append({"group": group, "at": today._parse_ts(r.get("completed_at")), "key": str(key)})
        return out
    if skill == "writing":
        student_ids = _student_ids(sb, user_id)
        if not student_ids:
            return out
        rows = _paged(lambda: (
            sb.table("writing_essays").select("id, task_type, created_at")
            .in_("student_id", student_ids).is_("deleted_at", "null").is_("sitting_id", "null")
            .order("created_at")))
        for r in rows:
            group = "task2" if r.get("task_type") == "task2" else "task1"
            out.append({"group": group, "at": today._parse_ts(r.get("created_at")), "key": str(r["id"])})
        return out
    table = f"{skill}_test_attempts"
    rows = _paged(lambda: (
        sb.table(table).select("id, test_id, submitted_at")
        .eq("user_id", user_id).eq("status", "submitted").is_("sitting_id", "null")
        .order("submitted_at")))
    types = _test_types(sb, skill, {str(r["test_id"]) for r in rows if r.get("test_id")})
    for r in rows:
        group = types.get(str(r.get("test_id") or ""))
        if group:
            out.append({"group": group, "at": today._parse_ts(r.get("submitted_at")),
                        "key": str(r["test_id"])})
    return out


def _test_types(sb, skill: str, ids) -> Dict[str, str]:
    ids = sorted(ids)
    found: Dict[str, str] = {}
    for start in range(0, len(ids), 200):
        rows = (sb.table(f"{skill}_tests").select("id, test_type")
                .in_("id", ids[start:start + 200]).execute()).data or []
        found.update({str(r["id"]): r.get("test_type") for r in rows if r.get("test_type")})
    return found


# ── catalog (FR-114) ──────────────────────────────────────────────────────────


def _catalog_groups(sb, skill: str) -> List[Dict[str, Any]]:
    """Group, label, paper count and href, read with the list page's filters.

    `keys` (internal, never sent) is the set of papers the group counts, in the
    same terms as the attempts' `key`, so `done` only counts papers that are in
    the group (FR-114): never "3 đề · đã làm 5". `keys=None` means the group
    has no paper list (Speaking full test) or attempts cannot be matched to a
    paper (Writing: an essay has no prompt id), so `done` follows that.
    """
    if skill == "speaking":
        def topics(part: int) -> set:
            return {str(r["title"]) for r in _paged(lambda: (
                sb.table("topics").select("id, title").eq("is_active", True).eq("part", part)
                .order("id"))) if r.get("title")}
        groups = []
        for p in (1, 2, 3):
            keys = topics(p)
            groups.append({"group": f"part{p}", "label": f"Part {p}", "count": len(keys),
                           "href": SPEAKING_ALL, "keys": keys})
        groups.append({"group": "full_test", "label": "Full test", "count": None, "href": "/full-test",
                       "keys": None})
        return groups
    if skill == "writing":
        from config import settings
        if not settings.WRITING_PROMPT_BANK_ENABLED:
            return []

        def prompts(task_types: List[str]) -> int:
            return _count(sb.table("writing_prompts").select("id", count="exact")
                          .eq("is_active", True).eq("exam_only", False).in_("task_type", task_types))
        # An essay carries no prompt id, so it cannot be matched to a paper:
        # `done` stays null rather than counting essays as papers (FR-114).
        return [
            {"group": "task1", "label": "Task 1", "count": prompts(["task1_academic", "task1_general"]),
             "href": WRITING_BANK, "keys": None, "no_done": True},
            {"group": "task2", "label": "Task 2", "count": prompts(["task2"]), "href": WRITING_BANK,
             "keys": None, "no_done": True},
        ]
    groups = []
    for test_type in ("full", "mini"):
        if skill == "listening":
            from routers.listening.student_fulltest import _AUDIO_READY_OR

            def build(test_type=test_type):
                return (sb.table("listening_public_practice_catalog").select("id")
                        .eq("status", "published").eq("is_public", True).or_(_AUDIO_READY_OR)
                        .eq("scoring_policy", "diagnostic").eq("test_type", test_type).order("id"))
        else:
            def build(test_type=test_type):
                return (sb.table("reading_public_practice_catalog").select("id")
                        .eq("status", "published").eq("is_public", True).eq("test_type", test_type)
                        .order("id"))
        keys = {str(r["id"]) for r in _paged(build)}
        groups.append({"group": test_type, "label": _TEST_TYPE_LABEL[test_type], "count": len(keys),
                       "href": _TEST_TYPE_HREF[skill][test_type], "keys": keys})
    return groups


_INTERNAL_GROUP_KEYS = ("keys", "no_done")


def public_group(group: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in group.items() if k not in _INTERNAL_GROUP_KEYS}


def build_catalog(groups: List[Dict[str, Any]], attempts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """`done` = distinct papers of the group the learner submitted (FR-114),
    only papers the group counts, so `done <= count` always holds."""
    has_attempts = bool(attempts)
    done: Dict[str, set] = {}
    for a in attempts:
        done.setdefault(a["group"], set()).add(a["key"])
    out = []
    for g in groups:
        papers = done.get(g["group"], set())
        if g.get("keys") is not None:
            papers = papers & g["keys"]
        value = None if (not has_attempts or g.get("no_done")) else len(papers)
        out.append({**public_group(g), "done": value})
    return out


# ── suggestions (FR-113) ──────────────────────────────────────────────────────


def _course_lesson_for(user_id: str, skill: str) -> Optional[Dict[str, Any]]:  # COURSELESSON-0064
    return None


def _error_review_for(user_id: str, skill: str) -> Optional[Dict[str, Any]]:  # GOI-12 error book
    return None


def _assigned_suggestions(rows: List[Dict[str, Any]], skill: str, now: datetime) -> List[Dict[str, Any]]:
    open_rows = [r for r in rows if not r.get("submitted_at")
                 and (r.get("assignment") or {}).get("skill") == skill]
    far = datetime.max.replace(tzinfo=timezone.utc)

    def key(r):
        due = today._parse_ts((r.get("assignment") or {}).get("due_at"))
        overdue = bool(r.get("is_missing")) or (due is not None and due < now)
        return (0 if overdue else 1, due or far, str(r.get("item_id") or ""))

    out = []
    for r in sorted(open_rows, key=key):
        assignment = r.get("assignment") or {}
        due = today._parse_ts(assignment.get("due_at"))
        if r.get("is_missing") or (due is not None and due < now):
            why = "Bài lớp giao, đã quá hạn"
        elif due is not None:
            why = f"Bài lớp giao, hạn {due.astimezone(today.VN_TZ).strftime('%d/%m')}"
        else:
            why = "Bài lớp giao, chưa nộp"
        if skill == "writing":
            href = f"/writing/dashboard?{urlencode({'view': 'all', 'assignment_id': str(r.get('item_id'))})}"
        else:
            href = "/my-class"
        out.append({"kind": "assigned", "title": assignment.get("title") or "Bài được giao",
                    "why": why, "href": href})
    return out


def _least_practised(groups: List[Dict[str, Any]], attempts: List[Dict[str, Any]],
                     now: datetime) -> Optional[Dict[str, Any]]:
    since = now - LEAST_PRACTISED_WINDOW
    recent = [a for a in attempts if a["at"] is not None and a["at"] >= since]
    if len(recent) < LEAST_PRACTISED_MIN_ATTEMPTS:
        return None
    counts = Counter(a["group"] for a in recent)
    open_groups = [g for g in groups if g.get("count") is None or g["count"] > 0]
    if not open_groups:
        return None
    pick = min(open_groups, key=lambda g: counts.get(g["group"], 0))  # ties keep catalog order
    n = counts.get(pick["group"], 0)
    why = (f"Dạng bạn làm ít nhất trong 30 ngày qua ({n} lượt)" if n
           else "Dạng bạn chưa làm trong 30 ngày qua")
    return {"kind": "least_practised", "title": pick["label"], "why": why, "href": pick["href"]}


def build_suggestions(*, course_lesson, assigned: List[Dict[str, Any]], error_review,
                      least_practised) -> List[Dict[str, Any]]:
    ordered = [s for s in ([course_lesson] + assigned + [error_review, least_practised]) if s]
    return ordered[:SUGGESTION_LIMIT]


# ── history (FR-115) — TEMPORARY until T16 `results` ──────────────────────────


def _result(band=None, correct=None, total=None, pending=False) -> Dict[str, Any]:
    return {"band": band, "correct": correct, "total": total, "pending": pending}


def _speaking_history(sb, user_id: str) -> List[Dict[str, Any]]:
    """One row per submission: the three sessions of a full test are one entry
    with the combined band (same rule as `GET /sessions/{id}/full-test-summary`:
    all parts completed with a band, mean rounded to 0.5), linked to its Part 1
    result page."""
    from routers.sessions import _round_band  # local: the router module is heavy

    cols = "id, part, mode, topic, status, completed_at, overall_band, full_test_attempt_id"
    rows = (sb.table("sessions").select(cols)
            .eq("user_id", user_id).eq("status", "completed").is_("sitting_id", "null")
            .order("completed_at", desc=True).limit(HISTORY_LIMIT * 3).execute()).data or []
    attempt_ids = sorted({str(r["full_test_attempt_id"]) for r in rows
                          if _speaking_group(r) == "full_test" and r.get("full_test_attempt_id")})
    parts_by_attempt: Dict[str, List[Dict[str, Any]]] = {}
    if attempt_ids:
        for r in (sb.table("sessions").select(cols).eq("user_id", user_id)
                  .in_("full_test_attempt_id", attempt_ids).execute()).data or []:
            parts_by_attempt.setdefault(str(r["full_test_attempt_id"]), []).append(r)
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for r in rows:
        if len(out) >= HISTORY_LIMIT:
            break
        group = _speaking_group(r)
        band = r.get("overall_band")
        if group == "full_test" and r.get("full_test_attempt_id"):
            attempt = str(r["full_test_attempt_id"])
            if attempt in seen:
                continue
            seen.add(attempt)
            parts = parts_by_attempt.get(attempt) or [r]
            part1 = next((p for p in parts if p.get("part") == 1), None)
            ready = (len(parts) == 3 and all(p.get("status") == "completed"
                                              and p.get("overall_band") is not None for p in parts))
            failed = any(p.get("status") == "analysis_failed" for p in parts)
            result = (_result(band=_round_band(sum(float(p["overall_band"]) for p in parts) / 3))
                      if ready else _result(pending=not failed))
            out.append({
                "submitted_at": max((p.get("completed_at") or "" for p in parts), default=None) or None,
                "title": "Speaking Full test", "kind": "Full test", "source": "ai_instant",
                "result": result,
                "href": (f"/full-test-result?{urlencode({'session_id': str(part1['id'])})}"
                         if part1 else None),
            })
            continue
        kind = "Full test" if group == "full_test" else (f"Part {r['part']}" if r.get("part") else "Speaking")
        out.append({
            "submitted_at": r.get("completed_at"),
            "title": r.get("topic") or f"Speaking {kind}",
            "kind": kind, "source": "ai_instant",
            "result": _result(band=float(band) if band is not None else None),
            "href": f"/result?{urlencode({'id': str(r['id'])})}",
        })
    return out


def _history_for(sb, user_id: str, skill: str) -> List[Dict[str, Any]]:
    if skill == "speaking":
        return _speaking_history(sb, user_id)
    if skill == "writing":
        student_ids = _student_ids(sb, user_id)
        if not student_ids:
            return []
        # "*" so the history still reads before migration 384 adds review_mode
        # on a database (absent column = the review flow, like NULL).
        rows = (sb.table("writing_essays").select("*")
                .in_("student_id", student_ids).is_("deleted_at", "null").is_("sitting_id", "null")
                .order("created_at", desc=True).limit(HISTORY_LIMIT).execute()).data or []
        delivered = [str(r["id"]) for r in rows if r.get("status") == "delivered"]
        bands: Dict[str, float] = {}
        if delivered:
            for fb in (sb.table("writing_feedback_current").select("essay_id, overall_band_score")
                       .in_("essay_id", delivered).execute()).data or []:
                if fb.get("overall_band_score") is not None:
                    bands[str(fb["essay_id"])] = float(fb["overall_band_score"])
        out = []
        for r in rows:
            essay_id = str(r["id"])
            label = today._TASK_LABELS.get(r.get("task_type"), "Writing")
            is_delivered = r.get("status") == "delivered"
            if is_delivered:
                result = _result(band=bands.get(essay_id))
            else:
                result = _result(pending=r.get("status") != "failed")
            out.append({
                "submitted_at": r.get("created_at"), "title": label,
                "kind": label.replace("Writing ", ""),
                # NULL review_mode is the existing class/admin-review flow (mig 384).
                "source": "ai_instant" if r.get("review_mode") == "ai_instant" else "teacher_review",
                "result": result,
                "href": f"/writing/result?{urlencode({'essay_id': essay_id})}" if is_delivered else None,
            })
        return out
    from services.listening_test_grader import scored_question_count
    rows = (sb.table(f"{skill}_test_attempts")
            .select("id, test_id, score, band_estimate, grading_details, submitted_at"
                    + (", scoring_policy" if skill == "listening" else ""))
            .eq("user_id", user_id).eq("status", "submitted").is_("sitting_id", "null")
            .order("submitted_at", desc=True).limit(HISTORY_LIMIT).execute()).data or []
    test_ids = sorted({str(r["test_id"]) for r in rows if r.get("test_id")})
    tests: Dict[str, Dict[str, Any]] = {}
    if test_ids:
        tests = {str(t["id"]): t for t in (sb.table(f"{skill}_tests").select("id, title, test_type")
                                           .in_("id", test_ids).execute()).data or []}
    out = []
    for r in rows:
        test = tests.get(str(r.get("test_id") or "")) or {}
        test_type = test.get("test_type")
        total = scored_question_count(r.get("grading_details") or []) or None
        score = r.get("score")
        result = _result()
        diagnostic = skill != "listening" or (r.get("scoring_policy") or "diagnostic") == "diagnostic"
        if (test_type == "full" and total == 40 and diagnostic
                and r.get("band_estimate") is not None):
            result = _result(band=float(r["band_estimate"]))
        elif total and score is not None:
            result = _result(correct=int(score), total=int(total))
        out.append({
            "submitted_at": r.get("submitted_at"),
            "title": test.get("title") or f"Bài {skill.capitalize()}",
            "kind": _TEST_TYPE_LABEL.get(test_type, "Bài luyện"), "source": "auto",
            "result": result,
            "href": f"/{skill}/review?{urlencode({'attempt_id': str(r['id'])})}",
        })
    return out


# ── starter, access ──────────────────────────────────────────────────────────


def _starter_for(user_id: str, skill: str) -> Optional[Dict[str, Any]]:  # T25s, FR-126
    return None


def _access_for(user_id: str, skill: str) -> Dict[str, Any]:  # G04 per-skill rule, FR-117
    return {"blocked": False}


# ── assembly ─────────────────────────────────────────────────────────────────


async def get_skill_hub_concurrent(
    make_sb: Callable[[], Any], user_id: str, skill: str, *, account_name: str = "",
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    if skill not in SKILLS:
        raise ValueError(f"unknown skill {skill!r}")
    now = now or datetime.now(timezone.utc)
    parts: Dict[str, Callable[[], Any]] = {
        "credits": lambda: _credits_for(user_id, skill),
        "resume": lambda: _resume_for(make_sb(), user_id, skill, now),
        "assigned": lambda: today._visible_assignments_for(
            user_id, account_name, now, read_only=True
        ),
        "groups": lambda: _catalog_groups(make_sb(), skill),
        "attempts": lambda: _attempts_for(make_sb(), user_id, skill),
        "history": lambda: _history_for(make_sb(), user_id, skill),
    }
    outcomes = await asyncio.gather(*(asyncio.to_thread(fn) for fn in parts.values()),
                                    return_exceptions=True)
    for outcome in outcomes:
        if isinstance(outcome, BaseException) and not isinstance(outcome, Exception):
            raise outcome
    return assemble_skill_hub(dict(zip(parts, outcomes)), user_id=user_id, skill=skill, now=now)


def assemble_skill_hub(results: Dict[str, Any], *, user_id: str, skill: str,
                       now: datetime) -> Dict[str, Any]:
    failed = set()

    def take(key: str, default: Any) -> Any:
        value = results.get(key)
        if isinstance(value, Exception):
            logger.warning("[skill-hub] part %s failed skill=%s: %s", key, skill,
                           value.__class__.__name__)
            failed.add(key)
            return default
        return value

    credits, credits_degraded = take("credits", (None, False))
    resume = take("resume", [])
    _has_class, rows, assigned_stale = take("assigned", (False, [], False))
    groups = take("groups", [])
    attempts = take("attempts", [])
    history = take("history", [])

    degraded = []
    if credits_degraded or "credits" in failed:
        degraded.append("credits")
    if "resume" in failed:
        degraded.append("resume")
    # Suggestions read the assignments, the catalog and the attempts; any of
    # them missing makes the list incomplete, so the block reports it.
    if failed & {"assigned", "groups", "attempts"} or assigned_stale:
        degraded.append("suggestions")
    if failed & {"groups", "attempts"}:
        degraded.append("catalog")
    if "history" in failed:
        degraded.append("history")

    catalog = [] if failed & {"groups", "attempts"} else build_catalog(groups, attempts)
    suggestions = build_suggestions(
        course_lesson=_course_lesson_for(user_id, skill),
        assigned=[] if assigned_stale else _assigned_suggestions(rows, skill, now),
        error_review=_error_review_for(user_id, skill),
        least_practised=(None if failed & {"groups", "attempts"}
                         else _least_practised(groups, attempts, now)),
    )
    # FR-112: the starter only when there is nothing to resume and no attempt yet.
    starter = (_starter_for(user_id, skill)
               if not resume and not history and not attempts and not failed else None)
    return {
        "skill": skill,
        "credits": credits,
        "resume": resume,
        "starter": starter,
        "suggestions": suggestions,
        "catalog": catalog,
        "catalog_href": CATALOG_HREF[skill],
        "history": history,
        "history_href": HISTORY_HREF[skill],
        "access": _access_for(user_id, skill),
        "degraded": degraded,
    }
