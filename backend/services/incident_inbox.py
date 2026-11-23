"""Incident inbox (ADMINIA-0074 FR-070, FR-071; plan 5.4; G09-T07).

Reads the three sources, groups them (``services.error_log_grouping``) and
overlays the state a person decided (``incident_groups``, migration 451).

* Each source reads at most ``SCAN_LIMIT`` of its newest rows; past that its
  name is in ``truncated``. A source whose read fails is in
  ``sources_failed`` and its groups are absent; the other sources still load.
* Status: the stored one; no stored row → ``new``, except a group whose every
  record was already dismissed/resolved one by one on the old pages, which
  reads as ``resolved``. A stored ``resolved``/``ignored`` group with a record
  newer than ``resolved_at`` reads as ``new`` (auto-reopen; notes kept).
* Changes go through ``fn_incident_group_transition`` (state + auto note in
  one transaction). Resolving an ``errors`` group then dismisses its
  undismissed ``error_logs`` rows, 200 ids per update; the per-row dismiss
  endpoints of ``routers/error_logs.py`` are unchanged.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from database import supabase_admin
from services import error_log_grouping as grouping
from services.error_log_grouping import Group

logger = logging.getLogger(__name__)

SCAN_LIMIT = 5000
PAGE_SIZE = 25
_READ_PAGE = 1000
_ID_CHUNK = 200
OPEN_STATUSES = ("new", "in_review")
STATUSES = ("new", "in_review", "resolved", "ignored")
ACTIONS = ("claim", "resolve", "ignore", "reopen")


@dataclass
class Snapshot:
    groups: dict[tuple[str, str], Group] = field(default_factory=dict)
    sources_failed: list[str] = field(default_factory=list)
    truncated: list[str] = field(default_factory=list)


def _paged(make_query, limit: Optional[int] = None) -> tuple[list[dict], bool]:
    """Read up to ``limit`` (default ``SCAN_LIMIT``) rows in pages; ``True`` when more rows exist."""
    limit = SCAN_LIMIT if limit is None else limit
    rows: list[dict] = []
    while len(rows) <= limit:
        start = len(rows)
        end = min(start + _READ_PAGE - 1, limit)   # row ``limit`` (0-based) only probes for more
        batch = make_query().range(start, end).execute().data or []
        rows.extend(batch)
        if len(batch) < end - start + 1:
            break
    return rows[:limit], len(rows) > limit


def _in_chunks(table: str, columns: str, column: str, ids: Iterable[str]) -> list[dict]:
    ids = sorted({str(i) for i in ids if i})
    out: list[dict] = []
    for i in range(0, len(ids), _ID_CHUNK):
        out.extend(supabase_admin.table(table).select(columns).in_(column, ids[i:i + _ID_CHUNK])
                   .execute().data or [])
    return out


def _read_errors() -> tuple[dict, bool]:
    rows, more = _paged(lambda: supabase_admin.table("error_logs")
                        .select("id, occurred_at, level, source, message, url, user_id, dismissed_at")
                        .order("occurred_at", desc=True).order("id", desc=True))
    return grouping.group_errors(rows), more


_SESSION_COLS = "id, user_id, mode, part, error_code, failed_step, last_error_at, started_at, status"


def _read_grading() -> tuple[dict, bool]:
    with_code, more_a = _paged(lambda: supabase_admin.table("sessions").select(_SESSION_COLS)
                               .not_.is_("error_code", "null")
                               .order("started_at", desc=True).order("id", desc=True))
    degraded, more_b = _paged(lambda: supabase_admin.table("sessions").select(_SESSION_COLS)
                              .eq("status", "grading_failed")
                              .order("started_at", desc=True).order("id", desc=True))
    sessions = {str(s["id"]): s for s in with_code + degraded}
    responses, more_c = _paged(lambda: supabase_admin.table("responses")
                               .select("id, session_id, stt_status")
                               .eq("grading_status", "failed").order("id", desc=True))
    # Like /admin/alerts: a response of a session already listed is not counted twice.
    pending = [r for r in responses if str(r.get("session_id") or "") not in sessions]
    owners = {str(s["id"]): s for s in _in_chunks("sessions", _SESSION_COLS, "id",
                                                    (r.get("session_id") for r in pending))}
    pairs = [(r, owners.get(str(r.get("session_id")), {})) for r in pending]
    return grouping.group_grading(sessions.values(), pairs), more_a or more_b or more_c


def _read_feedback() -> tuple[dict, bool]:
    rows, more = _paged(lambda: supabase_admin.table("user_feedback")
                        .select("id, type, skill, test_id, rating_de, rating_audio, status, created_by, created_at")
                        .neq("type", "report")
                        .order("created_at", desc=True).order("id", desc=True))
    return grouping.group_feedback(rows), more


_READERS = {"errors": _read_errors, "grading": _read_grading, "feedback": _read_feedback}


def snapshot(sources: Iterable[str] = grouping.SOURCES) -> Snapshot:
    snap = Snapshot()
    for source in sources:
        try:
            groups, more = _READERS[source]()
        except Exception:
            logger.exception("incident inbox: source %s failed", source)
            snap.sources_failed.append(source)
            continue
        if more:
            snap.truncated.append(source)
        for fp, group in groups.items():
            snap.groups[(source, fp)] = group
    return snap


def stored_states(keys: Optional[Iterable[tuple[str, str]]] = None) -> dict[tuple[str, str], dict]:
    """Stored rows of ``incident_groups`` (all of them, or those of ``keys``)."""
    rows: list[dict] = []
    if keys is None:
        rows, _ = _paged(lambda: supabase_admin.table("incident_groups").select("*")
                         .order("source").order("fingerprint"), limit=10 ** 6)
    else:
        by_source: dict[str, list[str]] = {}
        for source, fp in keys:
            by_source.setdefault(source, []).append(fp)
        for source, fps in by_source.items():
            for i in range(0, len(fps), _ID_CHUNK):
                rows.extend(supabase_admin.table("incident_groups").select("*").eq("source", source)
                            .in_("fingerprint", fps[i:i + _ID_CHUNK]).execute().data or [])
    return {(r["source"], r["fingerprint"]): r for r in rows}


def _parse(ts: Any) -> Optional[datetime]:
    if not ts:
        return None
    try:
        value = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def effective_status(group: Optional[Group], stored: Optional[dict]) -> tuple[str, bool]:
    """(status, reopened) of a group, as described in the module docstring."""
    if not stored:
        return ("resolved" if group is not None and group.all_closed else "new"), False
    status = stored.get("status") or "new"
    if status in ("resolved", "ignored") and group is not None:
        closed_at = _parse(stored.get("resolved_at"))
        last = _parse(group.last_at)
        if closed_at and last and last > closed_at:
            return "new", True
    return status, False


def opened_at(group: Group, stored: Optional[dict], reopened: bool) -> Optional[datetime]:
    """When the group's current open period began: its first record, or the
    first record after it was closed when it reopened."""
    times = [t for t in (_parse(x) for x in group.times) if t]
    if reopened and stored:
        closed_at = _parse(stored.get("resolved_at"))
        times = [t for t in times if closed_at is None or t > closed_at]
    return min(times) if times else None


def is_overdue(group: Group, stored: Optional[dict], status: str, reopened: bool,
               thresholds: Optional[dict], now: datetime) -> bool:
    """Plan 5.6: ``incident_unclaimed_hours`` for an unclaimed (``new``) error or
    grading group; ``feedback_unanswered_hours`` for an open feedback group."""
    if not thresholds:
        return False
    if group.source == "feedback":
        hours, applies = thresholds.get("feedback_unanswered_hours"), status in OPEN_STATUSES
    else:
        hours, applies = thresholds.get("incident_unclaimed_hours"), status == "new"
    start = opened_at(group, stored, reopened)
    if not applies or hours is None or start is None:
        return False
    return now - start > timedelta(hours=int(hours))


def review_items_open() -> int:
    """Open answer reports, shown as a count only (they live in Câu cần kiểm, T36)."""
    res = (supabase_admin.table("user_feedback").select("id", count="exact", head=True)
           .eq("type", "report").eq("status", "new").execute())
    return int(res.count or 0)


def user_names(ids: Iterable[Any]) -> dict[str, str]:
    rows = _in_chunks("users", "id, display_name, email", "id", ids)
    return {str(r["id"]): (r.get("display_name") or "").strip() or (r.get("email") or "") for r in rows}


def notes(source: str, fp: str) -> list[dict]:
    return (supabase_admin.table("incident_group_notes")
            .select("id, body, auto, actor_id, created_at")
            .eq("source", source).eq("fingerprint", fp)
            .order("created_at", desc=True).order("id", desc=True).limit(200).execute().data or [])


def transition(source: str, fp: str, action: str, actor: str, last_seen: Optional[str],
               note: Optional[str], closed_before: bool = False) -> dict:
    res = supabase_admin.rpc("fn_incident_group_transition", {
        "p_source": source, "p_fingerprint": fp, "p_action": action, "p_actor": actor,
        "p_last_seen": last_seen, "p_note": note, "p_closed_before": closed_before,
    }).execute()
    data = res.data
    if isinstance(data, list):
        data = data[0] if data else None
    if not isinstance(data, dict) or "changed" not in data:
        raise RuntimeError("fn_incident_group_transition returned no result")
    return data


def dismiss_error_rows(record_ids: list[str], actor: str) -> None:
    """Dismiss the still-undismissed ``error_logs`` rows of a resolved group."""
    now = datetime.now(timezone.utc).isoformat()
    for i in range(0, len(record_ids), _ID_CHUNK):
        (supabase_admin.table("error_logs")
         .update({"dismissed_at": now, "dismissed_by": actor})
         .in_("id", record_ids[i:i + _ID_CHUNK])
         .is_("dismissed_at", "null")
         .execute())
