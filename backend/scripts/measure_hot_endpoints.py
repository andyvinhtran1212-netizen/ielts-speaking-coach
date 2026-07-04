#!/usr/bin/env python3
"""Measure whether /auth/me + /api/dashboard/init are DB-bound or auth-bound.

This is the "measure before you optimise" tool for the P3.1/P3.2 decision. It
answers the one question the pre-P0 perf plan could not: of the ~1.15s a warm
/auth/me takes, how much is the (already-async) Supabase token-verify call
(`auth` stage) versus the sync `.execute()` DB round-trips (`db` stage)?
P3.1/P3.2 only touch `db` — if `auth` dominates, they are the wrong fix.

Two independent signals, so you get useful data even without a token:

  1. /health/async-db  (NO token) — the event-loop-lag monitor. Under real
     concurrency a blocking sync .execute() on the loop thread shows up as
     elevated lag_ms_p95/max. If p95 is low, the loop is NOT being blocked
     meaningfully and P3.1 (async migration) buys nothing.

  2. /auth/me + /api/dashboard/init  (needs a Bearer token AND the server
     started with ENABLE_SERVER_TIMING=true) — parses the W3C Server-Timing
     response header into total/auth/db/app and reports the spread over N runs.

Usage:
    # ambient loop-lag only (no token needed):
    python3 scripts/measure_hot_endpoints.py --base https://<railway-app> --n 8

    # full breakdown (flag must be ON server-side; grab the token from the
    # browser: Supabase session → access_token):
    TOKEN=eyJhbGciOi... python3 scripts/measure_hot_endpoints.py \
        --base https://<railway-app> --n 8

Stdlib only — no deps, runs anywhere Python 3 does.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request

DEFAULT_BASE = "https://ielts-speaking-coach-production.up.railway.app"


def _get(url: str, token: str | None, timeout: float = 30.0):
    """Return (status, headers_dict_lower, body_bytes, wall_ms). Never raises on HTTP status."""
    req = urllib.request.Request(url, method="GET")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            status = resp.status
            headers = {k.lower(): v for k, v in resp.headers.items()}
    except urllib.error.HTTPError as e:
        body = e.read()
        status = e.code
        headers = {k.lower(): v for k, v in (e.headers.items() if e.headers else [])}
    wall_ms = (time.perf_counter() - start) * 1000
    return status, headers, body, wall_ms


def _parse_server_timing(header: str) -> dict[str, float]:
    out: dict[str, float] = {}
    for part in header.split(","):
        part = part.strip()
        if ";dur=" not in part:
            continue
        name, _, dur = part.partition(";dur=")
        try:
            out[name.strip()] = float(dur.strip())
        except ValueError:
            pass
    return out


def _fmt_stats(label: str, values: list[float]) -> str:
    if not values:
        return f"  {label:<8} (no samples)"
    return (
        f"  {label:<8} min={min(values):7.1f}  med={statistics.median(values):7.1f}  "
        f"max={max(values):7.1f}  (ms)"
    )


def measure_loop_lag(base: str) -> None:
    print("\n── 1. Event-loop lag  (/health/async-db, no token) ─────────────────")
    status, _, body, wall = _get(f"{base}/health/async-db", token=None)
    if status != 200:
        print(f"  ⚠ /health/async-db returned {status} — cannot read lag")
        return
    data = json.loads(body or b"{}")
    lag = data.get("event_loop_lag", {}) or {}
    print(f"  use_async_db={data.get('use_async_db')}  "
          f"async_client_initialised={data.get('async_client_initialised')}")
    print(f"  samples={lag.get('samples')}  interval_s={lag.get('interval_s')}")
    print(f"  lag_ms  last={lag.get('lag_ms_last')}  p50={lag.get('lag_ms_p50')}  "
          f"p95={lag.get('lag_ms_p95')}  max={lag.get('lag_ms_max')}")
    p95 = lag.get("lag_ms_p95") or 0.0
    verdict = (
        "LOW → the loop is barely blocked; P3.1 (async migration) buys little"
        if p95 < 50 else
        "ELEVATED → sync .execute() IS stalling the loop; P3.1 could help under load"
    )
    print(f"  → p95 {p95}ms: {verdict}")


def measure_endpoint(base: str, path: str, token: str, n: int) -> None:
    print(f"\n── {path}  (×{n}) ───────────────────────────────")
    totals: list[float] = []
    stages: dict[str, list[float]] = {"total": [], "auth": [], "db": [], "app": []}
    walls: list[float] = []
    saw_header = False
    last_status = None
    for _ in range(n):
        status, headers, _body, wall = _get(f"{base}{path}", token=token)
        last_status = status
        walls.append(wall)
        st = headers.get("server-timing")
        if st:
            saw_header = True
            parsed = _parse_server_timing(st)
            for k in stages:
                if k in parsed:
                    stages[k].append(parsed[k])
            if "total" in parsed:
                totals.append(parsed["total"])
        time.sleep(0.15)  # small gap so we don't hammer

    print(f"  last HTTP status: {last_status}")
    print(_fmt_stats("wall", walls))
    if not saw_header:
        print("  ⚠ NO Server-Timing header — start the server with "
              "ENABLE_SERVER_TIMING=true to get the total/auth/db/app breakdown.")
        return
    for k in ("total", "auth", "db", "app"):
        print(_fmt_stats(k, stages[k]))
    # verdict: which stage dominates the median total?
    med = {k: (statistics.median(v) if v else 0.0) for k, v in stages.items()}
    if med["total"]:
        dominant = max(("auth", "db", "app"), key=lambda k: med[k])
        share = 100 * med[dominant] / med["total"] if med["total"] else 0
        note = {
            "auth": "Supabase token-verify (already async) — P3.1/P3.2 do NOT touch this",
            "db":   "sync .execute() round-trips — THIS is what P3.1/P3.2 target",
            "app":  "server-side app work — neither P3.1 nor P3.2 addresses this",
        }[dominant]
        print(f"  → dominant stage: '{dominant}' (~{share:.0f}% of total) — {note}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default=DEFAULT_BASE, help="API base URL")
    ap.add_argument("--n", type=int, default=8, help="samples per endpoint")
    ap.add_argument("--token", default=os.environ.get("TOKEN"),
                    help="Bearer token (or set env TOKEN)")
    args = ap.parse_args()

    print(f"Base: {args.base}")
    measure_loop_lag(args.base)

    if not args.token:
        print("\nNo TOKEN provided → skipping /auth/me + /api/dashboard/init "
              "breakdown. Set TOKEN=... (Supabase access_token) to measure those.")
        return 0

    measure_endpoint(args.base, "/auth/me", args.token, args.n)
    measure_endpoint(args.base, "/api/dashboard/init", args.token, args.n)
    print("\nReminder: turn ENABLE_SERVER_TIMING back OFF when done measuring.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
