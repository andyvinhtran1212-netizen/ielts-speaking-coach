"""Mock exam backend 2 (MOCKORG-0086 G09-T33): timeline, extra time, room
messages, release and score edits, analysis.

Tables come from migrations 447 (``mock_exam_events``, ``extra_seconds``,
``mock_exam_room_messages``) and 448 (``released_skills``,
``mock_exam_score_edits``, ``fn_mock_exam_score_edit``). Neither is applied
anywhere yet, so every entry point sits behind the same runtime flag as the
rest of the 0086 admin backend, ``mock_exam_audiences`` (default off): turning
it on requires 445–448 on that database. ``include_partial`` has its own flag,
``mock_partial_release`` (rollout.md), because the learner pages do not read a
partial release yet.

Notifications (GOI-11) are never sent from here: the sweep reads
``mock_exam_events`` after the writer's transaction (FR-11-002).
"""
from __future__ import annotations

import logging
import statistics
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from config import settings
from database import supabase_admin
from services import mock_exam_audience_service as aud
from services import mock_exam_modes
from services import mock_exam_service as exam_svc
from services import mock_review_workflow as wf
from services import runtime_flags

logger = logging.getLogger(__name__)

AudienceError = aud.AudienceError  # one error type for the router mapping
PARTIAL_FLAG = "mock_partial_release"
SKILLS = ("listening", "reading", "writing", "speaking")
TIMED = ("listening", "reading", "writing")
EXTRA_MAX_SECONDS = 3600
EVENT_KINDS = frozenset({
    "room_opened", "room_closed", "section_started", "section_collected",
    "audience_added", "window_changed", "extra_time", "room_message",
    "released", "release_summary", "score_edited", "makeup_granted",
})
_EVENTS = "mock_exam_events"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_enabled() -> None:
    aud._require_enabled()


def _load_exam(exam_id: str) -> dict:
    exam_id = aud._uuid(exam_id)
    exam = exam_svc.get_published_exam_by_id(exam_id)
    if not exam:
        raise AudienceError("not_found", "Không tìm thấy kỳ thi.", status=404)
    return exam


def _sitting(exam_id: str, sitting_id: str) -> dict:
    sitting_id = aud._uuid(sitting_id)
    rows = (supabase_admin.table("mock_exam_sittings").select("*")
            .eq("id", sitting_id).eq("mock_exam_id", exam_id).limit(1).execute()).data or []
    if not rows:
        raise AudienceError("sitting_not_found", "Không tìm thấy lượt thi này trong kỳ thi.",
                            status=404)
    return rows[0]


# --- timeline ---------------------------------------------------------------

def record_event(exam_id: str, kind: str, payload: Optional[dict] = None, *,
                 actor_id: Optional[str] = None, sitting_id: Optional[str] = None) -> dict:
    """Append one timeline row. Raises on failure; callers that only annotate an
    action that already happened use :func:`record_event_quietly`."""
    if kind not in EVENT_KINDS:
        raise ValueError(f"unknown mock exam event kind {kind!r}")
    row = {"exam_id": str(exam_id), "kind": kind, "payload": payload or {},
           "actor_id": actor_id, "sitting_id": sitting_id}
    res = supabase_admin.table(_EVENTS).insert(row).execute()
    return (res.data or [row])[0]


def record_event_quietly(exam_id: str, kind: str, payload: Optional[dict] = None, *,
                         actor_id: Optional[str] = None, sitting_id: Optional[str] = None) -> bool:
    """Annotate an action that has already been committed (open, advance,
    collect, audience change). With the flag off nothing is written (447 may be
    missing). A failure is logged, never raised: the exam action itself stands,
    and the log line names the gap in the timeline."""
    try:
        if not aud.enabled():
            return False
        record_event(exam_id, kind, payload, actor_id=actor_id, sitting_id=sitting_id)
        return True
    except Exception:  # noqa: BLE001 — the timeline must not undo a committed action
        logger.exception("[mock-events] timeline write failed exam=%s kind=%s", exam_id, kind)
        return False


