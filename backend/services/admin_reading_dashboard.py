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
`truncated` so the UI can say "(mẫu)" rather than imply full coverage. If
attempts grow large, move this to an RPC (the #365 `fn_total_grading_minutes`
pattern).

Pattern #29: the computation is wrapped so a query outage yields a null-ish
payload (ok=false), never a 500. Boundaries are UTC, consistent with
admin_dashboard / admin_overview / foot-traffic.

Schema (confirmed against migrations, no new migration this sprint):
  - reading_test_attempts (user_id, anon_src, status, score, band_estimate,
    skill_breakdown, time_spent_seconds, submitted_at, test_id)  [mig 087/090]
  - reading_tests (id, test_id, title)                            [mig 086]
  - users (id, email)                                             [mig 001]
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from database import supabase_admin

logger = logging.getLogger(__name__)

ALLOWED_WINDOWS = (7, 30, 90)
DEFAULT_WINDOW = 30
# Bounded fetch so the dashboard never pulls an unbounded table. The window
# COUNT(exact) is computed separately; if it exceeds the cap we flag truncated.
_FETCH_CAP = 5000
_RECENT_LIMIT = 20


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
    ok=false with empty aggregates on a query outage (Pattern #29)."""
    days = _clamp_window(days)
    now = datetime.now(timezone.utc)
    window_start = (now - timedelta(days=days)).isoformat()

    empty = {
        "ok": False,
        "window_days": days,
        "totals": {
            "submitted_all_time": None, "submitted_window": 0,
            "auth_attempts": 0, "anon_attempts": 0,
            "auth_distinct_users": 0, "anon_distinct_sources": 0,
            "truncated": False,
        },
        "band_distribution": [],
        "skill_performance": [],
        "time_stats": {"avg_minutes": None, "median_minutes": None, "count": 0},
        "per_test": [],
        "recent": [],
        "computed_at": now.isoformat(),
    }

    try:
        # All-time submitted total — head COUNT(exact), no rows pulled.
        all_time = (
            supabase_admin.table("reading_test_attempts")
            .select("id", count="exact").limit(0)
            .eq("status", "submitted")
            .execute()
        )
        submitted_all_time = int(all_time.count or 0)

        # Exact windowed count (for truncation detection) + the bounded rows.
        win_count_res = (
            supabase_admin.table("reading_test_attempts")
            .select("id", count="exact").limit(0)
            .eq("status", "submitted")
            .gte("submitted_at", window_start)
            .execute()
        )
        submitted_window = int(win_count_res.count or 0)

        rows_res = (
            supabase_admin.table("reading_test_attempts")
            .select("id,test_id,user_id,anon_src,score,band_estimate,"
                    "skill_breakdown,time_spent_seconds,submitted_at")
            .eq("status", "submitted")
            .gte("submitted_at", window_start)
            .order("submitted_at", desc=True)
            .limit(_FETCH_CAP)
            .execute()
        )
        rows = rows_res.data or []
        truncated = submitted_window > len(rows)
        if truncated:
            logger.warning(
                "[reading_dashboard] window=%sd has %s submitted attempts > cap %s "
                "— aggregating a sample (truncated=True)",
                days, submitted_window, _FETCH_CAP,
            )
    except Exception as exc:  # pragma: no cover - exercised via stub in tests
        logger.warning("[reading_dashboard] base fetch failed: %s", exc)
        return empty

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
        b = round(float(b) * 2) / 2.0      # snap to nearest 0.5 (defensive)
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
        tests_res = (
            supabase_admin.table("reading_tests")
            .select("id,test_id,title")
            .execute()
        )
        for t in (tests_res.data or []):
            title_by_uuid[t["id"]] = t.get("title") or t.get("test_id") or "(không tên)"
    except Exception as exc:  # pragma: no cover
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
        "window_days": days,
        "totals": {
            "submitted_all_time": submitted_all_time,
            "submitted_window": submitted_window,
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
        "computed_at": now.isoformat(),
    }
