"""services/student_tests.py — the Thi thử page payload (LEARNERCORE-0063 T16,
amendment 1, FR-080…FR-085).

    GET /api/student/tests?cursor= -> get_tests_concurrent(...)

Read-only. Every query filters by the caller and runs on the service role, one
worker thread per part. A part that raises lands in `degraded` and keeps its
empty default. A source owned by a package that is not merged yet (G04
credits, G08 Writing full tests, G09-T31 exam rosters) is a `_..._for` join
point; an empty answer from it is "not there yet", NOT degraded.

Release lock (HOLD FR-082): a mock sitting carries scores only once its status
is `released`, the same condition as `mock_exam_service.list_my_sittings`; the
review row is read for released sittings only, so an unreleased sitting never
puts a band, an Overall or a pending skill list into the JSON.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import urlencode

from services import student_today
from services.band_rounding import ielts_round

logger = logging.getLogger(__name__)

PAGE = 20
# Batch size of `_scan`: one page past the cursor plus room for rows that tie
# a timestamp. Ties are read by `eq(ts)` + `gt(id)`, older rows by `lt(ts)`.
_SCAN = PAGE + 1 + 20
# A source keeps reading batches until it holds the page it owes (rows it
# drops, such as drills or programme forms, do not count). The bound only
# stops a runaway read: 25 batches is about 1 000 attempts of one learner.
_MAX_BATCHES = 25
_MOCK_SCAN = 200  # a learner's own mock sittings: small, ordered here, not in SQL

_DEGRADABLE = ("assigned_exams", "results", "credits")
_BAND_SKILLS = ("listening", "reading", "writing", "speaking")
_LIVE_SITTING = ("registered", "lrw_in_progress")
_SITTING_STATE = {
    "lrw_submitted": "submitted",
    "speaking_pending": "submitted",
    "all_submitted": "grading",
    "under_review": "reviewing",
    "reviewed": "reviewing",
    "released": "released",
}
_KIND_TITLES = {"listening": "Bài Listening", "reading": "Bài Reading"}


class BadCursor(ValueError):
    """The `cursor` query value is not one this endpoint issued."""


# ── join points for other packages ────────────────────────────────────────────


def _credits_for(user_id: str) -> Optional[Dict[str, Any]]:  # G04 GET /api/me/credits
    """The same G04 reader as Today (T13), so the two pages never disagree."""
    return student_today._credits_for(user_id)


def _writing_full_tests_for(user_id: str, before: Optional[datetime]) -> List[Dict[str, Any]]:
    """G08 Writing full tests: result rows (`kind="writing_full"`), [] until G08."""
    return []


def _mock():
    # Imported lazily: mock_exam_service pulls the whole mock stack and the
    # global service-role client, which the unit tests replace.
    from services import mock_exam_service
    return mock_exam_service


# ── cursor ────────────────────────────────────────────────────────────────────


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def encode_cursor(ts: datetime, kind: str, row_id: str) -> str:
    raw = json.dumps([_iso(ts), kind, row_id], separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(value: Optional[str]) -> Optional[Tuple[datetime, str, str]]:
    if not value:
        return None
    try:
        padded = value + "=" * (-len(value) % 4)
        ts, kind, row_id = json.loads(base64.urlsafe_b64decode(padded.encode()))
        parsed = student_today._parse_ts(ts)
    except (ValueError, TypeError, binascii.Error, UnicodeDecodeError):
        raise BadCursor(value) from None
    if parsed is None or not isinstance(kind, str) or not isinstance(row_id, str):
        raise BadCursor(value)
    return parsed, kind, row_id


def _after(row: Dict[str, Any], before: Optional[Tuple[datetime, str, str]]) -> bool:
    """True when `row` sorts after the cursor in (submitted_at desc, kind, id)."""
    if before is None:
        return True
    ts, kind, row_id = before
    if row["_ts"] != ts:
        return row["_ts"] < ts
    return (row["kind"], row["id"]) > (kind, row_id)


def _sort_key(row: Dict[str, Any]) -> Tuple[float, str, str]:
    return (-row["_ts"].timestamp(), row["kind"], row["id"])


# ── results (FR-082) ──────────────────────────────────────────────────────────


def _int(value: Any) -> Optional[int]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value)


def _band(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _result(kind: str, row_id: str, title: str, ts: datetime, href: str, **extra: Any) -> Dict[str, Any]:
    base = {"kind": kind, "id": row_id, "title": title, "submitted_at": _iso(ts), "state": None,
            "band": None, "correct": None, "total": None, "pending_skills": None, "overall": None,
            "href": href, "_ts": ts}
    base.update(extra)
    return base


def _scan(make_query: Callable[[], Any], ts_col: str, before: Optional[Tuple[datetime, str, str]],
          convert: Callable[[List[Dict[str, Any]]], List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """Read one result source in keyset order (`ts_col` desc, `id`) until
    the rows it converts settle the next page.

    A batch reads the rest of the current timestamp tie group (`id` after
    the last one read), then older rows, so a group larger than a batch is
    read in full and never again. Rows `convert` drops (drills, programme
    forms, a missing Part 1) do not end the scan. It stops when the source
    is exhausted, or when PAGE + 1 rows sort after the cursor and every
    unread row is strictly older than the last of them."""

    def batch(state: Optional[Tuple[Any, Optional[str]]]) -> List[Dict[str, Any]]:
        if state is None:
            return (make_query().order(ts_col, desc=True).order("id").limit(_SCAN)
                    .execute().data or [])
        ts, last_id = state
        q = make_query().eq(ts_col, ts)
        if last_id is not None:
            q = q.gt("id", last_id)
        rows = q.order("id").limit(_SCAN).execute().data or []
        if len(rows) < _SCAN:
            rows += (make_query().lt(ts_col, ts).order(ts_col, desc=True).order("id")
                     .limit(_SCAN - len(rows)).execute().data or [])
        return rows

    out: List[Dict[str, Any]] = []
    state: Optional[Tuple[Any, Optional[str]]] = None if before is None else (_iso(before[0]), None)
    for _ in range(_MAX_BATCHES):
        rows = batch(state)
        if not rows:
            return out
        out.extend(convert(rows))
        if len(rows) < _SCAN:
            return out  # both reads came back short: the source is exhausted
        last = rows[-1]
        state = (last[ts_col], str(last["id"]))
        kept = sorted((r for r in out if _after(r, before)), key=_sort_key)
        last_ts = student_today._parse_ts(last[ts_col])
        if len(kept) > PAGE and last_ts is not None and last_ts < kept[PAGE]["_ts"]:
            return out
    logger.warning("[student_tests] %s scan stopped after %d batches", ts_col, _MAX_BATCHES)
    return out


def _self_chosen(sb, table: str, user_id: str, cols: str) -> Callable[[], Any]:
    """Submitted attempts the learner chose themselves: not a mock section
    (`sitting_id`, mig 148) and not class homework (`class_assignment_item_id`, mig 181)."""
    return lambda: (sb.table(table).select(cols).eq("user_id", user_id).eq("status", "submitted")
                    .is_("sitting_id", "null").is_("class_assignment_item_id", "null")
                    .not_.is_("submitted_at", "null"))


def _tests_by_id(sb, table: str, cols: str, ids: List[str]) -> Dict[str, Dict[str, Any]]:
    if not ids:
        return {}
    rows = sb.table(table).select(cols).in_("id", ids).execute().data or []
    return {str(r["id"]): r for r in rows}


def listening_results(sb, user_id: str, before) -> List[Dict[str, Any]]:
    from services.listening_test_grader import scored_question_count

    make = _self_chosen(sb, "listening_test_attempts", user_id,
                        "id, test_id, score, band_estimate, grading_details, submitted_at, scoring_policy")
    return _scan(make, "submitted_at", before, lambda batch: _listening_rows(sb, batch, scored_question_count))


def _listening_rows(sb, attempts: List[Dict[str, Any]], scored_question_count) -> List[Dict[str, Any]]:
    tests = _tests_by_id(sb, "listening_tests", "id, title, test_type",
                         sorted({str(a["test_id"]) for a in attempts if a.get("test_id")}))
    out = []
    for a in attempts:
        ts = student_today._parse_ts(a.get("submitted_at"))
        test = tests.get(str(a.get("test_id")))
        if ts is None or test is None or a.get("scoring_policy") == "report_only":
            continue  # programme forms are not self-chosen tests
        test_type = test.get("test_type")
        if test_type not in ("full", "mini"):
            continue  # drills are practice, not a full or mini test
        scored = scored_question_count(a.get("grading_details") or [])
        href = f"/listening/review?{urlencode({'attempt_id': str(a['id'])})}"
        title = test.get("title") or _KIND_TITLES["listening"]
        if test_type == "full":
            band = _band(a.get("band_estimate")) if scored == 40 else None
            out.append(_result("listening_full", str(a["id"]), title, ts, href, band=band))
        else:
            correct = _int(a.get("score"))
            ok = scored > 0 and correct is not None
            out.append(_result("listening_mini", str(a["id"]), title, ts, href,
                               correct=correct if ok else None, total=scored if ok else None))
    return out


def reading_results(sb, user_id: str, before) -> List[Dict[str, Any]]:
    make = _self_chosen(sb, "reading_test_attempts", user_id, "id, test_id, score, band_estimate, submitted_at")
    return _scan(make, "submitted_at", before, lambda batch: _reading_rows(sb, batch))


def _reading_rows(sb, attempts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    tests = _tests_by_id(sb, "reading_tests", "id, title, test_type, total_questions",
                         sorted({str(a["test_id"]) for a in attempts if a.get("test_id")}))
    out = []
    for a in attempts:
        ts = student_today._parse_ts(a.get("submitted_at"))
        test = tests.get(str(a.get("test_id")))
        if ts is None or test is None:
            continue
        # Papers from before mig 158 carry no test_type: they are full papers.
        test_type = test.get("test_type") or "full"
        if test_type not in ("full", "mini"):
            continue
        total = _int(test.get("total_questions"))
        href = f"/reading/review?{urlencode({'attempt_id': str(a['id'])})}"
        title = test.get("title") or _KIND_TITLES["reading"]
        if test_type == "full":
            band = _band(a.get("band_estimate")) if total == 40 else None
            out.append(_result("reading_full", str(a["id"]), title, ts, href, band=band))
        else:
            correct = _int(a.get("score"))
            ok = bool(total) and total > 0 and correct is not None
            out.append(_result("reading_mini", str(a["id"]), title, ts, href,
                               correct=correct if ok else None, total=total if ok else None))
    return out


def speaking_results(sb, user_id: str, before) -> List[Dict[str, Any]]:
    """One row per three-Part Speaking Full Test, anchored on its completed Part 3.

    The band is the rounded mean of the three Part bands, the rule of the
    Full Test result (`GET /sessions/{p1}/full-test-summary`), and only when all
    three are completed with a band; otherwise the row is still grading."""
    def make():
        return (sb.table("sessions").select("id, full_test_attempt_id, completed_at")
                .eq("user_id", user_id).eq("mode", "test_full").eq("part", 3).eq("status", "completed")
                .is_("sitting_id", "null").is_("class_assignment_item_id", "null")
                .not_.is_("completed_at", "null"))

    return _scan(make, "completed_at", before, lambda batch: _speaking_rows(sb, user_id, batch))


def _speaking_rows(sb, user_id: str, anchors: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    attempt_ids = sorted({str(a["full_test_attempt_id"]) for a in anchors if a.get("full_test_attempt_id")})
    parts: Dict[str, Dict[int, Dict[str, Any]]] = {}
    if attempt_ids:
        rows = (sb.table("sessions").select("id, part, status, overall_band, full_test_attempt_id")
                .eq("user_id", user_id).eq("mode", "test_full").in_("full_test_attempt_id", attempt_ids)
                .execute().data or [])
        for r in rows:
            parts.setdefault(str(r["full_test_attempt_id"]), {})[r.get("part")] = r
    out = []
    for a in anchors:
        ts = student_today._parse_ts(a.get("completed_at"))
        chain = parts.get(str(a.get("full_test_attempt_id")), {})
        p1 = chain.get(1)
        if ts is None or p1 is None:
            continue  # no Part 1 to open the Full Test result with
        bands = [_band((chain.get(p) or {}).get("overall_band")) for p in (1, 2, 3)]
        done = all((chain.get(p) or {}).get("status") == "completed" for p in (1, 2, 3))
        band = ielts_round(sum(bands) / 3) if done and all(b is not None for b in bands) else None
        href = f"/full-test-result?{urlencode({'session_id': str(p1['id'])})}"
        out.append(_result("speaking_full", str(p1["id"]), "Speaking Full Test", ts, href, band=band))
    return out


def _sitting_submitted_at(s: Dict[str, Any]) -> Optional[datetime]:
    stamps = [student_today._parse_ts(s.get(c)) for c in
              ("listening_submitted_at", "reading_submitted_at", "writing_submitted_at",
               "speaking_completed_at")]
    stamps = [t for t in stamps if t is not None]
    return max(stamps) if stamps else student_today._parse_ts(s.get("created_at"))


def released_scores(sitting: Dict[str, Any], final_bands: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Overall only for a sitting that set all four skills, each with a band
    (gói 5.6); `overall_readiness` is an extra gate and never lowers that bar."""
    ms = _mock()
    fb = final_bands or {}
    skills = ms.sitting_skills(sitting, fb)
    if skills is None:
        return {"pending_skills": None, "overall": None}
    pending = [s for s in skills if fb.get(s) is None]
    ready = ms.overall_readiness(fb)
    four = set(skills) == set(_BAND_SKILLS)
    overall = (_band(fb.get("overall"))
               if four and not pending and ready["banded_skill_count"] >= ready["overall_min_skills"]
               else None)
    return {"pending_skills": pending, "overall": overall}


