"""PC-J155: GET /admin/overview's `sessions` reads against a REAL Postgres.

`public.sessions` is not created by backend/migrations (it predates them), so
no migration test covers its columns. This builds the table as it exists on
STAGING and runs the exact queries the route sends, translated the way
PostgREST does (`select=` → quoted column list, `col=gte.v` → `col >= v`).

Column source: staging `information_schema.columns` for public.sessions, read
with a read-only Management API query on 2026-10-29 (PC-J155; matches Web
Manager's 20261029-1545 note: started_at / completed_at / last_accessed_at,
no created_at). The repo agrees: 003_admin_session_tracking.sql indexes
`sessions(started_at)` and adds error_code..pdf_status; 078 adds
last_accessed_at and notes "there is no `created_at` on sessions".

The control runs the pre-fix query (`created_at`) and must get SQLSTATE
42703, the error staging logged, so the test is proven able to catch it.

REQUIRE_PG=1 TEST_PG_URL=postgresql://postgres@127.0.0.1:<port>/postgres
"""
import asyncio
import os
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from urllib.parse import urlparse
from uuid import uuid4

import asyncpg
import pytest

DB = os.environ.get("TEST_PG_URL", "")

# (column, type) in staging ordinal order.
STAGING_SESSIONS_COLUMNS = (
    ("id", "uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY"),
    ("user_id", "uuid NOT NULL"),
    ("mode", "text NOT NULL"),
    ("part", "integer"),
    ("topic", "text"),
    ("status", "text DEFAULT 'in_progress'"),
    ("overall_band", "numeric"),
    ("band_fc", "numeric"),
    ("band_lr", "numeric"),
    ("band_gra", "numeric"),
    ("band_p", "numeric"),
    ("audio_url", "text"),
    ("pdf_url", "text"),
    ("tokens_used", "integer DEFAULT 0"),
    ("started_at", "timestamptz DEFAULT now()"),
    ("completed_at", "timestamptz"),
    ("error_code", "text"),
    ("error_message", "text"),
    ("failed_step", "text"),
    ("last_error_at", "timestamptz"),
    ("pdf_status", "text DEFAULT 'none'"),
    ("last_regraded_at", "timestamptz"),
    ("last_regraded_by", "text"),
    ("regrade_count", "integer DEFAULT 0"),
    ("last_accessed_at", "timestamptz"),
    ("audio_purged_at", "timestamptz"),
    ("content_purged_at", "timestamptz"),
    ("estimated_cost_usd", "numeric DEFAULT 0"),
    ("sitting_id", "uuid"),
    ("class_assignment_item_id", "uuid"),
    ("full_test_attempt_id", "uuid"),
    ("renderer_affinity", "text DEFAULT 'legacy'"),
    ("resume_expires_at", "timestamptz NOT NULL DEFAULT now() + interval '7 days'"),
)

# The pre-fix (c1ae1732 … 13bc49bda) Speaking read, kept verbatim as the control.
PRE_FIX_SESSIONS_QUERY = {
    "select": "id, user_id, overall_band, created_at, completed_at, status",
    "filters": [("created_at", "gte")],
}


async def _run(sql, *args):
    connection = await asyncpg.connect(DB)
    try:
        if not args and ";" in sql:
            await connection.execute(sql)
            return []
        return await connection.fetch(sql, *args)
    finally:
        await connection.close()


def query(sql, *args):
    return asyncio.run(_run(sql, *args))


@pytest.fixture
def schema():
    parsed = urlparse(DB)
    if parsed.scheme not in {"postgres", "postgresql"} or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("PC-J155 sessions test requires an explicitly LOCAL disposable PostgreSQL URL")
        pytest.skip("Local PostgreSQL unavailable")
    name = "j155_sessions_" + uuid4().hex
    columns = ",\n".join(f'"{col}" {decl}' for col, decl in STAGING_SESSIONS_COLUMNS)
    query(f"CREATE SCHEMA {name}; CREATE TABLE {name}.sessions(\n{columns}\n);")
    try:
        yield name
    finally:
        query(f"DROP SCHEMA {name} CASCADE;")


