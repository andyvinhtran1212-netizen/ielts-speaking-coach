"""services/mock_exam_assignment_service.py — per-student retake assignment.

A retake mock exam (exam_mode='retake', migration 154) is NOT opened to a whole
cohort; it is ASSIGNED to specific students, each with their own skill subset +
time window. The admin UI builds the rows from the source exam's
retest_summary() (who needs retest + which skills) and posts them here. Mirrors
writing_assignments' per-student model + a shared assignment_group_id per batch.

Module-level supabase_admin (like the other mock_* services) so the FakeSupabase
test double can patch it via the shared fake_db fixture.
"""
from __future__ import annotations

import logging
from datetime import datetime
from uuid import uuid4

from database import supabase_admin

logger = logging.getLogger(__name__)


class InvalidWindowError(ValueError):
    """open_until is earlier than open_from — an impossible availability window."""


class RevocationError(RuntimeError):
    """The assignment was deleted but an open sitting could not be voided, so
    access was NOT actually revoked. Reported rather than swallowed: the admin
    must know to clear it by hand."""


class UnservableSkillError(ValueError):
    """A skill was assigned that this retake exam has no content for.

    The skills come from the SOURCE exam's retest flags, but they are sat on the
    TARGET exam — and nothing tied the two together. Assigning Listening on a
    retake exam with no listening_test_id handed the student a "Bắt đầu
    Listening" button that starts their per-section clock and then loads an
    iframe with `id=undefined`: the time drains, the reaper collects an empty
    paper, and the band is computed from it.

    Loud and whole-request, not a silent per-student drop. This is a SETUP
    mistake (the target exam is missing a test), so it hits every student
    flagged for that skill at once, and the fix is to attach the test or untick
    the skill — both of which the admin can only do if they are told."""


# v1 retake covers Listening/Reading/Writing only (Speaking is session-based,
# added later — the skills array leaves room). Order-stable canonical list.
_RETAKE_SKILLS = ("listening", "reading", "writing")


def _clean_skills(skills) -> list:
    """Keep only known v1 retake skills, order-stable + deduped."""
    seen, out = set(), []
    for s in (skills or []):
        if s in _RETAKE_SKILLS and s not in seen:
            seen.add(s)
            out.append(s)
    return out


_SKILL_LABEL = {"listening": "Listening", "reading": "Reading", "writing": "Writing"}


def servable_skills(exam: dict) -> list:
    """Which retake skills this exam can actually put in front of a student.

    Deliberately the SAME rule as mock_exam_service._configured_sections: a
    Listening/Reading section is nothing without its test id — the runner builds
    an iframe src from it and gets `id=undefined` — whereas WRITING is always
    part of an exam even with no prompts attached, because the panel is native
    textareas and the runner renders the missing prompt as "(Không có đề Task
    N)". A promptless Writing paper is a content gap for the admin to fix, not a
    section the student cannot open.
    """
    have = []
    if (exam or {}).get("listening_test_id"):
        have.append("listening")
    if (exam or {}).get("reading_test_id"):
        have.append("reading")
    have.append("writing")
    return have


def _assert_servable(exam_id, merged: dict) -> None:
    """Refuse the batch if it assigns a skill the target exam cannot serve."""
    try:
        exam = (supabase_admin.table("mock_exams").select("*")
                .eq("id", str(exam_id)).limit(1).execute().data or [None])[0]
    except Exception:  # noqa: BLE001
        logger.exception("[retake] servable-skill lookup failed exam=%s", exam_id)
        return
    if not exam:
        # NOT our error to raise: mock_exam_assignments.exam_id is NOT NULL
        # REFERENCES mock_exams(id) (mig 154), so a non-existent exam is already
        # refused by the insert below. Inventing a second verdict here would
        # only mask that one.
        return
    ok = set(servable_skills(exam))
    wanted: dict = {}
    for uid, info in merged.items():
        for s in info["skills"]:
            if s not in ok:
                wanted.setdefault(s, []).append(uid)
    if not wanted:
        return
    detail = "; ".join(
        f"{_SKILL_LABEL.get(s, s)} ({len(uids)} học viên)"
        for s, uids in wanted.items()
    )
    raise UnservableSkillError(
        f"Đề test lại {exam.get('code') or exam_id!r} chưa có nội dung cho: {detail}. "
        "Gắn đề cho kĩ năng đó rồi gán lại, hoặc bỏ tick kĩ năng đó — nếu gán "
        "bây giờ, học viên sẽ bấm 'Bắt đầu' và đồng hồ chạy trên một phần trống."
    )


