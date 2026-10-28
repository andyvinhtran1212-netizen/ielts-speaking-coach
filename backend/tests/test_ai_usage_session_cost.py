"""q-12k — Speaking session cost and ledger correlation (job 00o, staging 10-28).

On a real-provider Speaking session `sessions.estimated_cost_usd` stayed 0
although its ai_usage_logs rows summed to $0.039: no code ever wrote the
column. The Whisper and Azure rows also lacked request_id/usage_event_id,
because only the CallTelemetry grading providers set them.

These pin: (1) every ledger row carries a usage_event_id and, inside a request,
its request_id; (2) a priced, session-linked row recomputes the session total
from the ledger, so the column equals the sum of its usage rows.
"""
from __future__ import annotations

import asyncio
import re
from decimal import Decimal

import pytest

from services import ai_usage_logger
from services.request_context import request_id_scope

_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"


# ── In-memory PostgREST double (sync + async) ─────────────────────────────────

class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.op, self.payload, self.filters = db, table, None, None, []

    def insert(self, row):
        self.op, self.payload = "insert", row
        return self

    def upsert(self, row, on_conflict=None, ignore_duplicates=False):
        assert on_conflict == "usage_event_id" and ignore_duplicates
        self.op, self.payload = "upsert", row
        return self

    def select(self, _cols):
        self.op = "select"
        return self

    def update(self, values):
        self.op, self.payload = "update", values
        return self

    def eq(self, col, val):
        self.filters.append(lambda r, c=col, v=val: r.get(c) == v)
        return self

    def or_(self, expr):
        # Only the shapes the logger sends: col.is.null / col.lt.<number>.
        def match(r, terms=[t.split(".", 2) for t in expr.split(",")]):
            for col, op, val in terms:
                cur = r.get(col)
                if op == "is" and val == "null" and cur is None:
                    return True
                if op == "lt" and cur is not None and Decimal(str(cur)) < Decimal(val):
                    return True
            return False
        self.filters.append(match)
        return self

    def _run(self):
        if self.op == "update":
            self.db.before_update(self)
        self.db.calls.append((self.table, self.op))
        if self.db.fail_on == (self.table, self.op):
            raise RuntimeError("db unavailable")
        rows = self.db.tables.setdefault(self.table, [])
        if self.op in ("insert", "upsert"):
            event = self.payload.get("usage_event_id")
            if self.op == "upsert" and any(r.get("usage_event_id") == event for r in rows):
                return _Result([])  # ON CONFLICT DO NOTHING
            rows.append(dict(self.payload))
            return _Result([self.payload])
        matched = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            for r in matched:
                r.update(self.payload)
            self.db.after_update(self)
        return _Result([dict(r) for r in matched])

    def execute(self):
        return self._run()


class _AsyncQuery(_Query):
    async def execute(self):
        if self.op == "update":
            await self.db.before_update_async(self)
        return self._run()


async def _noop_async(_q):
    return None


class _FakeDb:
    def __init__(self, query_cls=_Query):
        self.tables = {"sessions": [{"id": "s1", "estimated_cost_usd": 0}]}
        self.calls: list[tuple[str, str]] = []
        self.fail_on = None
        self.after_update = lambda _q: None
        self.before_update = lambda _q: None
        self.before_update_async = _noop_async
        self._query_cls = query_cls

    def table(self, name):
        return self._query_cls(self, name)

    @property
    def session_cost(self):
        return self.tables["sessions"][0]["estimated_cost_usd"]


@pytest.fixture
def db(monkeypatch):
    fake = _FakeDb()
    monkeypatch.setattr(ai_usage_logger, "supabase_admin", fake)
    return fake


@pytest.fixture
def adb(monkeypatch):
    fake = _FakeDb(_AsyncQuery)

    async def client():
        return fake

    monkeypatch.setattr(ai_usage_logger, "get_supabase_async", client)
    # Tests gather the pending set; a task left by another test belongs to a
    # closed loop and would make gather() raise.
    monkeypatch.setattr(ai_usage_logger, "_PENDING_USAGE_TASKS", set())
    return fake


