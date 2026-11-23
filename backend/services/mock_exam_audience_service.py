"""Who sits a mock exam (MOCKORG-0086 plan 5.5, G09-T31 PR1).

``mock_exam_audiences`` (migration 445) holds one row per (exam, student,
purpose). Classes, single learners and (later) saved groups add up into it;
the first source that brought a learner in is kept. Adding a class snapshots
its roster at that moment (Q12 default); "Cập nhật theo lớp" re-reads the
classes already on the list and adds only the learners who joined since (Q12
button, approved separately 23/11 11:14Z).

Everything here sits behind the runtime flag ``mock_exam_audiences`` (default
off): 445 is not applied anywhere yet, so with the flag off nothing reads or
writes the table and the old cohort/assignment paths are unchanged.

Dual write (plan 5.5 point 3): on a self-paced exam the list is mirrored into
``mock_exam_assignments`` through the existing assignment service when the
exam is scheduled, and on every change after that, so the current learner
path keeps working until G08-T22 reads audiences directly.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Iterable, Optional
from uuid import UUID

from database import supabase_admin
from services import class_membership_service as membership
from services import mock_exam_assignment_service as assign_svc
from services import mock_exam_modes
from services import mock_exam_service as exam_svc
from services import runtime_flags

logger = logging.getLogger(__name__)

FLAG = "mock_exam_audiences"
LEARNER_GATE_FLAG = "mock_exam_audiences_learner"
ALL_SKILLS = ("listening", "reading", "writing", "speaking")
# Skills the self-paced assignment path can serve (no Speaking, see
# mock_exam_assignment_service).
_ASSIGNABLE = ("listening", "reading", "writing")
_TABLE = "mock_exam_audiences"
_COLUMNS = ("id, exam_id, user_id, student_id, source_kind, source_cohort_id, source_group_id, "
            "skills, selected, excluded_reason, open_from, open_until, purpose, added_at")
_ID_CHUNK = 100


class AudienceError(Exception):
    """A refusal with a stable code for the API (status picked by the router)."""

    def __init__(self, code: str, message: str, *, status: int = 422, **extra: Any):
        super().__init__(message)
        self.code, self.message, self.status, self.extra = code, message, status, extra


def enabled() -> bool:
    # A flag lookup error disables: the table may not exist (445 unapplied).
    return runtime_flags.is_enabled(FLAG, default=False, on_error=False)


def learner_gate_enabled() -> bool:
    return runtime_flags.is_enabled(LEARNER_GATE_FLAG, default=False, on_error=False)


def _require_enabled() -> None:
    if not enabled():
        raise AudienceError("audiences_disabled",
                            "Danh sách người thi mới chưa bật (cờ mock_exam_audiences).",
                            status=409)


def _uuid(value: Any) -> str:
    try:
        return str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise AudienceError("invalid_id", f"Mã không hợp lệ: {value!r}.") from None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def exam_skills(exam: dict) -> list[str]:
    """The exam's skills in fixed order; NULL means all four (as before 445)."""
    chosen = set(exam.get("skills") or ALL_SKILLS)
    return [s for s in ALL_SKILLS if s in chosen]


def _load_exam(exam_id: str) -> dict:
    exam = exam_svc.get_published_exam_by_id(exam_id)
    if not exam:
        raise AudienceError("not_found", "Không tìm thấy kỳ thi.", status=404)
    if exam.get("status") == "archived":
        raise AudienceError("exam_locked", "Kỳ thi đã lưu trữ, không sửa người thi được.",
                            status=409)
    return exam


def _rows(exam_id: str) -> list[dict]:
    return membership._paged(lambda: supabase_admin.table(_TABLE).select(_COLUMNS)
                             .eq("exam_id", exam_id).eq("purpose", "main"))


def _students(ids: Iterable[str]) -> dict[str, dict]:
    ids = list(dict.fromkeys(str(i) for i in ids if i))
    out: dict[str, dict] = {}
    for offset in range(0, len(ids), _ID_CHUNK):
        chunk = ids[offset:offset + _ID_CHUNK]
        for row in membership._paged(lambda c=chunk: supabase_admin.table("students")
                                     .select("id, user_id, full_name").in_("id", c)):
            out[str(row["id"])] = row
    return out


def _cohort_labels(ids: Iterable[str]) -> dict[str, str]:
    ids = [i for i in dict.fromkeys(str(i) for i in ids if i)]
    if not ids:
        return {}
    rows = supabase_admin.table("cohorts").select("id, name").in_("id", ids).execute().data or []
    return {str(r["id"]): r.get("name") or "" for r in rows}


def _cohort_roster(cohort_id: str) -> list[dict]:
    return membership.active_students_for_cohort(supabase_admin, cohort_id,
                                                 "id, user_id, full_name")


