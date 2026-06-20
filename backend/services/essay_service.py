"""services/essay_service.py — Essay submission + async grading orchestration
(Sprint W2 Phase 2).

Responsibilities:
  • create_essay_with_job — insert writing_essays + writing_jobs rows and
    return enough info for the caller to schedule the BG task.
  • _bg_grade_essay — async BG task that runs the Gemini grader and writes
    writing_feedback. Failure modes mark essay+job as failed and store
    error_message; in-task retry is handled inside the grader (3 attempts
    with exponential backoff) per Sprint W2 Q1 (Option A).
  • list_essays / get_essay_with_feedback — read paths for admin UI.
  • estimate_eta_seconds — lookup table for level/model combos.

Phase 1 admin-only: callers come from /admin/writing/* routes which gate
with require_admin. Uses service-role `supabase_admin`.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException

from database import supabase_admin
from models.writing_feedback import (
    GraderConfig,
    GradingTier,
    WritingFeedback,
    validate_level_coverage,
)
from services.gemini_writing_grader import (
    AISafetyBlockError,
    APIRetryFailedError,
    InvalidJSONError,
    get_grader,
)
from services.writing_history import (
    get_band_trajectory,
    get_recurring_patterns,
    get_sentence_structure_history,
)
from services.band_rounding import overall_from_criteria
from services.mistake_authenticity import drop_noncorrection_mistakes

logger = logging.getLogger(__name__)


# ── ETA lookup (Sprint W2 Q2) ────────────────────────────────────────
# Keys are (analysis_level, selected_model). Default 60s when not listed.

_ETA_TABLE: dict[tuple[int, str], int] = {
    (1, "gemini-2.5-flash"): 15,
    (3, "gemini-2.5-pro"):   45,
    (5, "gemini-2.5-pro"):   90,
}
_ETA_DEFAULT_SECONDS = 60


def estimate_eta_seconds(
    *,
    analysis_level: int,
    selected_model: str,
    grading_tier: str = "standard",
) -> int:
    """Lookup grading-time estimate for (level, model, tier). Used for
    client polling UX — not authoritative.

    Sprint 2.7b: Deep tier overrides the (level, model) table. Deep
    runs three sequential Gemini calls; the per-pass timeouts are
    90 / 90 / 180s, so a generous estimate for the polling client
    is ~3 minutes (180s). Standard tier behaviour unchanged.
    """
    if grading_tier == "deep":
        return 240  # ~4 min — covers all three passes plus margin
    return _ETA_TABLE.get((analysis_level, selected_model), _ETA_DEFAULT_SECONDS)


# ── Helpers ──────────────────────────────────────────────────────────

def _now() -> str:
    """ISO-8601 UTC timestamp, matching CLAUDE.md guidance."""
    return datetime.now(timezone.utc).isoformat()


def _word_count(text: str) -> int:
    return len(text.split())


def _ensure_student_exists(student_id: str) -> None:
    r = (
        supabase_admin.table("students")
        .select("id")
        .eq("id", student_id)
        .limit(1)
        .execute()
    )
    if not r.data:
        raise HTTPException(404, f"Student not found: {student_id}")


# ── Submission ───────────────────────────────────────────────────────


# Keys recognised by `create_essay_row_only` beyond the core six. Callers
# (notably the student submit path's flagged branch) pass these through
# the same `data` dict to avoid plumbing N kwargs.
_OPTIONAL_ESSAY_FIELDS = (
    "is_flagged",
    "flag_reasons",
    "flagged_at",
    "delivered_at",
    "error_message",
    "paste_events",
    "suspicious_paste",
)


def create_essay_row_only(*, data: dict, admin_id: str) -> dict:
    """Sprint 2.7.1: insert ONE writing_essays row, NO grading job,
    NO assignment link. The first leg of the SAGA-pattern submit.

    Caller is responsible for either:
      • calling `schedule_grading_job(essay_id=…)` next (clean path), OR
      • leaving the row terminal (flagged path: status=delivered).

    Returns: {"essay_id": <uuid>, "eta_seconds": <int>}.

    `eta_seconds` is computed eagerly from (analysis_level, model) so
    the router can return it in the success response without an
    extra hop, even though no job has been queued yet."""
    student_id       = data["student_id"]
    task_type        = data["task_type"]
    prompt_text      = data["prompt_text"]
    essay_text       = data["essay_text"]
    analysis_level   = data["analysis_level"]
    form_of_address  = data.get("form_of_address",  "em")
    selected_model   = data.get("selected_model",   "gemini-2.5-pro")
    # Sprint 2.7a — grading_tier defaults to 'standard' so legacy
    # callers that don't pass the field get pre-2.7a Pro+12-section
    # behaviour. Migration 044 backfilled existing rows the same way.
    grading_tier     = data.get("grading_tier",     "standard")
    prompt_image_url = data.get("prompt_image_url")
    status           = data.get("status",           "pending")

    _ensure_student_exists(student_id)

    essay_payload: dict = {
        "student_id":         student_id,
        "submitted_by_admin": admin_id,
        "task_type":          task_type,
        "prompt_text":        prompt_text,
        "prompt_image_url":   prompt_image_url,
        "essay_text":         essay_text,
        "word_count":         _word_count(essay_text),
        "analysis_level":     analysis_level,
        "form_of_address":    form_of_address,
        "selected_model":     selected_model,
        "grading_tier":       grading_tier,
        "status":             status,
    }
    # Pull the optional fields through verbatim — None values would
    # overwrite column defaults, so copy only keys that are present.
    for k in _OPTIONAL_ESSAY_FIELDS:
        if k in data and data[k] is not None:
            essay_payload[k] = data[k]

    try:
        er = supabase_admin.table("writing_essays").insert(essay_payload).execute()
    except Exception as exc:
        logger.error("[essays] insert failed: %s", exc)
        raise HTTPException(500, f"Database insert failed: {exc}")

    if not er.data:
        raise HTTPException(500, "writing_essays insert returned no rows")
    essay = er.data[0]

    eta = estimate_eta_seconds(
        analysis_level=analysis_level,
        selected_model=selected_model,
        grading_tier=grading_tier,
    )
    return {"essay_id": essay["id"], "eta_seconds": eta}


def schedule_grading_job(
    *,
    essay_id: str,
    analysis_level: int,
    selected_model: str = "gemini-2.5-pro",
    grading_tier: str = "standard",
) -> dict:
    """Sprint 2.7.1: insert ONE writing_jobs row pointing at an
    already-created essay. Returns {"job_id": <uuid>, "eta_seconds": <int>}.

    Caller is responsible for adding the FastAPI BackgroundTask that
    runs `_bg_grade_essay(essay_id, job_id)` — BG tasks live in
    request scope, so this service can't add them itself.

    Idempotent only at the caller level: a duplicate call would
    insert a second `queued` row pointing at the same essay. The
    student submit path guards against this with the atomic claim
    (the link UPDATE is the gate), the admin path doesn't need to
    (admins explicitly trigger one job per request)."""
    try:
        jr = supabase_admin.table("writing_jobs").insert({
            "essay_id":  essay_id,
            "job_type":  "analyze",
            "status":    "queued",
        }).execute()
    except Exception as exc:
        logger.error("[essays] job insert failed essay=%s: %s", essay_id, exc)
        raise HTTPException(500, f"Database insert failed: {exc}")

    if not jr.data:
        raise HTTPException(500, "writing_jobs insert returned no rows")
    job = jr.data[0]

    eta = estimate_eta_seconds(
        analysis_level=analysis_level,
        selected_model=selected_model,
        grading_tier=grading_tier,
    )
    return {"job_id": job["id"], "eta_seconds": eta}


def create_essay_with_job(*, data: dict, admin_id: str) -> dict:
    """Backward-compat wrapper: row + job in one call.

    The admin /admin/writing/essays endpoint and any non-SAGA caller
    use this. New code on the student-facing path uses
    `create_essay_row_only` + `schedule_grading_job` to allow
    SAGA-style sequencing (Sprint 2.7.1).

    Returns: {"essay_id": <uuid>, "job_id": <uuid>, "eta_seconds": <int>}.
    """
    row_info = create_essay_row_only(data=data, admin_id=admin_id)
    essay_id = row_info["essay_id"]

    try:
        job_info = schedule_grading_job(
            essay_id=essay_id,
            analysis_level=data["analysis_level"],
            selected_model=data.get("selected_model", "gemini-2.5-pro"),
            grading_tier=data.get("grading_tier", "standard"),
        )
    except HTTPException:
        # Roll back the orphan essay so the legacy contract holds:
        # "this function returns a complete row+job pair or raises".
        try:
            supabase_admin.table("writing_essays").delete().eq("id", essay_id).execute()
        except Exception as exc:
            logger.error("[essays] orphan rollback failed essay=%s: %s", essay_id, exc)
        raise

    return {"essay_id": essay_id, **job_info}


# ── GV-1b: grading-version budget + orphan helpers ───────────────────
#
# A writing_feedback row carries `version` + `parent_version`. Versions form a
# LINEAR chain: each regrade/compose sets parent_version = the then-current
# version, and `writing_essays.current_version` points at the delivered one.
# LIVE versions = current_version + its parent ancestor chain — every
# kept/compare-able version. Anything else is an ORPHAN: a row that was inserted
# but whose pointer-advance never landed (a crashed regrade) — never an ancestor,
# so it can be GC'd without ever touching a kept version.

MAX_VERSIONS = 3   # mirrors the DB CHECK(version BETWEEN 1 AND 3)


def _ancestor_versions(essay_id: str) -> set[int]:
    """The LIVE version numbers for an essay (current_version + parent chain).
    Empty set when the essay has no feedback yet (first grade)."""
    # version-management: must read ALL versions from the base table (incl
    # orphans), NOT the current-only writing_feedback_current view.
    rows = (
        supabase_admin.table("writing_feedback")
        .select("version, parent_version")
        .eq("essay_id", essay_id).execute()
    ).data or []
    if not rows:
        return set()
    # `version` is NOT NULL in the DB; guard anyway so a malformed row can't crash budgeting.
    parent_of = {r["version"]: r.get("parent_version") for r in rows if r.get("version") is not None}
    cvr = (
        supabase_admin.table("writing_essays")
        .select("current_version").eq("id", essay_id).limit(1).execute()
    ).data or [{}]
    v = cvr[0].get("current_version") or 1
    live: set[int] = set()
    while v is not None and v in parent_of and v not in live:
        live.add(v)
        v = parent_of[v]
    return live


def live_version_count(essay_id: str) -> int:
    """Budget = number of LIVE versions. Orphan-safe (orphans aren't ancestors →
    never counted), so a crashed regrade can't silently lock the essay."""
    return len(_ancestor_versions(essay_id))


