"""
tests/test_admin_usage.py — Sprint 17.2 (Direction B) usage-log endpoints.

GET /admin/usage/users (per-user rollup) + GET /admin/access-codes/{id}/usage
(per-code rollup). Pins: session/cost aggregation, last_active = max, batched
no-N+1, Pattern #29 graceful sub-query failure, per-code excludes inactive
assignments, 404, and the admin guard.
"""

import asyncio

import pytest

from routers import admin as admin_module


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _Exec:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _B:
    """Records each execute() call + applies .eq() filters to canned data so
    is_active/id filters behave. A table value may be a callable to raise."""

    def __init__(self, name, tables, calls):
        self._name, self._t, self._calls, self._eqs, self._ins = name, tables, calls, [], []
        self._gtes, self._gts, self._ltes = [], [], []
        self._order_col, self._order_desc, self._limit = None, False, None

    def select(self, *a, **k): return self
    def order(self, col, *a, **k):
        self._order_col = col
        self._order_desc = bool(k.get("desc"))
        return self
    def limit(self, value):
        self._limit = value
        return self
    def in_(self, col, values):
        self._ins.append((col, set(values)))
        return self
    def gte(self, col, val):
        self._gtes.append((col, val))
        return self
    def gt(self, col, val):
        self._gts.append((col, val))
        return self
    def lte(self, col, val):
        self._ltes.append((col, val))
        return self

    def eq(self, col, val):
        self._eqs.append((col, val))
        return self

    def execute(self):
        self._calls.append(self._name)
        data = self._t.get(self._name, [])
        if callable(data):
            data = data()   # may raise → exercises Pattern #29 path
        rows = list(data)
        for col, val in self._eqs:
            rows = [r for r in rows if r.get(col) == val]
        for col, values in self._ins:
            rows = [r for r in rows if r.get(col) in values]
        for col, val in self._gtes:
            rows = [r for r in rows if r.get(col) is None or r.get(col) >= val]
        for col, val in self._gts:
            rows = [r for r in rows if r.get(col) is not None and r.get(col) > val]
        for col, val in self._ltes:
            rows = [r for r in rows if r.get(col) is None or r.get(col) <= val]
        if self._order_col:
            rows.sort(
                key=lambda row: row.get(self._order_col) or "",
                reverse=self._order_desc,
            )
        total = len(rows)
        if self._limit is not None:
            rows = rows[:self._limit]
        return _Exec(rows, count=total)


class _Stub:
    def __init__(self, tables, calls):
        self._t, self._calls = tables, calls

    def table(self, name):
        return _B(name, self._t, self._calls)


def _install(monkeypatch, tables):
    calls: list = []

    async def _ok(_authz):
        return {"id": "admin", "role": "admin"}

    monkeypatch.setattr(admin_module, "require_admin", _ok)
    monkeypatch.setattr(admin_module, "supabase_admin", _Stub(tables, calls))
    return calls


# ── GET /admin/usage/users ──────────────────────────────────────────────────────

def test_usage_by_user_aggregates(monkeypatch):
    _install(monkeypatch, {
        "users": [{"id": "u1", "email": "a@x", "display_name": "A", "role": "student"},
                  {"id": "u2", "email": "b@x", "display_name": "B", "role": "student"}],
        "sessions": [{"user_id": "u1", "started_at": "2026-01-02T00:00:00Z"},
                     {"user_id": "u1", "started_at": "2026-01-05T00:00:00Z"},
                     {"user_id": "u2", "started_at": "2026-01-03T00:00:00Z"}],
        "ai_usage_logs": [{"user_id": "u1", "cost_usd_est": 0.01},
                          {"user_id": "u1", "cost_usd_est": 0.02},
                          {"user_id": "u2", "cost_usd_est": 0.005}],
    })
    out = {u["user_id"]: u for u in _run(admin_module.usage_by_user(authorization="x"))}
    assert out["u1"]["sessions"] == 2 and out["u1"]["ai_cost_usd"] == 0.03
    assert out["u1"]["last_active"] == "2026-01-05T00:00:00Z"   # max
    assert out["u2"]["sessions"] == 1 and out["u2"]["ai_cost_usd"] == 0.005