def _new_row(exam: dict, student: dict, *, kind: str, cohort_id: Optional[str],
             actor_id: str, window: dict) -> dict:
    has_account = bool(student.get("user_id"))
    return {
        "exam_id": str(exam["id"]),
        "user_id": str(student["user_id"]) if has_account else None,
        "student_id": str(student["id"]),
        "source_kind": kind,
        "source_cohort_id": cohort_id if kind == "cohort" else None,
        "source_group_id": None,
        "skills": exam_skills(exam),
        "selected": has_account,
        "excluded_reason": None if has_account else "no_account",
        "open_from": window.get("open_from"),
        "open_until": window.get("open_until"),
        "purpose": "main",
        "added_by": actor_id,
    }


def _shape(rows: list[dict]) -> dict:
    students = _students(r["student_id"] for r in rows)
    labels = _cohort_labels(r.get("source_cohort_id") for r in rows)
    items = []
    for r in rows:
        st = students.get(str(r["student_id"])) or {}
        kind = r.get("source_kind")
        cid = str(r.get("source_cohort_id") or "")
        items.append({
            "user_id": r.get("user_id"),
            "student_id": r["student_id"],
            "name": st.get("full_name") or "—",
            "cohort": labels.get(cid) if cid else None,
            "source": {"kind": kind,
                       "label": labels.get(cid) if kind == "cohort" else
                       ("Học viên lẻ" if kind == "learner" else "Nhóm")},
            "skills": list(r.get("skills") or []),
            "selected": bool(r.get("selected")),
            "excluded_reason": r.get("excluded_reason"),
            "open_from": r.get("open_from"),
            "open_until": r.get("open_until"),
        })
    items.sort(key=lambda i: (i["name"] or "").casefold())
    # practice_overlap (T32 warning) is not computed in this PR: None, not [],
    # so the page cannot read "nobody overlaps".
    return {"items": items, "practice_overlap": None}


def get_audience(exam_id: str) -> dict:
    _require_enabled()
    exam_id = _uuid(exam_id)
    exam = exam_svc.get_published_exam_by_id(exam_id)
    if not exam:
        raise AudienceError("not_found", "Không tìm thấy kỳ thi.", status=404)
    return _shape(_rows(exam_id))


def _window(raw: Optional[dict]) -> dict:
    if not raw:
        return {}
    out = {"open_from": raw.get("open_from"), "open_until": raw.get("open_until")}
    f, u = assign_svc._parse_ts(out["open_from"]), assign_svc._parse_ts(out["open_until"])
    if f and u and u < f:
        raise AudienceError("invalid_window", "Khoảng mở không hợp lệ: 'đóng lúc' sớm hơn 'mở từ'.")
    return out