def mock_results(sb, user_id: str, before) -> List[Dict[str, Any]]:
    sittings = (sb.table("mock_exam_sittings")
                .select("id, mock_exam_id, status, created_at, assigned_skills, listening_submitted_at, "
                        "reading_submitted_at, writing_submitted_at, speaking_completed_at")
                .eq("user_id", user_id).in_("status", list(_SITTING_STATE))
                .order("created_at", desc=True).limit(_MOCK_SCAN).execute().data or [])
    exams = _tests_by_id(sb, "mock_exams", "id, title",
                         sorted({str(s["mock_exam_id"]) for s in sittings if s.get("mock_exam_id")}))
    released_ids = [str(s["id"]) for s in sittings if s.get("status") == "released"]
    reviews: Dict[str, Dict[str, Any]] = {}
    if released_ids:  # never read the review of an unreleased sitting
        rows = (sb.table("mock_exam_reviews").select("sitting_id, final_bands")
                .in_("sitting_id", released_ids).execute().data or [])
        reviews = {str(r["sitting_id"]): r for r in rows}
    out = []
    for s in sittings:
        ts = _sitting_submitted_at(s)
        if ts is None:
            continue
        state = _SITTING_STATE[s["status"]]
        title = (exams.get(str(s.get("mock_exam_id"))) or {}).get("title") or "Mock test"
        href = f"/mock/result?{urlencode({'sitting': str(s['id'])})}"
        extra: Dict[str, Any] = {"state": state}
        if state == "released":
            extra.update(released_scores(s, (reviews.get(str(s["id"])) or {}).get("final_bands")))
        out.append(_result("mock", str(s["id"]), title, ts, href, **extra))
    return out