def _log_job_00o_session(log):
    """The five rows job 00o recorded for session 548f0bcc (EVIDENCE.md §4)."""
    log.whisper(user_id="u1", session_id="s1", model="whisper-1",
                audio_seconds=28.14, feature="speaking_stt")
    log.claude(user_id="u1", session_id="s1", model="claude-haiku-4-5-20251001",
               input_tokens=454, output_tokens=111, feature="off_topic_judge")
    log.unpriced(service="azure_speech", model="pronunciation-assessment",
                 user_id="u1", session_id="s1", audio_seconds=28.14,
                 feature="pronunciation")
    log.claude(user_id="u1", session_id="s1", model="claude-sonnet-5-5",
               input_tokens=392, output_tokens=1367, cache_write_tokens=2833,
               feature="speaking_grading")
    log.claude(user_id="u1", session_id="s1", model="claude-sonnet-5-5",
               input_tokens=246, output_tokens=1312, cache_read_tokens=2833,
               feature="speaking_grading")


class _SyncLog:
    whisper = staticmethod(ai_usage_logger.log_whisper)
    claude = staticmethod(ai_usage_logger.log_claude)
    unpriced = staticmethod(ai_usage_logger.log_unpriced_usage)


def _ledger_sum(fake) -> Decimal:
    return sum(
        (Decimal(str(r["cost_usd_est"])) for r in fake.tables["ai_usage_logs"]
         if r.get("session_id") == "s1" and r.get("cost_usd_est") is not None),
        Decimal(0),
    )


# ── Session cost = sum of its usage rows ──────────────────────────────────────

def test_job_00o_session_cost_equals_its_usage_rows(db):
    _log_job_00o_session(_SyncLog)

    total = _ledger_sum(db)
    assert total == Decimal("0.0392548")  # the figure job 00o recorded
    # NUMERIC(10,4) column: the ledger sum at the column's precision.
    assert db.session_cost == pytest.approx(0.0393)
    assert db.session_cost == float(total.quantize(Decimal("0.0001")))


@pytest.mark.asyncio
async def test_async_ledger_writes_refresh_the_session_cost(adb):
    for coro in (
        ai_usage_logger.log_whisper_async(
            user_id="u1", session_id="s1", model="whisper-1",
            audio_seconds=28.14, feature="speaking_stt"),
        ai_usage_logger.log_claude_async(
            user_id="u1", session_id="s1", model="claude-sonnet-5-5",
            input_tokens=392, output_tokens=1367, cache_write_tokens=2833,
            feature="speaking_grading"),
    ):
        ai_usage_logger.schedule_usage_log(coro)
    await asyncio.gather(*list(ai_usage_logger._PENDING_USAGE_TASKS))

    assert adb.session_cost == float(_ledger_sum(adb).quantize(Decimal("0.0001")))
    assert adb.session_cost == pytest.approx(0.0244)


def test_duplicate_usage_event_is_not_double_counted(db):
    for _ in range(2):
        ai_usage_logger.log_whisper(
            user_id="u1", session_id="s1", model="whisper-1",
            audio_seconds=100, usage_event_id="stt:fixed",
        )
    assert len(db.tables["ai_usage_logs"]) == 1
    assert db.session_cost == pytest.approx(0.01)


def test_unpriced_row_does_not_touch_the_session(db):
    ai_usage_logger.log_unpriced_usage(
        service="azure_speech", model="pronunciation-assessment",
        session_id="s1", feature="pronunciation",
    )
    assert ("sessions", "update") not in db.calls
    assert db.session_cost == 0


def test_row_without_session_does_not_touch_sessions(db):
    ai_usage_logger.log_whisper(
        user_id="u1", session_id=None, model="whisper-1", audio_seconds=10,
    )
    assert ("sessions", "update") not in db.calls


