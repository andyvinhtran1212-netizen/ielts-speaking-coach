"""routers.listening.admin_audit — admin content audit and map images (BACKENDSPLIT-0076 T005).

The "Content audit" block of the former single-file routers/listening.py
(lines 3831–5191), cut and pasted unchanged: audit verify/fix in place, map
image helpers, manual upload, generation and signed URLs. The package
re-exports every name; tests patch ``routers.listening``, never this module
(see __init__.py).
"""

from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any, Literal, Optional
from fastapi import (
    APIRouter, File, Header, HTTPException, Query,
    UploadFile,
)
from pydantic import BaseModel, ConfigDict, Field
from config import settings
from services.errors import clip_user_value, describe_parse_error
from database import supabase_admin
from services import listening_audit as listening_audit_svc

from ._common import (
    _assemble_listening_review, _same_timestamp, _sign_map_image_url, _upload_audio_to_bucket,
    admin_router, logger, require_admin,
)


# ── Content audit (verify + fix in place, no re-import) ──────────────────────

def _fetch_test_audit_rows(test_id: str) -> tuple[dict, list[dict], list[dict]]:
    """Fetch a test + its content + exercises (FULL payload incl. answers — admin
    only) for the audit engine. Raises 404 if the test is missing."""
    tr = supabase_admin.table("listening_tests").select("*").eq("id", test_id).limit(1).execute()
    if not tr.data:
        raise HTTPException(404, "Test not found")
    test = tr.data[0]
    contents = (supabase_admin.table("listening_content")
                .select("*").eq("test_id", test_id).execute().data or [])
    content_ids = [c["id"] for c in contents]
    exercises: list[dict] = []
    if content_ids:
        exercises = (supabase_admin.table("listening_exercises")
                     .select("*").in_("content_id", content_ids).execute().data or [])
    return test, contents, exercises


def _load_audit_row(test_id: str) -> dict | None:
    r = (supabase_admin.table("listening_audit").select("*")
         .eq("test_id", test_id).limit(1).execute())
    return r.data[0] if r.data else None


def _require_standard_audit_contract(exercises: list[dict]) -> None:
    """Programme forms have response/self-review and whole-day timing contracts.

    The standard audit/editor assumes template_kind, answer and per-question
    audio windows. Applying it to a programme form invents defects and can
    rewrite the source response contract through the standard question editor.
    """
    for exercise in exercises:
        payload = exercise.get("payload")
        if exercise.get("exercise_type") == "programme_form" or (
            isinstance(payload, dict) and payload.get("variant") == "programme_form_v1"
        ):
            raise HTTPException(
                409,
                "Bài nguồn programme_form_v1 chưa hỗ trợ audit hoặc sửa câu theo template chuẩn. "
                "Health chưa được xác minh; không dùng báo cáo này để sửa đáp án hay audio của bài nguồn.",
            )


@admin_router.get("/tests/{test_id}/preview")
async def admin_preview_listening_test(
    test_id: str,
    authorization: str | None = Header(default=None),
):
    """Xem trước một đề nghe bằng ĐÚNG giao diện chữa bài của học viên.

    Đợt 2 (mig 170). Reuses _assemble_listening_review byte for byte rather than
    rendering a second admin-only view: the point of a preview is to show what
    the student will actually see, and a parallel renderer drifts.

    Deliberately the CHỮA BÀI shape, not the exam shape — an admin verifying a
    paper needs the questions AND the answers AND the audio, which is exactly
    what the review payload carries and exactly what the exam payload strips.

    Creates NOTHING. The synthetic attempt below never touches the database, so
    previewing does not consume an attempt slot, does not appear in the
    student's history, and cannot be mistaken for a sitting.
    """
    from services import listening_test_grader as grader

    await require_admin(authorization)

    test_res = (
        supabase_admin.table("listening_tests").select("id")
        .eq("id", test_id).limit(1).execute()
    )
    if not test_res.data:
        raise HTTPException(404, "Test bundle not found")

    # Answer key = the same source the grader scores against, so the preview can
    # never show an admin something different from what it will mark.
    section_ids = [
        r["id"] for r in (
            supabase_admin.table("listening_content").select("id")
            .eq("test_id", test_id).execute().data or []
        )
    ]
    ex_rows = (
        supabase_admin.table("listening_exercises").select("payload")
        .in_("content_id", section_ids).execute().data or []
    ) if section_ids else []
    key = grader.collect_answer_key(ex_rows)

    synthetic = {
        "test_id":         test_id,
        "_admin_preview":  True,  # server-only; never persisted or accepted from learners
        # status 'submitted' is what makes the page render the review layout;
        # nothing is persisted, so this is a rendering hint, not a claim.
        "status":          "submitted",
        "score":           None,
        "band_estimate":   None,
        "trap_analytics":  {},
        "grading_details": [
            {
                "q_num":       k.get("q_num"),
                "correct":     False,
                "user_answer": "",          # nobody sat this
                "expected":    k.get("answer") or "",
            }
            for k in key if k.get("q_num") is not None
        ],
    }
    if any(k.get("scoring") == "self_check" for k in key):
        # Reuse group propagation so preview and submission label the same slots.
        synthetic["grading_details"] = grader.grade_attempt([], key)["per_question"]
    out = _assemble_listening_review(synthetic, None)
    out["preview"] = True                   # let the page label itself honestly
    return out