def build_results(sb, user_id: str, before) -> Dict[str, Any]:
    rows: List[Dict[str, Any]] = []
    for source in (listening_results, reading_results, speaking_results, mock_results):
        rows.extend(source(sb, user_id, before))
    rows.extend(_writing_full_tests_for(user_id, before[0] if before else None))
    rows = sorted((r for r in rows if _after(r, before)), key=_sort_key)
    page = rows[:PAGE]
    cursor = None
    if len(rows) > PAGE:
        last = page[-1]
        cursor = encode_cursor(last["_ts"], last["kind"], last["id"])
    return {"results": [{k: v for k, v in r.items() if k != "_ts"} for r in page],
            "results_next_cursor": cursor}


# ── assigned mock exams (FR-081) ──────────────────────────────────────────────


def build_assigned_exams(sb, user_id: str) -> List[Dict[str, Any]]:
    """Before G09-T31: open exams the learner is really assigned to, plus the
    exams of their own submitted or released sittings. `mode` stays null and
    there is no `upcoming` / `closed_missed` until the roster exists."""
    ms = _mock()
    open_rows = ms.list_open_exams(user_id)
    sittings = ms.list_my_sittings(user_id)
    done: Dict[str, Dict[str, Any]] = {}
    for s in sittings:  # newest first: keep each exam's newest finished sitting
        if s.get("status") in _LIVE_SITTING or s.get("status") not in _SITTING_STATE:
            continue
        done.setdefault(str(s.get("mock_exam_id")), s)
    exam_ids = sorted({str(e["id"]) for e in open_rows} | set(done))
    meta = _tests_by_id(sb, "mock_exams", "id, cohort_id, total_minutes", exam_ids)
    retake = {str(x) for x in ms._retake_assigned_exam_ids(user_id)}

    out: List[Dict[str, Any]] = []
    for e in open_rows:
        exam_id = str(e["id"])
        mine = e.get("my_sitting_id")
        if exam_id in done and not mine:
            continue  # already sat: the finished sitting row below stands for it
        cohort_id = (meta.get(exam_id) or {}).get("cohort_id")
        if not (mine or exam_id in retake or (cohort_id and ms._user_in_cohort(user_id, cohort_id))):
            continue  # open to everyone is not "assigned"
        href = (f"/mock-exam?{urlencode({'sitting': str(mine)})}" if mine
                else f"/mock-exam?{urlencode({'code': str(e.get('code') or '')})}")
        if not mine and not e.get("code"):
            continue
        out.append({
            "exam_id": exam_id, "title": e.get("title") or "Mock test", "mode": None, "state": "open",
            "opens_at": None, "closes_at": None,
            "skills": ms.sitting_skills({"mock_exam_id": exam_id}),
            "total_minutes": _int(e.get("total_minutes")),
            "has_sitting_in_progress": bool(mine),
            "href": href,
        })
    for exam_id, s in done.items():
        released = s.get("status") == "released"
        out.append({
            "exam_id": exam_id, "title": s.get("title") or "Mock test", "mode": None,
            "state": "released" if released else "submitted",
            "opens_at": None, "closes_at": None,
            "skills": ms.sitting_skills({"mock_exam_id": exam_id}),
            "total_minutes": _int((meta.get(exam_id) or {}).get("total_minutes")),
            "has_sitting_in_progress": False,
            "href": f"/mock/result?{urlencode({'sitting': str(s['sitting_id'])})}",
        })
    return out