def test_usage_by_user_no_n_plus_1(monkeypatch):
    calls = _install(monkeypatch, {
        "users": [{"id": "u1"}, {"id": "u2"}, {"id": "u3"}],
        "sessions": [{"user_id": "u1", "started_at": "2026-01-01T00:00:00Z"}],
        "ai_usage_logs": [{"user_id": "u2", "cost_usd_est": 0.1}],
    })
    _run(admin_module.usage_by_user(authorization="x"))
    assert calls.count("sessions") == 1          # ONE batched query for all users
    assert calls.count("ai_usage_logs") == 1


def test_usage_by_user_pages_past_postgrest_cap(monkeypatch):
    users = [{"id": f"u{i}", "email": f"u{i}@x"} for i in range(1001)]
    calls = _install(monkeypatch, {
        "users": users,
        "sessions": [],
        "ai_usage_logs": [],
    })
    out = _run(admin_module.usage_by_user(authorization="x"))
    assert len(out) == 1001
    assert calls.count("users") == 2


def test_usage_by_user_pages_session_and_cost_sources_past_cap(monkeypatch):
    sessions = [
        {"id": f"s{i:04}", "user_id": "u1", "started_at": f"2026-01-{(i % 28) + 1:02}T00:00:00Z"}
        for i in range(1001)
    ]
    costs = [
        {"id": f"a{i:04}", "user_id": "u1", "cost_usd_est": 0.0001}
        for i in range(1001)
    ]
    calls = _install(monkeypatch, {
        "users": [{"id": "u1", "email": "a@x"}],
        "sessions": sessions,
        "ai_usage_logs": costs,
    })
    out = _run(admin_module.usage_by_user(authorization="x"))
    assert out[0]["sessions"] == 1001
    assert out[0]["last_active"] == "2026-01-28T00:00:00Z"
    assert out[0]["ai_cost_usd"] == 0.1001
    assert calls.count("sessions") == 2
    assert calls.count("ai_usage_logs") == 2


def test_usage_rollup_watermark_excludes_insert_between_pages(monkeypatch):
    original_sessions = [
        {"id": f"s{i:04}", "user_id": "u1", "started_at": "2026-01-01T00:00:00Z"}
        for i in range(1001)
    ]
    original_costs = [
        {"id": f"a{i:04}", "user_id": "u1", "cost_usd_est": 0.0001,
         "created_at": "2026-01-01T00:00:00Z"}
        for i in range(1001)
    ]
    source_calls = {"sessions": 0, "costs": 0}

    def sessions_source():
        source_calls["sessions"] += 1
        inserted = [
            # Sorts before the page-1 cursor. OFFSET pagination would shift page
            # 2 and duplicate an original row; keyset pagination ignores it.
            {"id": "s-0001", "user_id": "u1", "started_at": "2026-01-01T00:00:00Z"},
            # Sorts after the cursor but belongs after the request watermark.
            {"id": "sz-new", "user_id": "u1", "started_at": "2999-01-01T00:00:00Z"},
        ]
        return original_sessions if source_calls["sessions"] == 1 else inserted + original_sessions

    def costs_source():
        source_calls["costs"] += 1
        inserted = [
            {"id": "a-0001", "user_id": "u1", "cost_usd_est": 9,
             "created_at": "2026-01-01T00:00:00Z"},
            {"id": "az-new", "user_id": "u1", "cost_usd_est": 9,
             "created_at": "2999-01-01T00:00:00Z"},
        ]
        return original_costs if source_calls["costs"] == 1 else inserted + original_costs

    calls = _install(monkeypatch, {
        "users": [{"id": "u1", "email": "a@x"}],
        "sessions": sessions_source,
        "ai_usage_logs": costs_source,
    })
    out = _run(admin_module.usage_by_user(authorization="x"))
    assert out[0]["sessions"] == 1001
    assert out[0]["ai_cost_usd"] == 0.1001
    assert calls.count("sessions") == 2
    assert calls.count("ai_usage_logs") == 2


