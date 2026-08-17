"""routers/admin_mock_exams.py — admin CRUD for 4-skill mock exams (Phase 1).

Admin-gated (require_admin). Manages the exam DEFINITION, the SEQUENTIAL
section gate, and the per-exam sitting roster (list + void). The review
console lives in admin_mock_reviews.py.

  GET   /admin/mock-exams                       — all exams (incl. drafts)
  POST  /admin/mock-exams                        — create an exam definition
  PATCH /admin/mock-exams/{id}                   — edit / publish / archive
  POST  /admin/mock-exams/{id}/open              — live open/close toggle
  POST  /admin/mock-exams/{id}/advance           — open the NEXT seated section
  GET   /admin/mock-exams/{id}/section-progress  — active section + submitted/total
  GET   /admin/mock-exams/{id}/sittings          — sitting roster for an exam
  POST  /admin/mock-exams/sittings/{id}/void     — void a sitting (retake/tech)
  POST  /admin/mock-exams/sittings/{id}/retest   — early "cần test lại" toggle
  GET   /admin/mock-exams/reading-tests          — published reading tests for the
                                                    create-exam picker (a test may be
                                                    reused across several mock exams)
  GET   /admin/mock-exams/{id}/retest-summary    — per-skill "cần test lại" counts
  GET   /admin/mock-exams/{id}/roster            — class roster grid (per-skill snapshot)
  POST  /admin/mock-exams/{id}/writing/bulk-grade — queue many sittings' Writing at once
  POST  /admin/mock-exams/{id}/bulk-claim        — nhận many reviews at once
  POST  /admin/mock-exams/{id}/bulk-final-bands  — chốt band from the pre-filled values
  POST  /admin/mock-exams/{id}/bulk-release      — công bố many sittings' results
  GET   /admin/mock-exams/{id}/assignments       — per-student retake assignments
  POST  /admin/mock-exams/{id}/assignments       — assign retake exam to students
  DELETE /admin/mock-exams/{id}/assignments/{sid}— un-assign one student
"""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query
from pydantic import BaseModel, Field

from routers.admin import require_admin
from services import essay_service
from services import mock_exam_assignment_service as assign_svc
from services import mock_exam_service as svc
from services import mock_review_workflow as wf

router = APIRouter(prefix="/admin/mock-exams", tags=["admin-mock-exams"])


class ExamCreate(BaseModel):
    code: str
    title: str
    exam_mode: str = Field(default="sequential", pattern=r"^(sequential|retake)$")
    listening_test_id: str | None = None
    reading_test_id: str | None = None
    writing_task1_prompt_id: str | None = None
    writing_task2_prompt_id: str | None = None
    speaking_topic_set: dict = Field(default_factory=dict)
    total_minutes: int | None = None
    reading_minutes: int | None = None
    writing_minutes: int | None = None
    open_from: str | None = None
    open_until: str | None = None
    cohort_id: str | None = None
    review_sla_days: int | None = None


class ExamPatch(BaseModel):
    title: str | None = None
    exam_mode: str | None = Field(default=None, pattern=r"^(sequential|retake)$")
    listening_test_id: str | None = None
    reading_test_id: str | None = None
    writing_task1_prompt_id: str | None = None
    writing_task2_prompt_id: str | None = None
    speaking_topic_set: dict | None = None
    total_minutes: int | None = None
    reading_minutes: int | None = None
    writing_minutes: int | None = None
    open_from: str | None = None
    open_until: str | None = None
    cohort_id: str | None = None
    review_sla_days: int | None = None
    status: str | None = None      # draft | published | archived


class AssignRow(BaseModel):
    user_id: str
    skills: list[str] = Field(default_factory=list)
    open_from: str | None = None
    # Optional AT THE SCHEMA LEVEL, required by the service for any row that is
    # actually written. `assign()` documents that a row with no valid skill is
    # SKIPPED, and a skipped row has no window to validate — making this
    # unconditionally required let FastAPI 422 the whole batch before assign()
    # could skip it, so one skill-less row aborted every valid assignment
    # alongside it (Codex review, PR #839). Rows that do carry skills still get
    # a 400 from _validate_window when the deadline is missing.
    open_until: str | None = Field(
        default=None,
        description=("Hạn đóng của bài test lại (ISO 8601). Bắt buộc với mọi "
                     "dòng CÓ kỹ năng; dòng không kỹ năng bị bỏ qua nên không cần."),
    )


