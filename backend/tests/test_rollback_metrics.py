"""AUDIT F1 (2026-07-14) — GET /admin/error-logs/rollback-metrics.

The Pilot Entry checklist §4 froze two rollback triggers (error-rate > 2×
legacy baseline / 30-minute window; LCP p75 > 1.5× baseline / 24h) but the
dashboard could not compute either: no page-view denominator, no route
filter, no sub-day window, no baseline delta. These tests pin the endpoint
that closes that gap — INCLUDING the audit's own verification scenario
(100 views / 2 errors legacy vs 100 views / 5 errors next in 30 minutes →
delta 2.5× → breach).
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routers.error_logs as el


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, rows):
        self._rows = rows
        self._range = (0, len(rows) - 1)

    def __getattr__(self, _name):
        def _chain(*_a, **_kw):
            return self

        return _chain

    def range(self, start, end):
        self._range = (start, end)
        return self

    def execute(self):
        s, e = self._range
        return _Result(self._rows[s:e + 1])


class _FakeAdmin:
    """Dispatches by table name — rollback-metrics reads TWO tables."""

    def __init__(self, tables: dict):
        self._tables = tables

    def table(self, name):
        return _Query(self._tables.get(name, []))


def _client(monkeypatch, analytics=None, errors=None):
    async def _ok(_authz):
        return {"id": "admin", "role": "admin"}

    monkeypatch.setattr(el, "require_admin", _ok)
    monkeypatch.setattr(el, "supabase_admin", _FakeAdmin({
        "analytics_events": analytics or [],
        "error_logs": errors or [],
    }))
    app = FastAPI()
    app.include_router(el.router)
    app.include_router(el._admin_router)
    return TestClient(app)


def _pv(impl, path="/"):
    return {"event_name": "page_view",
            "event_data": {"path": path, "implementation": impl}}


def _wv(impl, lcp, path="/", **extra_vitals):
    ed = {"path": path, "implementation": impl, "lcp": lcp}
    ed.update(extra_vitals)
    return {"event_name": "web_vitals", "event_data": ed}


def _err(impl, url="/"):
    return {"url": url, "extra": {"implementation": impl}}


AUTHZ = {"Authorization": "Bearer x"}


def test_audit_verification_scenario_error_rate_breach(monkeypatch):
    """The audit's acceptance scenario: legacy 100 views / 2 errors, next
    100 views / 5 errors, 30-minute window → 0.05 vs 0.02 = 2.5× > 2× →
    BREACH, computed from data — not eyeballed from raw counts."""
    analytics = [_pv("legacy")] * 100 + [_pv("next")] * 100
    errors = [_err("legacy")] * 2 + [_err("next")] * 5
    res = _client(monkeypatch, analytics, errors).get(
        "/admin/error-logs/rollback-metrics?route=/&window_minutes=30",
        headers=AUTHZ,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["implementations"]["next"]["error_rate"] == 0.05
    assert body["implementations"]["legacy"]["error_rate"] == 0.02
    v = body["error_verdict"]
    assert v["status"] == "breach"
    assert v["basis"] == "relative"
    assert v["delta_x"] == 2.5
    assert v["baseline_source"] == "legacy-window"


def test_ok_when_under_threshold(monkeypatch):
    # next 3/100 = 0.03 vs legacy 2/100 = 0.02 → 1.5× ≤ 2× → ok
    analytics = [_pv("legacy")] * 100 + [_pv("next")] * 100
    errors = [_err("legacy")] * 2 + [_err("next")] * 3
    body = _client(monkeypatch, analytics, errors).get(
        "/admin/error-logs/rollback-metrics", headers=AUTHZ
    ).json()
    assert body["error_verdict"]["status"] == "ok"
    assert body["error_verdict"]["delta_x"] == 1.5


def test_route_filter_excludes_other_paths(monkeypatch):
    """Events/errors on OTHER routes must not pollute the measured route —
    the frozen trigger is per-route ('trên route đã cutover')."""
    analytics = (
        [_pv("next", "/")] * 30
        + [_pv("next", "/grammar")] * 500          # other route noise
        + [_wv("next", 9999, path="/grammar")] * 50
    )
    errors = [_err("next", "/")] * 1 + [_err("next", "/grammar")] * 40
    body = _client(monkeypatch, analytics, errors).get(
        "/admin/error-logs/rollback-metrics?route=/", headers=AUTHZ
    ).json()
    nxt = body["implementations"]["next"]
    assert nxt["page_views"] == 30
    assert nxt["errors"] == 1
    assert nxt["vitals"]["samples"] == 0


def test_insufficient_sample_never_pretends_to_conclude(monkeypatch):
    """A rate over 5 views must not look like a verdict (audit F1: sample
    sufficiency is part of the trigger's honesty)."""
    analytics = [_pv("next")] * 5
    errors = [_err("next")] * 3     # 60% error rate — but n=5
    body = _client(monkeypatch, analytics, errors).get(
        "/admin/error-logs/rollback-metrics", headers=AUTHZ
    ).json()
    assert body["error_verdict"]["status"] == "insufficient-sample"
    assert body["error_verdict"]["delta_x"] is None
    assert body["min_sample"]["views"] == el.ROLLBACK_MIN_VIEWS


def test_no_baseline_falls_back_to_absolute_guard(monkeypatch):
    """Pilot 1: legacy no longer serves `/`, so there is no in-window legacy
    baseline. Status must SAY no-baseline (not fake an ok), and the absolute
    ceiling still catches an on-fire route."""
    # Under the absolute ceiling → explicit "no-baseline"
    body = _client(
        monkeypatch, [_pv("next")] * 100, [_err("next")] * 1
    ).get("/admin/error-logs/rollback-metrics", headers=AUTHZ).json()
    assert body["error_verdict"]["status"] == "no-baseline"
    assert body["error_verdict"]["basis"] == "absolute"

    # Over the absolute ceiling (6% > 5%) → breach even without a baseline
    body = _client(
        monkeypatch, [_pv("next")] * 100, [_err("next")] * 6
    ).get("/admin/error-logs/rollback-metrics", headers=AUTHZ).json()
    assert body["error_verdict"]["status"] == "breach"
    assert body["error_verdict"]["basis"] == "absolute"


def test_param_baseline_used_when_legacy_traffic_insufficient(monkeypatch):
    """A pre-cutover measurement can be supplied as ?baseline_error_rate= —
    used only when the in-window legacy sample is insufficient."""
    analytics = [_pv("next")] * 100 + [_pv("legacy")] * 3  # legacy n=3 < min
    errors = [_err("next")] * 5
    body = _client(monkeypatch, analytics, errors).get(
        "/admin/error-logs/rollback-metrics?baseline_error_rate=0.02",
        headers=AUTHZ,
    ).json()
    v = body["error_verdict"]
    assert v["baseline_source"] == "param"
    assert v["delta_x"] == 2.5
    assert v["status"] == "breach"


def test_lcp_p75_nearest_rank_and_relative_breach(monkeypatch):
    """p75 is nearest-rank (deterministic); LCP verdict follows the frozen
    1.5× rule against the in-window legacy baseline."""
    analytics = (
        [_pv("next")] * 30 + [_pv("legacy")] * 30
        + [_wv("next", lcp) for lcp in range(100, 2100, 100)]   # 100..2000, n=20
        + [_wv("legacy", 1000)] * 12
    )
    body = _client(monkeypatch, analytics, []).get(
        "/admin/error-logs/rollback-metrics?window_minutes=1440", headers=AUTHZ
    ).json()
    nxt = body["implementations"]["next"]["vitals"]
    # nearest-rank p75 of 100..2000 step 100: ceil(0.75*20)=15th value = 1500
    assert nxt["lcp_p75"] == 1500
    assert nxt["samples"] == 20
    v = body["vitals_verdict"]
    assert v["baseline_lcp_ms"] == 1000
    assert v["delta_x"] == 1.5
    assert v["status"] == "ok"          # 1.5× is NOT > 1.5×


def test_lcp_breach_over_baseline(monkeypatch):
    analytics = (
        [_wv("next", 1600)] * 12 + [_wv("legacy", 1000)] * 12
    )
    body = _client(monkeypatch, analytics, []).get(
        "/admin/error-logs/rollback-metrics?window_minutes=1440", headers=AUTHZ
    ).json()
    assert body["vitals_verdict"]["status"] == "breach"
    assert body["vitals_verdict"]["delta_x"] == 1.6


def test_lcp_insufficient_sample(monkeypatch):
    body = _client(monkeypatch, [_wv("next", 1000)] * 3, []).get(
        "/admin/error-logs/rollback-metrics", headers=AUTHZ
    ).json()
    assert body["vitals_verdict"]["status"] == "insufficient-sample"


def test_window_clamped(monkeypatch):
    client = _client(monkeypatch)
    assert client.get(
        "/admin/error-logs/rollback-metrics?window_minutes=99999", headers=AUTHZ
    ).json()["window_minutes"] == 1440
    assert client.get(
        "/admin/error-logs/rollback-metrics?window_minutes=1", headers=AUTHZ
    ).json()["window_minutes"] == 5


def test_paginates_past_postgrest_1000_cap(monkeypatch):
    """Same lesson as migration-stats (PR #688): a bare select truncates at
    1000 rows and silently undercounts the denominator."""
    analytics = [_pv("next")] * 1500
    body = _client(monkeypatch, analytics, []).get(
        "/admin/error-logs/rollback-metrics", headers=AUTHZ
    ).json()
    assert body["scanned"]["analytics"] == 1500
    assert body["implementations"]["next"]["page_views"] == 1500


def test_tiny_baseline_not_lost_to_rounding(monkeypatch):
    """Review #761: verdict math must use the RAW baseline. legacy 1/15000
    = 6.67e-5 rounds to 1e-4 at 4 decimals — the old code computed delta
    against the ROUNDED value (2e-4/1e-4 = 2.0 → "ok") and missed this true
    3× regression; even smaller baselines rounded to 0.0 and fell through to
    the absolute guard entirely. (15k/side keeps the fixture under the 50k
    MAX_ROWS fetch ceiling.)"""
    analytics = [_pv("legacy")] * 15_000 + [_pv("next")] * 15_000
    errors = [_err("legacy")] * 1 + [_err("next")] * 3
    body = _client(monkeypatch, analytics, errors).get(
        "/admin/error-logs/rollback-metrics", headers=AUTHZ
    ).json()
    v = body["error_verdict"]
    assert v["basis"] == "relative", "a real legacy baseline must not vanish into rounding"
    assert v["baseline_source"] == "legacy-window"
    assert v["delta_x"] == 3.0
    assert v["status"] == "breach"


def _iso_ago(minutes):
    from datetime import datetime, timedelta, timezone
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


def test_verdicts_pinned_to_frozen_windows_not_table_window(monkeypatch):
    """Review #761: error verdict = 30m and vitals verdict = 24h REGARDLESS
    of window_minutes — one shared cutoff meant the displayed verdicts were
    not the frozen triggers unless the admin picked the matching window."""
    fresh, old = _iso_ago(5), _iso_ago(120)  # 5m vs 2h ago
    analytics = (
        [{**_pv("next"), "created_at": fresh}] * 100
        + [{**_pv("legacy"), "created_at": fresh}] * 100
        # vitals older than 30m but inside 24h — must still feed the LCP verdict
        + [{**_wv("next", 1600), "created_at": old}] * 12
        + [{**_wv("legacy", 1000), "created_at": old}] * 12
    )
    errors = (
        [{**_err("next"), "occurred_at": fresh}] * 5
        + [{**_err("legacy"), "occurred_at": fresh}] * 2
        # errors older than 30m — must NOT count toward the 30m error trigger
        + [{**_err("next"), "occurred_at": old}] * 40
    )
    body = _client(monkeypatch, analytics, errors).get(
        "/admin/error-logs/rollback-metrics?window_minutes=1440", headers=AUTHZ
    ).json()
    # Error verdict: only the fresh 5-vs-2 within 30m → delta 2.5 breach
    # (with the old 40 errors included it would be 45/100 vs 2/100 = 22.5×).
    assert body["error_verdict"]["window_minutes"] == 30
    assert body["error_verdict"]["delta_x"] == 2.5
    # Vitals verdict: the 2h-old samples are inside its 24h window → breach 1.6×.
    assert body["vitals_verdict"]["window_minutes"] == 1440
    assert body["vitals_verdict"]["delta_x"] == 1.6
    assert body["vitals_verdict"]["status"] == "breach"
    # The TABLE at 1440 shows everything (45 next errors).
    assert body["implementations"]["next"]["errors"] == 45
    assert body["windows"] == {"table": 1440, "error_trigger": 30, "vitals_trigger": 1440}

    # And with the default 30m table window, the vitals verdict still sees
    # the 24h samples even though the table shows none.
    body = _client(monkeypatch, analytics, errors).get(
        "/admin/error-logs/rollback-metrics", headers=AUTHZ
    ).json()
    assert body["implementations"]["next"]["vitals"]["samples"] == 0
    assert body["vitals_verdict"]["status"] == "breach"


def test_untagged_and_malformed_rows_bucketed_not_crashed(monkeypatch):
    analytics = [
        {"event_name": "page_view", "event_data": {"path": "/"}},        # no impl
        {"event_name": "page_view", "event_data": None},                 # malformed
        {"event_name": "web_vitals", "event_data": {"path": "/", "implementation": "next", "lcp": "bogus"}},
    ]
    errors = [{"url": "/", "extra": "corrupt"}]
    body = _client(monkeypatch, analytics, errors).get(
        "/admin/error-logs/rollback-metrics", headers=AUTHZ
    ).json()
    assert body["implementations"]["untagged"]["page_views"] == 1
    assert body["implementations"]["untagged"]["errors"] == 1
    assert body["implementations"]["next"]["vitals"]["samples"] == 0