def list_events(exam_id: str, kinds: Optional[Iterable[str]] = None, limit: int = 200) -> dict:
    _require_enabled()
    exam = _load_exam(exam_id)
    wanted = [k for k in (kinds or []) if k]
    bad = [k for k in wanted if k not in EVENT_KINDS]
    if bad:
        raise AudienceError("invalid_kind", f"Loại sự kiện không hợp lệ: {', '.join(bad)}.")
    q = (supabase_admin.table(_EVENTS)
         .select("id, sitting_id, kind, payload, actor_id, created_at")
         .eq("exam_id", exam["id"]))
    if wanted:
        q = q.in_("kind", wanted)
    rows = q.order("created_at", desc=True).limit(max(1, min(int(limit), 500))).execute().data or []
    names = wf.resolve_display_names({r["actor_id"] for r in rows if r.get("actor_id")})
    return {"items": [{**r, "actor_name": names.get(str(r.get("actor_id"))) if r.get("actor_id") else None}
                      for r in rows]}


# --- extra time (FR-146, plan 5.5 point 8) -----------------------------------

def add_extra_time(exam_id: str, sitting_id: str, section: str, seconds: int,
                   reason: str, actor_id: Optional[str]) -> dict:
    """Give one person extra time on the section they are running now.

    Self-paced only. A live room is collected for everyone at once by
    ``collect``, which does not skip a person with extra time, and tasks.md T33
    says not to rewrite ``collect`` here: live returns 409
    ``live_extra_time_unsupported`` (raised with the coordinator, 23/11)."""
    _require_enabled()
    reason = (reason or "").strip()
    if len(reason) < 3:
        raise AudienceError("reason_required", "Cần ghi lý do cộng giờ.")
    if section not in TIMED:
        raise AudienceError("invalid_section", "Chỉ cộng giờ cho Listening, Reading hoặc Writing.")
    try:
        seconds = int(seconds)
    except (TypeError, ValueError):
        raise AudienceError("invalid_seconds", "Số giây cộng thêm không hợp lệ.") from None
    if not 1 <= seconds <= EXTRA_MAX_SECONDS:
        raise AudienceError("invalid_seconds",
                            f"Số giây cộng thêm phải từ 1 đến {EXTRA_MAX_SECONDS}.")
    exam = _load_exam(exam_id)
    if not mock_exam_modes.is_self_paced(exam.get("exam_mode")):
        raise AudienceError("live_extra_time_unsupported",
                            "Phòng thi cùng giờ chưa cộng giờ riêng được: thu bài cả phòng "
                            "chưa bỏ qua người còn giờ cộng.", status=409)
    sitting = _sitting(exam["id"], sitting_id)
    if sitting.get("status") == "void":
        raise AudienceError("section_not_running", "Lượt thi đã huỷ.", status=409)
    skills = mock_exam_modes.sitting_sections(sitting, exam)
    durations = {s: exam_svc._section_duration_seconds(exam, s) for s in skills}
    timeline = mock_exam_modes.self_paced_timeline(
        sitting, exam, _now(), durations=durations,
        gap_seconds=settings.MOCK_SELF_PACED_GAP_SECONDS,
        open_until=sitting.get("retake_open_until"))
    if timeline.state != mock_exam_modes.IN_PROGRESS or timeline.current_section != section:
        raise AudienceError("section_not_running",
                            "Chỉ cộng giờ cho phần người này đang làm.", status=409,
                            current_section=timeline.current_section)
    before = dict(sitting.get("extra_seconds") or {})
    after = {**before, section: int(before.get(section) or 0) + seconds}
    # Compare-and-set on the value read, so two proctors adding at once do not
    # lose one of the additions.
    res = (supabase_admin.table("mock_exam_sittings").update({"extra_seconds": after})
           .eq("id", sitting["id"]).eq("extra_seconds", before).execute())
    if not (res.data or []):
        raise AudienceError("extra_time_conflict",
                            "Giờ cộng của người này vừa thay đổi; tải lại rồi thử lại.", status=409)
    logged = record_event_quietly(exam["id"], "extra_time",
                                  {"section": section, "seconds": seconds, "reason": reason,
                                   "total_seconds": after[section]},
                                  actor_id=actor_id, sitting_id=sitting["id"])
    return {"sitting_id": sitting["id"], "extra_seconds": after, "event_logged": logged}


# --- room messages (FR-146) ---------------------------------------------------

