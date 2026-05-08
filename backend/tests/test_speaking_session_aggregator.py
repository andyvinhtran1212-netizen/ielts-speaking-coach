"""Tests for services/speaking_session_aggregator.py (Sprint 5.0).

Pins behavior:
  - Full session-level rubric → source='session_columns', no response query
  - Some session columns + responses → source='mixed' (filling gaps)
  - All session NULL + graded responses → source='computed_from_responses'
  - All session NULL + no responses → source='no_data', all bands None
  - Responses without grading_status='completed' are excluded from averages
  - band_fc/lr/gra stay None when session columns NULL (no per-response source)

Pattern: an in-memory `FakeSupabase` table fake (mirrors
test_instructor_workflow.py's approach) that returns whatever rows are
seeded for each table. The fake doesn't simulate JOINs — the aggregator
issues two `.select` calls (sessions + responses), which is what we
exercise.
"""

from __future__ import annotations

from uuid import uuid4

import pytest


# ── Minimal in-memory Supabase fake ───────────────────────────────────


class _Resp:
    def __init__(self, data):
        self.data = data


class _TableQuery:
    def __init__(self, fake, table_name):
        self.fake = fake
        self.table_name = table_name
        self.filters: list[tuple[str, str, object]] = []
        self.limit_n = None

    def select(self, *_args, **_kw):
        return self

    def eq(self, field, value):
        self.filters.append((field, "eq", value))
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def execute(self):
        rows = self.fake.tables.get(self.table_name, [])
        matched = [r for r in rows if self._matches(r)]
        if self.limit_n is not None:
            matched = matched[: self.limit_n]
        return _Resp(matched)

    def _matches(self, row):
        for field, op, value in self.filters:
            if row.get(field) != value:
                return False
        return True


class FakeSupabase:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {"sessions": [], "responses": []}

    def table(self, name: str) -> _TableQuery:
        return _TableQuery(self, name)


# ── Fixtures ──────────────────────────────────────────────────────────


@pytest.fixture
def fake_db(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(
        "services.speaking_session_aggregator.supabase_admin", fake,
    )
    return fake


@pytest.fixture
def aggregator():
    from services import speaking_session_aggregator
    return speaking_session_aggregator


def _seed_session(fake, session_id, **fields):
    """Seed one session row. Defaults all rubric columns to None."""
    row = {
        "id": str(session_id),
        "overall_band": None,
        "band_fc": None,
        "band_lr": None,
        "band_gra": None,
        "band_p": None,
    }
    row.update(fields)
    fake.tables["sessions"].append(row)


def _seed_response(fake, session_id, **fields):
    row = {
        "id": str(uuid4()),
        "session_id": str(session_id),
        "overall_band": None,
        "pronunciation_score": None,
        "grading_status": None,
    }
    row.update(fields)
    fake.tables["responses"].append(row)


# ── Tests ─────────────────────────────────────────────────────────────


def test_session_with_full_columns_uses_session_source(fake_db, aggregator):
    """Fast path — every band column populated on the session row."""
    sid = uuid4()
    _seed_session(fake_db, sid,
        overall_band=6.5, band_fc=6.0, band_lr=7.0, band_gra=6.5, band_p=7.0)

    result = aggregator.compute_session_band_aggregate(sid)

    assert result.source == "session_columns"
    assert result.overall_band == 6.5
    assert result.band_fc == 6.0
    assert result.band_lr == 7.0
    assert result.band_gra == 6.5
    assert result.band_p == 7.0
    # No need to count responses on the fast path.
    assert result.response_count == 0


def test_session_with_null_columns_computes_from_responses(fake_db, aggregator):
    """Session columns all NULL; two graded responses → average them."""
    sid = uuid4()
    _seed_session(fake_db, sid)
    _seed_response(fake_db, sid,
        overall_band=6.0, pronunciation_score=70, grading_status="completed")
    _seed_response(fake_db, sid,
        overall_band=7.0, pronunciation_score=80, grading_status="completed")

    result = aggregator.compute_session_band_aggregate(sid)

    assert result.source == "computed_from_responses"
    assert result.overall_band == 6.5      # avg of 6.0 + 7.0
    assert result.band_p == 7.5            # avg of (70/10 + 80/10)
    # band_fc/lr/gra cannot be derived from response columns.
    assert result.band_fc is None
    assert result.band_lr is None
    assert result.band_gra is None
    assert result.response_count == 2
    assert result.responses_with_grading == 2


def test_session_with_no_responses_returns_no_data_source(fake_db, aggregator):
    """Session columns NULL AND zero responses (e.g., session in_progress)."""
    sid = uuid4()
    _seed_session(fake_db, sid)

    result = aggregator.compute_session_band_aggregate(sid)

    assert result.source == "no_data"
    assert result.overall_band is None
    assert result.band_fc is None
    assert result.band_p is None
    assert result.response_count == 0
    assert result.responses_with_grading == 0


def test_session_mixed_partial_columns_with_response_fill(fake_db, aggregator):
    """Some session columns populated, others NULL with responses to fill."""
    sid = uuid4()
    _seed_session(fake_db, sid,
        overall_band=6.0,    # session-level present
        band_fc=None,
        band_lr=None,
        band_gra=None,
        band_p=None,         # session-level absent — response fills it
    )
    _seed_response(fake_db, sid,
        overall_band=6.0, pronunciation_score=75, grading_status="completed")

    result = aggregator.compute_session_band_aggregate(sid)

    assert result.source == "mixed", (
        "Session contributes overall_band; response fills band_p — mixed"
    )
    assert result.overall_band == 6.0      # from session, not recomputed
    assert result.band_p == 7.5            # 75/10
    # band_fc/lr/gra still None — no per-response source.
    assert result.band_fc is None
    assert result.band_lr is None
    assert result.band_gra is None


def test_responses_without_grading_excluded_from_averages(fake_db, aggregator):
    """grading_status != 'completed' rows are not part of the average."""
    sid = uuid4()
    _seed_session(fake_db, sid)
    _seed_response(fake_db, sid,
        overall_band=None, pronunciation_score=None, grading_status="in_progress")
    _seed_response(fake_db, sid,
        overall_band=6.0, pronunciation_score=70, grading_status="completed")

    result = aggregator.compute_session_band_aggregate(sid)

    assert result.responses_with_grading == 1
    assert result.response_count == 2
    assert result.overall_band == 6.0       # only the completed one
    assert result.band_p == 7.0             # 70/10


def test_partial_session_columns_no_responses_labels_session_columns(fake_db, aggregator):
    """Edge case: some session columns populated, no responses to fill the
    rest. We label this 'session_columns' (every value present came from
    the session row); the missing fields stay None and the dashboard
    renders gaps as '—'. 'mixed' would be misleading — there was no
    response contribution."""
    sid = uuid4()
    _seed_session(fake_db, sid, overall_band=6.0, band_fc=6.0)
    # No responses seeded.

    result = aggregator.compute_session_band_aggregate(sid)

    assert result.source == "session_columns"
    assert result.overall_band == 6.0
    assert result.band_fc == 6.0
    assert result.band_lr is None
    assert result.band_p is None


def test_pronunciation_score_zero_is_treated_as_data(fake_db, aggregator):
    """pronunciation_score=0 is a valid (very low) score, not "missing".
    Only None should exclude a response from the band_p average."""
    sid = uuid4()
    _seed_session(fake_db, sid)
    _seed_response(fake_db, sid,
        overall_band=4.0, pronunciation_score=0, grading_status="completed")

    result = aggregator.compute_session_band_aggregate(sid)

    assert result.band_p == 0.0
    assert result.responses_with_grading == 1
