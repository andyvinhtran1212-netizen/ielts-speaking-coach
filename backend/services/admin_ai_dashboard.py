"""Read models for the admin AI dashboard (AIOPS-0024 FR-001/FR-002/FR-008).

* Models in use: the routing ``ai_router`` will apply right now, per feature,
  with the source of every value (``db_override`` / ``env`` / ``code_default``).
* Usage: ``fn_admin_ai_usage_rollup`` groups the complete window in the
  database; cost comes from the stored ledger estimate or, for legacy rows, the
  ``ai_pricing`` catalog. Nothing is truncated by a row cap.
* Failures: ``fn_admin_ai_failure_rollup`` plus the latest 50 rows of
  ``ai_provider_failures``.

Windows start at 00:00 Asia/Saigon (today, 6 or 29 days earlier) and end now.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable
from zoneinfo import ZoneInfo

from services import ai_failure_log, ai_model_overrides, ai_router
from services.ai_pricing import effective_logged_cost

SAIGON = ZoneInfo("Asia/Ho_Chi_Minh")
TIMEZONE_LABEL = "Asia/Saigon"
WINDOW_DAYS: dict[str, int] = {"today": 0, "7d": 6, "30d": 29}
RPC_PAGE = 1000
RECENT_FAILURES = 50
RECENT_CHANGES = 20

FEATURE_LABELS: dict[str, str] = {
    "speaking_grading": "Chấm Speaking",
    "writing_grading": "Chấm Writing",
    "course_writing": "Soát bài tự luận theo buổi",
    "advanced_vocab_rewrite": "Viết lại câu – Từ vựng nâng cao",
    "question_generation": "Sinh câu hỏi Speaking",
    "listening_audit": "Kiểm duyệt nội dung Listening",
}

PROVIDER_BY_SERVICE: dict[str, str] = {
    "claude": "anthropic",
    "gemini": "gemini",
    "whisper": "openai",
    "tts": "openai",
    "openai": "openai",
    "elevenlabs": "elevenlabs",
    "azure": "azure",
}


class DashboardNotMigrated(RuntimeError):
    pass


async def _execute(query: Any) -> Any:
    """Run a sync PostgREST query off the event loop."""
    return await asyncio.to_thread(query.execute)


def window_bounds(key: str, now: datetime | None = None) -> tuple[datetime, datetime]:
    """``[start, end)`` in UTC for a window key; start is a Saigon midnight."""
    days = WINDOW_DAYS[key]
    end = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    local = end.astimezone(SAIGON)
    start_local = (local - timedelta(days=days)).replace(hour=0, minute=0, second=0, microsecond=0)
    return start_local.astimezone(timezone.utc), end


def window_out(key: str, start: datetime, end: datetime) -> dict[str, Any]:
    return {"key": key, "start": start, "end": end, "timezone": TIMEZONE_LABEL}


# ── Models in use ──────────────────────────────────────────────────────────


def _slot_steps_speaking(s: Any) -> list[dict[str, Any]]:
    from services.grading_orchestrator import grading_provider_order
    from services.grading_providers.claude import ClaudeHaikuProvider, ClaudeSonnetProvider

    anthropic_key = bool(getattr(s, "ANTHROPIC_API_KEY", "") or "")
    gemini_key = bool(getattr(s, "GEMINI_API_KEY", "") or "")
    steps = []
    for slot in grading_provider_order(s):
        if slot == "anthropic_primary":
            steps.append({
                "provider": "anthropic", "slot": slot,
                "model": ai_router.anthropic_model("speaking_grading", s),
                "model_source": ai_router.anthropic_model_source("speaking_grading", s),
                "available": anthropic_key, "note": "1 lần thử, không retry",
            })
        elif slot == "grading_primary":
            model = (getattr(s, "SPEAKING_GRADING_MODEL", "") or "").strip()
            provider = ai_failure_log.provider_for(None, model)
            available = bool(model) and (
                (provider == "anthropic" and anthropic_key) or (provider == "gemini" and gemini_key)
            )
            steps.append({
                "provider": provider, "slot": slot, "model": model or None,
                "model_source": ai_router.setting_source(s, "SPEAKING_GRADING_MODEL"),
                "available": available, "note": "SPEAKING_GRADING_MODEL",
            })
        elif slot in ("claude_haiku", "claude_sonnet"):
            cls = ClaudeHaikuProvider if slot == "claude_haiku" else ClaudeSonnetProvider
            steps.append({
                "provider": "anthropic", "slot": slot, "model": cls.model,
                "model_source": "code_default", "available": anthropic_key,
                "note": "chuỗi dự phòng",
            })
        else:  # pragma: no cover - future slot
            steps.append({"provider": ai_failure_log.provider_for(slot), "slot": slot,
                          "model": None, "model_source": "code_default",
                          "available": True, "note": ""})
    return steps


def _configured_preference(feature: str, s: Any) -> str:
    """First provider of the configured order (before the missing-key rule)."""
    existing = ai_model_overrides.EXISTING_PROVIDERS[feature]
    order = [p for p in ai_router.provider_order(feature, s) if p in ("anthropic", existing)]
    if existing not in order:
        order.append(existing)
    return order[0]


def describe_feature(feature: str, s: Any, emails: dict[str, str]) -> dict[str, Any]:
    existing = ai_model_overrides.EXISTING_PROVIDERS[feature]
    existing_models = ai_router.existing_models(feature, s)
    if feature == "speaking_grading":
        steps = _slot_steps_speaking(s)
    else:
        steps = []
        for provider in ai_router.effective_order(feature, existing, s):
            if provider == "anthropic":
                steps.append({
                    "provider": "anthropic", "slot": "anthropic",
                    "model": ai_router.anthropic_model(feature, s),
                    "model_source": ai_router.anthropic_model_source(feature, s),
                    "available": True, "note": "",
                })
            else:
                primary = existing_models[0] if existing_models else {}
                steps.append({
                    "provider": provider, "slot": provider,
                    "model": primary.get("model") or None,
                    "model_source": primary.get("source", "code_default"),
                    "available": True,
                    "note": "; ".join(f"{m['model']} ({m['note']})" for m in existing_models
                                      if m.get("note")),
                })

    stored = ai_model_overrides.all_overrides().get(feature)
    override = None
    if stored is not None:
        override = {
            "preferred_provider": stored.preferred_provider,
            "anthropic_model": stored.anthropic_model,
            "updated_at": stored.updated_at,
            "updated_by": stored.updated_by,
            "updated_by_email": emails.get(stored.updated_by or ""),
            "invalid_fields": list(stored.invalid_fields),
        }
    return {
        "feature": feature,
        "label": FEATURE_LABELS.get(feature, feature),
        "existing_provider": existing,
        "allowed_providers": list(ai_model_overrides.allowed_providers(feature)),
        "effective_order": steps,
        "preferred_provider": {
            "value": _configured_preference(feature, s),
            "source": ai_router.provider_order_source(feature, s),
        },
        "anthropic_model": {
            "value": ai_router.anthropic_model(feature, s),
            "source": ai_router.anthropic_model_source(feature, s),
        },
        "existing_models": existing_models,
        "override": override,
    }


async def _fetch_emails(client: Any, user_ids: Iterable[str | None]) -> dict[str, str]:
    ids = sorted({str(i) for i in user_ids if i})
    if not ids:
        return {}
    try:
        res = await _execute(client.table("users").select("id, email").in_("id", ids))
    except Exception:
        return {}
    return {str(r["id"]): r.get("email") or "" for r in (res.data or []) if r.get("id")}


async def models_view(client: Any, s: Any) -> dict[str, Any]:
    changes: list[dict[str, Any]] = []
    changes_error: str | None = None
    try:
        res = await _execute(
            client.table(ai_model_overrides.AUDIT_TABLE)
            .select("id, feature, action, old_preferred_provider, new_preferred_provider, "
                    "old_anthropic_model, new_anthropic_model, changed_by, changed_at")
            .order("changed_at", desc=True)
            .order("id", desc=True)
            .limit(RECENT_CHANGES)
        )
        changes = list(res.data or [])
    except Exception as exc:
        changes_error = ("not_migrated" if ai_model_overrides.is_missing_table_error(exc)
                         else "unavailable")

    overrides = ai_model_overrides.all_overrides().values()
    emails = await _fetch_emails(
        client, [c.get("changed_by") for c in changes] + [o.updated_by for o in overrides],
    )
    for change in changes:
        change["changed_by_email"] = emails.get(str(change.get("changed_by") or ""))

    return {
        "features": [describe_feature(f, s, emails) for f in ai_model_overrides.EXISTING_PROVIDERS],
        "anthropic_models": list(ai_model_overrides.ANTHROPIC_MODEL_ALLOWLIST),
        "anthropic_key_configured": bool(getattr(s, "ANTHROPIC_API_KEY", "") or ""),
        "store": ai_model_overrides.snapshot_info(s),
        "recent_changes": changes,
        "recent_changes_error": changes_error,
        "computed_at": datetime.now(timezone.utc),
    }


# ── Usage ──────────────────────────────────────────────────────────────────


async def _rpc_all(client: Any, name: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    """Every row of a set-returning RPC, paging past PostgREST's max-rows."""
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        try:
            res = await _execute(client.rpc(name, params).range(offset, offset + RPC_PAGE - 1))
        except Exception as exc:
            if ai_model_overrides.is_missing_table_error(exc):
                raise DashboardNotMigrated(name) from exc
            raise
        page = list(res.data or [])
        rows.extend(page)
        if len(page) < RPC_PAGE:
            return rows
        offset += RPC_PAGE