def _gc_orphan_versions(essay_id: str, live: set[int]) -> None:
    """Delete writing_feedback rows NOT in the LIVE ancestor chain (orphans).
    Frees version-number slots so max(LIVE)+1 stays ≤ MAX_VERSIONS. The linear
    chain guarantees every kept version is in `live`, so this never removes a
    compare-able version."""
    # version-management: read ALL versions from base (incl orphans) to GC.
    rows = (
        supabase_admin.table("writing_feedback")
        .select("version").eq("essay_id", essay_id).execute()
    ).data or []
    for v in [r["version"] for r in rows if r["version"] not in live]:
        supabase_admin.table("writing_feedback").delete().eq(
            "essay_id", essay_id).eq("version", v).execute()


def _source_for_tier(grading_tier) -> str:
    """GV-1b: every band-producing grade today is a Pro run (standard / deep /
    instructor are all Pro; Flash never grades bands). `partial`/`composed` land
    in later GV phases."""
    return "ai_pro"


def _bands_from_feedback(feedback) -> dict:
    """Extract the 4 criterion band columns + overall from a validated
    WritingFeedback (the admin edit is authoritative on its values, mirroring
    the legacy admin_edits_json overlay — no recompute)."""
    c = feedback.criteriaFeedback
    return {
        "overall_band_score":      float(feedback.overallBandScore),
        "band_main_criterion":     float(c.mainCriterion.bandScore),
        "band_coherence_cohesion": float(c.coherenceCohesion.bandScore),
        "band_lexical_resource":   float(c.lexicalResource.bandScore),
        "band_grammatical_range":  float(c.grammaticalRange.bandScore),
    }