def update_audience(exam_id: str, body: dict, actor_id: str) -> dict:
    """Apply one PATCH: add classes / learners, refresh classes, set rows, window.

    Validates everything before the first write, so a refused request changes
    nothing. Returns the audience as GET does."""
    _require_enabled()
    exam_id = _uuid(exam_id)
    exam = _load_exam(exam_id)
    if body.get("add_group_ids"):
        raise AudienceError("groups_unavailable",
                            "Nhóm đã lưu chưa có trên hệ thống này (G09-T25, migration 443).")
    skills_allowed = set(exam_skills(exam))
    window = _window(body.get("window"))
    existing = {str(r["student_id"]): r for r in _rows(exam_id)}

    # 1. Who to add, first source wins (classes in the order sent, then learners).
    additions: dict[str, dict] = {}
    cohort_ids = [_uuid(c) for c in body.get("add_cohort_ids") or []]
    refresh = [str(r["source_cohort_id"]) for r in existing.values()
               if r.get("source_kind") == "cohort" and r.get("source_cohort_id")] \
        if body.get("refresh_cohorts") else []
    for cid in list(dict.fromkeys(cohort_ids + refresh)):
        for st in _cohort_roster(cid):
            sid = str(st["id"])
            if sid not in existing and sid not in additions:
                additions[sid] = _new_row(exam, st, kind="cohort", cohort_id=cid,
                                          actor_id=actor_id, window=window)
    learner_ids = [_uuid(s) for s in body.get("add_student_ids") or []]
    found = _students(learner_ids)
    missing = [s for s in learner_ids if s not in found]
    if missing:
        raise AudienceError("student_not_found", "Không tìm thấy học viên.", missing=missing)
    for sid in learner_ids:
        if sid not in existing and sid not in additions:
            additions[sid] = _new_row(exam, found[sid], kind="learner", cohort_id=None,
                                      actor_id=actor_id, window=window)

    # 2. Row edits, keyed by student_id (rows without an account have no user_id).
    by_user = {str(r["user_id"]): sid for sid, r in {**existing, **additions}.items()
               if r.get("user_id")}
    edits: dict[str, dict] = {}
    for item in body.get("set") or []:
        sid = str(item.get("student_id") or "") or by_user.get(str(item.get("user_id") or ""))
        sid = _uuid(sid) if sid else None
        row = (existing.get(sid) or additions.get(sid)) if sid else None
        if row is None:
            raise AudienceError("not_in_audience", "Người này chưa có trong danh sách.",
                                user_id=item.get("user_id"), student_id=item.get("student_id"))
        change: dict = {}
        if item.get("skills") is not None:
            skills = [s for s in ALL_SKILLS if s in set(item["skills"])]
            if not skills or set(item["skills"]) - skills_allowed:
                raise AudienceError("skills_not_in_exam",
                                    "Kỹ năng của mỗi người phải nằm trong kỹ năng của kỳ thi (ít nhất một).",
                                    student_id=sid)
            change["skills"] = skills
        if item.get("selected") is not None:
            if item["selected"] and not row.get("user_id"):
                raise AudienceError("no_account", "Học viên chưa có tài khoản nên không chọn được.",
                                    student_id=sid)
            change["selected"] = bool(item["selected"])
        if change:
            edits[sid] = change
    for sid, change in edits.items():
        if sid in additions:
            additions[sid].update(change)

    # 3. Self-paced pre-checks for the mirror, so a refusal writes nothing.
    # A draft is not mirrored (learners only see published exams); schedule()
    # mirrors the whole list once, right before publishing.
    mirror = (mock_exam_modes.is_self_paced(exam.get("exam_mode"))
              and exam.get("status") == "published")
    if mirror:
        prospective = []
        for sid, row in {**existing, **additions}.items():
            merged = {**row, **edits.get(sid, {}), **window}
            if merged.get("selected") and merged.get("user_id"):
                prospective.append(merged)
        servable = set(assign_svc.servable_skills(exam))
        for row in prospective:
            assignable = [s for s in row.get("skills") or [] if s in _ASSIGNABLE]
            if assignable and not row.get("open_until"):
                raise AudienceError("window_required",
                                    "Kỳ làm trong khoảng thời gian cần có 'đóng lúc' trước khi giao.")
            if set(assignable) - servable:
                raise AudienceError("skill_not_servable",
                                    "Kỳ thi chưa có đề cho một kỹ năng đã chọn.",
                                    student_id=row.get("student_id"))

    # 4. Writes.
    if additions:
        supabase_admin.table(_TABLE).insert(list(additions.values())).execute()
    for sid, change in edits.items():
        if sid in existing:
            supabase_admin.table(_TABLE).update(change).eq("id", existing[sid]["id"]).execute()
    if window:
        supabase_admin.table(_TABLE).update(window).eq("exam_id", exam_id) \
            .eq("purpose", "main").execute()
    rows = _rows(exam_id)
    _keep_cohort_pointer(exam, cohort_ids)
    if mirror:
        deselected = {str(existing[sid]["user_id"]) for sid, ch in edits.items()
                      if sid in existing and ch.get("selected") is False
                      and existing[sid].get("selected") and existing[sid].get("user_id")}
        _mirror_assignments(exam, rows, actor_id, deselected)
    logger.info("mock_exam_audience_update exam=%s added=%d edited=%d window=%s",
                exam_id, len(additions), len(edits), bool(window))
    return _shape(rows)


def _keep_cohort_pointer(exam: dict, added_cohorts: list[str]) -> None:
    """plan 5.5 point 3: ``mock_exams.cohort_id`` stays, set to the first class."""
    if exam.get("cohort_id") or not added_cohorts:
        return
    supabase_admin.table("mock_exams").update({"cohort_id": added_cohorts[0]}) \
        .eq("id", str(exam["id"])).is_("cohort_id", "null").execute()


def _mirror_assignments(exam: dict, rows: list[dict], actor_id: str,
                        deselected: set[str]) -> None:
    """Dual write into mock_exam_assignments for a self-paced exam.

    Every selected row is upserted (idempotent per user). Only learners this
    request deselected are un-assigned: an assignment made through the old
    ``/assignments`` path before the exam had audience rows is left alone.
    Un-assigning voids a sitting already opened, exactly as the existing
    "gỡ giao" does."""
    exam_id = str(exam["id"])
    wanted = {str(r["user_id"]): r for r in rows if r.get("selected") and r.get("user_id")}
    upserts = [{"user_id": uid,
                "skills": [s for s in r.get("skills") or [] if s in _ASSIGNABLE],
                "open_from": r.get("open_from"), "open_until": r.get("open_until")}
               for uid, r in wanted.items()]
    upserts = [u for u in upserts if u["skills"]]
    if upserts:
        if any(not u["open_until"] for u in upserts):
            raise AudienceError("window_required",
                                "Kỳ làm trong khoảng thời gian cần có 'đóng lúc' trước khi giao.")
        try:
            assign_svc.assign(exam_id, upserts, created_by=actor_id)
        except (assign_svc.InvalidWindowError, assign_svc.UnservableSkillError) as exc:
            raise AudienceError("assignment_refused", str(exc)) from exc
    for uid in deselected - set(wanted):
        assign_svc.remove(exam_id, uid, admin_id=actor_id)


