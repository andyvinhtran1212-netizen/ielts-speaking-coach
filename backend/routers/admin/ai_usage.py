"""routers.admin.ai_usage — AI usage ledger (BACKENDSPLIT-0076 T009).

Cut and pasted unchanged from the former single-file routers/admin.py. The
package re-exports every name; tests patch ``routers.admin``, never this module
(see __init__.py).
"""

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query, Response
from database import supabase_admin
from services import admin_dashboard, ai_usage_logger, class_archive_service, test_data_visibility
from services.ai_pricing import effective_logged_cost

from routers.admin import (  # noqa: E402 — defined above this block in the package
    logger,
    router,
    require_admin,
)
from .access_codes import (  # noqa: E402
    _usage_paged,
    _usage_id_chunks,
    _writing_job_id,
    _writing_feedback_reconcilable,
    _writing_feedback_service,
    _writing_feedback_supplemental_cost,
)


# ── GET /admin/ai-usage ────────────────────────────────────────────────────────

@router.get("/ai-usage")
async def get_ai_usage(
    days: int | None = None,
    authorization: str | None = Header(default=None),
):
    """
    Per-account AI usage summary with cost estimates.

    Query param:
        days=N   — restrict to the last N days (default: all time)

    Returns:
        {
            "overall":  { calls, cost_usd, by_service: {service: {calls, cost_usd}} },
            "per_user": [ {user_id, email, display_name, calls, cost_usd, by_service} ]
        }
    """
    await require_admin(authorization)

    usage_columns = (
        "user_id, service, model, input_tokens, output_tokens, thinking_tokens, "
        "cache_read_tokens, cache_write_tokens, audio_seconds, text_chars, "
        "cost_usd_est, cost_source, status, error_code, feature, resource_type, resource_id, "
        "pricing_version, usage_event_id, created_at"
    )
    legacy_usage_columns = (
        "user_id, service, model, input_tokens, output_tokens, "
        "cache_read_tokens, cache_write_tokens, audio_seconds, text_chars, "
        "cost_usd_est, created_at"
    )
    cutoff = None

    def _usage_query(columns: str):
        built = (
            supabase_admin.table("ai_usage_logs")
            .select(columns, count="exact")
            .order("created_at", desc=True)
            .limit(10_000)
        )
        return built.gte("created_at", cutoff) if cutoff else built

    if days is not None:
        cutoff = (
            datetime.now(timezone.utc) - timedelta(days=days)
        ).isoformat()
    query = _usage_query(usage_columns)

    ledger_schema_legacy = False
    try:
        res = query.execute()
    except Exception as exc:
        if not ai_usage_logger.is_legacy_schema_error(exc):
            logger.error("[admin] AI usage load failed: %s", exc, exc_info=True)
            raise HTTPException(500, "Lỗi khi tải AI usage. Vui lòng thử lại.") from None
        try:
            res = _usage_query(legacy_usage_columns).execute()
            ledger_schema_legacy = True
        except Exception as fallback_exc:
            logger.error("[admin] AI usage load failed: %s", exc, exc_info=exc)
            logger.error("[admin] AI usage legacy fallback failed: %s", fallback_exc, exc_info=True)
            raise HTTPException(500, "Lỗi khi tải AI usage. Vui lòng thử lại.") from None

    logs = res.data or []
    total_matching = res.count if isinstance(res.count, int) else None
    capped_limit = 10_000
    ledger_returned_rows = len(logs)
    ledger_truncated = bool(
        total_matching is not None and total_matching > ledger_returned_rows
    )

    # Historical Writing usage lived only in writing_feedback. Merge it at read
    # time (no history mutation) unless the same essay already has canonical
    # ledger rows from the new per-call instrumentation.
    writing_lookup_failed = False
    supplemental_writing_rows = 0
    writing_source_returned_rows = 0
    writing_source_total_rows: int | None = None
    writing_source_truncated = False
    ledger_writing_first_seen: dict[str, str] = {}
    ledger_writing_cost_by_job: dict[str, float] = {}
    for row in logs:
        if row.get("feature") != "writing_grading" or not row.get("resource_id"):
            continue
        essay_id = str(row["resource_id"])
        created_at = row.get("created_at")
        current = ledger_writing_first_seen.get(essay_id)
        if created_at and (current is None or created_at < current):
            ledger_writing_first_seen[essay_id] = created_at
    try:
        wq = (
            # GV-1a SPEND-analytics exception: dashboard spend includes every
            # feedback version; current-only would understate provider cost.
            supabase_admin.table("writing_feedback")
            .select("id, essay_id, model_used, tokens_input, tokens_output, "
                    "cost_usd, grading_duration_ms, provenance, created_at", count="exact")
            .order("created_at", desc=True)
            .limit(capped_limit)
        )
        if days is not None:
            wq = wq.gte("created_at", cutoff)
        writing_res = wq.execute()
        writing_rows = writing_res.data or []
        writing_source_returned_rows = len(writing_rows)
        writing_source_total_rows = (
            writing_res.count if isinstance(writing_res.count, int) else None
        )
        writing_source_truncated = bool(
            writing_source_total_rows is not None
            and writing_source_total_rows > writing_source_returned_rows
        )
        # The dashboard list above is deliberately capped. Dedupe cannot use
        # that partial list: query canonical Writing ledger rows separately for
        # every candidate essay, with keyset pagination, so truncation cannot
        # turn overlapping feedback into double-counted spend.
        candidate_essay_ids = list({
            str(row["essay_id"]) for row in writing_rows if row.get("essay_id")
        })
        if not ledger_schema_legacy:
            for essay_chunk in _usage_id_chunks(candidate_essay_ids):
                ledger_rows = _usage_paged(
                    lambda essay_chunk=essay_chunk: supabase_admin.table("ai_usage_logs")
                    .select("id, service, model, input_tokens, output_tokens, "
                            "thinking_tokens, cache_read_tokens, cache_write_tokens, "
                            "audio_seconds, text_chars, cost_usd_est, pricing_version, "
                            "resource_id, usage_event_id, created_at")
                    .eq("feature", "writing_grading")
                    .in_("resource_id", essay_chunk)
                )
                for ledger_row in ledger_rows:
                    if job_id := _writing_job_id(ledger_row.get("usage_event_id")):
                        ledger_cost, _ = effective_logged_cost(ledger_row)
                        ledger_writing_cost_by_job[job_id] = (
                            ledger_writing_cost_by_job.get(job_id, 0.0)
                            + float(ledger_cost or 0)
                        )
                    essay_id = str(ledger_row.get("resource_id") or "")
                    created_at = ledger_row.get("created_at")
                    current = ledger_writing_first_seen.get(essay_id)
                    if essay_id and created_at and (current is None or created_at < current):
                        ledger_writing_first_seen[essay_id] = created_at
        reconciled_writing_rows: list[tuple[dict, float]] = []
        for row in writing_rows:
            essay_id = str(row.get("essay_id") or "")
            if not _writing_feedback_reconcilable(row):
                continue
            supplemental_cost = _writing_feedback_supplemental_cost(
                row,
                ledger_cost_by_job=ledger_writing_cost_by_job,
                ledger_first_seen=ledger_writing_first_seen.get(essay_id),
            )
            if supplemental_cost > 0:
                reconciled_writing_rows.append((row, supplemental_cost))
        writing_rows = [row for row, _ in reconciled_writing_rows]
        essay_ids = list({str(row["essay_id"]) for row in writing_rows if row.get("essay_id")})
        essay_student_map: dict[str, str] = {}
        for essay_chunk in _usage_id_chunks(essay_ids):
            er = (
                supabase_admin.table("writing_essays")
                .select("id, student_id")
                .in_("id", essay_chunk)
                .execute()
            )
            essay_student_map.update({
                str(row["id"]): str(row["student_id"])
                for row in (er.data or []) if row.get("id") and row.get("student_id")
            })
        student_ids = list(set(essay_student_map.values()))
        student_user_map: dict[str, str | None] = {}
        for student_chunk in _usage_id_chunks(student_ids):
            sr = (
                supabase_admin.table("students")
                .select("id, user_id")
                .in_("id", student_chunk)
                .execute()
            )
            student_user_map.update({
                str(row["id"]): row.get("user_id") for row in (sr.data or [])
                if row.get("id")
            })
        for row, supplemental_cost in reconciled_writing_rows:
            essay_id = str(row.get("essay_id") or "")
            student_id = essay_student_map.get(essay_id)
            provenance = row.get("provenance")
            job_id = provenance.get("job_id") if isinstance(provenance, dict) else None
            logs.append({
                "user_id": student_user_map.get(student_id or ""),
                "service": _writing_feedback_service(row),
                "model": row.get("model_used"),
                "input_tokens": row.get("tokens_input"),
                "output_tokens": row.get("tokens_output"),
                "thinking_tokens": None,
                "cost_usd_est": supplemental_cost,
                "cost_source": (
                    "writing_feedback_reconciliation"
                    if job_id and ledger_writing_cost_by_job.get(str(job_id), 0) > 0
                    else "writing_feedback_legacy"
                ),
                "pricing_version": (
                    "writing_feedback:legacy"
                    if row.get("cost_usd") is not None else None
                ),
                "status": "success",
                "feature": "writing_grading",
                "resource_type": "writing_essay",
                "resource_id": essay_id,
                "created_at": row.get("created_at"),
            })
        supplemental_writing_rows = len(reconciled_writing_rows)
    except Exception as exc:
        writing_lookup_failed = True
        logger.warning("[admin ai-usage] historical Writing merge failed: %s", exc)

    truncated = ledger_truncated or writing_source_truncated
    combined_total = (
        total_matching + supplemental_writing_rows
        if total_matching is not None and not writing_source_truncated
        else None
    )

    # Enrich with user info
    user_ids = list({l["user_id"] for l in logs if l.get("user_id")})
    user_map: dict[str, dict] = {}
    if user_ids:
        try:
            ur = (
                supabase_admin.table("users")
                .select("id, email, display_name")
                .in_("id", user_ids)
                .execute()
            )
            for u in (ur.data or []):
                user_map[u["id"]] = {
                    "email":        u.get("email", ""),
                    "display_name": u.get("display_name", ""),
                }
        except Exception:
            pass

    # Aggregate
    overall: dict = {
        "calls": 0,
        "priced_calls": 0,
        "unpriced_calls": 0,
        "failed_calls": 0,
        "legacy_repriced_calls": 0,
        "cost_usd": 0.0,
        "by_service": {},
    }
    per_user: dict[str, dict] = {}

    for log in logs:
        uid  = log.get("user_id") or "unknown"
        svc  = log.get("service", "unknown")
        effective_cost, effective_price_version = effective_logged_cost(log)
        cost = float(effective_cost or 0.0)
        is_priced = effective_cost is not None
        if effective_price_version and not log.get("pricing_version"):
            overall["legacy_repriced_calls"] += 1

        # Overall
        overall["calls"] += 1
        is_success = log.get("status") in (None, "success")
        if is_priced:
            overall["priced_calls"] += 1
        elif is_success:
            overall["unpriced_calls"] += 1
        if not is_success:
            overall["failed_calls"] += 1
        overall["cost_usd"] = round(overall["cost_usd"] + cost, 6)
        if svc not in overall["by_service"]:
            overall["by_service"][svc] = {
                "calls": 0, "priced_calls": 0, "unpriced_calls": 0,
                "cost_usd": 0.0,
            }
        overall["by_service"][svc]["calls"] += 1
        if is_priced:
            overall["by_service"][svc]["priced_calls"] += 1
        elif is_success:
            overall["by_service"][svc]["unpriced_calls"] += 1
        overall["by_service"][svc]["cost_usd"] = round(
            overall["by_service"][svc]["cost_usd"] + cost, 6
        )

        # Per user
        if uid not in per_user:
            info = user_map.get(uid, {})
            per_user[uid] = {
                "user_id":      uid,
                "email":        info.get("email", ""),
                "display_name": info.get("display_name", ""),
                "calls":        0,
                "cost_usd":     0.0,
                "by_service":   {},
            }
        per_user[uid]["calls"] += 1
        per_user[uid]["cost_usd"] = round(per_user[uid]["cost_usd"] + cost, 6)
        if svc not in per_user[uid]["by_service"]:
            per_user[uid]["by_service"][svc] = {"calls": 0, "cost_usd": 0.0}
        per_user[uid]["by_service"][svc]["calls"] += 1
        per_user[uid]["by_service"][svc]["cost_usd"] = round(
            per_user[uid]["by_service"][svc]["cost_usd"] + cost, 6
        )

    return {
        "overall":  overall,
        "per_user": sorted(per_user.values(), key=lambda x: x["cost_usd"], reverse=True),
        "meta": {
            "query_limit": capped_limit,
            "returned_rows": len(logs),
            "total_matching_rows": combined_total,
            "truncated": truncated,
            "ledger_returned_rows": ledger_returned_rows,
            "ledger_total_matching_rows": total_matching,
            "ledger_truncated": ledger_truncated,
            "ledger_schema_legacy": ledger_schema_legacy,
            "supplemental_writing_rows": supplemental_writing_rows,
            "writing_source_returned_rows": writing_source_returned_rows,
            "writing_source_total_rows": writing_source_total_rows,
            "writing_source_truncated": writing_source_truncated,
            "writing_lookup_failed": writing_lookup_failed,
        },
    }