def test_usage_by_user_merges_multiple_user_id_chunks(monkeypatch):
    users = [{"id": f"u{i:03}", "email": f"u{i:03}@x"} for i in range(250)]
    calls = _install(monkeypatch, {
        "users": users,
        "sessions": [
            {"id": f"s{i:03}", "user_id": user["id"], "started_at": "2026-01-01T00:00:00Z"}
            for i, user in enumerate(users)
        ],
        "ai_usage_logs": [
            {"id": f"a{i:03}", "user_id": user["id"], "cost_usd_est": 0.001}
            for i, user in enumerate(users)
        ],
    })
    out = {row["user_id"]: row for row in _run(admin_module.usage_by_user(authorization="x"))}
    assert len(out) == 250
    assert out["u000"]["sessions"] == 1 and out["u000"]["ai_cost_usd"] == 0.001
    assert out["u249"]["sessions"] == 1 and out["u249"]["ai_cost_usd"] == 0.001
    assert calls.count("sessions") == 2
    assert calls.count("ai_usage_logs") == 2


def test_usage_by_user_graceful_on_sessions_failure(monkeypatch):
    def _boom():
        raise RuntimeError("sessions down")
    _install(monkeypatch, {
        "users": [{"id": "u1", "email": "a@x", "display_name": "A", "role": "student"}],
        "sessions": _boom,
        "ai_usage_logs": [{"user_id": "u1", "cost_usd_est": 0.03}],
    })
    out = _run(admin_module.usage_by_user(authorization="x"))
    # sessions degrades to None; cost still computed (Pattern #29).
    assert out[0]["sessions"] is None and out[0]["last_active"] is None
    assert out[0]["ai_cost_usd"] == 0.03


def test_usage_by_user_merges_historical_writing_without_double_count(monkeypatch):
    _install(monkeypatch, {
        "users": [{"id": "u1", "email": "a@x"}],
        "sessions": [],
        "ai_usage_logs": [
            {"id": "l1", "user_id": "u1", "service": "gemini",
             "model": "gemini-2.5-pro", "cost_usd_est": 0.02,
             "pricing_version": "stored:test", "feature": "writing_grading",
             "resource_id": "e1",
             "usage_event_id": "writing:j1:attempt:1:run:r1:pass1:api:1",
             "created_at": "2026-01-01T00:00:01Z"},
            {"id": "l2", "user_id": "u1", "service": "openai_tts",
             "model": "gpt-4o-mini-tts", "cost_usd_est": 0.01,
             "pricing_version": "stored:test", "created_at": "2026-01-01T00:00:00Z"},
        ],
        "writing_essays": [
            {"id": "e1", "student_id": "student-1"},
            {"id": "e2", "student_id": "student-1"},
        ],
        "students": [{"id": "student-1", "user_id": "u1"}],
        "writing_feedback": [
            {"id": "f0", "essay_id": "e1", "model_used": "gemini-2.5-pro",
             "tokens_input": 10, "tokens_output": 10, "cost_usd": 0.04,
             "created_at": "2025-12-01T00:00:00Z"},
            {"id": "f1", "essay_id": "e1", "model_used": "gemini-2.5-pro",
             "tokens_input": 10, "tokens_output": 10, "cost_usd": 0.02,
             "provenance": {"job_id": "j1"},
             "created_at": "2026-01-01T00:00:00Z"},
            {"id": "f2", "essay_id": "e2", "model_used": "gemini-2.5-pro",
             "tokens_input": 10, "tokens_output": 10, "cost_usd": 0.03,
             "created_at": "2026-01-01T00:00:00Z"},
        ],
    })

    out = _run(admin_module.usage_by_user(authorization="x"))

    # Historical feedback before the first canonical ledger row remains spend;
    # only overlapping feedback at/after that first row is suppressed.
    assert out[0]["ai_cost_usd"] == 0.1