def _parse_ts(value):
    """ISO timestamp string → datetime (None passthrough). Tolerates a 'Z'
    suffix. Raises InvalidWindowError on an unparseable value."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise InvalidWindowError(f"Thời điểm không hợp lệ: {value!r}") from exc


def _validate_window(open_from, open_until) -> None:
    """Reject a window the retake flow cannot finish.

    Two ways it can be wrong:

    · INVERTED (open_until < open_from) — locks the student out entirely.

    · OPEN-ENDED (no open_until) — worse, and silent. The reaper only collects a
      section that has STARTED, or everything once the window has closed. With
      no closing bound, a student who never presses "Bắt đầu" leaves the sitting
      in `registered` FOREVER: never collected, never reviewed, never finished.
      It also permanently occupies the uq_mock_sitting_active slot, so no fresh
      sitting can be granted for that exam either.

      That was merely annoying while a stuck sitting only blocked its own exam.
      Once one live sitting per student is enforced across ALL exams (C3), the
      same stuck row locks the student out of every future exam — so the window
      is now required rather than optional.
    """
    f, u = _parse_ts(open_from), _parse_ts(open_until)
    if u is None:
        raise InvalidWindowError(
            "Phải đặt 'đóng lúc' cho bài test lại — không có hạn đóng thì bài "
            "của học viên không bao giờ được thu và tài khoản bị kẹt."
        )
    if f is not None and u < f:
        raise InvalidWindowError("Khung giờ không hợp lệ: 'đóng lúc' sớm hơn 'mở từ'.")


def assign(exam_id, rows, *, created_by, source_exam_id=None) -> dict:
    """Upsert one assignment per (exam_id, user) from `rows`
    [{user_id, skills, open_from, open_until}]. A user already assigned to this
    exam is UPDATED (skills/window/group refreshed) — re-running an assign is
    safe (idempotent per user). A row with no valid skill is skipped. All rows
    in one call share one assignment_group_id.

    Returns {"group_id", "assigned": [user_id...], "skipped": [user_id...]}.
    """
    # Coalesce duplicate user_ids within ONE request. retest_summary is
    # per-SITTING, so a user with >1 flagged sitting arrives more than once —
    # without merging, the second occurrence would take the insert path and hit
    # the UNIQUE(exam_id, user_id) constraint, failing the whole batch. Union
    # the skills across occurrences; keep the first non-null window bound.
    merged: dict = {}
    order: list = []
    for row in rows:
        uid = row.get("user_id")
        if not uid:
            continue
        uid = str(uid)
        if uid not in merged:
            merged[uid] = {"skills": [], "open_from": None, "open_until": None}
            order.append(uid)
        for s in _clean_skills(row.get("skills")):
            if s not in merged[uid]["skills"]:
                merged[uid]["skills"].append(s)
        if merged[uid]["open_from"] is None:
            merged[uid]["open_from"] = row.get("open_from")
        if merged[uid]["open_until"] is None:
            merged[uid]["open_until"] = row.get("open_until")

    # Validate every window up-front so a bad one fails the request cleanly
    # (400) instead of persisting a subset then raising mid-batch — but only for
    # rows that will actually be WRITTEN. A skill-less row is documented to be
    # skipped, so validating its window aborted the entire request and left the
    # valid students in the same batch unassigned (Codex review, PR #839).
    for uid in order:
        if not merged[uid]["skills"]:
            continue
        _validate_window(merged[uid]["open_from"], merged[uid]["open_until"])
    # ...and the same up-front, whole-request treatment for a skill the TARGET
    # exam has no paper for. Checked here, after the skill-less rows are known
    # to be skipped, so it only judges what will actually be written.
    _assert_servable(exam_id, {u: merged[u] for u in order if merged[u]["skills"]})

    group_id = str(uuid4())
    assigned, skipped, refreshed, locked, refresh_failed = [], [], [], [], []
    existing = {
        r["user_id"]: r["id"]
        for r in (supabase_admin.table("mock_exam_assignments")
                  .select("id, user_id").eq("exam_id", str(exam_id))
                  .execute().data or [])
    }
    for uid in order:
        info = merged[uid]
        if not info["skills"]:
            skipped.append(uid)
            continue
        payload = {
            "exam_id":             str(exam_id),
            "user_id":             uid,
            "skills":              info["skills"],
            "open_from":           info["open_from"],
            "open_until":          info["open_until"],
            "assignment_group_id": group_id,
            "source_exam_id":      str(source_exam_id) if source_exam_id else None,
            "created_by":          str(created_by),
        }
        if uid in existing:
            supabase_admin.table("mock_exam_assignments").update(payload).eq(
                "id", existing[uid]).execute()
        else:
            supabase_admin.table("mock_exam_assignments").insert(payload).execute()
        assigned.append(uid)

        # D2 — carry the edit onto a sitting the student ALREADY opened.
        outcome = _refresh_open_sitting(
            exam_id, uid, info["skills"], info["open_from"], info["open_until"],
        )
        if outcome == "refreshed":
            refreshed.append(uid)
        elif outcome == "locked":
            locked.append(uid)
        elif outcome == "failed":
            refresh_failed.append(uid)

    logger.info("[retake] assign exam=%s assigned=%d skipped=%d refreshed=%d locked=%d group=%s",
                exam_id, len(assigned), len(skipped), len(refreshed), len(locked), group_id)
    return {
        "group_id": group_id, "assigned": assigned, "skipped": skipped,
        # Sittings the edit reached, and sittings it could NOT reach because the
        # student is already mid-exam. The caller MUST show `locked`: silently
        # not applying an admin's correction is how the old bug felt.
        "refreshed": refreshed, "locked": locked,
        # Could not be applied to an open sitting because the lookup/update
        # errored. Distinct from `locked` (a deliberate refusal) — this one
        # means we do not know what that student is now sitting.
        "refresh_failed": refresh_failed,
    }


def _sitting_started(sitting: dict) -> bool:
    """Has ANY section's clock been started on this sitting?

    A named seam, not an inline `any(...)`, so a test can stage the exact race
    the compare-and-set below defends against: a read that says "not started"
    while the row has since been started.
    """
    return any(sitting.get(f"{s}_started_at") for s in _RETAKE_SKILLS)


def _refresh_open_sitting(exam_id, user_id, skills, open_from, open_until) -> str:
    """Push an edited assignment onto a sitting the student already opened.

    create_sitting SNAPSHOTS assigned_skills + the window onto the sitting, and
    assign() only ever updated mock_exam_assignments — so correcting a wrong
    skill set after the student had opened (but not started) the exam was
    SILENTLY IGNORED: they sat the old skills on the old window, and the admin
    had no way to tell.

    Only refreshes a sitting with NO section started. Once a clock is running,
    changing the skill set mid-exam is worse than the stale snapshot: the
    student could lose a section they are actively working on. Those are
    reported as `locked` instead.

    Returns 'refreshed' | 'locked' | 'failed' | 'none'. `failed` is kept apart
    from `none` on purpose: collapsing them made a database error look exactly
    like "this student never opened the exam", so the admin was told the edit
    applied while the open sitting kept its old skills and window
    (Codex review, PR #845).
    """
    try:
        rows = (supabase_admin.table("mock_exam_sittings")
                .select("id, listening_started_at, reading_started_at, writing_started_at")
                .eq("mock_exam_id", str(exam_id)).eq("user_id", str(user_id))
                .not_.in_("status", ["released", "void"]).execute().data or [])
    except Exception:  # noqa: BLE001 — the assignment write already succeeded
        logger.exception("[retake] sitting refresh lookup failed exam=%s user=%s", exam_id, user_id)
        return "failed"
    if not rows:
        return "none"
    sitting = rows[0]
    if _sitting_started(sitting):
        return "locked"
    try:
        # RE-CHECK THE GUARD IN THE WRITE ITSELF. The SELECT above and this
        # UPDATE are two round trips: a student who presses "Bắt đầu" in
        # between has start_section() stamp their clock, and an unconditional
        # update would still replace the skill set — potentially removing the
        # very section they are sitting (Codex review, PR #845). Matching on
        # all three clocks being null makes the write lose that race instead,
        # and zero rows means the same thing the SELECT branch above means.
        q = supabase_admin.table("mock_exam_sittings").update({
            "assigned_skills":   skills,
            "retake_open_from":  open_from,
            "retake_open_until": open_until,
        }).eq("id", sitting["id"]).not_.in_("status", ["released", "void"])
        for s in _RETAKE_SKILLS:
            q = q.is_(f"{s}_started_at", "null")
        resp = q.execute()
    except Exception:  # noqa: BLE001
        logger.exception("[retake] sitting refresh failed sitting=%s", sitting["id"])
        return "failed"
    if not resp.data:
        logger.info(
            "[retake] sitting refresh lost the race sitting=%s — student started meanwhile",
            sitting["id"],
        )
        return "locked"
    return "refreshed"


def list_assignments(exam_id) -> list:
    """All assignments for an exam, each enriched with student_name."""
    from services.mock_review_workflow import resolve_display_names
    rows = (supabase_admin.table("mock_exam_assignments").select("*")
            .eq("exam_id", str(exam_id)).execute().data or [])
    names = resolve_display_names(r.get("user_id") for r in rows)
    for r in rows:
        r["student_name"] = names.get(r.get("user_id"), "—")
    return rows


def remove(exam_id, user_id, *, admin_id=None) -> dict:
    """Un-assign one user from a retake exam, and VOID any sitting they already
    opened for it.

    Deleting the assignment alone did not actually revoke access: create_sitting
    RESUMES an existing non-terminal sitting *before* applying the eligibility
    gates (mock_exam_service.py:471-478 — deliberate, so a mid-exam refresh
    can't lock a student out of their own paper). So an un-assigned student who
    had already opened the exam kept full access to it.

    Voiding is also what frees the uq_mock_sitting_active slot. That matters
    much more once one live sitting per student is enforced across all exams
    (C3): without this, un-assigning someone would leave them holding a lock on
    every OTHER exam too, with no way for the admin to clear it.

    Returns {"voided": [sitting_id...]} so the caller can report what it did
    rather than silently doing two different things under one verb.
    """
    from services import mock_exam_service  # local import avoids an import cycle

    # Only ever cancel a sitting for a REAL assignment. Without this a stale or
    # hand-made DELETE aimed at a sequential exam — or at a user who has no
    # assignment at all — would cancel that student's live sitting, where the old
    # implementation was a harmless no-op (Codex review, PR #840).
    if not (supabase_admin.table("mock_exam_assignments").select("id")
            .eq("exam_id", str(exam_id)).eq("user_id", str(user_id))
            .limit(1).execute().data or []):
        logger.info("[retake] unassign: no assignment exam=%s user=%s — no-op",
                    exam_id, user_id)
        return {"voided": []}

    # DELETE THE ASSIGNMENT FIRST, then look for sittings. The other order left
    # a real window: a student pressing "Bắt đầu" concurrently could read the
    # assignment (still present), and insert their sitting after this scan and
    # before the delete — so the new sitting was never voided, subsequent
    # refreshes resumed it before the eligibility gates, and this endpoint
    # reported a successful revocation (Codex review, PR #840).
    #
    # PostgREST gives no cross-table transaction, so this cannot be made
    # strictly serialisable here. Deleting first closes the window from the
    # other side — once the assignment is gone create_sitting() refuses — and
    # the SECOND scan below catches anyone who slipped through in between.
    supabase_admin.table("mock_exam_assignments").delete().eq(
        "exam_id", str(exam_id)).eq("user_id", str(user_id)).execute()

    def _open_sittings() -> list:
        return (supabase_admin.table("mock_exam_sittings").select("id")
                .eq("mock_exam_id", str(exam_id)).eq("user_id", str(user_id))
                .not_.in_("status", ["released", "void"]).execute().data or [])

    open_rows = _open_sittings()

    voided, failed = [], []
    for row in open_rows:
        try:
            mock_exam_service.void_sitting(
                row["id"], admin_id or "system",
                reason="Gỡ khỏi danh sách được gán bài test lại.",
            )
            voided.append(str(row["id"]))
        except Exception:  # noqa: BLE001
            logger.exception("[retake] unassign: void failed sitting=%s", row["id"])
            failed.append(str(row["id"]))

    # Swallowing this and still answering ok:true was the dangerous half. The
    # assignment row is gone from the admin's list while the sitting stays
    # usable — create_sitting RESUMES it before the eligibility gates — so the
    # UI would show access revoked when it was not (Codex review, PR #840).
    if failed:
        raise RevocationError(
            "Đã gỡ khỏi danh sách nhưng KHÔNG huỷ được lượt thi đang mở "
            f"({len(failed)}). Học viên vẫn vào được — hãy huỷ lượt thủ công "
            "trên trang phòng thi trực tiếp."
        )

    # SECOND PASS. A sitting inserted between the delete and the first scan is
    # exactly the interleaving above; catching it here turns a silent access
    # leak into one extra query.
    late = [r for r in _open_sittings() if str(r["id"]) not in voided]
    for row in late:
        try:
            mock_exam_service.void_sitting(
                row["id"], admin_id or "system",
                reason="Gỡ khỏi danh sách được gán bài test lại.",
            )
            voided.append(str(row["id"]))
            logger.warning(
                "[retake] unassign: voided a sitting created mid-request sitting=%s",
                row["id"],
            )
        except Exception:  # noqa: BLE001
            logger.exception("[retake] unassign: late void failed sitting=%s", row["id"])
            raise RevocationError(
                "Đã gỡ khỏi danh sách nhưng học viên vừa kịp mở một lượt thi mới "
                "và KHÔNG huỷ được — hãy huỷ lượt thủ công trên trang phòng thi "
                "trực tiếp."
            )

    logger.info("[retake] unassign exam=%s user=%s voided=%d",
                exam_id, user_id, len(voided))
    return {"voided": voided}