def _empty_totals() -> dict[str, Any]:
    return {
        "calls": 0, "failed_calls": 0, "input_tokens": 0, "output_tokens": 0,
        "thinking_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0,
        "cost_usd": 0.0, "priced_calls": 0, "unpriced_calls": 0, "legacy_calls": 0,
    }


def _int(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def aggregate_usage(rows: Iterable[dict[str, Any]]) -> dict[str, Any]:
    totals = _empty_totals()
    by_feature: dict[str, dict[str, Any]] = defaultdict(_empty_totals)
    by_provider: dict[str, dict[str, Any]] = defaultdict(_empty_totals)

    for row in rows:
        calls = _int(row.get("calls"))
        if not calls:
            continue
        success = row.get("status") in (None, "success")
        cost: float | None
        priced = legacy = 0
        if row.get("cost_source") == "unpriced":
            cost = None
        elif row.get("pricing_version"):
            stored = row.get("cost_usd")
            cost = float(stored) if stored is not None else None
            priced = min(calls, _int(row.get("priced_calls")))
        else:
            # Pre-286 legacy rows: re-price the aggregated raw units.
            legacy = calls
            cost, _ = effective_logged_cost({
                "service": row.get("service"), "model": row.get("model"),
                "input_tokens": _int(row.get("input_tokens")),
                "output_tokens": _int(row.get("output_tokens")),
                "thinking_tokens": _int(row.get("thinking_tokens")),
                "cache_read_tokens": _int(row.get("cache_read_tokens")),
                "cache_write_tokens": _int(row.get("cache_write_tokens")),
                "audio_seconds": float(row.get("audio_seconds") or 0),
                "text_chars": _int(row.get("text_chars")),
                "cost_usd_est": row.get("cost_usd"),
                "created_at": row.get("last_at"),
            })
            priced = calls if cost is not None else 0
        unpriced = (calls - priced) if success else 0

        feature = row.get("feature") or "unattributed"
        service = str(row.get("service") or "unknown")
        provider = PROVIDER_BY_SERVICE.get(service, service)
        for bucket in (totals, by_feature[feature], by_provider[provider]):
            bucket["calls"] += calls
            bucket["failed_calls"] += 0 if success else calls
            for key in ("input_tokens", "output_tokens", "thinking_tokens",
                        "cache_read_tokens", "cache_write_tokens"):
                bucket[key] += _int(row.get(key))
            bucket["cost_usd"] = round(bucket["cost_usd"] + max(0.0, cost or 0.0), 6)
            bucket["priced_calls"] += priced
            bucket["unpriced_calls"] += unpriced
            bucket["legacy_calls"] += legacy

    def _sorted(groups: dict[str, dict[str, Any]], key: str) -> list[dict[str, Any]]:
        return sorted(({key: name, **values} for name, values in groups.items()),
                      key=lambda g: (-g["cost_usd"], -g["calls"], g[key]))

    return {
        "totals": totals,
        "by_feature": _sorted(by_feature, "feature"),
        "by_provider": _sorted(by_provider, "provider"),
    }


async def usage_view(client: Any, key: str, now: datetime | None = None) -> dict[str, Any]:
    start, end = window_bounds(key, now)
    rows = await _rpc_all(client, "fn_admin_ai_usage_rollup",
                          {"p_start": start.isoformat(), "p_end": end.isoformat()})
    return {
        "window": window_out(key, start, end),
        **aggregate_usage(rows),
        "meta": {
            "source": "ai_usage_logs",
            "note": ("Chi phí là ước tính theo bảng giá ai_pricing; hoá đơn nhà cung cấp "
                     "là nguồn chính thức."),
        },
    }


# ── Failures ───────────────────────────────────────────────────────────────


def aggregate_failures(rows: Iterable[dict[str, Any]]) -> dict[str, Any]:
    totals = {"total": 0, "retry": 0, "fallback": 0, "final": 0}
    groups: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        count = _int(row.get("failures"))
        if not count:
            continue
        outcome = row.get("outcome") if row.get("outcome") in ai_failure_log.OUTCOMES else "final"
        key = (str(row.get("provider") or "unknown"), str(row.get("feature") or "unknown"))
        group = groups.setdefault(key, {
            "provider": key[0], "feature": key[1],
            "total": 0, "retry": 0, "fallback": 0, "final": 0, "by_error_type": {},
        })
        error_type = str(row.get("error_type") or "unknown")
        for bucket in (totals, group):
            bucket["total"] += count
            bucket[outcome] += count
        group["by_error_type"][error_type] = group["by_error_type"].get(error_type, 0) + count
    return {
        "totals": totals,
        "by_provider_feature": sorted(groups.values(),
                                      key=lambda g: (-g["total"], g["provider"], g["feature"])),
    }


async def failures_view(client: Any, key: str, now: datetime | None = None) -> dict[str, Any]:
    start, end = window_bounds(key, now)
    params = {"p_start": start.isoformat(), "p_end": end.isoformat()}
    try:
        rows = await _rpc_all(client, "fn_admin_ai_failure_rollup", params)
        res = await _execute(
            client.table(ai_failure_log.TABLE)
            .select("id, created_at, feature, provider, model, route_slot, attempt, "
                    "error_type, error_code, outcome")
            .gte("created_at", params["p_start"])
            .lt("created_at", params["p_end"])
            .order("created_at", desc=True)
            .order("id", desc=True)
            .limit(RECENT_FAILURES)
        )
    except DashboardNotMigrated:
        return {"window": window_out(key, start, end), "store_status": "not_migrated",
                **aggregate_failures([]), "recent": []}
    except Exception as exc:
        if ai_model_overrides.is_missing_table_error(exc):
            return {"window": window_out(key, start, end), "store_status": "not_migrated",
                    **aggregate_failures([]), "recent": []}
        raise
    return {
        "window": window_out(key, start, end),
        "store_status": "ok",
        **aggregate_failures(rows),
        "recent": list(res.data or []),
    }
