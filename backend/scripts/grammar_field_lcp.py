#!/usr/bin/env python3
"""Field LCP p75 verdict for /grammar and /grammar/* (owner decision 2026-10-28).

The /grammar target is real-user LCP p75 <= 2.5 s (approved 12:44). q-97 found
7 days of prod `web_vitals` far too thin to judge it (desktop n=5, mobile n=0),
so the owner fixed the evaluation rule at 14:05:

  * rolling 28-day window, ending at the database's now();
  * desktop and mobile judged separately, each needing >= 30 real-user
    samples; below that the verdict is INSUFFICIENT_DATA and the Lighthouse
    lab budget (agent-tools ui-audit perf.sh, BUDGETS) is what applies;
  * crawlers and headless/automated browsers are excluded (HeadlessChrome,
    bingbot, Lighthouse, Playwright, ...). They never count toward the 30;
  * no synthetic traffic is added to /grammar to reach the minimum.

The hub (/grammar) and the article pages (/grammar/*) are reported as separate
page groups, each with its own per-device verdict.

Samples are `analytics_events` rows with event_name='web_vitals' and a numeric
`lcp`. One beacon per Next metric, so rows are de-duplicated on
`event_data.metric_id` (earliest kept). The device class comes from the UA
string; there is no form-factor field. p75 is nearest-rank, the same as
`routers.error_logs._p75`.

Usage:
    # read-only query through the Supabase Management API (SUPABASE_ACCESS_TOKEN):
    python3 backend/scripts/grammar_field_lcp.py --project-ref <ref> [--json]
    # evaluate rows exported earlier (a list of rows or a Mgmt API response):
    python3 backend/scripts/grammar_field_lcp.py --rows rows.json
    # the SQL only, to run by hand inside a READ ONLY transaction:
    python3 backend/scripts/grammar_field_lcp.py --print-sql

The query is SELECT-only: the request sets `read_only: true`, the SQL opens with
SET TRANSACTION READ ONLY, and every returned row must carry
transaction_read_only = 'on' or the run aborts.

Exit status: 0 = no judged FAIL (PASS and/or INSUFFICIENT_DATA), 1 = at least
one page group / device judged FAIL, 2 = query or input error.
Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

WINDOW_DAYS = 28
MIN_SAMPLES_PER_DEVICE = 30
TARGET_LCP_P75_MS = 2500
DEVICE_CLASSES = ("desktop", "mobile")
PAGE_GROUPS = ("hub", "articles")

# Not a filter: samples above this stay in the p75. When the nearest-rank p75
# sample of a judged cell is one of them, they alone decide it and the report says so
# (prod 10-01/02: one Linux Chrome UA swept every article once with LCP
# 100-1900 s, an automation pattern the UA filter cannot see).
OUTLIER_LCP_MS = 60_000

PASS = "PASS"
FAIL = "FAIL"
INSUFFICIENT = "INSUFFICIENT_DATA"

# q-97's exclusion list, widened from HeadlessChrome to any "Headless" UA, the
# other automation drivers, and any UA carrying a URL: crawlers identify
# themselves with "+https://..." (prod 10-27: "SunriseTranscriptionReach/1.0
# (+https://...)" has no "bot" in it); browsers never do. Checked before the
# device split, so a headless mobile emulation is a bot, not a mobile sample.
# "bot" skips the Cubot phone brand, which appears in Android WebView UAs.
BOT_UA_RE = re.compile(
    r"Headless|Lighthouse|PTST|Playwright|Puppeteer|Selenium|PhantomJS"
    r"|(?<!cu)bot|crawler|spider|slurp|https?://",
    re.IGNORECASE,
)
# Tablets are checked first: iPad Safari/Chrome send "Mobile/15E148", Firefox
# on Android tablets sends "Android; Tablet". Android without "Mobile" is a
# tablet too (Chrome on Android sends "Mobile" only on phones).
TABLET_UA_RE = re.compile(r"iPad|Tablet", re.IGNORECASE)
MOBILE_UA_RE = re.compile(r"Mobi|iPhone|iPod", re.IGNORECASE)
ANDROID_UA_RE = re.compile(r"Android", re.IGNORECASE)

SQL = f"""SET TRANSACTION READ ONLY;
WITH h AS (
  SELECT current_setting('transaction_read_only') AS ro,
         extract(epoch FROM now())::float8 AS db_now
), e AS (
  SELECT id::text AS id,
         extract(epoch FROM created_at)::float8 AS created_at,
         event_data->>'path' AS path,
         event_data->>'ua' AS ua,
         event_data->>'metric_id' AS metric_id,
         (event_data->>'lcp')::float8 AS lcp
  FROM analytics_events
  WHERE event_name = 'web_vitals'
    AND created_at >= now() - interval '{WINDOW_DAYS} days'
    AND jsonb_typeof(event_data->'lcp') = 'number'
    AND (event_data->>'path' IN ('/grammar', '/grammar/')
         OR event_data->>'path' LIKE '/grammar/%')
)
SELECT h.ro, h.db_now, e.* FROM h LEFT JOIN e ON true;
"""


def p75(values: list[float]) -> float | None:
    """Nearest-rank 75th percentile, identical to routers.error_logs._p75."""
    if not values:
        return None
    ordered = sorted(values)
    idx = max(0, -(-3 * len(ordered) // 4) - 1)  # ceil(0.75*n) - 1
    return round(ordered[idx], 3)


def device_class(ua: str | None) -> str:
    """'bot' | 'mobile' | 'tablet' | 'desktop' | 'unknown' (empty UA)."""
    ua = ua or ""
    if not ua.strip():
        return "unknown"
    if BOT_UA_RE.search(ua):
        return "bot"
    if TABLET_UA_RE.search(ua):
        return "tablet"
    if MOBILE_UA_RE.search(ua):
        return "mobile"
    if ANDROID_UA_RE.search(ua):
        return "tablet"
    return "desktop"


def page_group(path: str | None) -> str | None:
    """'hub' for /grammar, 'articles' for /grammar/<anything>, else None."""
    if not isinstance(path, str):
        return None
    path = path.split("?", 1)[0].split("#", 1)[0]
    if path in ("/grammar", "/grammar/"):
        return "hub"
    if path.startswith("/grammar/"):
        return "articles"
    return None


def _epoch(value) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            return float(value)
        except ValueError:
            pass
        text = value.strip().replace(" ", "T", 1)
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        elif re.search(r"[+-]\d\d$", text):
            text += ":00"
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()
    return None


def _lcp(value) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number >= 0 else None


def verdict_for(samples: int, value: float | None,
                min_samples: int = MIN_SAMPLES_PER_DEVICE,
                target_ms: float = TARGET_LCP_P75_MS) -> str:
    if samples < min_samples or value is None:
        return INSUFFICIENT
    return PASS if value <= target_ms else FAIL


def evaluate(rows: list[dict], now: float,
             window_days: int = WINDOW_DAYS,
             min_samples: int = MIN_SAMPLES_PER_DEVICE,
             target_ms: float = TARGET_LCP_P75_MS) -> dict:
    """Apply the rule to raw web_vitals rows. `now` is epoch seconds."""
    start = now - window_days * 86400
    excluded = {"outside_window": 0, "duplicate": 0, "bot": 0,
                "tablet": 0, "unknown": 0, "invalid": 0}
    seen: dict[str, tuple[float, dict]] = {}
    for i, row in enumerate(rows):
        group = page_group(row.get("path"))
        if group is None:
            continue
        created = _epoch(row.get("created_at"))
        lcp = _lcp(row.get("lcp"))
        if created is None or lcp is None:
            excluded["invalid"] += 1
            continue
        if created < start or created > now:
            excluded["outside_window"] += 1
            continue
        key = row.get("metric_id") or f"id:{row.get('id', i)}"
        prior = seen.get(key)
        if prior is not None:
            excluded["duplicate"] += 1
            if created >= prior[0]:
                continue
        seen[key] = (created, {"group": group, "ua": row.get("ua"), "lcp": lcp})

    values = {g: {d: [] for d in DEVICE_CLASSES} for g in PAGE_GROUPS}
    for _, sample in seen.values():
        cls = device_class(sample["ua"])
        if cls in excluded:
            excluded[cls] += 1
            continue
        values[sample["group"]][cls].append(sample["lcp"])

    groups = {}
    for g in PAGE_GROUPS:
        groups[g] = {}
        for d in DEVICE_CLASSES:
            vals = values[g][d]
            value = p75(vals)
            groups[g][d] = {
                "samples": len(vals),
                "p75_ms": value,
                "verdict": verdict_for(len(vals), value, min_samples, target_ms),
                "over_60s": sum(1 for v in vals if v > OUTLIER_LCP_MS),
            }
    iso = lambda t: datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="seconds")
    return {
        "rule": {"window_days": window_days, "min_samples_per_device": min_samples,
                 "target_p75_ms": target_ms, "percentile": "nearest-rank"},
        "window": {"start": iso(start), "end": iso(now)},
        "excluded": excluded,
        "groups": groups,
    }


def render(report: dict) -> str:
    rule = report["rule"]
    lines = [
        f"Field LCP p75, rolling {rule['window_days']} days "
        f"({report['window']['start']} .. {report['window']['end']}), "
        f"target <= {rule['target_p75_ms']} ms, min {rule['min_samples_per_device']} samples per device",
    ]
    for g in PAGE_GROUPS:
        label = "/grammar" if g == "hub" else "/grammar/*"
        for d in DEVICE_CLASSES:
            cell = report["groups"][g][d]
            p = "-" if cell["p75_ms"] is None else f"{cell['p75_ms']:g} ms"
            if cell["verdict"] == INSUFFICIENT:
                note = "insufficient data (not judged; lab budget applies)"
            else:
                note = cell["verdict"]
            lines.append(f"FIELD {cell['verdict']}\t{label}\t{d}\tn={cell['samples']}\tp75={p}\t{note}")
            if outliers_decide_p75(cell):
                lines.append(f"WARN\t{label}\t{d}\t{cell['over_60s']}/{cell['samples']} samples have LCP > "
                             f"{OUTLIER_LCP_MS // 1000} s and set the p75 by themselves; check them for "
                             "automated traffic the UA filter missed before acting on this verdict")
    ex = report["excluded"]
    lines.append("excluded: " + ", ".join(f"{k}={v}" for k, v in ex.items()))
    if any(c["verdict"] == INSUFFICIENT for g in report["groups"].values() for c in g.values()):
        lines.append("Below the sample minimum the Lighthouse lab budget applies "
                     "(ui-audit perf.sh BUDGETS: /grammar and /grammar/* LCP_ms <= 2500). "
                     "Do not add synthetic traffic to reach it.")
    return "\n".join(lines)


def outliers_decide_p75(cell: dict) -> bool:
    """True when a judged cell's nearest-rank p75 sample is above OUTLIER_LCP_MS.

    The outliers are the top values, so that is the case exactly when more than
    n - ceil(0.75 n) of them are present. Counted, not read off the rounded p75.
    """
    n = cell["samples"]
    return (cell["verdict"] != INSUFFICIENT
            and cell["over_60s"] > n - (-(-3 * n // 4)))


def exit_code(report: dict) -> int:
    judged = [c["verdict"] for g in report["groups"].values() for c in g.values()]
    return 1 if FAIL in judged else 0


def _result_rows(payload) -> list[dict]:
    """Mgmt API returns a list of rows; some exports wrap it as {"result": [...]}."""
    if isinstance(payload, dict):
        payload = payload.get("result", payload.get("rows"))
    if not isinstance(payload, list) or not all(isinstance(r, dict) for r in payload):
        raise ValueError("expected a JSON list of row objects")
    return payload


def split_query_result(rows: list[dict]) -> tuple[float, list[dict]]:
    """Validate the read-only proof and return (db_now, sample rows)."""
    if not rows:
        raise ValueError("query returned no rows (the header row is missing)")
    if any(r.get("ro") != "on" for r in rows):
        raise ValueError("transaction_read_only was not 'on' for every row; refusing the result")
    now = _epoch(rows[0].get("db_now"))
    if now is None:
        raise ValueError("db_now missing from the query result")
    return now, [r for r in rows if r.get("id") is not None]


def fetch_rows(project_ref: str, token: str, opener=urllib.request.urlopen) -> list[dict]:
    """POST the read-only query to the Supabase Management API."""
    if not re.fullmatch(r"[a-z0-9]{20}", project_ref or ""):
        raise ValueError("project ref must be the 20-character Supabase project id")
    body = json.dumps({"query": SQL, "read_only": True}).encode()
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{project_ref}/database/query",
        data=body, method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                 "User-Agent": "aver-grammar-field-lcp/1"},
    )
    try:
        with opener(req, timeout=60) as resp:
            return _result_rows(json.loads(resp.read()))
    except urllib.error.HTTPError as e:
        detail = e.read()[:300].decode("utf-8", "replace")
        raise RuntimeError(f"Management API HTTP {e.code}: {detail}") from None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--project-ref", help="Supabase project ref; needs SUPABASE_ACCESS_TOKEN")
    src.add_argument("--rows", help="JSON file with the query result rows")
    src.add_argument("--print-sql", action="store_true", help="print the read-only SQL and exit")
    ap.add_argument("--json", action="store_true", help="print the report as JSON")
    args = ap.parse_args(argv)

    if args.print_sql:
        print(SQL, end="")
        return 0
    try:
        if args.project_ref:
            token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
            if not token:
                raise ValueError("SUPABASE_ACCESS_TOKEN is not set")
            raw = fetch_rows(args.project_ref, token)
        else:
            with open(args.rows, encoding="utf-8") as fh:
                raw = _result_rows(json.load(fh))
        now, rows = split_query_result(raw)
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as e:
        print(f"grammar_field_lcp: {e}", file=sys.stderr)
        return 2
    report = evaluate(rows, now)
    print(json.dumps(report, indent=2) if args.json else render(report))
    return exit_code(report)


if __name__ == "__main__":
    sys.exit(main())