def send_room_message(exam_id: str, body: str, actor_id: Optional[str]) -> dict:
    _require_enabled()
    body = (body or "").strip()
    if not 1 <= len(body) <= 500:
        raise AudienceError("invalid_body", "Tin nhắn phải có từ 1 đến 500 ký tự.")
    exam = _load_exam(exam_id)
    if not mock_exam_modes.is_live(exam.get("exam_mode")):
        raise AudienceError("live_only", "Chỉ nhắn được trong phòng thi cùng giờ.", status=409)
    if not exam.get("is_open"):
        raise AudienceError("room_closed", "Phòng thi chưa mở.", status=409)
    row = (supabase_admin.table("mock_exam_room_messages")
           .insert({"exam_id": exam["id"], "body": body, "sent_by": actor_id})
           .execute()).data or []
    msg = row[0] if row else {"exam_id": exam["id"], "body": body}
    logged = record_event_quietly(exam["id"], "room_message", {"body": body, "message_id": msg.get("id")},
                                  actor_id=actor_id)
    return {**msg, "event_logged": logged}


# --- release (FR-148) ---------------------------------------------------------

def _release_summary(exam_id: str, request_key: str) -> Optional[dict]:
    rows = (supabase_admin.table(_EVENTS).select("kind, payload")
            .eq("exam_id", exam_id).in_("kind", ["released", "release_summary"])
            .eq("payload->>request_key", request_key).execute()).data or []
    if not rows:
        return None
    for r in rows:
        if r["kind"] == "release_summary":
            p = r.get("payload") or {}
            return {"released": p.get("released", 0), "partial": p.get("partial", 0),
                    "skipped": p.get("skipped", 0), "skipped_items": p.get("skipped_items", []),
                    "replayed": True}
    raise AudienceError("release_in_progress",
                        "Lần trả kết quả với mã yêu cầu này đang chạy hoặc đã dừng giữa chừng; "
                        "tải lại trang để xem kết quả rồi trả lại với yêu cầu mới.", status=409)


def _final_skills(review: Optional[dict]) -> list[str]:
    bands = (review or {}).get("final_bands") or {}
    return [s for s in SKILLS if bands.get(s) is not None]


def release(exam_id: str, mode: str, confirm_title: str, request_key: str,
            actor_id: str) -> dict:
    """Hand results back for the whole exam.

    ``complete_only`` releases exactly the sittings the existing ``bulk-release``
    would (review ``reviewed``, claimed by this admin, Writing done): a learner
    without a Speaking band, or one who never sat (``missed``), is skipped.
    ``include_partial`` (flag ``mock_partial_release``) also writes
    ``released_skills`` for the rest: the skills that already have a final band.

    Idempotent per ``request_key``: the first call claims the key with a
    ``released`` event (unique index, 448) and ends with a ``release_summary``
    event; a repeat returns that summary."""
    _require_enabled()
    if mode not in ("complete_only", "include_partial"):
        raise AudienceError("invalid_mode", "Cách trả kết quả không hợp lệ.")
    key = (request_key or "").strip()
    if not 8 <= len(key) <= 80:
        raise AudienceError("invalid_request_key", "Thiếu mã yêu cầu hợp lệ.")
    exam = _load_exam(exam_id)
    if (confirm_title or "").strip() != (exam.get("title") or "").strip():
        raise AudienceError("confirm_mismatch", "Tên kỳ thi gõ lại không khớp.")
    if mode == "include_partial" and not runtime_flags.is_enabled(PARTIAL_FLAG, default=False,
                                                                   on_error=False):
        raise AudienceError("partial_release_disabled",
                            "Chưa bật trả từng phần (cờ mock_partial_release).", status=409)
    unavailable = AudienceError("release_unavailable",
                                "Không ghi được nhật ký trả kết quả; chưa trả gì.", status=503)
    try:
        replay = _release_summary(exam["id"], key)
    except AudienceError:
        raise
    except Exception:
        logger.exception("[mock-release] timeline read failed exam=%s", exam["id"])
        raise unavailable from None
    if replay is not None:
        return replay
    try:
        record_event(exam["id"], "released", {"request_key": key, "mode": mode}, actor_id=actor_id)
    except Exception:
        # Lost the race to the same key, or the timeline is down: either way,
        # nothing has been released by this call.
        try:
            replay = _release_summary(exam["id"], key)
        except AudienceError:
            raise
        except Exception:
            replay = None
        if replay is not None:
            return replay
        raise unavailable from None

    sittings = (supabase_admin.table("mock_exam_sittings")
                .select("id, status, released_skills").eq("mock_exam_id", exam["id"])
                .neq("status", "void").execute()).data or []
    reviews = {}
    for s in sittings:
        reviews[s["id"]] = wf.get_review_for_sitting(s["id"])
    ready = [s["id"] for s in sittings
             if (reviews.get(s["id"]) or {}).get("status") == "reviewed"]
    already = {s["id"] for s in sittings if (reviews.get(s["id"]) or {}).get("status") == "released"}
    out = wf.bulk_release_sittings(ready, actor_id) if ready else {"released": [], "skipped": []}
    released = set(out["released"])
    skipped_items = list(out["skipped"])
    partial = 0
    for s in sittings:
        sid = s["id"]
        if sid in released or sid in already or sid in ready:
            continue
        skills = _final_skills(reviews.get(sid))
        if mode != "include_partial" or not skills:
            skipped_items.append({"sitting_id": sid, "reason": "Chưa đủ điểm để trả."})
            continue
        merged = sorted(set(s.get("released_skills") or []) | set(skills), key=SKILLS.index)
        try:
            supabase_admin.table("mock_exam_sittings").update({"released_skills": merged}) \
                .eq("id", sid).neq("status", "void").execute()
            partial += 1
        except Exception as e:  # noqa: BLE001 — report per sitting, like bulk-release
            logger.exception("[mock-release] partial release failed sitting=%s", sid)
            skipped_items.append({"sitting_id": sid, "reason": f"Lỗi: {e}"})
    summary = {"released": len(released), "partial": partial, "skipped": len(skipped_items),
               "skipped_items": skipped_items}
    record_event_quietly(exam["id"], "release_summary",
                         {"request_key": key, "mode": mode, **summary}, actor_id=actor_id)
    return {**summary, "replayed": False}