def test_stale_write_from_a_concurrent_sibling_is_corrected(db):
    """A sibling row lands between this refresh's write and its re-read: the
    write was stale, so the refresh repeats instead of leaving it."""
    ai_usage_logger.log_whisper(
        user_id="u1", session_id="s1", model="whisper-1", audio_seconds=100,
    )
    assert db.session_cost == pytest.approx(0.01)

    landed = []

    def sibling_insert(query):
        if not landed:
            landed.append(True)
            db.tables["ai_usage_logs"].append(
                {"session_id": "s1", "cost_usd_est": 0.02, "usage_event_id": "late"},
            )

    db.after_update = sibling_insert
    ai_usage_logger.log_whisper(
        user_id="u1", session_id="s1", model="whisper-1", audio_seconds=100,
    )
    assert db.session_cost == pytest.approx(0.04)


def test_sibling_refresh_before_each_update_cannot_leave_a_stale_total(db):
    """Codex P2 on #1862: four $0.01 rows. Before each of the first writer's
    three UPDATEs a sibling inserts and finishes its own refresh, so every
    total the first writer holds is stale. The column must still end at the
    ledger sum ($0.04), not the first writer's last read ($0.03)."""
    siblings = iter(range(3))

    def sibling_lands_and_refreshes(query):
        if query.table != "sessions" or getattr(db, "_in_sibling", False):
            return
        if next(siblings, None) is None:
            return
        db._in_sibling = True
        try:
            ai_usage_logger.log_whisper(
                user_id="u1", session_id="s1", model="whisper-1", audio_seconds=100,
            )
        finally:
            db._in_sibling = False

    db.before_update = sibling_lands_and_refreshes
    ai_usage_logger.log_whisper(
        user_id="u1", session_id="s1", model="whisper-1", audio_seconds=100,
    )

    assert len(db.tables["ai_usage_logs"]) == 4
    assert _ledger_sum(db) == Decimal("0.04")
    assert db.session_cost == pytest.approx(0.04)


@pytest.mark.asyncio
async def test_async_sibling_refresh_before_each_update_cannot_leave_a_stale_total(adb):
    """Async twin of the Codex P2 interleaving."""
    siblings = iter(range(3))
    in_sibling = []

    async def sibling_lands_and_refreshes(query):
        if query.table != "sessions" or in_sibling:
            return
        if next(siblings, None) is None:
            return
        in_sibling.append(True)
        try:
            await ai_usage_logger.log_whisper_async(
                user_id="u1", session_id="s1", model="whisper-1", audio_seconds=100,
            )
        finally:
            in_sibling.clear()

    adb.before_update_async = sibling_lands_and_refreshes
    await ai_usage_logger.log_whisper_async(
        user_id="u1", session_id="s1", model="whisper-1", audio_seconds=100,
    )

    assert len(adb.tables["ai_usage_logs"]) == 4
    assert _ledger_sum(adb) == Decimal("0.04")
    assert adb.session_cost == pytest.approx(0.04)


def test_stale_total_never_lowers_the_column(db):
    """The UPDATE only raises: a refresh holding a total below the column's
    value leaves the column alone."""
    db.tables["sessions"][0]["estimated_cost_usd"] = 0.05
    ai_usage_logger.log_whisper(
        user_id="u1", session_id="s1", model="whisper-1", audio_seconds=100,
    )
    assert db.session_cost == pytest.approx(0.05)


def test_session_cost_refresh_failure_warns_without_breaking_the_flow(db, caplog):
    db.fail_on = ("sessions", "update")
    ai_usage_logger.log_whisper(
        user_id="u1", session_id="s1", model="whisper-1", audio_seconds=10,
    )
    assert len(db.tables["ai_usage_logs"]) == 1
    assert "session cost refresh failed session=s1" in caplog.text


def test_failed_ledger_write_does_not_refresh(db):
    db.fail_on = ("ai_usage_logs", "upsert")
    ai_usage_logger.log_whisper(
        user_id="u1", session_id="s1", model="whisper-1", audio_seconds=10,
    )
    assert ("ai_usage_logs", "select") not in db.calls
    assert ("sessions", "update") not in db.calls