class AssignBody(BaseModel):
    assignments: list[AssignRow] = Field(default_factory=list)
    source_exam_id: str | None = None


class VoidBody(BaseModel):
    reason: str = ""


class OpenBody(BaseModel):
    is_open: bool


class AdvanceBody(BaseModel):
    """The section the admin's screen was showing when they clicked.

    Sent so a duplicate click from a stale tab is REJECTED, not replayed: the
    optimistic compare-and-set alone only catches requests whose DB reads
    overlap, so two clicks where the first has already committed would both
    advance and the class would skip a section."""

    # REQUIRED, and validated. Accepting a missing/null/empty value let the
    # stale-screen check be bypassed entirely: a cached pre-deploy frontend or
    # any other caller sending {} would have TWO sequential requests each
    # compare against the freshly-read section and both succeed — advancing
    # not_started → listening → reading and skipping a section for the whole
    # class (Codex review, PR #842).
    from_section: str = Field(
        ..., pattern=r"^(not_started|listening|reading|writing)$",
        description="Phần mà màn hình của admin đang hiển thị lúc bấm.",
    )


class RetestBody(BaseModel):
    needs_retest: bool
    reason: str = ""


class BulkReleaseBody(BaseModel):
    sitting_ids: list[str] = Field(default_factory=list)


class BulkSittingsBody(BaseModel):
    """Selected roster rows for bulk-claim / bulk-final-bands. Neither carries
    bands or flags: the server derives them, so a stale tab cannot post a band."""

    sitting_ids: list[str] = Field(default_factory=list)


class RetestFlagsBody(BaseModel):
    # {skill: bool} — the skills the student must retake. Skills the exam does
    # not require are dropped server-side, so a stale client cannot invent one.
    retest_flags: dict[str, bool] = Field(default_factory=dict)


class BulkGradeBody(BaseModel):
    sitting_ids: list[str] = Field(default_factory=list)
    grading_tier: str = Field(default="standard", pattern=r"^(standard|instructor)$")
    analysis_level: int = Field(default=3, ge=1, le=5)
    selected_model: str = Field(
        default="gemini-2.5-pro",
        pattern=r"^(gemini-2\.5-pro|gemini-2\.5-flash|gemini-3\.5-flash)$",
    )


@router.get("")
async def list_exams(authorization: str | None = Header(default=None)):
    await require_admin(authorization)
    return {"exams": svc.admin_list_exams()}


@router.get("/reading-tests")
async def available_reading_tests(authorization: str | None = Header(default=None)):
    """Published reading tests for the "Tạo đề mới" picker. Deliberately does
    NOT hide tests already assigned to another mock exam — unlike the student
    practice list, a reading test may be reused across several mock exams."""
    await require_admin(authorization)
    return {"items": svc.admin_available_reading_tests()}