# --- score edit after release (FR-148) ----------------------------------------

def score_edit(sitting_id: str, skill: str, new_band: Any, reason: str, actor_id: str) -> dict:
    _require_enabled()
    reason = (reason or "").strip()
    if len(reason) < 3:
        raise AudienceError("reason_required", "Cần ghi lý do sửa điểm.")
    if skill not in SKILLS:
        raise AudienceError("invalid_skill", "Kỹ năng không hợp lệ.")
    try:
        band = wf._coerce_band(new_band)
    except wf.ValidationError:
        raise AudienceError("invalid_band", "Band phải từ 0 đến 9.") from None
    if band * 2 != int(band * 2):
        raise AudienceError("invalid_band", "Band phải theo bước 0,5.")
    sitting_id = aud._uuid(sitting_id)
    rows = (supabase_admin.table("mock_exam_sittings").select("id, mock_exam_id, status")
            .eq("id", sitting_id).limit(1).execute()).data or []
    if not rows:
        raise AudienceError("sitting_not_found", "Không tìm thấy lượt thi.", status=404)
    review = wf.get_review_for_sitting(sitting_id)
    if not review or review.get("status") != "released":
        raise AudienceError("not_released", "Chỉ sửa điểm sau khi đã trả kết quả.", status=409)
    old = dict(review.get("final_bands") or {})
    if old.get(skill) is None:
        raise AudienceError("skill_not_banded", "Kỹ năng này chưa có band để sửa.", status=409)
    new = {**old, skill: band}
    banded = tuple(s for s in SKILLS if new.get(s) is not None)
    required = tuple(wf.required_skills_for_sitting(sitting_id))
    new["overall"] = (None if any(new.get(s) is None for s in required)
                      else wf.compute_overall(new, banded))
    try:
        res = supabase_admin.rpc("fn_mock_exam_score_edit", {
            "p_exam_id": rows[0]["mock_exam_id"], "p_sitting_id": sitting_id, "p_skill": skill,
            "p_reason": reason, "p_actor_id": actor_id, "p_expected": old, "p_new": new,
        }).execute()
    except Exception as e:
        if "mock_score_edit_conflict" in str(e):
            raise AudienceError("score_edit_conflict",
                                "Điểm vừa được sửa ở nơi khác; tải lại rồi thử lại.", status=409) from None
        raise
    return {"sitting_id": sitting_id, "skill": skill, "old_band": old.get(skill),
            "new_band": band, "final_bands": (res.data or {}).get("final_bands", new)}