def test_usage_by_user_dedupes_writing_across_report_boundary(monkeypatch):
    _install(monkeypatch, {
        "users": [{"id": "u1", "email": "a@x"}],
        "sessions": [],
        "ai_usage_logs": [{
            "id": "l1", "user_id": "u1", "service": "gemini",
            "model": "gemini-2.5-pro", "cost_usd_est": 0.02,
            "pricing_version": "stored:test", "feature": "writing_grading",
            "resource_id": "e1",
            "usage_event_id": "writing:j1:attempt:1:run:r1:pass1:api:1",
            "created_at": "2026-09-17T23:59:59Z",
        }],
        "writing_essays": [{"id": "e1", "student_id": "student-1"}],
        "students": [{"id": "student-1", "user_id": "u1"}],
        "writing_feedback": [{
            "id": "f1", "essay_id": "e1", "model_used": "gemini-2.5-pro",
            "tokens_input": 100, "tokens_output": 50, "cost_usd": 0.02,
            "provenance": {"job_id": "j1"},
            "created_at": "2026-09-18T00:00:01Z",
        }],
    })

    out = _run(admin_module.usage_by_user(
        authorization="x", date_from="2026-09-18T00:00:00Z",
    ))

    assert out[0]["ai_cost_usd"] == 0.0


# ── GET /admin/ai-usage ──────────────────────────────────────────────────────

def test_ai_usage_merges_writing_and_reports_source_metadata(monkeypatch):
    _install(monkeypatch, {
        "ai_usage_logs": [
            {"user_id": "u1", "service": "gemini", "model": "gemini-2.5-pro",
             "input_tokens": 100, "output_tokens": 50, "cost_usd_est": 0.02,
             "pricing_version": "stored:test", "status": "success",
             "feature": "writing_grading", "resource_id": "e1",
             "usage_event_id": "writing:j1:attempt:1:run:r1:pass1:api:1",
             "created_at": "2026-01-01T00:00:01Z"},
        ],
        "writing_feedback": [
            {"id": "f1", "essay_id": "e1", "model_used": "gemini-2.5-pro",
             "tokens_input": 100, "tokens_output": 50, "cost_usd": 0.02,
             "provenance": {"job_id": "j1"},
             "created_at": "2026-01-01T00:00:00Z"},
            {"id": "f2", "essay_id": "e2", "model_used": "gemini-2.5-pro",
             "tokens_input": 100, "tokens_output": 50, "cost_usd": 0.03,
             "created_at": "2026-01-01T00:00:00Z"},
        ],
        "writing_essays": [
            {"id": "e1", "student_id": "student-1"},
            {"id": "e2", "student_id": "student-1"},
        ],
        "students": [{"id": "student-1", "user_id": "u1"}],
        "users": [{"id": "u1", "email": "a@x", "display_name": "A"}],
    })

    out = _run(admin_module.get_ai_usage(authorization="x"))

    assert out["overall"]["calls"] == 2
    assert out["overall"]["cost_usd"] == 0.05
    assert out["per_user"][0]["cost_usd"] == 0.05
    assert out["meta"]["ledger_returned_rows"] == 1
    assert out["meta"]["supplemental_writing_rows"] == 1
    assert out["meta"]["writing_source_total_rows"] == 2
    assert out["meta"]["total_matching_rows"] == 2