# ── Capture the route's real PostgREST calls ─────────────────────────


class _Res:
    data: list = []
    count = 0


class _Recorder:
    """Supabase stand-in that records each table query the route builds."""

    def __init__(self, sink, table):
        self.call = {"table": table, "select": None, "filters": [], "head": False}
        sink.append(self.call)

    def select(self, cols="*", **kw):
        self.call["select"] = cols
        self.call["head"] = bool(kw.get("head"))
        return self

    def gte(self, field, _value):
        self.call["filters"].append((field, "gte"))
        return self

    def lte(self, field, _value):
        self.call["filters"].append((field, "lte"))
        return self

    def eq(self, field, _value):
        self.call["filters"].append((field, "eq"))
        return self

    def __getattr__(self, _name):          # is_/in_/order/limit/or_/range/not_
        return lambda *a, **k: self

    def execute(self):
        return _Res()


class _RecordingClient:
    def __init__(self):
        self.calls: list[dict] = []

    def table(self, name):
        return _Recorder(self.calls, name)


def _route_sessions_calls():
    from routers import admin_overview

    client = _RecordingClient()
    with patch.object(admin_overview, "supabase_admin", client), \
            patch.object(admin_overview, "require_admin", new=AsyncMock(return_value={"id": "a"})):
        asyncio.run(admin_overview.get_admin_overview(authorization="Bearer x"))
    return [call for call in client.calls if call["table"] == "sessions"]


def _as_sql(schema_name, call):
    """PostgREST's translation of select=… & col=op.value, as plain SQL."""
    cols = [c.strip() for c in call["select"].split(",")]
    select = "count(*)" if call["head"] else ", ".join(f'"{c}"' for c in cols)
    ops = {"gte": ">=", "lte": "<=", "eq": "="}
    where = [f'"{field}" {ops[op]} ${i + 1}' for i, (field, op) in enumerate(call["filters"])]
    sql = f"SELECT {select} FROM {schema_name}.sessions"
    if where:
        sql += " WHERE " + " AND ".join(where)
    return sql, len(where)


def _window_start():
    # Every filter the route places on sessions is a 30-day timestamp window.
    return datetime.now(timezone.utc) - timedelta(days=30)


def test_route_sessions_queries_run_on_staging_schema(schema):
    calls = _route_sessions_calls()
    assert {c["head"] for c in calls} == {True, False}, calls   # rows + total count
    query(f"""INSERT INTO {schema}.sessions(user_id, mode, status, overall_band,
                                            started_at, completed_at)
              VALUES (gen_random_uuid(), 'practice', 'completed', 6.5,
                      now() - interval '1 day', now() - interval '1 day'),
                     (gen_random_uuid(), 'practice', 'completed', 5.0,
                      now() - interval '40 days', now() - interval '40 days');""")
    results = {}
    for call in calls:
        sql, nargs = _as_sql(schema, call)
        results[call["head"]] = query(sql, *[_window_start()] * nargs)
    rows = results[False]
    assert len(rows) == 1                              # 30-day window on started_at
    assert set(rows[0].keys()) == {"id", "user_id", "overall_band", "started_at",
                                   "completed_at", "status"}
    assert results[True][0]["count"] == 2


def test_pre_fix_created_at_query_fails_with_42703(schema):
    sql, nargs = _as_sql(schema, {**PRE_FIX_SESSIONS_QUERY, "head": False})
    with pytest.raises(asyncpg.exceptions.UndefinedColumnError) as excinfo:
        query(sql, *[_window_start()] * nargs)
    assert excinfo.value.sqlstate == "42703"
    assert 'column "created_at" does not exist' in str(excinfo.value)
