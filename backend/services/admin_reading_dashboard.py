"""services/admin_reading_dashboard.py — reading-access-tracking Part C.

Aggregates `reading_test_attempts` for the admin "Reading attempts" dashboard:
counts (authenticated distinct + anonymous APPROXIMATE), per-test usage, band
distribution, skill performance (which skills students struggle with — the
actionable bit), and time-taken stats — for BOTH authenticated users
(`user_id`) and anonymous share-link takers (`user_id` NULL, grouped by the
salted `anon_src` hash from Part B1).

Privacy: `anon_src` is a SALTED IP hash (B1 never persisted the raw IP). It is
used ONLY for an approximate distinct-source COUNT server-side and is NEVER
returned to the client. Anonymous distinct counts are APPROXIMATE (NAT / shared
IP / rotation — the #370 dedupe limit) and labelled as such in the UI.

Aggregation runs in Python over a bounded, column-projected fetch of SUBMITTED
attempts within the window (no RPC, no migration — the table is new + small).
The row fetch is capped; if the window exceeds the cap the response flags
`truncated` so the UI can render lower bounds rather than imply full coverage. If
attempts grow large, move this to an RPC (the #365 `fn_total_grading_minutes`
pattern).

Pattern #29: a load-bearing row-query outage yields an explicit unavailable
payload (ok=false); auxiliary failures retain safe data as partial. Boundaries
are UTC, consistent with admin_dashboard / admin_overview / foot-traffic.

Schema (confirmed against migrations, no new migration this sprint):
  - reading_test_attempts (user_id, anon_src, status, score, band_estimate,
    skill_breakdown, time_spent_seconds, submitted_at, test_id)  [mig 087/090]
  - reading_tests (id, test_id, title)                            [mig 086]
  - users (id, email)                                             [mig 001]
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from database import supabase_admin
from services.band_rounding import ielts_round

logger = logging.getLogger(__name__)

ALLOWED_WINDOWS = (7, 30, 90)
DEFAULT_WINDOW = 30
# Bounded fetch so the dashboard never pulls an unbounded table. The window
# COUNT(exact) is computed separately; if it exceeds the cap we flag truncated.
_FETCH_CAP = 5000
_RECENT_LIMIT = 20


class _AttemptRow(BaseModel):
    """The small, privacy-aware projection used by this dashboard.

    Validation happens before aggregation so one legacy/corrupt JSON row cannot
    turn the whole admin read into a 500 or silently poison averages.
    """

    id: str
    test_id: str
    user_id: str | None = None
    anon_src: str | None = None
    # These diagnostics are schema-drift tolerant on input and sanitized below.
    # A bad optional diagnostic must not erase an otherwise valid submission.
    band_estimate: Any = None
    # Legacy submitted attempts may not carry optional diagnostics. Their core
    # count/band facts remain valid; only the missing diagnostic is skipped.
    skill_breakdown: Any = None
    time_spent_seconds: Any = None
    submitted_at: datetime


def _clamp_window(days: int) -> int:
    return days if days in ALLOWED_WINDOWS else DEFAULT_WINDOW


def _median(nums: list[float]) -> float | None:
    if not nums:
        return None
    s = sorted(nums)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2.0


def compute_reading_attempts_dashboard(days: int = DEFAULT_WINDOW) -> dict:
    """Reading-attempt aggregates for the admin dashboard. Windowed by
    `submitted_at` (last `days`), plus an all-time submitted count. Returns
    unavailable row-derived aggregates on a load-bearing query outage."""
    days = _clamp_window(days)
    now = datetime.now(timezone.utc)
    # Freeze every query at one watermark. Without an upper bound, a submission
    # committed between COUNT and SELECT can make the totals and sample describe
    # two different datasets in the same response.
    snapshot_point = now
    snapshot_to = snapshot_point.isoformat()
    window_start = (snapshot_point - timedelta(days=days)).isoformat()

    empty = {
        "ok": False,
        "data_status": "unavailable",
        "window_days": days,
        "window_start": window_start,
        "snapshot_to": snapshot_to,
        "totals": {
            "submitted_all_time": None, "submitted_window": None,
            "auth_attempts": None, "anon_attempts": None,
            "auth_distinct_users": None, "anon_distinct_sources": None,
            "truncated": False,
        },
        "band_distribution": [],
        "skill_performance": [],
        "time_stats": {"avg_minutes": None, "median_minutes": None, "count": 0},
        "per_test": [],
        "recent": [],
        "malformed_count": 0,
        "lookup_failures": [],
        "computed_at": now.isoformat(),
    }

    lookup_failures: list[str] = []
    submitted_all_time: int | None = None
    submitted_window: int | None = None

    try:
        # All-time submitted total — head COUNT(exact), no rows pulled.
        all_time = (
            supabase_admin.table("reading_test_attempts")
            .select("id", count="exact").limit(0)
            .eq("status", "submitted")
            .lte("submitted_at", snapshot_to)
            .execute()
        )
        if all_time.count is None:
            raise ValueError("exact all-time count missing")
        submitted_all_time = int(all_time.count)
    except Exception as exc:  # pragma: no cover - exercised via stub in tests
        lookup_failures.append("all_time_count")
        logger.warning("[reading_dashboard] all-time count failed: %s", exc)

    try:
        # Exact windowed count (for truncation detection) + the bounded rows.
        win_count_res = (
            supabase_admin.table("reading_test_attempts")
            .select("id", count="exact").limit(0)
            .eq("status", "submitted")
            .gte("submitted_at", window_start)
            .lte("submitted_at", snapshot_to)
            .execute()
        )
        if win_count_res.count is None:
            raise ValueError("exact window count missing")
        submitted_window = int(win_count_res.count)
    except Exception as exc:  # pragma: no cover - exercised via stub in tests
        lookup_failures.append("window_count")
        logger.warning("[reading_dashboard] window count failed: %s", exc)

    try:
        rows_res = (
            supabase_admin.table("reading_test_attempts")
            .select("id,test_id,user_id,anon_src,band_estimate,"
                    "skill_breakdown,time_spent_seconds,submitted_at")
            .eq("status", "submitted")
            .gte("submitted_at", window_start)
            .lte("submitted_at", snapshot_to)
            .order("submitted_at", desc=True)
            .order("id", desc=True)
            .limit(_FETCH_CAP)
            .execute()
        )
        raw_rows = rows_res.data or []
        raw_count = len(raw_rows)
        # COUNT and rows are separate PostgREST requests, not one transaction.
        # The shared upper watermark prevents ordinary forward inserts, but a
        # late/backdated write or concurrent delete can still disagree. Only
        # trust COUNT when it matches the scan, or when a full cap proves the
        # scan itself was truncated. Otherwise downgrade to the scanned lower
        # bound instead of letting response validation turn drift into a 500.
        if submitted_window is None:
            truncated = raw_count >= _FETCH_CAP
        elif submitted_window == raw_count:
            truncated = False
        elif submitted_window > _FETCH_CAP and raw_count == _FETCH_CAP:
            truncated = True
        else:
            logger.warning(
                "[reading_dashboard] count/row mismatch at snapshot: count=%s rows=%s",
                submitted_window, raw_count,
            )
            submitted_window = None
            if "window_count" not in lookup_failures:
                lookup_failures.append("window_count")
            truncated = raw_count >= _FETCH_CAP
        if truncated:
            logger.warning(
                "[reading_dashboard] window=%sd has %s submitted attempts > cap %s "
                "— aggregating a sample (truncated=True)",
                days, submitted_window if submitted_window is not None else "unknown", _FETCH_CAP,
            )
    except Exception as exc:  # pragma: no cover - exercised via stub in tests
        logger.warning("[reading_dashboard] attempt-row fetch failed: %s", exc)
        empty["totals"]["submitted_all_time"] = submitted_all_time
        empty["lookup_failures"] = lookup_failures
        return empty

    rows: list[dict] = []
    malformed_count = 0
    for raw in raw_rows:
        try:
            row = _AttemptRow.model_validate(raw).model_dump(mode="json")
            band = row["band_estimate"]
            if band is not None:
                if isinstance(band, bool) or not isinstance(band, (int, float)):
                    malformed_count += 1
                    band = None
                else:
                    band = float(band)
                    if not math.isfinite(band) or not 0 <= band <= 9:
                        malformed_count += 1
                        band = None
            row["band_estimate"] = band

            # JSONB is schema-less: validate each skill aggregate explicitly.
            safe_breakdown: dict[str, dict[str, int]] = {}
            raw_breakdown = row["skill_breakdown"]
            if raw_breakdown is not None and not isinstance(raw_breakdown, dict):
                malformed_count += 1
                raw_breakdown = {}
            for tag, value in (raw_breakdown or {}).items():
                if not isinstance(tag, str) or not tag or not isinstance(value, dict):
                    malformed_count += 1
                    continue
                correct = value.get("correct")
                total = value.get("total")
                if (type(correct) is not int or type(total) is not int
                        or correct < 0 or total <= 0 or correct > total):
                    malformed_count += 1
                    continue
                safe_breakdown[tag] = {"correct": correct, "total": total}
            row["skill_breakdown"] = safe_breakdown

            duration = row["time_spent_seconds"]
            if duration is not None and (type(duration) is not int or duration < 0):
                malformed_count += 1
                duration = None
            row["time_spent_seconds"] = duration
            rows.append(row)
        except (ValidationError, TypeError, ValueError):
            malformed_count += 1

    if submitted_all_time is not None and submitted_all_time < (submitted_window or len(raw_rows)):
        logger.warning(
            "[reading_dashboard] all-time count %s is below window lower bound %s",
            submitted_all_time, submitted_window or len(raw_rows),
        )
        submitted_all_time = None
        if "all_time_count" not in lookup_failures:
            lookup_failures.append("all_time_count")

    data_status = "partial" if (
        truncated or malformed_count or lookup_failures
    ) else "complete"

    # ── Split auth vs anonymous + distinct counts ─────────────────────
    auth_user_ids: set[str] = set()
    anon_sources: set[str] = set()
    auth_attempts = anon_attempts = 0
    for r in rows:
        uid = r.get("user_id")
        if uid:
            auth_attempts += 1
            auth_user_ids.add(uid)
        else:
            anon_attempts += 1
            src = r.get("anon_src")
            if src:
                anon_sources.add(src)   # salted hash — NEVER surfaced to the client

    # ── Band distribution (group by the 0.5 band value) ───────────────
    band_counts: dict[float, int] = {}
    for r in rows:
        b = r.get("band_estimate")
        if b is None:
            continue
        b = ielts_round(float(b))          # C2: half-up snap to 0.5 (was banker's)
        band_counts[b] = band_counts.get(b, 0) + 1
    band_distribution = [
        {"band": b, "count": band_counts[b]} for b in sorted(band_counts)
    ]

    # ── Skill performance (aggregate skill_breakdown JSONB) ───────────
    skill_acc: dict[str, dict[str, int]] = {}
    for r in rows:
        sb = r.get("skill_breakdown") or {}
        if not isinstance(sb, dict):
            continue
        for tag, v in sb.items():
            if not isinstance(v, dict):
                continue
            agg = skill_acc.setdefault(tag, {"correct": 0, "total": 0})
            agg["correct"] += int(v.get("correct") or 0)
            agg["total"] += int(v.get("total") or 0)
    skill_performance = [
        {
            "skill_tag": tag,
            "correct": agg["correct"],
            "total": agg["total"],
            "accuracy": round(agg["correct"] / agg["total"], 3) if agg["total"] else None,
        }
        for tag, agg in skill_acc.items()
    ]
    # Weakest first (lowest accuracy) — the actionable ordering. None accuracy
    # (no data) sorts last.
    skill_performance.sort(key=lambda s: (s["accuracy"] is None, s["accuracy"] if s["accuracy"] is not None else 1))

    # ── Time-taken stats (minutes) ────────────────────────────────────
    times = [int(r.get("time_spent_seconds") or 0) for r in rows]
    times = [t for t in times if t > 0]
    time_stats = {
        "avg_minutes": round(sum(times) / len(times) / 60.0, 1) if times else None,
        "median_minutes": round(_median(times) / 60.0, 1) if times else None,
        "count": len(times),
    }

    # ── Per-test usage (title resolved from reading_tests) ────────────
    title_by_uuid: dict[str, str] = {}
    try:
        relevant_test_ids = sorted({str(r["test_id"]) for r in rows if r.get("test_id")})
        # Do not read the whole catalog: PostgREST may cap it and silently omit
        # a title that is present in this snapshot. Chunk the exact identities
        # instead, keeping request URLs bounded.
        for start in range(0, len(relevant_test_ids), 200):
            tests_res = (
                supabase_admin.table("reading_tests")
                .select("id,test_id,title")
                .in_("id", relevant_test_ids[start:start + 200])
                .execute()
            )
            for t in (tests_res.data or []):
                title_by_uuid[t["id"]] = t.get("title") or t.get("test_id") or "(không tên)"
    except Exception as exc:  # pragma: no cover
        lookup_failures.append("test_titles")
        data_status = "partial"
        logger.warning("[reading_dashboard] test-title lookup failed: %s", exc)

    per_test_acc: dict[str, dict] = {}
    for r in rows:
        tid = r.get("test_id")
        if not tid:
            continue
        pt = per_test_acc.setdefault(tid, {"attempts": 0, "auth": 0, "anon": 0, "band_sum": 0.0, "band_n": 0})
        pt["attempts"] += 1
        if r.get("user_id"):
            pt["auth"] += 1
        else:
            pt["anon"] += 1
        b = r.get("band_estimate")
        if b is not None:
            pt["band_sum"] += float(b)
            pt["band_n"] += 1
    per_test = [
        {
            "test_id": tid,
            "title": title_by_uuid.get(tid, "(không tên)"),
            "attempts": pt["attempts"],
            "auth": pt["auth"],
            "anon": pt["anon"],
            "avg_band": round(pt["band_sum"] / pt["band_n"], 1) if pt["band_n"] else None,
        }
        for tid, pt in per_test_acc.items()
    ]
    per_test.sort(key=lambda p: p["attempts"], reverse=True)

    # ── Recent attempts (who / test / time / band) ────────────────────
    recent_rows = rows[:_RECENT_LIMIT]
    # Resolve emails ONLY for the recent authed set (≤20 ids) — anonymous rows
    # show "Ẩn danh", never the anon_src hash.
    email_by_id: dict[str, str] = {}
    recent_uids = list({r.get("user_id") for r in recent_rows if r.get("user_id")})
    if recent_uids:
        try:
            urs = (
                supabase_admin.table("users")
                .select("id,email").in_("id", recent_uids).execute()
            )
            for u in (urs.data or []):
                email_by_id[u["id"]] = u.get("email") or "(người dùng)"
        except Exception as exc:  # pragma: no cover
            lookup_failures.append("recent_identities")
            data_status = "partial"
            logger.warning("[reading_dashboard] recent email lookup failed: %s", exc)
    recent = []
    for r in recent_rows:
        uid = r.get("user_id")
        is_anon = not uid
        t = int(r.get("time_spent_seconds") or 0)
        recent.append({
            "submitted_at": r.get("submitted_at"),
            "test_title": title_by_uuid.get(r.get("test_id"), "(không tên)"),
            "who": "Ẩn danh" if is_anon else email_by_id.get(uid, "(người dùng)"),
            "is_anonymous": is_anon,
            "band": float(r["band_estimate"]) if r.get("band_estimate") is not None else None,
            "time_minutes": round(t / 60.0, 1) if t > 0 else None,
        })

    return {
        "ok": True,
        "data_status": data_status,
        "window_days": days,
        "window_start": window_start,
        "snapshot_to": snapshot_to,
        "totals": {
            "submitted_all_time": submitted_all_time,
            # If COUNT failed, the scanned rows are only a lower bound.
            "submitted_window": submitted_window if submitted_window is not None else len(raw_rows),
            "auth_attempts": auth_attempts,
            "anon_attempts": anon_attempts,
            "auth_distinct_users": len(auth_user_ids),
            "anon_distinct_sources": len(anon_sources),   # APPROXIMATE (#370)
            "truncated": truncated,
        },
        "band_distribution": band_distribution,
        "skill_performance": skill_performance,
        "time_stats": time_stats,
        "per_test": per_test,
        "recent": recent,
        "malformed_count": malformed_count,
        "lookup_failures": lookup_failures,
        "computed_at": now.isoformat(),
    }