def upsert_composed_version(
    essay_id: str, feedback, *, edited_by: str | None = None,
    provenance: dict | None = None,
) -> int:
    """GV-1c — apply a human edit as a COMPOSED version so `current_version` is
    the single source of truth (retires the admin_edits_json overlay). F2 reuses
    this for mix-commit by passing a custom `provenance`.

    `feedback` = a validated WritingFeedback. Returns the version now current.
      • current is an AI version (source LIKE 'ai_%') → INSERT a NEW composed
        version (parent = current_version) and advance the pointer. The AI
        version is NEVER mutated (immutable).
      • current is already composed → UPDATE it in-place (human-owned, mutable)
        so repeated edits don't burn a version slot.

    `provenance` defaults to the GV-1c human-edit shape ({edited_by, edited_at});
    F2 mix passes {block_sources, base_version, mixed_by, mixed_at}.

    Raises HTTPException(409) when a NEW composed version is needed but the
    3-version budget is full (an edit IS a version; the admin compares/regrades
    instead).
    """
    row = {
        "essay_id":      essay_id,
        "feedback_json": feedback.model_dump(mode="json"),
        "source":        "composed",
        "provenance":    provenance if provenance is not None
                         else {"edited_by": edited_by, "edited_at": _now()},
        **_bands_from_feedback(feedback),
    }
    cvr = (
        supabase_admin.table("writing_essays")
        .select("current_version").eq("id", essay_id).limit(1).execute()
    ).data or [{}]
    cur = cvr[0].get("current_version") or 1
    # version-management: read the CURRENT version row from base (its source
    # decides create-vs-update); the view would hide a non-current one.
    cur_rows = (
        supabase_admin.table("writing_feedback")
        .select("version, source").eq("essay_id", essay_id).eq("version", cur)
        .limit(1).execute()
    ).data
    cur_source = (cur_rows[0].get("source") if cur_rows else None)

    if cur_source == "composed":
        # in-place update of the human-owned composed version — no new slot.
        supabase_admin.table("writing_feedback").update(row).eq(
            "essay_id", essay_id).eq("version", cur).execute()
        return cur

    # current is AI (or no feedback yet) → mint a new composed version.
    live = _ancestor_versions(essay_id)
    if live:
        _gc_orphan_versions(essay_id, live)          # reclaim slots first
        live = _ancestor_versions(essay_id)
        if len(live) >= MAX_VERSIONS:
            raise HTTPException(
                409,
                f"Đã đạt tối đa {MAX_VERSIONS} version cho bài này — không thể thêm "
                f"bản chỉnh sửa. Hãy so sánh/ghép hoặc chấm lại các bản hiện có.",
            )
        row["version"], row["parent_version"] = max(live) + 1, cur
    else:
        row["version"], row["parent_version"] = 1, None
    supabase_admin.table("writing_feedback").insert(row).execute()
    # advance the pointer LAST (ordered best-effort, mirrors the grade path).
    supabase_admin.table("writing_essays").update(
        {"current_version": row["version"]}).eq("id", essay_id).execute()
    return row["version"]


_MIX_CRITERIA = ("mainCriterion", "coherenceCohesion", "lexicalResource", "grammaticalRange")