@admin_router.get("/tests/{test_id}/audit")
async def admin_get_test_audit(
    test_id: str,
    authorization: str | None = Header(default=None),
):
    """Fast structural + audio-bounds audit of a persisted test (NO LLM, no
    writes). Returns the live issue list + the last saved audit row (status /
    notes / previous full-run health). The admin audit dashboard + detail page
    call this to render health without a re-import."""
    await require_admin(authorization)
    test, contents, exercises = _fetch_test_audit_rows(test_id)
    try:
        _require_standard_audit_contract(exercises)
    except HTTPException as exc:
        if exc.status_code != 409:
            raise
        saved = _load_audit_row(test_id)
        if saved:
            saved = {**saved, "issues": listening_audit_svc.with_issue_sources(saved.get("issues"))}
        raise HTTPException(409, {
            "code": "unsupported_audit_contract",
            "uuid": test_id,
            "test_id": test.get("test_id"),
            "message": exc.detail,
            "saved": saved,
        }) from exc
    h = listening_audit_svc.hydrate_test(test, contents, exercises)
    report = listening_audit_svc.run_structural(h)
    saved = _load_audit_row(test_id)
    if saved:
        saved = {**saved, "issues": listening_audit_svc.with_issue_sources(saved.get("issues"))}
    # Editor view — the fields the audit-detail page renders + edits inline.
    editor_sections = [{
        "section_num": s["section_num"],
        "content_id":  s["content_id"],
        "content_updated_at": s["content_updated_at"],
        "audio_offset": s["audio_offset"],
        "transcript":  s["transcript"],
        "questions": [{
            "q_num":         q["q_num"],
            "exercise_id":   q["exercise_id"],
            "exercise_updated_at": q["exercise_updated_at"],
            "template_kind": q["template_kind"],
            "prompt":        q["prompt"],
            "options":       q["options"],
            "answer":        q["answer"],
            "alternatives":  q["alternatives"],
            "trap_mechanisms": q["trap_mechanisms"],
            "solution":      q["notes"],
            "audio_window":  q["audio_window"],
        } for q in s["questions"]],
    } for s in h["sections"]]
    return {
        "test_id":     test.get("test_id"),
        "uuid":        test_id,
        "title":       test.get("title"),
        "status":      test.get("status"),
        "test_type":   h.get("test_type"),
        "question_count": len(h["all_questions"]),
        "section_count":  len(h["sections"]),
        "sections":    editor_sections,   # for the inline editor
        "live":        report,            # {issues, health} from THIS structural run
        "saved":       saved,             # persisted listening_audit row (may be null)
    }


class _RoutedAuditProvider:
    """Claude first (services.ai_router), then the configured audit provider.

    The Claude answer must contain a parseable JSON array (the same shape
    `parse_llm_audit` reads) or the configured provider runs unchanged.
    `served_model` records which model actually produced the audit.
    """

    def __init__(self, legacy):
        self._legacy = legacy
        self.served_model: str | None = None

    async def invoke(self, system_prompt: str, user_message: str, **_kw) -> str:
        import json as _json
        import re as _re

        from services import ai_router

        def _validate(text: str):
            match = _re.search(r"\[.*\]", text, _re.DOTALL)
            if not match or not isinstance(_json.loads(match.group(0)), list):
                raise ValueError("audit response is not a JSON array")
            return text

        async def _claude() -> str:
            result, text = await ai_router.call_anthropic(
                "listening_audit", system=system_prompt, user=user_message,
                max_tokens=2048, operation="content_audit", validate=_validate,
            )
            self.served_model = result.model
            return text

        async def _legacy() -> str:
            if self._legacy is None:
                raise RuntimeError("LISTENING_AUDIT_MODEL provider not configured")
            text = await self._legacy.invoke(system_prompt, user_message)
            self.served_model = settings.LISTENING_AUDIT_MODEL
            return text

        return await ai_router.with_fallback(
            "listening_audit", legacy_provider="gemini",
            anthropic_call=_claude, legacy_call=_legacy,
        )


def _audit_provider():
    from services import ai_router
    from services.grading_orchestrator import _build_grading_primary
    anthropic_key = getattr(settings, "ANTHROPIC_API_KEY", "") or ""
    gemini_key = getattr(settings, "GEMINI_API_KEY", "") or ""
    try:
        legacy = _build_grading_primary(
            settings.LISTENING_AUDIT_MODEL,
            anthropic_key,
            gemini_key,
            feature="listening_audit",
            operation="content_audit",
        )
    except Exception:
        legacy = None
    # A Claude LISTENING_AUDIT_MODEL already is Anthropic; route only a Gemini one.
    if (str(settings.LISTENING_AUDIT_MODEL or "").lower().startswith("gemini")
            and ai_router.anthropic_position("listening_audit", "gemini")):
        return _RoutedAuditProvider(legacy)
    return legacy


class AuditRunRequest(BaseModel):
    """Optional client identity for a paid/non-idempotent full audit run.

    Legacy rollback callers may omit it. Native callers persist a UUID in their
    durable receipt and reconcile only against the same request_id in health.
    """
    model_config = ConfigDict(extra="forbid")
    request_id: str | None = Field(default=None, min_length=8, max_length=80,
                                   pattern=r"^[A-Za-z0-9_-]+$")


@admin_router.post("/tests/{test_id}/audit/run")
async def admin_run_test_audit(
    test_id: str,
    body: AuditRunRequest | None = None,
    authorization: str | None = Header(default=None),
):
    """Full audit: structural + audio-bounds + LLM content pass. PERSISTS the
    result to listening_audit (one row per test) and sets status
    passed/has_issues. The LLM pass degrades to an 'inconclusive' warning if no
    model key is configured or the call fails — it never blocks the structural
    result."""
    user = await require_admin(authorization)
    test, contents, exercises = _fetch_test_audit_rows(test_id)
    _require_standard_audit_contract(exercises)
    h = listening_audit_svc.hydrate_test(test, contents, exercises)

    issues = (listening_audit_svc.structural_checks(h)
              + listening_audit_svc.audio_bounds_checks(h))

    provider = _audit_provider()
    if provider is None:
        issues.append({"q_num": None, "dimension": "solution", "severity": "warning",
                       "code": "llm_skipped", "resolved": False,
                       "source": "llm",
                       "message": "Chưa cấu hình model audit (LISTENING_AUDIT_MODEL/API key) — bỏ qua LLM pass."})
    else:
        issues.extend(await listening_audit_svc.llm_content_audit(h, provider.invoke))

    from uuid import uuid4
    request_id = body.request_id if body and body.request_id else str(uuid4())
    health = {**listening_audit_svc.summarize(issues),
              "question_count": len(h["all_questions"]),
              "llm_model": ((getattr(provider, "served_model", None)
                             or settings.LISTENING_AUDIT_MODEL) if provider else None),
              "request_id": request_id}
    status = health["status"]
    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).isoformat()
    row = {
        "test_id":  test_id,
        "status":   status,
        "health":   health,
        "issues":   issues,
        "auditor":  (user or {}).get("id") or (user or {}).get("email"),
        "audited_at": now_iso,
        "updated_at": now_iso,
    }
    # upsert on the unique test_id
    existing = _load_audit_row(test_id)
    if existing:
        result = (supabase_admin.table("listening_audit").update(row)
                  .eq("test_id", test_id).execute())
    else:
        result = supabase_admin.table("listening_audit").insert(row).execute()
    if not (result.data or []):
        raise HTTPException(500, "Listening audit write was not confirmed by the database.")

    return {"test_id": test.get("test_id"), "uuid": test_id,
            "health": health, "issues": issues, "status": status,
            "audited_at": now_iso, "request_id": request_id}


