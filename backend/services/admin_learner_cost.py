"""AI cost of one learner (ADMINIA-0074 FR-026; plan 5.4
``GET /admin/learners/{ref}/ai-cost``; G09-T04c).

Shown only on the Khoá và quyền tab. The calls counted are the learner's:

* every ``ai_usage_logs`` row with ``user_id`` = the learner's account, and
* every ``writing_grading`` row whose ``resource_id`` is one of the learner's
  essays (an essay an admin hands in for an offline learner is logged with
  ``user_id`` NULL, and it is still this learner's spend),

plus the historical Writing spend that lives only on ``writing_feedback``
rows, merged with the same dedupe rule as ``/admin/ai-usage`` and
``/admin/usage/users`` (``routers.admin._writing_feedback_reconcilable`` and
``_writing_feedback_supplemental_cost``),
so the per-person figure never counts a Writing job twice.

A call with no price (``effective_logged_cost`` is ``None``) adds nothing to
the total and is counted in ``unpriced_calls`` when it succeeded, as on
``/admin/ai-usage``. Every read is paged; a failed read raises, so the route
answers 503 rather than a smaller total. Read only; no AI call.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from database import supabase_admin
from services.admin_learner_directory import Person
from services.ai_pricing import effective_logged_cost

WINDOWS = (7, 30, 90)
_CHUNK = 200
_LEDGER_COLS = ("id, user_id, service, model, input_tokens, output_tokens, thinking_tokens, "
                "cache_read_tokens, cache_write_tokens, audio_seconds, text_chars, cost_usd_est, "
                "cost_source, status, pricing_version, feature, resource_id, usage_event_id, created_at")


def _chunks(ids: list[str]):
    for start in range(0, len(ids), _CHUNK):
        yield ids[start:start + _CHUNK]


def _essay_ids(person: Person) -> list[str]:
    """The learner's essays: the profile's own student row plus every other
    student row of the same account (an archived duplicate keeps its essays)."""
    from routers.admin import _usage_paged

    student_ids = {person.student_id} if person.student_id else set()
    if person.user:
        uid = str(person.user["id"])
        student_ids |= {str(r["id"]) for r in _usage_paged(
            lambda: supabase_admin.table("students").select("id, user_id").eq("user_id", uid)) if r.get("id")}
    essays: set[str] = set()
    for chunk in _chunks(sorted(student_ids)):
        essays |= {str(r["id"]) for r in _usage_paged(
            lambda c=chunk: supabase_admin.table("writing_essays").select("id, student_id").in_("student_id", c))
            if r.get("id")}
    return sorted(essays)


def _within(value: Any, lo: datetime, hi: datetime) -> bool:
    try:
        at = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return False
    at = at if at.tzinfo else at.replace(tzinfo=timezone.utc)
    return lo <= at <= hi


def cost(person: Person, window_days: int, *, now: Optional[datetime] = None) -> dict[str, Any]:
    from routers.admin import (_usage_paged, _writing_feedback_reconcilable,
                               _writing_feedback_supplemental_cost, _writing_job_id)

    if window_days not in WINDOWS:
        raise ValueError("window")
    now = now or datetime.now(timezone.utc)
    since = (now - timedelta(days=window_days)).isoformat()
    until = now.isoformat()
    essays = _essay_ids(person)

    calls: dict[str, dict] = {}                  # ledger row id -> row, in the window
    if person.user:
        uid = str(person.user["id"])
        for row in _usage_paged(lambda: supabase_admin.table("ai_usage_logs").select(_LEDGER_COLS)
                                .eq("user_id", uid).gte("created_at", since).lte("created_at", until)):
            calls[str(row["id"])] = row
    # Writing ledger rows of the learner's essays, read over all time: the
    # dedupe below needs a job's whole ledger spend and first ledger instant,
    # not only the part inside the window.
    ledger_cost_by_job: dict[str, float] = {}
    first_seen: dict[str, str] = {}
    for chunk in _chunks(essays):
        for row in _usage_paged(lambda c=chunk: supabase_admin.table("ai_usage_logs").select(_LEDGER_COLS)
                                .eq("feature", "writing_grading").in_("resource_id", c)):
            if job := _writing_job_id(row.get("usage_event_id")):
                value, _ = effective_logged_cost(row)
                ledger_cost_by_job[job] = ledger_cost_by_job.get(job, 0.0) + float(value or 0)
            essay, created = str(row.get("resource_id") or ""), row.get("created_at")
            if essay and created and (essay not in first_seen or created < first_seen[essay]):
                first_seen[essay] = created
            if _within(created, now - timedelta(days=window_days), now):
                calls.setdefault(str(row["id"]), row)

    total = 0.0
    unpriced = 0
    by_feature: dict[Optional[str], dict] = {}

    def add(feature: Optional[str], value: Optional[float], succeeded: bool) -> None:
        nonlocal total, unpriced
        slot = by_feature.setdefault(feature, {"feature": feature, "calls": 0, "cost_usd": 0.0,
                                               "unpriced_calls": 0})
        slot["calls"] += 1
        if value is None:
            if succeeded:
                slot["unpriced_calls"] += 1
                unpriced += 1
            return
        slot["cost_usd"] += value
        total += value

    for row in calls.values():
        value, _ = effective_logged_cost(row)
        add(row.get("feature"), None if value is None else float(value), row.get("status") in (None, "success"))

    for chunk in _chunks(essays):
        # GV-1a SPEND-analytics exception: historical AI cost must include
        # every feedback version, not only the current view.
        for row in _usage_paged(lambda c=chunk: supabase_admin.table("writing_feedback")
                                .select("id, essay_id, model_used, tokens_input, tokens_output, cost_usd, "
                                        "provenance, created_at")
                                .in_("essay_id", c).gte("created_at", since).lte("created_at", until)):
            # Same row rule as /admin/ai-usage and /admin/usage/users, so a
            # Claude-led job missing a ledger write counts here too.
            if not _writing_feedback_reconcilable(row):
                continue
            extra = _writing_feedback_supplemental_cost(
                row, ledger_cost_by_job=ledger_cost_by_job,
                ledger_first_seen=first_seen.get(str(row.get("essay_id") or "")))
            if extra > 0:
                add("writing_grading", extra, True)

    items = sorted(by_feature.values(), key=lambda s: (-s["cost_usd"], s["feature"] or "~"))
    for slot in items:
        slot["cost_usd"] = round(slot["cost_usd"], 2)
    return {"window_days": window_days, "total_usd": round(total, 2), "unpriced_calls": unpriced,
            "by_feature": items}