@router.post("")
async def create_exam(body: ExamCreate, authorization: str | None = Header(default=None)):
    admin = await require_admin(authorization)
    try:
        return svc.admin_create_exam(body.model_dump(exclude_none=True), admin["id"])
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/{exam_id}")
async def update_exam(
    exam_id: str, body: ExamPatch, authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    patch = body.model_dump(exclude_none=True)
    if body.status is not None and body.status not in ("draft", "published", "archived"):
        raise HTTPException(400, "status không hợp lệ.")
    try:
        return svc.admin_update_exam(exam_id, patch)
    except svc.NotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/{exam_id}/open")
async def set_open(
    exam_id: str, body: OpenBody, authorization: str | None = Header(default=None),
):
    """Live toggle — open the exam so students can start, or close it."""
    admin = await require_admin(authorization)
    try:
        return svc.set_open(exam_id, body.is_open, admin["id"])
    except svc.NotFoundError as e:
        raise HTTPException(404, str(e))
    except svc.SittingConflictError as e:
        raise HTTPException(409, str(e))


@router.post("/{exam_id}/advance")
async def advance_section(
    exam_id: str,
    body: AdvanceBody,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    """Open the NEXT seated section for every sitting under this exam —
    not_started → listening → reading → writing → done.

    The transition returns immediately; the straggler sweep for the section
    being closed is QUEUED (B3). It used to run inline — one loop over every
    unsubmitted sitting, grading each L/R attempt — which for a class of 25-30
    made this a very long request, and a timeout left papers collected but the
    section unmoved with no way for the admin to tell.

    The live console polls every 5s, so the papers visibly land one by one. If
    the sweep dies (a restart mid-task), the console flags the section as
    "chưa thu đủ" and POST /collect?section=… re-runs it."""
    admin = await require_admin(authorization)
    try:
        out = svc.advance_section(exam_id, admin["id"], body.from_section)
    except svc.NotFoundError as e:
        raise HTTPException(404, str(e))
    except svc.SittingConflictError as e:
        raise HTTPException(409, str(e))
    except svc.MockExamError as e:
        raise HTTPException(503, str(e))
    if out.get("sweep_section"):
        background_tasks.add_task(
            svc._force_collect_section, exam_id, out["sweep_section"],
        )
    return out


@router.post("/{exam_id}/collect", status_code=202)
async def collect_section(
    exam_id: str,
    background_tasks: BackgroundTasks,
    # REQUIRED, and validated. Optional, it could simply be omitted — and the
    # stale-screen guard it exists for is skipped entirely: the service then
    # reads the CANONICAL active_section, so if another invigilator advanced
    # first this irreversibly collects the newly-opened paper the moment it
    # opened. That is precisely the race this parameter prevents (Codex review,
    # PR #843).
    from_section: str = Query(
        ...,
        # 'done' is a legitimate screen state for the RECOVERY path: re-sweeping
        # a section whose background sweep died is done from a monitor showing a
        # later section, and after the final advance that screen says 'done'.
        # Excluding it 422'd every recovery click after the exam finished — the
        # exact case the button exists for (Codex review, PR #844).
        pattern=r"^(listening|reading|writing|done)$",
        description="Phần mà màn hình của admin đang hiển thị lúc bấm Thu bài.",
    ),
    # The section to sweep. Defaults to the open one; an EARLIER one re-sweeps
    # it (recovery after a half-dead background sweep).
    section: str | None = Query(
        default=None, pattern=r"^(listening|reading|writing)$",
    ),
    authorization: str | None = Header(default=None),
):
    """THU BÀI for a section WITHOUT opening the next one.

    Lets the invigilator run the real sequence — take papers in, check everyone
    is accounted for, then hand out the next section — instead of the two being
    one irreversible button. Students drop into the waiting room with no clock
    running until /advance.

    Validated synchronously (so a rejected request is a real error, not a silent
    202) then swept in the background, same as /advance. `section` defaults to
    the open one; passing an earlier one re-sweeps it — the recovery path when a
    background sweep died half-way."""
    admin = await require_admin(authorization)
    try:
        info = svc.collect_preflight(exam_id, section, from_section)
    except svc.NotFoundError as e:
        raise HTTPException(404, str(e))
    except svc.SittingConflictError as e:
        raise HTTPException(409, str(e))
    except svc.MockExamError as e:
        # A lookup failure is NOT "0 bài đã thu" — the preflight does the count
        # SYNCHRONOUSLY precisely so a dead database is a real error here rather
        # than a 202 followed by a background sweep that collects nothing
        # (Codex review, PR #844).
        raise HTTPException(503, str(e))
    # Close admissions synchronously — the pause must hold from the moment the
    # request is accepted, not from whenever the queued sweep happens to run.
    marked = svc.mark_section_collected(exam_id, info["section"])
    # For a fresh collection, a false compare-and-set means advance won the
    # race after preflight. Do not queue an uncoordinated sweep against the old
    # section. Recovery re-sweeps intentionally target an earlier section, so
    # their marker update is expected to be a no-op.
    if info["section"] == from_section and not marked:
        raise HTTPException(
            409,
            "Phần thi vừa được chuyển bởi thao tác khác; chưa xếp hàng thu bài. "
            "Tải lại trang để đối chiếu.",
        )
    background_tasks.add_task(
        # No from_section: the stale-screen check already ran, synchronously,
        # against the state at request time. Re-checking it inside the queued
        # task would fail the sweep whenever a legitimate advance happened in
        # between — losing the very papers this call accepted responsibility for.
        svc.collect_section_after_flush_grace,
        exam_id, admin["id"], info["section"],
    )
    return {**info, "queued": True}


@router.get("/{exam_id}/section-progress")
async def section_progress(
    exam_id: str, authorization: str | None = Header(default=None),
):
    """Live "đã nộp X/Y" counts per section — informs when to advance."""
    await require_admin(authorization)
    try:
        return svc.admin_section_progress(exam_id)
    except svc.NotFoundError as e:
        raise HTTPException(404, str(e))


@router.get("/{exam_id}/live")
async def live_monitor(exam_id: str, authorization: str | None = Header(default=None)):
    """Per-student live state for the invigilator console — the shared section
    clock, the expected roster vs who actually showed up, and each student's
    per-section progress (submitted / working / waiting, answers the server
    holds, last activity). One poll, batched lookups, persisted state only."""
    await require_admin(authorization)
    try:
        return svc.admin_live_monitor(exam_id)
    except svc.NotFoundError as e:
        raise HTTPException(404, str(e))


@router.get("/{exam_id}/sittings")
async def list_sittings(exam_id: str, authorization: str | None = Header(default=None)):
    await require_admin(authorization)
    return {"sittings": svc.admin_list_sittings(exam_id)}


@router.get("/{exam_id}/retest-summary")
async def retest_summary(exam_id: str, authorization: str | None = Header(default=None)):
    """Per-skill "cần test lại" counts for this exam's class — how many
    sittings an admin flagged, broken out per skill, plus the roster."""
    await require_admin(authorization)
    return wf.retest_summary(exam_id)


@router.get("/{exam_id}/roster")
async def roster(exam_id: str, authorization: str | None = Header(default=None)):
    """Class roster grid for the review console — one row per sitting with a
    per-skill preliminary snapshot (L/R correct count, Writing word counts,
    Speaking session count) + claim status. Replaces the flat review queue."""
    await require_admin(authorization)
    return {"roster": wf.roster(exam_id)}


@router.get("/{exam_id}/assignments")
async def list_assignments(exam_id: str, authorization: str | None = Header(default=None)):
    """Per-student retake assignments for this exam (with student names)."""
    await require_admin(authorization)
    return {"assignments": assign_svc.list_assignments(exam_id)}


@router.post("/{exam_id}/assignments")
async def create_assignments(
    exam_id: str, body: AssignBody, authorization: str | None = Header(default=None),
):
    """Assign a retake exam to specific students (each with a skill subset +
    time window). Idempotent per student — re-posting refreshes the row. The
    admin UI builds `assignments` from the source exam's retest_summary."""
    admin = await require_admin(authorization)
    rows = [r.model_dump() for r in body.assignments]
    try:
        return assign_svc.assign(
            exam_id, rows, created_by=admin["id"], source_exam_id=body.source_exam_id,
        )
    except (assign_svc.InvalidWindowError, assign_svc.UnservableSkillError) as e:
        raise HTTPException(400, str(e))


@router.delete("/{exam_id}/assignments/{student_id}")
async def delete_assignment(
    exam_id: str, student_id: str, authorization: str | None = Header(default=None),
):
    """Un-assign one student from a retake exam.

    Also VOIDS any sitting they already opened for it — deleting the assignment
    alone did not revoke access, because create_sitting resumes an existing
    sitting before the eligibility gates. Reports the voided ids rather than
    doing two things silently under one verb."""
    admin = await require_admin(authorization)
    try:
        out = assign_svc.remove(exam_id, student_id, admin_id=admin["id"])
    except assign_svc.RevocationError as e:
        # The assignment is gone but an open sitting survived, so access was
        # NOT revoked. Answering ok:true here would show the admin a revocation
        # that did not happen.
        raise HTTPException(409, str(e))
    return {"ok": True, **out}


@router.post("/{exam_id}/writing/bulk-grade", status_code=202)
async def bulk_grade_writing(
    exam_id: str,
    body: BulkGradeBody,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    """Send the promoted Writing essays of several sittings into the grading
    queue in one action (2026-07-12) — the roster-grid bulk version of the
    per-essay start-grading button. For each requested sitting (validated to
    belong to THIS exam), each task's essay that is still 'pending' is claimed
    atomically and queued; anything already grading/graded is skipped and
    reported. A sitting the admin flagged for retest (needs_retest) is skipped
    entirely — no point grading a retaker's Writing (server-side guard; the
    roster UI already excludes it). Reuses the same claim + background task as
    the single endpoint, so the downstream pipeline is unchanged."""
    await require_admin(authorization)

    queued: list[str] = []
    skipped: list[str] = []
    short: list[str] = []
    retest_skipped: list[str] = []
    for sitting_id in body.sitting_ids:
        sitting = svc.get_sitting(sitting_id)
        # Only grade essays for a sitting that actually belongs to this exam —
        # never let a stray id reach into another exam's work.
        if not sitting or str(sitting.get("mock_exam_id")) != str(exam_id):
            continue
        # Early retest flag → this student is retaking; don't grade their Writing.
        if sitting.get("needs_retest"):
            retest_skipped.append(str(sitting_id))
            continue
        # Word-count-gated claim: too-short essays are reported in `short` (held
        # for the admin's grade-anyway / skip decision), not auto-queued.
        res = svc.claim_mock_writing_grading(
            [sitting.get("essay_task1_id"), sitting.get("essay_task2_id")],
            grading_tier=body.grading_tier,
            analysis_level=body.analysis_level,
            selected_model=body.selected_model,
        )
        for essay_id, job_id in res["queued"]:
            background_tasks.add_task(essay_service._bg_grade_essay, essay_id, job_id)
            queued.append(essay_id)
        short.extend(res["short"])
        skipped.extend(res["skipped"])

    return {
        "queued":         queued,
        "skipped":        skipped,
        "short":          short,
        "retest_skipped": retest_skipped,
        "grading_tier":   body.grading_tier,
    }


@router.post("/writing/essays/{essay_id}/skip-grading")
async def skip_writing_grading(
    essay_id: str, authorization: str | None = Header(default=None),
):
    """Admin decides NOT to grade a too-short mock Writing essay — stamp
    grading_skipped_at so the mock release gate stops blocking on it (the student
    gets the manual Writing band with no per-task feedback). Mock-scoped: rejects
    a non-mock essay (sitting_id null) so this can't silently drop a normal
    self-submit essay out of its own queue."""
    admin = await require_admin(authorization)
    try:
        return svc.skip_mock_writing_grading(essay_id, admin_id=admin["id"])
    except svc.NotFoundError as e:
        raise HTTPException(404, str(e))
    except svc.SittingConflictError as e:
        raise HTTPException(409, str(e))


@router.post("/{exam_id}/writing/promote")
async def promote_writing(
    exam_id: str, authorization: str | None = Header(default=None),
):
    """Backfill: create the writing_essays for this exam's sittings whose Writing
    was collected but never promoted (a cohort that sat the exam before the
    promotion feature shipped → text captured, no essay rows, nothing to grade).
    Idempotent; does NOT grade (use bulk-grade next). Returns per-sitting counts."""
    await require_admin(authorization)
    return svc.backfill_promote_writing(exam_id)


@router.post("/sittings/{sitting_id}/retest")
async def set_sitting_retest(
    sitting_id: str, body: RetestBody, authorization: str | None = Header(default=None),
):
    """Toggle the EARLY 'cần test lại' flag on a sitting (mig 153) — set from the
    roster off the auto-graded L/R results so Writing bulk-grade skips a retaker
    before any grading budget is spent."""
    admin = await require_admin(authorization)
    try:
        return svc.set_sitting_retest(
            sitting_id, admin["id"], body.needs_retest, body.reason,
        )
    except svc.NotFoundError as e:
        raise HTTPException(404, str(e))


def _scope_to_exam(exam_id: str, sitting_ids: list[str]) -> tuple[list[str], list[dict]]:
    """Split posted ids into this exam's and the strays, the latter as `skipped`
    rows. The path's exam_id is the admin's stated scope: a sitting outside it
    came from a stale tab or a hand-made call, never from this roster. Reported
    rather than dropped silently — a bulk action that ignores an id it was given
    must say so (Codex review, PR #787)."""
    mine = svc.sittings_in_exam(exam_id, sitting_ids)
    ids = [str(s) for s in sitting_ids]
    return (
        [s for s in ids if s in mine],
        [{"sitting_id": s, "reason": "Không thuộc đề này."} for s in ids if s not in mine],
    )


@router.post("/{exam_id}/bulk-claim")
async def bulk_claim(
    exam_id: str, body: BulkSittingsBody, authorization: str | None = Header(default=None),
):
    """Nhận many reviews at once. Only a 'queued' row is taken — claim()'s atomic
    WHERE clause is still the lock, so this cannot lift another admin's review.
    A row it could not take is skipped with a reason, never raised. Scoped to
    THIS exam, like writing/bulk-grade."""
    admin = await require_admin(authorization)
    if not body.sitting_ids:
        return {"claimed": [], "skipped": []}
    ids, foreign = _scope_to_exam(exam_id, body.sitting_ids)
    out = wf.bulk_claim_sittings(ids, admin["id"])
    out["skipped"] = out["skipped"] + foreign
    return out


@router.post("/{exam_id}/bulk-final-bands")
async def bulk_final_bands(
    exam_id: str, body: BulkSittingsBody, authorization: str | None = Header(default=None),
):
    """Chốt band for many claimed reviews from the bands the console pre-fills
    (L/R off the Cambridge table, Writing off the two admin-reviewed essays).

    The client posts NO bands — the server derives them, and save_final_bands
    still validates each one and recomputes the overall. A sitting whose required
    band cannot be derived (e.g. Speaking) is skipped with a reason rather than
    signed off with a number nobody chose. Does not publish; use bulk-release.

    Scoped to THIS exam: without it a stray id could mark another exam's review
    'reviewed' — and 'reviewed' is exactly what bulk-release then publishes."""
    admin = await require_admin(authorization)
    if not body.sitting_ids:
        return {"saved": [], "skipped": []}
    ids, foreign = _scope_to_exam(exam_id, body.sitting_ids)
    out = wf.bulk_save_final_bands(ids, admin["id"])
    out["skipped"] = out["skipped"] + foreign
    return out


@router.post("/{exam_id}/bulk-release")
async def bulk_release(
    exam_id: str, body: BulkReleaseBody, authorization: str | None = Header(default=None),
):
    """Công bố many sittings at once — PUBLISHES results to real students.

    Gates are per sitting and unchanged (reviewed + claimed by this admin +
    Writing resolved); a sitting failing any of them is skipped with a reason
    rather than sinking the batch. The response's `skipped` list is not optional
    detail — the caller must show it, or the admin cannot tell who was published.

    Scoped to THIS exam (2026-07-16). Codex flagged the gap on the two new bulk
    routes; this one has had it since #778 and is the one that PUBLISHES to real
    students, so it is closed with the same helper rather than left as the only
    unscoped bulk action in the file.
    """
    admin = await require_admin(authorization)
    if not body.sitting_ids:
        return {"released": [], "skipped": []}
    ids, foreign = _scope_to_exam(exam_id, body.sitting_ids)
    out = wf.bulk_release_sittings(ids, admin["id"])
    out["skipped"] = out["skipped"] + foreign
    return out


@router.post("/sittings/{sitting_id}/retest-flags")
async def set_sitting_retest_flags(
    sitting_id: str, body: RetestFlagsBody, authorization: str | None = Header(default=None),
):
    """Record WHICH skills the student must retake, straight from the roster.

    Distinct from /retest above: that one flips the sitting's needs_retest gate
    (Writing bulk-grade skips the sitting — an early cost gate). This one only
    records the per-skill decision and never blocks grading (product decision
    2026-07-15). PATCH-shaped semantics, POST verb to match the sibling route.
    """
    admin = await require_admin(authorization)
    try:
        return wf.set_retest_flags_for_sitting(
            sitting_id, admin["id"], body.retest_flags,
        )
    except wf.NotFoundError as e:
        raise HTTPException(404, str(e))
    except wf.ConflictError as e:
        raise HTTPException(409, str(e))


@router.get("/sittings/{sitting_id}/pacing")
async def sitting_pacing(
    sitting_id: str, authorization: str | None = Header(default=None),
):
    """How the student SPENT the exam — reconstructed from `answered_at` stamps
    that every answer write has always made and nobody has ever read.

    Order answers actually landed in, pauses between them, rushed finishes, and
    where the work stopped. The response carries its own caveats: answered_at is
    the LAST touch of a question, so gaps bracket think-time rather than being
    it."""
    await require_admin(authorization)
    try:
        return svc.sitting_pacing(sitting_id)
    except svc.NotFoundError as e:
        raise HTTPException(404, str(e))


@router.post("/sittings/{sitting_id}/record-speaking")
async def admin_record_speaking(
    sitting_id: str, authorization: str | None = Header(default=None),
):
    """Unstick a sitting whose Speaking never got reported.

    The student's report call is fire-and-forget; if it failed the sitting stays
    `speaking_pending` forever — no review, never released — and nobody could
    fix it. Ratifies only the sessions ALREADY bound to this sitting, so it can
    never attach work the student didn't do."""
    admin = await require_admin(authorization)
    try:
        return svc.admin_record_speaking(sitting_id, admin["id"])
    except svc.NotFoundError as e:
        raise HTTPException(404, str(e))
    except svc.SittingConflictError as e:
        raise HTTPException(409, str(e))


@router.post("/sittings/{sitting_id}/void")
async def void_sitting(
    sitting_id: str, body: VoidBody, authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    try:
        return svc.void_sitting(sitting_id, admin["id"], body.reason)
    except svc.NotFoundError as e:
        raise HTTPException(404, str(e))
    except svc.SittingConflictError as e:
        raise HTTPException(409, str(e))