def get_live_versions(essay_id: str) -> list[dict]:
    """F2 compare-data: the LIVE versions (current + ancestor chain) as
    compare-shaped rows for side-by-side per-criterion display, newest first.
    Each = {version, source, overall_band_score, created_at, criteriaFeedback}."""
    live = _ancestor_versions(essay_id)
    if not live:
        return []
    # version-management: read ALL live versions from BASE (the current-only view
    # would hide the ancestors needed for compare). Documented gate exception.
    rows = (
        supabase_admin.table("writing_feedback")
        .select("version, source, overall_band_score, feedback_json, created_at")
        .eq("essay_id", essay_id).in_("version", sorted(live)).execute()
    ).data or []
    out = []
    for r in sorted(rows, key=lambda x: x["version"], reverse=True):
        fj = r.get("feedback_json") or {}
        out.append({
            "version":            r["version"],
            "source":             r.get("source"),
            "overall_band_score": r.get("overall_band_score"),
            "created_at":         r.get("created_at"),
            "criteriaFeedback":   fj.get("criteriaFeedback"),
        })
    return out


def compose_version(essay_id: str, *, base_version: int, picks: dict, mixed_by: str) -> int:
    """F2 mix ($0, NO AI call): assemble a composed version from per-criterion
    picks. `picks` maps each of the 4 criteria → the version to take it from;
    each pick copies that version's WHOLE criteriaFeedback.<crit> sub-object
    (band + feedback together — never split). Non-criteria content is base-derived
    (taken verbatim from `base_version`). Overall is recomputed (IELTS) from the 4
    picked bands. Reuses upsert_composed_version → AI versions stay immutable,
    budget (Option A) + advance inherited.
    """
    live = _ancestor_versions(essay_id)
    needed = {base_version, *picks.values()}
    if not live or not needed.issubset(live):
        raise HTTPException(409, "Phiên bản được chọn không hợp lệ (ngoài các bản hiện hành).")
    # version-management: BASE read of the picked versions' full feedback_json.
    rows = (
        supabase_admin.table("writing_feedback")
        .select("version, feedback_json")
        .eq("essay_id", essay_id).in_("version", sorted(needed)).execute()
    ).data or []
    by_ver = {r["version"]: (r.get("feedback_json") or {}) for r in rows}
    if base_version not in by_ver:
        raise HTTPException(404, "Bản nền (base_version) không tìm thấy.")

    assembled = dict(by_ver[base_version])                 # base-derived non-criteria content
    cf = dict(assembled.get("criteriaFeedback") or {})
    picked_bands = []
    for crit in _MIX_CRITERIA:
        src_v = picks[crit]
        src_cf = (by_ver.get(src_v) or {}).get("criteriaFeedback") or {}
        if crit not in src_cf:
            raise HTTPException(422, f"Tiêu chí {crit} thiếu ở version {src_v}.")
        cf[crit] = src_cf[crit]                            # whole sub-object from ONE version
        picked_bands.append(src_cf[crit]["bandScore"])
    assembled["criteriaFeedback"] = cf
    # mix overall ≠ any source's → recompute deterministically (IELTS round).
    assembled["overallBandScore"] = overall_from_criteria(*picked_bands)

    feedback = WritingFeedback(**assembled)                # validate the assembled object
    provenance = {
        "block_sources": {crit: picks[crit] for crit in _MIX_CRITERIA},
        "base_version":  base_version,
        "mixed_by":      mixed_by,
        "mixed_at":      _now(),
    }
    return upsert_composed_version(essay_id, feedback, provenance=provenance)


# ── Async BG grader task ─────────────────────────────────────────────