# --- analysis (FR-147) ----------------------------------------------------------

def _min_papers() -> Optional[int]:
    """``band_dist_min_papers`` (ops thresholds, migration 440); None hides."""
    from services import ops_thresholds
    try:
        values = ops_thresholds._resolve(ops_thresholds._read_stored())
    except Exception:  # noqa: BLE001 — unknown threshold reads as "do not show"
        logger.exception("[mock-analysis] thresholds unavailable")
        return None
    return values.get("band_dist_min_papers")


def _distribution(bands: list[float]) -> list[dict]:
    counts: dict[float, int] = {}
    for b in bands:
        counts[b] = counts.get(b, 0) + 1
    return [{"band": b, "count": counts[b]} for b in sorted(counts)]


_TOP_WRONG = 10
_ATTEMPT = {"listening": ("listening_attempt_id", "listening_test_attempts"),
            "reading": ("reading_attempt_id", "reading_test_attempts")}
_CRITERIA = ("band_main_criterion", "band_coherence_cohesion", "band_lexical_resource",
             "band_grammatical_range")


def _live_key(skill: str, test_id: str) -> list[dict]:
    """The current answer key of a test (same loading as the sweep graders)."""
    if skill == "reading":
        from services import reading_test_grader as grader
        passages = (supabase_admin.table("reading_passages").select("id, passage_order")
                    .eq("test_id", test_id).eq("library", "l3_test").execute().data or [])
        order = {p["id"]: p.get("passage_order") for p in passages}
        rows = (supabase_admin.table("reading_questions")
                .select("q_num,question_type,prompt,payload,answer,skill_tag,explanation,passage_id")
                .in_("passage_id", list(order)).execute().data if order else []) or []
        return grader.collect_answer_key(rows, order)
    from services import listening_test_grader as grader
    ids = [r["id"] for r in (supabase_admin.table("listening_content").select("id")
                             .eq("test_id", test_id).execute().data or [])]
    rows = (supabase_admin.table("listening_exercises").select("payload")
            .in_("content_id", ids).execute().data if ids else []) or []
    return grader.collect_answer_key(rows)


def _question_types(skill: str, attempt: dict, cache: dict) -> dict:
    """q_num → question type of the paper this attempt was marked on: the
    frozen key when the attempt has one (mock_paper_policy), else the test's
    current key. Reading: ``question_type``; Listening: ``template_kind``."""
    field = "question_type" if skill == "reading" else "template_kind"
    ck = (skill, attempt.get("test_id"), attempt.get("paper_revision"), attempt.get("policy_revision"))
    if ck not in cache:
        from services.mock_paper_policy import frozen_answer_key
        key = None
        try:
            key = frozen_answer_key(supabase_admin, skill, attempt)
        except Exception:  # noqa: BLE001 — fall back to the live key, never fail the card
            logger.exception("[mock-analysis] frozen key unavailable attempt=%s", attempt.get("id"))
        if key is None and attempt.get("test_id"):
            live = ("live", skill, attempt["test_id"])
            if live not in cache:
                cache[live] = _live_key(skill, attempt["test_id"])
            key = cache[live]
        cache[ck] = {k.get("q_num"): k.get(field) for k in (key or []) if k.get("q_num") is not None}
    return cache[ck]