# ── assembly ──────────────────────────────────────────────────────────────────


async def get_tests_concurrent(make_sb: Callable[[], Any], user_id: str, *,
                               cursor: Optional[str] = None) -> Dict[str, Any]:
    before = decode_cursor(cursor)  # BadCursor before any read
    parts: Dict[str, Callable[[], Any]] = {
        "results": lambda: build_results(make_sb(), user_id, before),
        "credits": lambda: _credits_for(user_id),
    }
    if before is None:  # "Xem thêm" pages carry only results
        parts["assigned_exams"] = lambda: build_assigned_exams(make_sb(), user_id)
    outcomes = await asyncio.gather(*(asyncio.to_thread(fn) for fn in parts.values()),
                                    return_exceptions=True)
    for outcome in outcomes:
        if isinstance(outcome, BaseException) and not isinstance(outcome, Exception):
            raise outcome
    return assemble_tests(dict(zip(parts, outcomes)))


def assemble_tests(results: Dict[str, Any]) -> Dict[str, Any]:
    degraded: List[str] = []

    def take(key: str, default: Any) -> Any:
        value = results.get(key, default)
        if isinstance(value, Exception):
            logger.warning("[tests] part %s failed: %s", key, value.__class__.__name__)
            degraded.append(key)
            return default
        return value

    page = take("results", {"results": [], "results_next_cursor": None})
    credits = take("credits", None)
    total = _int((credits or {}).get("total")) if isinstance(credits, dict) else None
    return {
        "assigned_exams": take("assigned_exams", []),
        "results": page["results"],
        "results_next_cursor": page["results_next_cursor"],
        "credits": {"total": total} if total is not None else None,
        "degraded": [key for key in _DEGRADABLE if key in degraded],
    }