async def _bg_grade_essay(essay_id: str, job_id: str) -> None:
    """FastAPI BackgroundTask: load essay, call Gemini grader, persist feedback.

    Terminal states only — in-task retry is the grader's 3 attempts. Failures
    mark essay.status='failed' + job.status='failed' and store an
    error_message so the admin UI can surface it.
    """
    logger.info("[grade %s] starting (job=%s)", essay_id, job_id)

    try:
        # Mark in-flight
        supabase_admin.table("writing_jobs").update({
            "status":     "running",
            "started_at": _now(),
        }).eq("id", job_id).execute()
        supabase_admin.table("writing_essays").update({
            "status": "grading",
        }).eq("id", essay_id).execute()

        # Load essay payload — student_id pulled in for Phase 1.5a so we
        # can fetch this student's recurring-patterns aggregate before
        # constructing GraderConfig. Sprint 2.7a: also pull
        # grading_tier so the grader picks the right model + prompt
        # variant + response schema.
        er = (
            supabase_admin.table("writing_essays")
            .select("task_type, prompt_text, prompt_image_url, essay_text, analysis_level, "
                    "form_of_address, selected_model, grading_tier, student_id")
            .eq("id", essay_id)
            .limit(1)
            .execute()
        )
        if not er.data:
            raise RuntimeError(f"essay {essay_id} disappeared mid-flight")
        essay = er.data[0]

        # Phase 1.5a + 1.5b + 1.5c — pre-aggregated history fed into
        # the Gemini prompt so feedback can reference past mistakes
        # (recurringPatterns), band trends (bandTrajectoryAnalysis),
        # and sentence-structure history + a focus theme for the
        # week (Phase-1.5c shape on sentenceStructureAnalysis,
        # overriding the L4/L5 legacy `{sentenceUpgrades:[...]}`
        # shape). All three return None when:
        #   • student has <5 graded essays (Phase-1 behaviour preserved)
        #   • the lookup itself raised (defensive — grading must not
        #     fail because history is unavailable)
        recurring_patterns  = get_recurring_patterns(essay["student_id"])
        band_trajectory     = get_band_trajectory(essay["student_id"])
        sentence_structure  = get_sentence_structure_history(essay["student_id"])

        config = GraderConfig(
            task_type=essay["task_type"],
            prompt_text=essay["prompt_text"],
            essay_text=essay["essay_text"],
            # Bug-2 fix — authoritative deterministic count (body only), so the
            # grader applies word-count caps to the real number, not the LLM's
            # tokenizer guess.
            word_count=_word_count(essay["essay_text"]),
            analysis_level=essay["analysis_level"],
            form_of_address=essay["form_of_address"],
            selected_model=essay["selected_model"],
            # Sprint 2.7a — fall back to "standard" if the row predates
            # migration 044 in some replicated/test environment.
            grading_tier=essay.get("grading_tier") or "standard",
            history=recurring_patterns,
            trajectory=band_trajectory,
            sentence_structure=sentence_structure,
            # Sprint 19.3.5 — forward the Task 1 Academic chart image so the
            # grader can send it to Gemini multimodally. The snapshot was
            # persisted on the essay row at submit time (mig 033); the grader
            # ignores it for non-task1_academic and on fetch failure (D7).
            prompt_image_url=essay.get("prompt_image_url"),
        )

        result = await get_grader().grade_essay(config)

        # Sprint 2.7c — post-grading level-coverage check. Logs a
        # warning per missing required section but never raises:
        # rejecting a near-complete grading because the LLM dropped
        # one section is worse UX than rendering with the gap. The
        # warning surfaces in monitoring; the student still sees the
        # rest of the feedback.
        validate_level_coverage(
            result.feedback,
            level=config.analysis_level,
            task_type=config.task_type,
        )

        # Persist feedback (1:1 with essay)
        fb = result.feedback

        # P-2a — enforce the mistake authenticity rule (output_schema §6.1) in
        # the backend: drop any mistakeAnalysis entry whose `original ==
        # suggestion` after Unicode/whitespace normalisation (a "flag" with an
        # identical fix is not a real correction). Was prompt-only; this makes
        # it deterministic. Apply-forward; never touches bands/transition.
        fb.mistakeAnalysis, _dropped = drop_noncorrection_mistakes(fb.mistakeAnalysis)
        if _dropped:
            logger.info(
                "[authenticity] dropped %d non-correction mistake(s) essay=%s",
                _dropped, essay_id,
            )

        b_tr  = float(fb.criteriaFeedback.mainCriterion.bandScore)
        b_cc  = float(fb.criteriaFeedback.coherenceCohesion.bandScore)
        b_lr  = float(fb.criteriaFeedback.lexicalResource.bandScore)
        b_gra = float(fb.criteriaFeedback.grammaticalRange.bandScore)

        # P-1 — the overall band is computed + IELTS-rounded by the BACKEND
        # (deterministic, verified), NOT trusted to the model's self-round
        # which mis-handles the .25/.75 boundaries. The model's emitted value
        # is preserved in feedback_json (overallBandScoreModel) for audit / a
        # future holistic A/B — never discarded.
        model_overall   = float(fb.overallBandScore)
        backend_overall = overall_from_criteria(b_tr, b_cc, b_lr, b_gra)
        feedback_json = fb.model_dump(mode="json")
        feedback_json["overallBandScore"]      = backend_overall
        feedback_json["overallBandScoreModel"] = model_overall

        feedback_row = {
            "essay_id":                 essay_id,
            "overall_band_score":       backend_overall,
            "band_main_criterion":      b_tr,
            "band_coherence_cohesion":  b_cc,
            "band_lexical_resource":    b_lr,
            "band_grammatical_range":   b_gra,
            "feedback_json":            feedback_json,
            "prompt_version":           result.prompt_version,
            "model_used":               result.model_used,
            "tokens_input":             result.tokens_input,
            "tokens_output":            result.tokens_output,
            "cost_usd":                 result.cost_usd,
            "grading_duration_ms":      result.grading_duration_ms,
        }
        # GV-1b — versioned write. First grade → version 1; regrade → next
        # version (kept, NOT overwriting prior versions, so they stay
        # compare-able). Idempotent on job_id: a re-invoked BG task for the same
        # job reuses its row instead of burning a new version slot.
        # version-management: base table (the view filters to current only).
        existing = (
            supabase_admin.table("writing_feedback")
            .select("version")
            .eq("essay_id", essay_id)
            .eq("provenance->>job_id", job_id)
            .limit(1).execute()
        ).data
        if existing:
            version = existing[0]["version"]
            supabase_admin.table("writing_feedback").update(feedback_row).eq(
                "essay_id", essay_id).eq("version", version).execute()
        else:
            live = _ancestor_versions(essay_id)
            if live:
                _gc_orphan_versions(essay_id, live)   # reclaim slots so version ≤ 3
                cur = max(live)
                version, parent = cur + 1, cur
            else:
                version, parent = 1, None
            feedback_row["version"]        = version
            feedback_row["source"]         = _source_for_tier(result.grading_tier)
            feedback_row["parent_version"] = parent
            feedback_row["provenance"]     = {"job_id": job_id}
            supabase_admin.table("writing_feedback").insert(feedback_row).execute()

        # Sprint 2.7b — persist Deep tier per-pass metadata to the
        # writing_essays.grading_tier_metadata JSONB column so the
        # cost/latency/degradation breakdown is queryable without
        # re-running the grader. Standard tier writes {} (the existing
        # writing_feedback flat columns already carry single-pass
        # tokens / cost / duration). Empty dicts skipped to avoid
        # unnecessary writes.
        essay_update: dict = {"status": "graded"}
        if result.tier_metadata:
            essay_update["grading_tier_metadata"] = result.tier_metadata
        supabase_admin.table("writing_essays").update(
            essay_update,
        ).eq("id", essay_id).execute()

        # GV-1b — advance the current-version pointer LAST (ordered best-effort,
        # Supabase has no real transaction). If THIS write fails, current_version
        # stays on the last-good version (delivery stays correct, never a
        # half-written one) and the row just inserted becomes an orphan that the
        # next regrade GCs — the 3-version budget is never silently consumed.
        supabase_admin.table("writing_essays").update(
            {"current_version": version},
        ).eq("id", essay_id).execute()
        supabase_admin.table("writing_jobs").update({
            "status":       "completed",
            "completed_at": _now(),
        }).eq("id", job_id).execute()

        # Sprint 2.7d.1 — Instructor tier: post-grading hook creates
        # an instructor_reviews queue row so the admin queue page
        # surfaces this essay for human review. Idempotent — a
        # retried grade run will see the existing row and no-op.
        # Failure to create the row logs but does not fail the grade
        # — the essay still has its AI Pass 1 feedback persisted; an
        # admin can manually create the review row if needed (or
        # reschedule the grade so the create_review hook re-runs).
        if result.grading_tier == GradingTier.INSTRUCTOR:
            try:
                from services import instructor_workflow
                from uuid import UUID
                instructor_workflow.create_review(UUID(essay_id))
            except Exception:  # noqa: BLE001 — never block delivery on this
                logger.exception(
                    "[grade %s] failed to create instructor review row "
                    "post-grading; manual create may be needed",
                    essay_id,
                )

        logger.info(
            "[grade %s] done band=%s tokens=%s/%s cost=%s",
            essay_id, fb.overallBandScore,
            result.tokens_input, result.tokens_output, result.cost_usd,
        )

    except (AISafetyBlockError, APIRetryFailedError, InvalidJSONError) as exc:
        _mark_failed(essay_id, job_id, exc, kind=type(exc).__name__)
    except Exception as exc:  # noqa: BLE001 — last-resort failure capture
        logger.exception("[grade %s] unexpected failure", essay_id)
        _mark_failed(essay_id, job_id, exc, kind="UnexpectedError")


