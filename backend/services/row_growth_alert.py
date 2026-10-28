"""Daily row-growth alert for learner-writable Vocabulary/flashcard tables.

INACTIVEWRITE-0035 follow-up (owner decision 2026-10-28). Learners can write
`user_vocabulary` and the flashcard tables with their own JWT through Supabase
REST, which has no rate limit (and the owner chose not to add one). This check
counts, per user and per table, the rows created in the trailing window and
flags any user above the threshold (default: more than 500 in 24 hours).

Alert path: the backend `error_logs` row that admins triage at
/admin/error-logs (level `warning`, source `backend`), plus a server log line.
Nothing is sent to the learner. One alert per (UTC day, table, user): the
`request_id` carries that key and is checked before insert, so a restart or a
second run on the same day does not repeat it.

Known limit: the window uses the row's own timestamp column, which a direct
REST insert can set. Migration 335 stops inactive accounts from writing at
all; this alert targets bulk writes by an active account.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from database import supabase_admin

logger = logging.getLogger(__name__)

# (table, timestamp column, owner column). flashcard_cards has no user_id; its
# owner is the stack's user_id.
WATCHED_TABLES: tuple[tuple[str, str, str], ...] = (
    ("user_vocabulary", "created_at", "user_id"),
    ("flashcard_stacks", "created_at", "user_id"),
    ("flashcard_cards", "added_at", "stack_id"),
    ("flashcard_reviews", "created_at", "user_id"),
    ("flashcard_review_log", "reviewed_at", "user_id"),
)

PAGE_SIZE = 1000
# Per table per run. Hitting it is itself abnormal and raises its own alert;
# counts gathered so far are still evaluated.
MAX_SCANNED_ROWS = 50_000
_LOOKUP_CHUNK = 100
ALERT_URL = "/internal/row-growth-check"


def _count_new_rows(table: str, ts_col: str, owner_col: str, since_iso: str) -> tuple[dict[str, int], bool]:
    counts: dict[str, int] = {}
    scanned = 0
    while scanned < MAX_SCANNED_ROWS:
        page = (
            supabase_admin.table(table)
            .select(owner_col)
            .gte(ts_col, since_iso)
            .order(ts_col)
            .order("id")
            .range(scanned, scanned + PAGE_SIZE - 1)
            .execute()
        ).data or []
        for row in page:
            owner = row.get(owner_col)
            if owner:
                counts[str(owner)] = counts.get(str(owner), 0) + 1
        scanned += len(page)
        if len(page) < PAGE_SIZE:
            return counts, False
    return counts, True


def _stack_counts_to_users(stack_counts: dict[str, int]) -> dict[str, int]:
    stack_ids = sorted(stack_counts)
    per_user: dict[str, int] = {}
    for i in range(0, len(stack_ids), _LOOKUP_CHUNK):
        chunk = stack_ids[i:i + _LOOKUP_CHUNK]
        stacks = (
            supabase_admin.table("flashcard_stacks")
            .select("id, user_id")
            .in_("id", chunk)
            .execute()
        ).data or []
        for s in stacks:
            uid = str(s.get("user_id") or "")
            if uid:
                per_user[uid] = per_user.get(uid, 0) + stack_counts.get(str(s["id"]), 0)
    return per_user


def _alert_once(key: str, day_start_iso: str, message: str, extra: dict) -> bool:
    """Insert one warning into error_logs unless `key` is already there today."""
    existing = (
        supabase_admin.table("error_logs")
        .select("id")
        .gte("occurred_at", day_start_iso)
        .eq("request_id", key)
        .limit(1)
        .execute()
    ).data or []
    if existing:
        return False
    supabase_admin.table("error_logs").insert({
        "level": "warning",
        "source": "backend",
        "message": message[:1000],
        "url": ALERT_URL,
        "request_id": key,
        "extra": extra,
    }).execute()
    return True


def run_row_growth_check(
    *,
    threshold: int,
    window_hours: int = 24,
    now: datetime | None = None,
) -> dict:
    """Flag users who created more than `threshold` rows in one watched table
    within the trailing `window_hours`. Returns a summary for the log."""
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    since_iso = (now - timedelta(hours=window_hours)).isoformat()
    day = now.date().isoformat()
    day_start_iso = datetime(now.year, now.month, now.day, tzinfo=timezone.utc).isoformat()
    summary: dict = {"flagged": [], "alerted": 0, "failed_tables": [], "truncated_tables": []}

    for table, ts_col, owner_col in WATCHED_TABLES:
        try:
            counts, truncated = _count_new_rows(table, ts_col, owner_col, since_iso)
            if table == "flashcard_cards":
                counts = _stack_counts_to_users(counts)
            alerts: list[tuple[str, str, dict]] = []
            if truncated:
                summary["truncated_tables"].append(table)
                alerts.append((
                    f"row-growth:{day}:{table}:scan-cap",
                    f"Row growth alert: {table} has more than {MAX_SCANNED_ROWS} new rows "
                    f"in the last {window_hours}h (scan stopped at the cap)",
                    {"kind": "row_growth_scan_cap", "table": table,
                     "scanned_rows": MAX_SCANNED_ROWS, "window_hours": window_hours,
                     "since": since_iso},
                ))
            for user_id, rows in sorted(counts.items(), key=lambda kv: -kv[1]):
                if rows <= threshold:
                    continue
                summary["flagged"].append({"table": table, "user_id": user_id, "rows": rows})
                logger.warning(
                    "[row-growth] user=%s table=%s rows=%d in %dh (threshold %d)",
                    user_id, table, rows, window_hours, threshold,
                )
                alerts.append((
                    f"row-growth:{day}:{table}:{user_id}",
                    f"Row growth alert: user {user_id} created {rows} {table} rows "
                    f"in the last {window_hours}h (threshold {threshold})",
                    {"kind": "row_growth", "table": table, "user_id": user_id,
                     "rows": rows, "threshold": threshold,
                     "window_hours": window_hours, "since": since_iso},
                ))
            for key, message, extra in alerts:
                if _alert_once(key, day_start_iso, message, extra):
                    summary["alerted"] += 1
        except Exception as exc:
            # No silent failure: a check that cannot run is itself reported.
            logger.error("[row-growth] check failed for %s: %s", table, exc)
            summary["failed_tables"].append(table)
            try:
                _alert_once(
                    f"row-growth:{day}:{table}:check-failed",
                    day_start_iso,
                    f"Row growth check failed for {table}: {str(exc)[:300]}",
                    {"kind": "row_growth_check_failed", "table": table},
                )
            except Exception as alert_exc:
                logger.error("[row-growth] could not record the failure for %s: %s", table, alert_exc)

    return summary