# ── Every ledger row carries request_id + usage_event_id ──────────────────────

def test_rows_without_ids_get_a_unique_usage_event_id_and_the_request_id(db):
    with request_id_scope("req-00o"):
        _log_job_00o_session(_SyncLog)

    rows = db.tables["ai_usage_logs"]
    assert len(rows) == 5
    assert all(r["request_id"] == "req-00o" for r in rows)
    events = [r["usage_event_id"] for r in rows]
    assert len(set(events)) == 5
    whisper, _, azure, *_ = rows
    assert re.fullmatch(rf"speaking_stt:whisper:{_UUID}", whisper["usage_event_id"])
    assert re.fullmatch(rf"pronunciation:azure_speech:{_UUID}", azure["usage_event_id"])


def test_caller_supplied_ids_are_kept(db):
    with request_id_scope("req-route"):
        ai_usage_logger.log_whisper(
            user_id="u1", session_id=None, model="whisper-1", audio_seconds=1,
            usage_event_id="course:sub-1:attempt:1", request_id="req-explicit",
        )
    row = db.tables["ai_usage_logs"][0]
    assert row["usage_event_id"] == "course:sub-1:attempt:1"
    assert row["request_id"] == "req-explicit"


def test_background_work_has_no_request_id_but_still_an_event_id(db):
    ai_usage_logger.log_tts(user_id=None, session_id=None, model="tts-1", text_chars=10)
    row = db.tables["ai_usage_logs"][0]
    assert "request_id" not in row
    assert re.fullmatch(rf"tts:tts:{_UUID}", row["usage_event_id"])


@pytest.mark.asyncio
async def test_scheduled_whisper_row_keeps_the_request_id(adb):
    """grading.py schedules the Whisper row as a background task; the task
    copies the request context, so the row still names the request."""
    with request_id_scope("c5f75b42-req"):
        task = ai_usage_logger.schedule_usage_log(ai_usage_logger.log_whisper_async(
            user_id="u1", session_id="s1", model="whisper-1", audio_seconds=28.14,
            feature="speaking_stt", operation="transcribe_response",
            resource_type="question", resource_id="q1",
        ))
    await task
    row = adb.tables["ai_usage_logs"][0]
    assert row["request_id"] == "c5f75b42-req"
    assert re.fullmatch(rf"speaking_stt:whisper:{_UUID}", row["usage_event_id"])


@pytest.mark.asyncio
async def test_azure_pronunciation_row_carries_request_and_event_ids(adb, monkeypatch):
    from services import azure_pronunciation, provider_fixtures

    monkeypatch.setattr(provider_fixtures, "fixture_mode_enabled", lambda: False)
    monkeypatch.setattr(azure_pronunciation.settings, "AZURE_SPEECH_KEY", "k", raising=False)
    monkeypatch.setattr(azure_pronunciation.settings, "AZURE_SPEECH_REGION", "eastasia", raising=False)
    monkeypatch.setattr(azure_pronunciation, "_convert_to_wav", lambda _data: None)

    class _Resp:
        status_code = 500
        headers = {"apim-request-id": "azure-req-1"}
        content = b"boom"
        text = "boom"

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, *a, **k):
            return _Resp()

    monkeypatch.setattr(azure_pronunciation.httpx, "AsyncClient", _Client)

    with request_id_scope("req-azure"):
        with pytest.raises(RuntimeError):
            await azure_pronunciation.assess_pronunciation(
                b"audio", usage_user_id="u1", usage_session_id="s1",
                usage_resource_type="question", usage_resource_id="q1",
                audio_seconds=28.14,
            )
    await asyncio.gather(*list(ai_usage_logger._PENDING_USAGE_TASKS))

    row = adb.tables["ai_usage_logs"][0]
    assert row["service"] == "azure_speech"
    assert row["request_id"] == "req-azure"
    assert row["provider_request_id"] == "azure-req-1"
    assert re.fullmatch(rf"pronunciation:azure_speech:{_UUID}", row["usage_event_id"])