def test_ai_usage_falls_back_to_legacy_ledger_schema(monkeypatch):
    class LegacyColumnError(RuntimeError):
        code = "PGRST204"

    attempts = {"count": 0}

    def ledger_source():
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise LegacyColumnError("pricing_version missing from schema cache")
        return [{
            "user_id": "u1", "service": "legacy-provider", "model": "old-model",
            "cost_usd_est": 0.04, "created_at": "2026-01-01T00:00:00Z",
        }]

    _install(monkeypatch, {
        "ai_usage_logs": ledger_source,
        "writing_feedback": [],
        "users": [{"id": "u1", "email": "a@x"}],
    })

    out = _run(admin_module.get_ai_usage(authorization="x"))

    assert attempts["count"] == 2
    assert out["overall"]["cost_usd"] == 0.04
    assert out["meta"]["ledger_schema_legacy"] is True


def test_ai_usage_marks_each_truncated_source(monkeypatch):
    logs = [
        {"user_id": "u1", "service": "azure_speech",
         "model": "pronunciation-assessment", "created_at": f"2026-01-01T00:{i % 60:02}:00Z"}
        for i in range(10_001)
    ]
    writing = [
        {"id": f"f{i}", "essay_id": f"e{i}", "model_used": "legacy-non-gemini",
         "created_at": f"2026-01-01T00:{i % 60:02}:00Z"}
        for i in range(10_001)
    ]
    _install(monkeypatch, {
        "ai_usage_logs": logs,
        "writing_feedback": writing,
        "users": [{"id": "u1", "email": "a@x"}],
    })

    out = _run(admin_module.get_ai_usage(authorization="x"))

    assert out["meta"]["ledger_truncated"] is True
    assert out["meta"]["writing_source_truncated"] is True
    assert out["meta"]["truncated"] is True
    assert out["meta"]["total_matching_rows"] is None


def test_ai_usage_dedupes_writing_against_ledger_rows_outside_display_cap(monkeypatch):
    logs = [
        {
            "id": f"new-{i:05}",
            "user_id": "u1",
            "service": "azure_speech",
            "model": "pronunciation-assessment",
            "created_at": f"2026-01-{1 + (i % 28):02}T00:00:00Z",
        }
        for i in range(10_000)
    ]
    # This canonical row is older than every displayed row, so the capped
    # newest-first list omits it. The dedicated dedupe query must still find it.
    logs.append({
        "id": "ledger-old",
        "user_id": "u1",
        "service": "gemini",
        "model": "gemini-2.5-pro",
        "feature": "writing_grading",
        "resource_id": "e-old",
        "cost_usd_est": 0.02,
        "pricing_version": "stored:test",
        "status": "success",
        "usage_event_id": "writing:j-old:attempt:1:run:r1:pass1:api:1",
        "created_at": "2025-01-01T00:00:00Z",
    })
    _install(monkeypatch, {
        "ai_usage_logs": logs,
        "writing_feedback": [{
            "id": "f-old", "essay_id": "e-old",
            "model_used": "gemini-2.5-pro",
            "tokens_input": 100, "tokens_output": 50, "cost_usd": 0.02,
            "provenance": {"job_id": "j-old"},
            "created_at": "2025-02-01T00:00:00Z",
        }],
        "writing_essays": [{"id": "e-old", "student_id": "student-1"}],
        "students": [{"id": "student-1", "user_id": "u1"}],
        "users": [{"id": "u1", "email": "a@x"}],
    })

    out = _run(admin_module.get_ai_usage(authorization="x"))

    assert out["meta"]["ledger_truncated"] is True
    assert out["meta"]["supplemental_writing_rows"] == 0


# ── GET /admin/access-codes/{id}/usage ───────────────────────────────────────────