def _question_stats(sittings: list[dict]) -> tuple[dict, dict]:
    """``top_wrong`` and ``by_question_type`` for Listening and Reading from
    the per-question marking each attempt stored (``grading_details``).
    Self-check rows (``correct`` null) are not marked and are left out. A skill
    with no marked attempt is null."""
    top: dict[str, Optional[list]] = {}
    types: dict[str, Optional[list]] = {}
    cache: dict = {}
    for skill, (col, table) in _ATTEMPT.items():
        ids = [s[col] for s in sittings if s.get(col)]
        attempts = []
        for i in range(0, len(ids), 100):
            attempts += (supabase_admin.table(table)
                         .select("id, test_id, status, grading_details, paper_revision, policy_revision")
                         .in_("id", ids[i:i + 100]).execute().data or [])
        per_q: dict = {}
        per_type: dict = {}
        marked = 0
        for a in attempts:
            rows = [r for r in (a.get("grading_details") or []) if r.get("correct") is not None]
            if a.get("status") != "submitted" or not rows:
                continue
            marked += 1
            qtypes = _question_types(skill, a, cache)
            for r in rows:
                q = r.get("q_num")
                slot = per_q.setdefault(q, {"q_num": q, "attempted": 0, "wrong": 0, "blank": 0,
                                            "expected": r.get("expected"), "answers": {}})
                slot["attempted"] += 1
                answer = str(r.get("user_answer") or "").strip()
                if not r.get("correct"):
                    slot["wrong"] += 1
                    if answer:
                        slot["answers"][answer] = slot["answers"].get(answer, 0) + 1
                    else:
                        slot["blank"] += 1
                qtype = qtypes.get(q) or "unknown"
                t = per_type.setdefault(qtype, {"question_type": qtype, "correct": 0, "total": 0})
                t["total"] += 1
                t["correct"] += 1 if r.get("correct") else 0
        if not marked:
            top[skill] = types[skill] = None
            continue
        ranked = sorted((v for v in per_q.values() if v["wrong"]),
                        key=lambda v: (-v["wrong"] / v["attempted"], -v["wrong"], v["q_num"] or 0))
        out = []
        for v in ranked[:_TOP_WRONG]:
            answers = v.pop("answers")
            common = max(answers.items(), key=lambda kv: (kv[1], kv[0])) if answers else None
            out.append({**v, "wrong_rate": round(v["wrong"] / v["attempted"], 3),
                        "top_wrong_answer": ({"answer": common[0], "count": common[1]}
                                             if common else None)})
        top[skill] = out
        types[skill] = sorted(
            ({**t, "rate": round(t["correct"] / t["total"], 3)} for t in per_type.values()),
            key=lambda t: (t["rate"], t["question_type"]))
    return top, types


def _writing_criteria(sittings: list[dict]) -> Optional[dict]:
    """Median of each Writing criterion per task over graded essays; null
    when no essay of this exam has feedback."""
    out: dict = {}
    for task, col in (("task1", "essay_task1_id"), ("task2", "essay_task2_id")):
        ids = [s[col] for s in sittings if s.get(col)]
        rows = []
        for i in range(0, len(ids), 100):
            rows += (supabase_admin.table("writing_feedback").select("essay_id, " + ", ".join(_CRITERIA))
                     .in_("essay_id", ids[i:i + 100]).execute().data or [])
        if not rows:
            out[task] = None
            continue
        out[task] = {"essays": len(rows)}
        for c in _CRITERIA:
            vals = [float(r[c]) for r in rows if r.get(c) is not None]
            out[task][c.removeprefix("band_")] = statistics.median(vals) if vals else None
    return out if any(out.values()) else None


def _banded(review: Optional[dict], skill: str) -> Optional[float]:
    if not review or review.get("status") not in ("reviewed", "released"):
        return None
    value = (review.get("final_bands") or {}).get(skill)
    return float(value) if value is not None else None


def _vs_previous(exam: dict, sittings: list[dict], reviews: dict) -> Optional[dict]:
    """The latest earlier exam (by ``created_at``) that shares at least one
    learner with this one, compared on those shared learners only: median band
    per skill there and here, and the difference. Null when there is none."""
    users = {s["user_id"] for s in sittings if s.get("user_id")}
    if not users or not exam.get("created_at"):
        return None
    other = []
    ulist = sorted(users)
    for i in range(0, len(ulist), 100):
        other += (supabase_admin.table("mock_exam_sittings").select("id, mock_exam_id, user_id, status")
                  .in_("user_id", ulist[i:i + 100]).neq("mock_exam_id", exam["id"])
                  .neq("status", "void").execute().data or [])
    if not other:
        return None
    exam_ids = sorted({o["mock_exam_id"] for o in other})
    exams = (supabase_admin.table("mock_exams").select("id, title, created_at")
             .in_("id", exam_ids).execute().data or [])
    earlier = sorted((e for e in exams if e.get("created_at") and e["created_at"] < exam["created_at"]),
                     key=lambda e: e["created_at"], reverse=True)
    for prev in earlier:
        theirs = {o["user_id"]: o for o in other if o["mock_exam_id"] == prev["id"]}
        prev_reviews = {uid: wf.get_review_for_sitting(o["id"]) for uid, o in theirs.items()}
        here = {s["user_id"]: reviews.get(s["id"]) for s in sittings if s.get("user_id") in theirs}
        skills = {}
        for skill in SKILLS:
            pairs = [(_banded(prev_reviews.get(u), skill), _banded(r, skill)) for u, r in here.items()]
            pairs = [(a, b) for a, b in pairs if a is not None and b is not None]
            if pairs:
                before = statistics.median(a for a, _ in pairs)
                now = statistics.median(b for _, b in pairs)
                skills[skill] = {"learners": len(pairs), "previous_median": before,
                                 "median": now, "delta": round(now - before, 2)}
        if skills:
            return {"exam_id": prev["id"], "title": prev.get("title"),
                    "shared_learners": len(here), "skills": skills}
    return None