class AuditTriageRequest(BaseModel):
    """Human triage of a persisted audit: update reviewer status / notes and/or
    mark specific issues resolved (by index into the saved issues array)."""
    model_config = ConfigDict(extra="forbid")
    status:          str | None = None       # 'pending'|'passed'|'has_issues'|'fixed'
    notes:           str | None = None
    resolved_indexes: list[int] | None = None
    expected_updated_at: str = Field(min_length=8, max_length=80)


_AUDIT_STATUSES = {"pending", "passed", "has_issues", "fixed"}


@admin_router.patch("/tests/{test_id}/audit")
async def admin_triage_test_audit(
    test_id: str,
    body: AuditTriageRequest,
    authorization: str | None = Header(default=None),
):
    """Reviewer triage — set audit status / notes and mark issues resolved. Does
    NOT re-run checks (use POST .../audit/run for that)."""
    await require_admin(authorization)
    row = _load_audit_row(test_id)
    if not row:
        raise HTTPException(404, "Chưa có bản audit cho test này — chạy audit trước.")
    if not _same_timestamp(row.get("updated_at"), body.expected_updated_at):
        raise HTTPException(
            409,
            "Listening audit changed after this triage was opened. Reload canonical data before saving.",
        )
    patch: dict[str, Any] = {}
    if body.status is not None:
        if body.status not in _AUDIT_STATUSES:
            raise HTTPException(422, f"status phải thuộc {sorted(_AUDIT_STATUSES)}.")
        patch["status"] = body.status
    if body.notes is not None:
        patch["notes"] = body.notes
    if body.resolved_indexes is not None:
        issues = list(row.get("issues") or [])
        requested = body.resolved_indexes
        if len(set(requested)) != len(requested) or any(i < 0 or i >= len(issues) for i in requested):
            raise HTTPException(422, "resolved_indexes chứa vị trí không hợp lệ hoặc bị trùng.")
        for i in requested:
            issues[i] = {**issues[i], "resolved": True}
        patch["issues"] = issues
    candidate_issues = patch.get("issues", list(row.get("issues") or []))
    if patch.get("status") in {"passed", "fixed"} and any(
        issue.get("severity") == "error" and not issue.get("resolved")
        for issue in candidate_issues if isinstance(issue, dict)
    ):
        raise HTTPException(
            422,
            "Không thể đánh dấu passed/fixed khi vẫn còn lỗi chưa được xử lý.",
        )
    if not patch:
        raise HTTPException(422, "Không có gì để cập nhật.")
    from datetime import datetime, timezone
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = (supabase_admin.table("listening_audit").update(patch)
              .eq("test_id", test_id)
              .eq("updated_at", body.expected_updated_at).execute())
    if not (result.data or []):
        raise HTTPException(
            409,
            "Listening audit changed while saving triage. Reload canonical data before retrying.",
        )
    return {"test_id": test_id, **patch}


class QuestionEditRequest(BaseModel):
    """In-place edit of ONE question inside a test-bundle exercise payload. All
    fields optional (partial update). Editing here never re-imports the test."""
    model_config = ConfigDict(extra="forbid")
    answer:          str | None = None
    alternatives:    list[str] | None = None
    prompt:          str | None = None
    solution:        str | None = None            # → solutions[q].why_correct + answers.notes
    trap_mechanisms: list[str] | None = None
    audio_window:    dict[str, Any] | None = None  # {start, end, section?}
    options:         list[dict[str, Any]] | None = None  # MCQ options [{letter,text}]; [] clears → short-answer
    expected_updated_at: str | None = Field(default=None, max_length=80)


def _fetch_exercise_ctx(exercise_id: str) -> tuple[dict, dict, dict]:
    """Return (exercise, content, test) for an exercise — for accurate audit
    bounds after an in-place edit. Raises 404 if the exercise is missing."""
    er = (supabase_admin.table("listening_exercises").select("*")
          .eq("id", exercise_id).limit(1).execute())
    if not er.data:
        raise HTTPException(404, "Exercise not found")
    ex = er.data[0]
    content = {}
    cr = (supabase_admin.table("listening_content").select("*")
          .eq("id", ex.get("content_id")).limit(1).execute())
    if cr.data:
        content = cr.data[0]
    test = {}
    if content.get("test_id"):
        tr = (supabase_admin.table("listening_tests").select("*")
              .eq("id", content["test_id"]).limit(1).execute())
        if tr.data:
            test = tr.data[0]
    return ex, content, test