def _mark_failed(essay_id: str, job_id: str, exc: Exception, *, kind: str) -> None:
    """Idempotent failure-state writer. Best-effort — never re-raises."""
    msg = f"{kind}: {exc}"[:1000]  # truncate to keep error_message bounded
    try:
        supabase_admin.table("writing_essays").update({
            "status":        "failed",
            "error_message": msg,
        }).eq("id", essay_id).execute()
        supabase_admin.table("writing_jobs").update({
            "status":       "failed",
            "completed_at": _now(),
            "error_log":    [{"kind": kind, "message": str(exc), "at": _now()}],
        }).eq("id", job_id).execute()
    except Exception as inner:
        logger.error("[grade %s] failure-state write also failed: %s", essay_id, inner)


# ── Read paths ───────────────────────────────────────────────────────

_ALLOWED_STATUSES = {"pending", "grading", "graded", "reviewed", "delivered", "failed"}


def list_essays(
    *,
    status: Optional[str] = None,
    student_id: Optional[str] = None,
    cohort_id: Optional[str] = None,
    owner_id: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """List essays (newest first) with optional status / student / cohort filters,
    enriched for the grade-queue UI with student name+code, overall band, and the
    assignment deadline.

    Enrichment is BATCHED — exactly three extra queries regardless of page size
    (students, feedback, assignments), so there is no N+1. `cohort_id` scopes to
    essays whose student is in that cohort (students.cohort_id, WF-1).

    W-3 — `owner_id` None = admin see-all (unchanged). When set (instructor mode),
    the result is scoped to owned essays (2-branch: assignment ∪ student) and any
    student_id/cohort_id filter must belong to the owner (else PermissionError).
    """
    if status and status not in _ALLOWED_STATUSES:
        raise HTTPException(400, f"Invalid status: {status!r}")

    # W-3 — instructor ownership gate on the requested filters (fail-closed).
    if owner_id is not None:
        owner = str(owner_id)
        if student_id:
            srow = (supabase_admin.table("students").select("id, instructor_id")
                    .eq("id", student_id).limit(1).execute().data or [None])[0]
            if not srow or srow.get("instructor_id") != owner:
                raise PermissionError(f"list_essays: student {student_id} không thuộc instructor {owner}")
        if cohort_id:
            crow = (supabase_admin.table("cohorts").select("id, created_by")
                    .eq("id", cohort_id).limit(1).execute().data or [None])[0]
            if not crow or crow.get("created_by") != owner:
                raise PermissionError(f"list_essays: cohort {cohort_id} không thuộc instructor {owner}")

    q = (
        supabase_admin.table("writing_essays")
        .select(
            "id, student_id, task_type, status, analysis_level, "
            "selected_model, word_count, created_at, delivered_at, error_message"
        )
        .is_("deleted_at", "null")          # hide soft-deleted essays
        .order("created_at", desc=True)
    )
    if status:
        q = q.eq("status", status)
    if student_id:
        q = q.eq("student_id", student_id)
    if cohort_id:
        # Cohort scope = essays whose student is in this cohort. students.cohort_id
        # is the single source of class membership (WF-1).
        sc = (
            supabase_admin.table("students")
            .select("id").eq("cohort_id", cohort_id).execute()
        )
        cohort_student_ids = [row["id"] for row in (sc.data or [])]
        if not cohort_student_ids:
            return []
        q = q.in_("student_id", cohort_student_ids)

    # W-3 — scope to owned essays (2-branch) in instructor mode. Fail-closed:
    # no owned essays → empty result (never an unscoped list).
    if owner_id is not None:
        from services.instructor_access import instructor_owned_essay_ids  # local — avoid cycle
        owned_ids = instructor_owned_essay_ids(owner_id)
        if not owned_ids:
            return []
        q = q.in_("id", owned_ids)

    r = q.range(offset, offset + limit - 1).execute()
    rows = r.data or []
    if not rows:
        return rows

    essay_ids   = [e["id"] for e in rows]
    student_ids = list({e["student_id"] for e in rows if e.get("student_id")})

    # Batch 1 — student name + code.
    students_map: dict = {}
    if student_ids:
        sr = (
            supabase_admin.table("students")
            .select("id, full_name, student_code")
            .in_("id", student_ids).execute()
        )
        students_map = {s["id"]: s for s in (sr.data or [])}

    # Batch 2 — overall band. GV-1a: read the CURRENT version via the view so a
    # multi-version essay yields its delivered band, not an arbitrary version.
    band_map: dict = {}
    fr = (
        supabase_admin.table("writing_feedback_current")
        .select("essay_id, overall_band_score")
        .in_("essay_id", essay_ids).execute()
    )
    for f in (fr.data or []):
        eid = f.get("essay_id")
        if eid and eid not in band_map:
            band_map[eid] = f.get("overall_band_score")

    # Batch 3 — deadline (writing_assignments.essay_id → writing_essays.id;
    # assignment points to the essay). Earliest non-null deadline wins.
    deadline_map: dict = {}
    ar = (
        supabase_admin.table("writing_assignments")
        .select("essay_id, deadline")
        .in_("essay_id", essay_ids).execute()
    )
    for a in (ar.data or []):
        eid, dl = a.get("essay_id"), a.get("deadline")
        if not eid or dl is None:
            continue
        if eid not in deadline_map or dl < deadline_map[eid]:
            deadline_map[eid] = dl

    for e in rows:
        stu = students_map.get(e["student_id"]) or {}
        e["student_full_name"] = stu.get("full_name")
        e["student_code"]      = stu.get("student_code")
        e["band"]              = band_map.get(e["id"])
        e["deadline"]          = deadline_map.get(e["id"])
    return rows


def get_essay_with_feedback(essay_id: str) -> dict:
    """Return one essay row + feedback (when graded) + student summary."""
    er = (
        supabase_admin.table("writing_essays")
        .select("*")
        .eq("id", essay_id)
        .is_("deleted_at", "null")          # soft-deleted → 404
        .limit(1)
        .execute()
    )
    if not er.data:
        raise HTTPException(404, "Essay not found")
    essay = dict(er.data[0])

    fr = (
        supabase_admin.table("writing_feedback_current")   # GV-1a: current version
        .select("*")
        .eq("essay_id", essay_id)
        .limit(1)
        .execute()
    )
    essay["feedback"] = fr.data[0] if fr.data else None

    sr = (
        supabase_admin.table("students")
        .select("id, student_code, full_name, target_band")
        .eq("id", essay["student_id"])
        .limit(1)
        .execute()
    )
    essay["student"] = sr.data[0] if sr.data else None

    return essay


def get_essay_render_context(essay_id: str) -> dict:
    """Build the data dict consumed by writing_render / writing_word_exporter.

    Layers admin_edits_json (when present) over the AI feedback_json — admin
    edits supersede the original grader output for render + delivery.

    Returns:
        {
          "feedback":      WritingFeedback,  # validated, edits-applied
          "essay_text":    str,
          "prompt_text":   str,
          "task_type":     str,
          "student_name":  str,
          "student_code":  str,
          "essay_id":      str,
        }
    Raises 404 when essay or feedback row is missing.
    """
    er = (
        supabase_admin.table("writing_essays")
        .select(
            "id, student_id, task_type, prompt_text, essay_text, status"
        )
        .eq("id", essay_id)
        .is_("deleted_at", "null")          # soft-deleted → 404 (no render/export)
        .limit(1)
        .execute()
    )
    if not er.data:
        raise HTTPException(404, "Essay not found")
    essay = er.data[0]

    fr = (
        supabase_admin.table("writing_feedback_current")   # GV-1a: current version
        .select("feedback_json")
        .eq("essay_id", essay_id)
        .limit(1)
        .execute()
    )
    if not fr.data:
        raise HTTPException(404, "Feedback not yet available")

    # GV-1c: single source of truth = current_version (the view returns it). The
    # legacy admin_edits_json overlay is retired — a human edit is now a
    # 'composed' version, so the current version already carries it. (The
    # admin_edits_json column is DEAD: no reader remains after GV-1c.)
    feedback_json = fr.data[0]["feedback_json"]
    try:
        feedback = WritingFeedback(**feedback_json)
    except Exception as exc:
        raise HTTPException(500, f"Stored feedback fails schema: {exc}")

    sr = (
        supabase_admin.table("students")
        .select("student_code, full_name")
        .eq("id", essay["student_id"])
        .limit(1)
        .execute()
    )
    student = sr.data[0] if sr.data else {"student_code": "", "full_name": ""}

    return {
        "feedback":     feedback,
        "essay_text":   essay["essay_text"],
        "prompt_text":  essay["prompt_text"],
        "task_type":    essay["task_type"],
        "student_name": student.get("full_name") or "",
        "student_code": student.get("student_code") or "",
        "essay_id":     essay["id"],
    }


def get_essay_status(essay_id: str) -> dict:
    """Lightweight status payload for polling. Cheaper than full detail.

    Sprint 2.7b: also returns `grading_tier` so the polling page can
    show tier-aware messaging (e.g. Deep tier rotates Pass 1/2/3
    progress hints over the longer 3-5 minute wait).
    """
    er = (
        supabase_admin.table("writing_essays")
        .select(
            "id, status, error_message, analysis_level, "
            "selected_model, grading_tier, created_at"
        )
        .eq("id", essay_id)
        .is_("deleted_at", "null")          # soft-deleted → 404
        .limit(1)
        .execute()
    )
    if not er.data:
        raise HTTPException(404, "Essay not found")
    essay = er.data[0]

    grading_tier = essay.get("grading_tier") or "standard"
    eta = estimate_eta_seconds(
        analysis_level=essay["analysis_level"],
        selected_model=essay["selected_model"],
        grading_tier=grading_tier,
    )
    return {
        "essay_id":      essay["id"],
        "status":        essay["status"],
        "error_message": essay.get("error_message"),
        "eta_seconds":   eta,
        "grading_tier":  grading_tier,
        "created_at":    essay["created_at"],
    }


def get_student_summary(student_id: str) -> dict:
    """Aggregated student stats (profile + essay counters + last-5-band avg +
    recent essays/assignments) for the instructor/admin "Tổng quan" view.

    Extracted from admin_writing.get_student_summary so the /admin and
    /instructor routes share ONE implementation (the instructor route adds an
    owner gate before calling this). Behaviour is byte-identical to the prior
    admin inline version. Raises 404 when the student doesn't exist.
    """
    sr = (
        supabase_admin.table("students")
        .select(
            "id, student_code, full_name, target_band, "
            "current_band_estimate, target_date, persona_notes, "
            "flag_count, is_under_review, last_flagged_at"
        )
        .eq("id", str(student_id))
        .limit(1)
        .execute()
    )
    if not sr.data:
        raise HTTPException(404, "Student not found")
    student = sr.data[0]

    essays_resp = (
        supabase_admin.table("writing_essays")
        .select(
            "id, status, is_flagged, task_type, created_at, delivered_at, "
            "regrade_count, last_regraded_at, "
            # GV-1a: embed the CURRENT version via the view; aliased back to the
            # `writing_feedback` key so the to-one result (a dict, not an array)
            # flows to existing consumers (this fn's avg-band calc + the admin
            # students FE _bandFromEssay) unchanged — both already handle a dict.
            "writing_feedback:writing_feedback_current(overall_band_score)"
        )
        .eq("student_id", str(student_id))
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .limit(20)
        .execute()
    )
    essays = essays_resp.data or []

    assignments_resp = (
        supabase_admin.table("writing_assignments")
        .select(
            "id, status, deadline, created_at, submitted_at, delivered_at, "
            "writing_prompts(title, task_type)"
        )
        .eq("student_id", str(student_id))
        .order("created_at", desc=True)
        .limit(10)
        .execute()
    )

    flagged_count = sum(1 for e in essays if e.get("is_flagged"))
    graded_count  = sum(
        1 for e in essays
        if not e.get("is_flagged") and e.get("status") in ("graded", "reviewed", "delivered")
    )

    valid_bands: list[float] = []
    for e in essays:
        if e.get("is_flagged"):
            continue
        fb = e.get("writing_feedback") or []
        if isinstance(fb, list):
            band = fb[0].get("overall_band_score") if fb else None
        elif isinstance(fb, dict):
            band = fb.get("overall_band_score")
        else:
            band = None
        if band is None:
            continue
        try:
            valid_bands.append(float(band))
        except (TypeError, ValueError):
            continue
        if len(valid_bands) >= 5:
            break

    avg_band = round(sum(valid_bands) / len(valid_bands), 1) if valid_bands else None

    return {
        "student": student,
        "stats": {
            "total_essays":        len(essays),
            "graded_count":        graded_count,
            "flagged_count":       flagged_count,
            "average_band_last5":  avg_band,
            "valid_band_sample":   len(valid_bands),
        },
        "recent_essays":      essays[:10],
        "recent_assignments": (assignments_resp.data or [])[:5],
    }