def analysis(exam_id: str) -> dict:
    """FR-147: band distribution per skill (shown only from
    ``band_dist_min_papers`` graded papers; a null threshold shows none),
    medians, per-sitting pacing, the questions most often wrong and the rate
    per question type (Listening/Reading), the Writing criterion medians, and
    the comparison with the previous exam of the same learners. No overall
    band here (FR-147). A part that could not be read is null and named in
    ``sources_failed``, so the page never shows a gap as "nothing wrong"."""
    _require_enabled()
    exam = _load_exam(exam_id)
    sittings = (supabase_admin.table("mock_exam_sittings")
                .select("id, user_id, status, listening_attempt_id, reading_attempt_id, "
                        "essay_task1_id, essay_task2_id")
                .eq("mock_exam_id", exam["id"]).neq("status", "void").execute()).data or []
    by_sitting = {s["id"]: wf.get_review_for_sitting(s["id"]) for s in sittings}
    reviews = list(by_sitting.values())
    threshold = _min_papers()
    dist: dict[str, Optional[list]] = {}
    medians: dict[str, Optional[float]] = {}
    for skill in SKILLS:
        bands = [float(r["final_bands"][skill]) for r in reviews
                 if r and r.get("status") in ("reviewed", "released")
                 and (r.get("final_bands") or {}).get(skill) is not None]
        dist[skill] = (_distribution(bands) if threshold is not None and len(bands) >= threshold
                       else None)
        medians[skill] = statistics.median(bands) if bands else None
    names = wf.resolve_display_names({s["user_id"] for s in sittings if s.get("user_id")})
    pacing = []
    for s in sittings:
        try:
            p = exam_svc.sitting_pacing(s["id"])
        except Exception:  # noqa: BLE001 — one sitting's pacing must not hide the rest
            logger.exception("[mock-analysis] pacing failed sitting=%s", s["id"])
            p = None
        pacing.append({"sitting_id": s["id"], "name": names.get(str(s.get("user_id"))),
                       "pacing": p})
    failed: list[str] = []

    def guarded(name, fn, *args, default=None):
        try:
            return fn(*args)
        except Exception:  # noqa: BLE001 — one source must not hide the rest of the card
            logger.exception("[mock-analysis] %s failed exam=%s", name, exam["id"])
            failed.append(name)
            return default

    top_wrong, by_type = guarded("question_stats", _question_stats, sittings, default=(None, None))
    return {
        "band_dist_min_papers": threshold,
        "band_distribution": dist,
        "band_median": medians,
        "top_wrong": top_wrong,
        "by_question_type": by_type,
        "pacing": pacing,
        "vs_previous": guarded("vs_previous", _vs_previous, exam, sittings, by_sitting),
        "writing_criteria_median": guarded("writing_criteria", _writing_criteria, sittings),
        "sources_failed": failed,
    }


def idle_threshold_minutes() -> Optional[int]:
    """``exam_idle_minutes`` for the live tab (ops thresholds, default 5)."""
    from services import ops_thresholds
    try:
        return ops_thresholds._resolve(ops_thresholds._read_stored()).get("exam_idle_minutes")
    except Exception:  # noqa: BLE001 — the threshold is advisory on the live tab
        logger.exception("[mock-live] thresholds unavailable")
        return None