@admin_router.patch("/exercises/{exercise_id}/questions/{q_num}")
async def admin_edit_exercise_question(
    exercise_id: str,
    q_num: int,
    body: QuestionEditRequest,
    authorization: str | None = Header(default=None),
):
    """Edit ONE question in place — answer / alternatives / prompt / solution /
    trap_mechanisms / audio_window — writing straight into the exercise payload
    JSONB. This is the core "fix without re-import" primitive behind the audit
    editor. Preserves mcq_multi grouping (group_key is derived from answers[0]
    at grade time, so per-slot edits stay valid). Returns the updated question +
    a fresh structural/audio re-check for it."""
    await require_admin(authorization)
    ex, content, test = _fetch_exercise_ctx(exercise_id)
    _require_standard_audit_contract([ex])
    expected_updated_at = (body.expected_updated_at or "").strip() or None
    if expected_updated_at and not _same_timestamp(ex.get("updated_at"), expected_updated_at):
        raise HTTPException(
            409,
            "Listening exercise changed after this editor was opened. Reload canonical data before saving.",
        )
    payload = dict(ex.get("payload") or {})

    def _int(x):
        try: return int(str(x).strip())
        except (TypeError, ValueError): return None

    questions = list(payload.get("questions") or [])
    answers = list(payload.get("answers") or [])
    q_idx = next((i for i, q in enumerate(questions) if _int(q.get("q_num")) == q_num), None)
    if q_idx is None:
        raise HTTPException(404, f"Câu {q_num} không có trong exercise này.")
    a_idx = next((i for i, a in enumerate(answers) if _int(a.get("q_num")) == q_num), None)

    changed: list[str] = []
    shared_option_bank = payload.get("template_kind") in {"matching", "mcq_multi"}
    if body.prompt is not None:
        questions[q_idx] = {**questions[q_idx], "prompt": body.prompt}
        changed.append("prompt")
    if body.options is not None:
        if shared_option_bank:
            metadata = dict(payload.get("metadata") or {})
            if body.options:
                metadata["match_options"] = body.options
            else:
                metadata.pop("match_options", None)
            payload["metadata"] = metadata
        else:
            q_obj = dict(questions[q_idx])
            if body.options:
                q_obj["options"] = body.options
            else:
                q_obj.pop("options", None)   # empty → het-block short-answer (text gap)
            questions[q_idx] = q_obj
        changed.append("options")

    if a_idx is not None:
        ans = dict(answers[a_idx])
        if body.answer is not None:
            ans["answer"] = body.answer; changed.append("answer")
        if body.alternatives is not None:
            ans["alternatives"] = body.alternatives; changed.append("alternatives")
        if body.trap_mechanisms is not None:
            ans["trap_mechanisms"] = body.trap_mechanisms; changed.append("trap_mechanisms")
        if body.solution is not None:
            ans["notes"] = body.solution; changed.append("solution")
        answers[a_idx] = ans
    elif any(v is not None for v in (body.answer, body.alternatives, body.trap_mechanisms, body.solution)):
        raise HTTPException(422, f"Câu {q_num} không có answer entry để sửa đáp án/bài giải.")

    if payload.get("template_kind") == "keep_change" and any(
        v is not None for v in (body.prompt, body.answer, body.alternatives)
    ):
        # The editor exposes the persisted key: KEEP or bare correction text,
        # with separate alternatives. Validate the resulting key before writing
        # either half; grading reads action from answers and printed_value from questions.
        from services.listening_test_grader import normalize_answer

        if a_idx is None:
            raise HTTPException(422, "Câu này không có answer entry cho keep_change.")
        question = dict(questions[q_idx])
        ans = dict(answers[a_idx])
        printed = question.get("prompt")
        answer = ans.get("answer")
        if not isinstance(printed, str) or not normalize_answer(printed):
            raise HTTPException(422, "Câu này: keep_change cần printed value trong prompt.")
        if not isinstance(answer, str) or not answer.strip():
            raise HTTPException(422, "Câu này: keep_change cần KEEP hoặc nội dung sửa.")
        action = "KEEP" if answer.strip().upper() == "KEEP" else "CHANGE"
        alternatives = ans.get("alternatives") or []
        if action == "KEEP":
            if body.alternatives:
                raise HTTPException(422, "Câu này: KEEP không được có alternatives sửa nội dung.")
            canonical, alternatives = answer, []
        else:
            canonical = answer
            if not isinstance(alternatives, list):
                raise HTTPException(422, "Câu này: alternatives phải là danh sách nội dung sửa.")
            for value in [canonical, *alternatives]:
                if (not isinstance(value, str) or not normalize_answer(value)
                        or value.strip().upper() in {"KEEP", "CHANGE"}
                        or re.match(r"^(?:KEEP|CHANGE)\s*:", value.strip(), re.IGNORECASE)
                        or normalize_answer(value) == normalize_answer(printed)):
                    raise HTTPException(
                        422,
                        "Câu này: CHANGE cần nội dung sửa khác printed value; "
                        "answer/alternatives chỉ chứa nội dung, không chứa nhãn KEEP/CHANGE.",
                    )
        synced = {"answer": canonical, "alternatives": alternatives, "keep_change_action": action}
        for field, value in synced.items():
            if ans.get(field) != value and field not in changed:
                changed.append(field)
        if question.get("printed_value") != printed:
            changed.append("printed_value")
        questions[q_idx] = {**question, "printed_value": printed}
        answers[a_idx] = {**ans, **synced}

    payload["questions"] = questions
    payload["answers"] = answers

    if body.solution is not None:
        sols = dict(payload.get("solutions") or {})
        cur = dict(sols.get(str(q_num)) or {})
        cur["why_correct"] = body.solution
        if body.answer is not None:
            cur["answer"] = body.answer
        sols[str(q_num)] = cur
        payload["solutions"] = sols

    if "audio_window" in body.model_fields_set:
        wins = dict(payload.get("audio_windows") or {})
        if body.audio_window is None:
            wins.pop(str(q_num), None)
            wins.pop(q_num, None)
        else:
            w = body.audio_window
            s, e = w.get("start"), w.get("end")
            if s is None or e is None:
                raise HTTPException(422, "audio_window cần cả start và end.")
            try:
                s, e = float(s), float(e)
            except (TypeError, ValueError):
                raise HTTPException(422, "audio_window start/end phải là số.")
            if s < 0 or e <= s:
                raise HTTPException(422, f"audio_window không hợp lệ (cần start ≥ 0, end > start: {s}–{e}).")
            new_w = {"start": round(s, 2), "end": round(e, 2)}
            if w.get("section"):
                new_w["section"] = w["section"]
            elif isinstance(wins.get(str(q_num)), dict) and wins[str(q_num)].get("section"):
                new_w["section"] = wins[str(q_num)]["section"]
            else:
                section_num = _int(content.get("section_num"))
                if section_num is None or section_num < 1:
                    raise HTTPException(422, "Không xác định được section cho audio_window mới.")
                new_w["section"] = f"S{section_num}"
            wins[str(q_num)] = new_w
        payload["audio_windows"] = wins
        changed.append("audio_window")

    if not changed:
        raise HTTPException(422, "Không có trường nào để sửa.")

    from datetime import datetime, timezone
    updated_at = datetime.now(timezone.utc).isoformat()
    mutation = (supabase_admin.table("listening_exercises")
                .update({"payload": payload, "updated_at": updated_at})
                .eq("id", exercise_id))
    if expected_updated_at:
        mutation = mutation.eq("updated_at", expected_updated_at)
    result = mutation.execute()
    rows = result.data or []
    if not rows:
        if expected_updated_at:
            raise HTTPException(
                409,
                "Listening exercise changed while saving. Reload canonical data before retrying.",
            )
        raise HTTPException(
            500,
            "Listening exercise update was not confirmed by the database.",
        )

    # Re-check just this question (structural + audio bounds) so the editor can
    # show whether the fix cleared the issue.
    updated_ex = {**ex, "payload": payload, "updated_at": updated_at}
    h = listening_audit_svc.hydrate_test(test or {"id": content.get("test_id")},
                                         [content] if content else [], [updated_ex])
    issues = [i for i in (listening_audit_svc.structural_checks(h)
                          + listening_audit_svc.audio_bounds_checks(h))
              if i.get("q_num") == q_num]

    q_view = next((q for q in h["all_questions"] if q["q_num"] == q_num), None)
    return {
        "exercise_id": exercise_id,
        "q_num":       q_num,
        "changed":     changed,
        "updated_at":  updated_at,
        "question":    q_view,
        "issues":      issues,
        "ok":          not any(i["severity"] == "error" for i in issues),
    }