# ── Schedule (FR-144) ───────────────────────────────────────────────────────

_CONTENT_COL = {"listening": "listening_test_id", "reading": "reading_test_id"}


def schedule_missing(exam: dict, rows: list[dict]) -> list[str]:
    """What still blocks "Lên lịch", as stable codes the page words."""
    missing: list[str] = []
    skills = exam_skills(exam)
    for skill in skills:
        col = _CONTENT_COL.get(skill)
        if col and not exam.get(col):
            missing.append(f"{skill}_paper")
        if skill == "writing" and not (exam.get("writing_task1_prompt_id")
                                       or exam.get("writing_task2_prompt_id")):
            missing.append("writing_paper")
        if skill == "speaking" and not exam.get("speaking_topic_set"):
            missing.append("speaking_paper")
    timed = tuple(s for s in ("listening", "reading", "writing") if s in skills
                  and f"{s}_paper" not in missing)
    if timed and exam_svc._exam_content_readiness_issues(exam, timed):
        missing.append("paper_not_ready")
    if not any(r.get("selected") for r in rows):
        missing.append("audience")
    if mock_exam_modes.is_live(exam.get("exam_mode")):
        if not exam.get("starts_at"):
            missing.append("starts_at")
    elif not all(r.get("open_until") for r in rows if r.get("selected")):
        # Self-paced windows live on each person's row (the PATCH window sets
        # them all); the assignment mirror needs an end for every one.
        missing.append("window")
    return missing


def schedule(exam_id: str, actor_id: str) -> dict:
    _require_enabled()
    exam_id = _uuid(exam_id)
    exam = _load_exam(exam_id)
    rows = _rows(exam_id)
    missing = schedule_missing(exam, rows)
    if missing:
        raise AudienceError("not_ready", "Chưa lên lịch được.", missing=missing)
    if mock_exam_modes.is_live(exam.get("exam_mode")) and not learner_gate_enabled():
        # Until G08 reads audiences at the room door, only the exam's own class
        # can enter a live room (tasks.md T31 "Vướng mắc").
        roster = {str(s["id"]) for s in _cohort_roster(str(exam["cohort_id"]))} \
            if exam.get("cohort_id") else set()
        outside = [r["student_id"] for r in rows if r.get("selected")
                   and str(r["student_id"]) not in roster]
        if outside:
            raise AudienceError("learner_gate_not_ready",
                                "Kỳ thi cùng giờ có người ngoài lớp chính chưa lên lịch được "
                                "cho tới khi cổng vào phòng của học viên đọc danh sách mới.",
                                outside=len(outside))
    if mock_exam_modes.is_self_paced(exam.get("exam_mode")):
        _mirror_assignments(exam, rows, actor_id, set())
    exam_svc.admin_update_exam(exam_id, {"status": "published"}, actor_id)
    logger.info("mock_exam_schedule exam=%s selected=%d", exam_id,
                sum(1 for r in rows if r.get("selected")))
    # Notifications to the selected learners (GOI-11) are not sent in this PR.
    return {"status": "published", "selected": sum(1 for r in rows if r.get("selected"))}


# ── Monitor roster ──────────────────────────────────────────────────────────


def expected_roster(exam: dict) -> Optional[dict]:
    """Roster for ``admin_live_monitor`` from audiences, or None to fall back.

    None (flag off, lookup error, or no audience row yet) keeps the old
    cohort/assignment roster, so an old one-class exam reads exactly as before.
    Keys match ``mock_exam_service._expected_roster``."""
    if not enabled():
        return None
    try:
        rows = [r for r in _rows(str(exam["id"])) if r.get("selected")]
        if not rows:
            return None
        students = _students(r["student_id"] for r in rows)
    except Exception:  # noqa: BLE001
        logger.exception("[audience] roster lookup failed exam=%s", exam.get("id"))
        return None
    out: dict = {}
    for r in rows:
        uid = r.get("user_id")
        key = str(uid) if uid else f"student:{r['student_id']}"
        out[key] = {"user_id": str(uid) if uid else None,
                    "name": (students.get(str(r["student_id"])) or {}).get("full_name"),
                    "skills": list(r.get("skills") or []),
                    "open_until": r.get("open_until")}
    return out