def test_code_usage_rollup_excludes_inactive(monkeypatch):
    _install(monkeypatch, {
        "access_codes": [{"id": "c1", "code": "AAA", "session_limit": 10, "code_type": "mass", "cohort_id": None}],
        "user_code_assignments": [{"code_id": "c1", "user_id": "u1", "is_active": True, "assigned_at": "t"},
                                  {"code_id": "c1", "user_id": "u2", "is_active": False, "assigned_at": "t"}],  # excluded
        "users": [{"id": "u1", "email": "a@x", "display_name": "A", "role": "student"}],
        "sessions": [{"user_id": "u1", "started_at": "2026-01-01T00:00:00Z"},
                     {"user_id": "u1", "started_at": "2026-01-02T00:00:00Z"}],
        "ai_usage_logs": [{"user_id": "u1", "cost_usd_est": 0.04}],
    })
    out = _run(admin_module.code_usage("c1", authorization="x"))
    assert out["aggregate"] == {"assigned_user_count": 1, "total_sessions": 2, "total_ai_cost_usd": 0.04}
    assert [u["user_id"] for u in out["assigned_users"]] == ["u1"]   # inactive u2 excluded
    assert out["assigned_users"][0]["role"] == "student"


def test_code_usage_preserves_degraded_aggregate_as_unknown(monkeypatch):
    def _boom():
        raise RuntimeError("sessions down")
    _install(monkeypatch, {
        "access_codes": [{"id": "c1", "code": "AAA"}],
        "user_code_assignments": [{"id": "a1", "code_id": "c1", "user_id": "u1", "is_active": True}],
        "users": [{"id": "u1", "email": "a@x"}],
        "sessions": _boom,
        "ai_usage_logs": [{"user_id": "u1", "cost_usd_est": 0.04}],
    })
    out = _run(admin_module.code_usage("c1", authorization="x"))
    assert out["assigned_users"][0]["sessions"] is None
    assert out["aggregate"]["total_sessions"] is None
    assert out["aggregate"]["total_ai_cost_usd"] == 0.04


def test_code_usage_merges_assignment_and_user_id_chunks(monkeypatch):
    users = [
        {"id": f"u{i:03}", "email": f"u{i:03}@x", "role": "student"}
        for i in range(201)
    ]
    calls = _install(monkeypatch, {
        "access_codes": [{"id": "c1", "code": "AAA"}],
        "user_code_assignments": [
            {"id": f"a{i:03}", "code_id": "c1", "user_id": user["id"], "is_active": True}
            for i, user in enumerate(users)
        ],
        "users": users,
        "sessions": [
            {"id": f"s{i:03}", "user_id": user["id"], "started_at": "2026-01-01T00:00:00Z"}
            for i, user in enumerate(users)
        ],
        "ai_usage_logs": [
            {"id": f"l{i:03}", "user_id": user["id"], "cost_usd_est": 0.001}
            for i, user in enumerate(users)
        ],
    })
    out = _run(admin_module.code_usage("c1", authorization="x"))
    assert out["aggregate"] == {
        "assigned_user_count": 201,
        "total_sessions": 201,
        "total_ai_cost_usd": 0.201,
    }
    assert len(out["assigned_users"]) == 201
    assert calls.count("users") == 2
    assert calls.count("sessions") == 2
    assert calls.count("ai_usage_logs") == 2


def test_code_usage_404_when_missing(monkeypatch):
    from fastapi import HTTPException
    _install(monkeypatch, {"access_codes": []})
    with pytest.raises(HTTPException) as ei:
        _run(admin_module.code_usage("nope", authorization="x"))
    assert ei.value.status_code == 404


def test_usage_endpoints_admin_guarded(monkeypatch):
    from fastapi import HTTPException

    async def _deny(_authz):
        raise HTTPException(403, "forbidden")
    monkeypatch.setattr(admin_module, "require_admin", _deny)
    monkeypatch.setattr(admin_module, "supabase_admin", _Stub({}, []))
    for call in (admin_module.usage_by_user(authorization="x"),
                 admin_module.code_usage("c1", authorization="x")):
        with pytest.raises(HTTPException) as ei:
            _run(call)
        assert ei.value.status_code == 403