_AUDIO_ASSEMBLY_MODES = {"full_premixed", "parts_auto_assembled", "parts_only"}


class TestAudioModePatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: str


class TestAudioAssembleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    narrator_voice_id: Optional[str] = None
    narrator_model:    Optional[str] = None


def _fetch_test_or_404(test_id: str) -> dict:
    res = (
        supabase_admin.table("listening_tests")
        .select("*")
        .eq("id", test_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Test bundle not found")
    return res.data[0]


@admin_router.post("/tests/{test_id}/audio/full")
async def admin_upload_test_full_audio(
    test_id: str,
    audio: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    """Upload an Andy-pre-mixed 30-min audio for a Cambridge test bundle.

    Sets ``listening_tests.full_audio_*`` columns + auto-sets
    ``audio_assembly_mode='full_premixed'`` when previously NULL.
    """
    from services import listening_audio

    await require_admin(authorization)
    test = _fetch_test_or_404(test_id)

    name = (audio.filename or "").lower()
    if not name.endswith(".mp3"):
        from services.storage_limits import upload_error
        raise upload_error("listening-audio", 415, message=f"Audio phải là .mp3 (nhận: {clip_user_value(audio.filename)!r})",
                           allowed=["audio/mpeg"])
    from services.storage_limits import read_upload_capped, upload_error
    data = read_upload_capped(
        audio, listening_audio.FULL_AUDIO_MAX_BYTES,
        lambda _size: upload_error("listening-audio", 413, max_bytes=listening_audio.FULL_AUDIO_MAX_BYTES))

    result = listening_audio.validate_full_audio(data)
    if result["errors"]:
        raise HTTPException(422, "; ".join(result["errors"]))

    storage_path = f"tests/{test_id}/full.mp3"
    _upload_audio_to_bucket(storage_path, data)

    update: dict = {
        "full_audio_storage_path":     storage_path,
        "full_audio_duration_seconds": result["duration_seconds"],
        "full_audio_size_bytes":       result["size_bytes"],
    }
    if not test.get("audio_assembly_mode"):
        update["audio_assembly_mode"] = "full_premixed"

    (
        supabase_admin.table("listening_tests")
        .update(update)
        .eq("id", test_id)
        .execute()
    )

    signed = None
    try:
        s = supabase_admin.storage.from_(settings.LISTENING_AUDIO_BUCKET) \
            .create_signed_url(storage_path, 3600)
        signed = (s or {}).get("signedURL") or (s or {}).get("signed_url")
    except Exception:                                                       # pragma: no cover
        pass

    return {
        "full_audio_storage_path":     storage_path,
        "full_audio_duration_seconds": result["duration_seconds"],
        "full_audio_size_bytes":       result["size_bytes"],
        "audio_assembly_mode":         update.get("audio_assembly_mode")
                                       or test.get("audio_assembly_mode"),
        "signed_url":                  signed,
        "warnings":                    result["warnings"],
    }


@admin_router.post("/tests/{test_id}/audio/section/{section_num}")
async def admin_upload_test_section_audio(
    test_id: str,
    section_num: int,
    audio: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    """Upload a per-section MP3 (3-8 min target) to a Cambridge test.

    Updates the matching ``listening_content`` row's audio_* fields.
    Auto-sets ``listening_tests.audio_assembly_mode='parts_only'`` when
    previously NULL (Andy can promote to ``parts_auto_assembled`` later
    via the mode PATCH).
    """
    from services import listening_audio

    await require_admin(authorization)
    if not (1 <= section_num <= 4):
        raise HTTPException(422, "section_num must be 1-4")
    test = _fetch_test_or_404(test_id)

    name = (audio.filename or "").lower()
    if not name.endswith(".mp3"):
        from services.storage_limits import upload_error
        raise upload_error("listening-audio", 415, message=f"Audio phải là .mp3 (nhận: {clip_user_value(audio.filename)!r})",
                           allowed=["audio/mpeg"])
    from services.storage_limits import read_upload_capped, upload_error
    data = read_upload_capped(
        audio, listening_audio.SECTION_AUDIO_MAX_BYTES,
        lambda _size: upload_error("listening-audio", 413, max_bytes=listening_audio.SECTION_AUDIO_MAX_BYTES))

    result = listening_audio.validate_section_audio(data)
    if result["errors"]:
        raise HTTPException(422, "; ".join(result["errors"]))

    # Locate the section content row.
    sec_res = (
        supabase_admin.table("listening_content")
        .select("id")
        .eq("test_id", test_id)
        .eq("section_num", section_num)
        .limit(1)
        .execute()
    )
    if not sec_res.data:
        raise HTTPException(
            404,
            f"Section {section_num} row missing — test này chưa có content row "
            f"cho section đó. Import lại đề (import-fulltest) trước khi upload.",
        )
    content_id = sec_res.data[0]["id"]

    storage_path = f"tests/{test_id}/section-{section_num}.mp3"
    _upload_audio_to_bucket(storage_path, data)

    (
        supabase_admin.table("listening_content")
        .update({
            "audio_storage_path":     storage_path,
            "audio_duration_seconds": result["duration_seconds"],
            "audio_size_bytes":       result["size_bytes"],
        })
        .eq("id", content_id)
        .execute()
    )

    tests_update: dict = {}
    if not test.get("audio_assembly_mode"):
        tests_update["audio_assembly_mode"] = "parts_only"
    # Any section change invalidates the cached assembled audio. We
    # don't delete the file (preserve history) but null the path so the
    # assemble endpoint re-renders on next click.
    if test.get("assembled_audio_storage_path"):
        tests_update["assembled_audio_storage_path"] = None
        tests_update["assembled_audio_generated_at"] = None

    if tests_update:
        (
            supabase_admin.table("listening_tests")
            .update(tests_update)
            .eq("id", test_id)
            .execute()
        )

    return {
        "content_id":             content_id,
        "section_num":            section_num,
        "audio_storage_path":     storage_path,
        "audio_duration_seconds": result["duration_seconds"],
        "audio_size_bytes":       result["size_bytes"],
        "warnings":               result["warnings"],
    }


@admin_router.post("/tests/{test_id}/audio/assemble")
async def admin_assemble_test_audio(
    test_id: str,
    body: TestAudioAssembleRequest = TestAudioAssembleRequest(),
    authorization: str | None = Header(default=None),
):
    """Render narrator intros via ElevenLabs + concatenate the 4 section
    audios + pauses into a single assembled-test MP3.

    Requires:
      * audio_assembly_mode in (NULL, 'parts_only', 'parts_auto_assembled')
      * 4 listening_content rows with audio_storage_path populated
      * ELEVENLABS_API_KEY configured (otherwise 503)
      * ffmpeg installed in the runtime env (otherwise 500)
    """
    from services import listening_audio

    await require_admin(authorization)
    if not settings.ELEVENLABS_API_KEY:
        raise HTTPException(
            503,
            "Assembly cần ELEVENLABS_API_KEY để render narrator. "
            "Liên hệ ops để cấu hình.",
        )

    test = _fetch_test_or_404(test_id)

    sections_res = (
        supabase_admin.table("listening_content")
        .select("id,section_num,audio_storage_path,metadata,updated_at")
        .eq("test_id", test_id)
        .order("section_num")
        .execute()
    )
    rows = sections_res.data or []
    by_section = {r["section_num"]: r for r in rows}
    missing = [n for n in (1, 2, 3, 4) if not by_section.get(n)
               or not by_section[n].get("audio_storage_path")]
    if missing:
        raise HTTPException(
            422,
            f"Section(s) {missing} chưa có audio — upload tất cả 4 parts "
            f"trước khi assemble.",
        )

    # Idempotency: if assembled is fresher than every section update, skip.
    last_generated = test.get("assembled_audio_generated_at")
    if last_generated and test.get("assembled_audio_storage_path"):
        try:
            max_section_updated = max(r.get("updated_at") or "" for r in rows)
            if max_section_updated and max_section_updated <= last_generated:
                return {
                    "assembled_audio_storage_path": test["assembled_audio_storage_path"],
                    "duration_seconds":             None,
                    "cue_points":                   test.get("cue_points") or [],
                    "narrator_credit_estimate":     0,
                    "cached":                       True,
                }
        except Exception:                                                   # pragma: no cover
            pass

    # Download the 4 section audios from storage.
    section_audios: list[bytes] = []
    narrator_intros: list[Any] = []
    for n in (1, 2, 3, 4):
        row = by_section[n]
        try:
            audio_bytes = supabase_admin.storage \
                .from_(settings.LISTENING_AUDIO_BUCKET) \
                .download(row["audio_storage_path"])
        except Exception as exc:
            logger.error("[listening] section %s audio download failed test=%s: %s",
                         n, test_id, exc, exc_info=True)
            raise HTTPException(
                500,
                f"Không tải được audio section {n}. Vui lòng thử lại.",
            ) from None
        section_audios.append(audio_bytes)
        narrator_intros.append((row.get("metadata") or {}).get("narrator_intro"))

    voice_id = (body.narrator_voice_id or listening_audio.DEFAULT_NARRATOR_VOICE).strip()
    model    = (body.narrator_model or listening_audio.DEFAULT_NARRATOR_MODEL).strip()

    try:
        assembly = listening_audio.assemble_test_audio(
            section_audios, narrator_intros,
            narrator_voice_id=voice_id, narrator_model=model,
        )
    except Exception as exc:
        logger.exception("Assembly failed for test %s", test_id)
        raise HTTPException(
            500,
            "Assembly thất bại. Kiểm tra ffmpeg + ElevenLabs quota.",
        ) from None

    storage_path = f"tests/{test_id}/assembled.mp3"
    _upload_audio_to_bucket(storage_path, assembly.mp3_bytes)

    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).isoformat()

    (
        supabase_admin.table("listening_tests")
        .update({
            "assembled_audio_storage_path": storage_path,
            "assembled_audio_generated_at": now_iso,
            "cue_points":                   assembly.cue_points,
            "audio_assembly_mode":          "parts_auto_assembled",
        })
        .eq("id", test_id)
        .execute()
    )

    return {
        "assembled_audio_storage_path": storage_path,
        "duration_seconds":             assembly.duration_seconds,
        "cue_points":                   assembly.cue_points,
        "narrator_credit_estimate":     assembly.narrator_credit_estimate,
        "cached":                       False,
    }


@admin_router.patch("/tests/{test_id}/audio/mode")
async def admin_patch_test_audio_mode(
    test_id: str,
    body: TestAudioModePatchRequest,
    authorization: str | None = Header(default=None),
):
    """Switch the audio assembly mode on a Cambridge test bundle.

    Sprint 13.4.3.1 — soft validation. The mode toggle is treated as
    exploratory state during the setup flow; admins may pick a mode
    *before* uploading audio so the corresponding upload UI appears.
    Audio readiness is enforced at publish time via
    ``services.listening_audio.can_publish`` (Sprint 13.4.3).

    Validation here is limited to the enum allow-list. Mode value must
    be one of {full_premixed, parts_auto_assembled, parts_only}.
    """
    await require_admin(authorization)
    mode = (body.mode or "").strip().lower()
    if mode not in _AUDIO_ASSEMBLY_MODES:
        raise HTTPException(
            422, f"mode must be one of {sorted(_AUDIO_ASSEMBLY_MODES)}",
        )

    _fetch_test_or_404(test_id)

    (
        supabase_admin.table("listening_tests")
        .update({"audio_assembly_mode": mode})
        .eq("id", test_id)
        .execute()
    )
    return {"id": test_id, "audio_assembly_mode": mode}


@admin_router.get("/tests/{test_id}/audio/signed-urls")
async def admin_get_test_audio_signed_urls(
    test_id: str,
    expires_in: int = Query(default=3600, ge=60, le=86400),
    authorization: str | None = Header(default=None),
):
    """Sprint 13.4.3.2 — bundle signed URLs for admin preview of a test
    bundle's audio assets.

    Returns ``{full, assembled, sections: [{section_num, signed_url}, ...]}``
    with ``signed_url=None`` for any asset that doesn't exist yet. One
    round-trip per page render — the previous design forced N+1 fetches
    (one per asset) which slowed the tests-detail page on cold load.

    ``expires_in`` is in seconds (default 1h, max 24h).
    """
    await require_admin(authorization)
    test = _fetch_test_or_404(test_id)

    bucket = supabase_admin.storage.from_(settings.LISTENING_AUDIO_BUCKET)

    def _sign(path: str | None) -> str | None:
        if not path:
            return None
        try:
            res = bucket.create_signed_url(path, expires_in)
        except Exception as exc:                                            # pragma: no cover
            logger.warning("[listening] signed URL mint failed for %s: %s", path, exc)
            return None
        return (res or {}).get("signedURL") or (res or {}).get("signed_url")

    sections_res = (
        supabase_admin.table("listening_content")
        .select("section_num,audio_storage_path")
        .eq("test_id", test_id)
        .order("section_num")
        .execute()
    )
    section_signed = []
    for n in (1, 2, 3, 4):
        row = next(
            (r for r in (sections_res.data or []) if r.get("section_num") == n),
            None,
        )
        section_signed.append({
            "section_num":         n,
            "audio_storage_path":  (row or {}).get("audio_storage_path"),
            "signed_url":          _sign((row or {}).get("audio_storage_path")),
        })

    return {
        "full": {
            "audio_storage_path": test.get("full_audio_storage_path"),
            "signed_url":         _sign(test.get("full_audio_storage_path")),
            "duration_seconds":   test.get("full_audio_duration_seconds"),
            "size_bytes":         test.get("full_audio_size_bytes"),
        },
        "assembled": {
            "audio_storage_path": test.get("assembled_audio_storage_path"),
            "signed_url":         _sign(test.get("assembled_audio_storage_path")),
            "generated_at":       test.get("assembled_audio_generated_at"),
        },
        "sections":   section_signed,
        "expires_in": expires_in,
    }


# ── Map image helpers (shared by manual upload / delete / signed-url) ─────


def _fetch_exercise_or_404(exercise_id: str) -> dict:
    res = (
        supabase_admin.table("listening_exercises")
        .select("*")
        .eq("id", exercise_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Exercise not found")
    return res.data[0]


def _sign_programme_visual_url(storage_path: str | None, expires_in: int = 7200) -> str | None:
    """Sign an immutable package visual stored beside its private form audio."""
    if not storage_path:
        return None
    try:
        signed = supabase_admin.storage.from_(
            settings.LISTENING_AUDIO_BUCKET
        ).create_signed_url(storage_path, expires_in)
    except Exception as exc:  # pragma: no cover - provider-specific failure
        logger.warning("[listening-programme] visual signed URL failed: %s", exc)
        return None
    return (signed or {}).get("signedURL") or (signed or {}).get("signed_url")


# ── Sprint 13.5.9.3 — manual upload escape hatch ──────────────────────────


# Magic-byte signatures for the formats we accept. Dependency-free
# alternative to PIL: every byte sequence below is unique to its
# format header, so a 16-byte prefix check is enough to reject GIFs,
# BMPs, SVGs, PDFs, and corrupted files.
_IMAGE_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n",            "png"),
    (b"\xff\xd8\xff",                 "jpg"),
    # WebP carries an 8-byte ``RIFF????`` prefix then ``WEBP``. We
    # match the prefix + WEBP marker manually below since the length
    # bytes between them are variable.
)

_MANUAL_UPLOAD_MAX_BYTES = 5 * 1024 * 1024   # 5 MB hard cap
_MANUAL_UPLOAD_MIN_BYTES = 100               # sanity floor — anything
                                             # smaller is empty / corrupt


def _detect_image_format(data: bytes) -> str | None:
    """Return ``"png" / "jpg" / "webp"`` based on the magic-byte
    prefix, or ``None`` for any other format. Used as the only image
    validation in the manual-upload path — there's no Pillow / Magic
    dependency in this codebase, so byte signatures are the cheap +
    reliable check.
    """
    if not data or len(data) < 12:
        return None
    for sig, fmt in _IMAGE_SIGNATURES:
        if data.startswith(sig):
            return fmt
    # WebP: ``RIFF\x??\x??\x??\x??WEBP``.
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


@admin_router.post("/exercises/{exercise_id}/upload-map-image")
async def admin_upload_map_image(
    exercise_id: str,
    image_file: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    """Sprint 13.5.9.3 — manual upload escape hatch.

    Andy's authoring loop sometimes produces a higher-quality map
    image via an external tool (e.g. the standalone Gemini Banana
    web app) than any of the six in-app API models. This endpoint
    persists that pre-generated image into the same Supabase Storage
    bucket / payload schema as the API path, so the student player
    treats both sources identically.

    Validation chain (all return 4xx before any storage call):
      * variant guard       — plan-label exercises only (422)
      * size                — 100 B floor / 5 MB cap (400 / 413)
      * format              — PNG / JPG / WebP via magic-byte sniff (415)

    The payload tags ``map_image_source = "manual_upload"`` and
    nulls out ``map_image_model`` + ``map_image_prompt_source`` so
    the admin panel can render the right source badge without any
    follow-up round-trip.
    """
    import time
    from datetime import datetime, timezone

    admin_user = await require_admin(authorization)
    exercise = _fetch_exercise_or_404(exercise_id)

    payload = dict(exercise.get("payload") or {})
    variant = payload.get("variant") or exercise.get("variant")
    template_kind = payload.get("template_kind")
    if variant != "mcq_letter_label" and template_kind != "plan_label":
        raise HTTPException(
            422,
            "Map image upload is only available for plan-label exercises "
            "(variant=mcq_letter_label).",
        )

    contents = await image_file.read()
    if len(contents) < _MANUAL_UPLOAD_MIN_BYTES:
        raise HTTPException(
            400,
            f"Image file too small ({len(contents)} bytes) — likely "
            "empty or corrupted.",
        )
    if len(contents) > _MANUAL_UPLOAD_MAX_BYTES:
        from services.storage_limits import upload_error
        raise upload_error("listening-images", 413, max_bytes=_MANUAL_UPLOAD_MAX_BYTES)

    fmt = _detect_image_format(contents)
    if fmt is None:
        from services.storage_limits import upload_error
        raise upload_error("listening-images", 415)

    # Resolve parent test_id for storage pathing (mirrors the API
    # path's resolution so both sources share one bucket prefix).
    content_id = exercise.get("content_id")
    content_res = (
        supabase_admin.table("listening_content")
        .select("test_id")
        .eq("id", content_id)
        .limit(1)
        .execute()
    )
    test_id = (content_res.data or [{}])[0].get("test_id")
    if not test_id:
        raise HTTPException(500, "Exercise has no parent test bundle.")

    # Storage path — lives alongside API-generated images under
    # ``tests/<test_uuid>/maps/`` so the existing delete endpoint
    # cleans it up the same way.
    timestamp = int(time.time())
    storage_path = (
        f"tests/{test_id}/maps/{exercise_id}-manual-{timestamp}.{fmt}"
    )
    resolved_bucket = settings.LISTENING_IMAGES_BUCKET

    content_type = "image/jpeg" if fmt == "jpg" else f"image/{fmt}"
    from services.storage_limits import check_upload, raise_storage_error
    check_upload("listening-images", len(contents), content_type)
    try:
        supabase_admin.storage.from_(resolved_bucket).upload(
            storage_path,
            contents,
            {"content-type": content_type, "upsert": "true"},
        )
    except Exception as exc:                                              # pragma: no cover
        raise_storage_error("listening-images", exc)
        logger.error("[map_image] manual upload to storage failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Không tải được file lên kho lưu trữ. Vui lòng thử lại.") from None

    # Sprint 13.5.6 left these fields on the payload root; the admin
    # panel reads them from there. Manual uploads use the same shape
    # but null out the API-only fields + tag the new source.
    now_iso = datetime.now(timezone.utc).isoformat()
    payload.update({
        "map_image_storage_path":  storage_path,
        "map_image_size_bytes":    len(contents),
        "map_image_source":        "manual_upload",
        "map_image_model":         None,
        "map_image_prompt":        None,
        "map_image_prompt_source": None,
        "map_image_generated_at":  now_iso,
        "map_image_uploaded_at":   now_iso,
        "map_image_uploaded_by":   admin_user.get("id"),
    })
    (
        supabase_admin.table("listening_exercises")
        .update({"payload": payload})
        .eq("id", exercise_id)
        .execute()
    )

    logger.info(
        "[map_image] manual upload exercise=%s size=%d fmt=%s by=%s",
        exercise_id, len(contents), fmt, admin_user.get("id"),
    )

    return {
        "exercise_id":            exercise_id,
        "map_image_storage_path": storage_path,
        "map_image_size_bytes":   len(contents),
        "map_image_format":       fmt,
        "map_image_source":       "manual_upload",
        "map_image_uploaded_at":  now_iso,
        "signed_url":             _sign_map_image_url(storage_path),
    }


@admin_router.delete("/exercises/{exercise_id}/map-image")
async def admin_delete_map_image(
    exercise_id: str,
    authorization: str | None = Header(default=None),
):
    """Sprint 13.5.6 — remove the generated map image so the admin can
    regenerate with a different model or a refined description. Both
    the Storage object and the payload metadata are cleared.
    """
    await require_admin(authorization)
    exercise = _fetch_exercise_or_404(exercise_id)
    payload = dict(exercise.get("payload") or {})
    storage_path = payload.get("map_image_storage_path")

    if storage_path:
        try:
            supabase_admin.storage.from_(
                settings.LISTENING_IMAGES_BUCKET
            ).remove([storage_path])
        except Exception as exc:                                              # pragma: no cover
            logger.warning("[map_image] storage delete failed for %s: %s", storage_path, exc)

    cleared = False
    # Sprint 13.5.9.3 — clear the new manual-upload tags too so a
    # delete followed by a fresh API generate doesn't carry stale
    # provenance metadata.
    for key in (
        "map_image_storage_path",
        "map_image_size_bytes",
        "map_image_model",
        "map_image_prompt",
        "map_image_prompt_source",
        "map_image_generated_at",
        "map_image_source",
        "map_image_uploaded_at",
        "map_image_uploaded_by",
    ):
        if key in payload:
            payload.pop(key, None)
            cleared = True

    if cleared:
        (
            supabase_admin.table("listening_exercises")
            .update({"payload": payload})
            .eq("id", exercise_id)
            .execute()
        )

    return {"deleted": True, "had_image": bool(storage_path)}


@admin_router.get("/exercises/{exercise_id}/map-image/signed-url")
async def admin_get_map_image_signed_url(
    exercise_id: str,
    expires_in: int = Query(default=3600, ge=60, le=86400),
    authorization: str | None = Header(default=None),
):
    """Sprint 13.5.6 — fresh signed URL for an admin preview (the URL
    expires; the page calls this on refresh).
    """
    await require_admin(authorization)
    exercise = _fetch_exercise_or_404(exercise_id)
    payload = exercise.get("payload") or {}
    storage_path = payload.get("map_image_storage_path")
    if not storage_path:
        raise HTTPException(404, "No map image generated for this exercise.")
    url = _sign_map_image_url(storage_path, expires_in)
    if not url:
        raise HTTPException(500, "Signed URL could not be minted.")
    return {
        "exercise_id":            exercise_id,
        "signed_url":             url,
        "expires_in":             expires_in,
        "map_image_model":        payload.get("map_image_model"),
        "map_image_generated_at": payload.get("map_image_generated_at"),
    }
