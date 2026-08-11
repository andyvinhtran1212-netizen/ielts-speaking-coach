"""Tests for services/student_home_aggregator.py (Sprint 5.1).

Pins behaviour:
  - Active student with mixed activity → all four skill cards populated
  - Cross-skill streak counts unique activity dates back from today
  - Reading + Listening surface as ``status='active'`` (launched)
  - Brand-new student (no activity, no students row) returns zeros not 500
  - Per-skill failure isolates to ``_errors`` and the rest of the payload
    still renders
  - Vocabulary "due count" reflects flashcard_reviews.next_review_at <= now
  - Writing card resolves through students.user_id (the join the actual
    aggregator does); a user without a students row gets an empty card,
    not a 403 (the homepage is more permissive than /api/writing/*)

Pattern: an in-memory FakeSupabase (the common table-fake approach used across
the aggregator tests, extended for `.count`, `.order`, `.gte`, `.lte`,
`.not_.is_`). The fake
intentionally doesn't simulate JOINs or RLS — the aggregator never relies
on either, so the gap is acceptable.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

import pytest


# ── Minimal in-memory Supabase fake ───────────────────────────────────


class _Resp:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _NotProxy:
    """Stub for `.not_.is_(col, "null")` — only "null" is asserted."""
    def __init__(self, query):
        self.query = query

    def is_(self, field, value):
        # Match the aggregator: filter rows where field is NOT NULL.
        self.query.filters.append((field, "not_null", value))
        return self.query


class _TableQuery:
    def __init__(self, fake, table_name):
        self.fake = fake
        self.table_name = table_name
        self.filters: list[tuple[str, str, object]] = []
        self.limit_n = None
        self.order_field = None
        self.order_desc = False
        self.count_mode = None
        self.range_window = None

    def select(self, *_args, count=None, **_kw):
        self.count_mode = count
        return self

    def eq(self, field, value):
        self.filters.append((field, "eq", value))
        return self

    def gte(self, field, value):
        self.filters.append((field, "gte", value))
        return self

    def lte(self, field, value):
        self.filters.append((field, "lte", value))
        return self

    def order(self, field, desc=False):
        self.order_field = field
        self.order_desc = desc
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def in_(self, field, values):
        self.filters.append((field, "in", list(values or [])))
        return self

    def range(self, start, end):
        # PostgREST range() is an INCLUSIVE offset window (the paging primitive
        # _vocab_quiz_progress uses so a big word_stats set isn't truncated).
        self.range_window = (start, end)
        return self

    def is_(self, field, value):
        # R2a soft-delete: .is_("deleted_at","null") → keep rows where field IS NULL
        self.filters.append((field, "is_null", value))
        return self

    @property
    def not_(self):
        return _NotProxy(self)

    def execute(self):
        rows = self.fake.tables.get(self.table_name, [])
        matched = [r for r in rows if self._matches(r)]
        # Capture full count BEFORE limiting — `.select(count="exact")` returns
        # the unfiltered total post-eq filters. Mirrors PostgREST.
        full_count = len(matched)
        if self.order_field:
            matched.sort(
                key=lambda r: r.get(self.order_field) or "",
                reverse=self.order_desc,
            )
        if self.range_window is not None:
            lo, hi = self.range_window
            matched = matched[lo:hi + 1]
        if self.limit_n is not None:
            matched = matched[: self.limit_n]
        return _Resp(matched, count=full_count if self.count_mode == "exact" else None)

    def _matches(self, row):
        for field, op, value in self.filters:
            v = row.get(field)
            if op == "eq" and v != value:
                return False
            if op == "gte" and (v is None or v < value):
                return False
            if op == "lte" and (v is None or v > value):
                return False
            if op == "not_null" and v is None:
                return False
            if op == "is_null" and v is not None:
                return False
            if op == "in" and v not in value:
                return False
        return True


class FakeSupabase:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {
            "sessions": [],
            "writing_essays": [],
            "writing_feedback": [],
            "students": [],
            "article_views": [],
            "user_vocabulary": [],
            "flashcard_reviews": [],
            "reading_test_attempts": [],
            "listening_attempts": [],
            "listening_test_attempts": [],
            "quiz_banks": [],
            "quiz_word_stats": [],
            "quiz_sessions": [],
        }

    def table(self, name: str) -> _TableQuery:
        if name == "writing_feedback_current":   # GV-1a: view == base for single-version test data
            name = "writing_feedback"
        return _TableQuery(self, name)


# ── Fixtures ──────────────────────────────────────────────────────────


@pytest.fixture
def fake_db():
    return FakeSupabase()


@pytest.fixture
def aggregator():
    from services import student_home_aggregator
    return student_home_aggregator


# Helpers ----------------------------------------------------------------


def _today_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _days_ago_iso(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def _seed_session(fake, user_id, **fields):
    row = {
        "id": str(uuid4()),
        "user_id": user_id,
        "started_at": _today_iso(),
        "overall_band": None,
        "status": "completed",
    }
    row.update(fields)
    fake.tables["sessions"].append(row)


def _seed_essay(fake, student_id, **fields):
    row = {
        "id": str(uuid4()),
        "student_id": student_id,
        "created_at": _today_iso(),
        "status": "delivered",
    }
    row.update(fields)
    fake.tables["writing_essays"].append(row)


def _seed_article_view(fake, user_id, **fields):
    row = {
        "id": str(uuid4()),
        "user_id": user_id,
        "article_slug": "noun-phrase",
        "last_viewed_at": _today_iso(),
    }
    row.update(fields)
    fake.tables["article_views"].append(row)


def _seed_vocab(fake, user_id, **fields):
    row = {
        "id": str(uuid4()),
        "user_id": user_id,
        "headword": "ephemeral",
        "is_archived": False,
        "is_skipped": False,
        "is_pending": False,  # Sprint 10.4 default — pending rows hidden from home count
        "created_at": _today_iso(),
    }
    row.update(fields)
    fake.tables["user_vocabulary"].append(row)


def _seed_quiz_bank(fake, bank_id, *, skill_area="vocab", is_published=True):
    fake.tables["quiz_banks"].append(
        {"id": bank_id, "skill_area": skill_area, "is_published": is_published}
    )


def _seed_word_stat(fake, user_id, bank_id, item_key, *, status="mastered", wrong_count=0):
    fake.tables["quiz_word_stats"].append({
        "id": str(uuid4()), "user_id": user_id, "bank_id": bank_id,
        "item_key": item_key, "status": status, "wrong_count": wrong_count,
    })


def _seed_quiz_session(fake, user_id, bank_id, *, ended_at=None):
    fake.tables["quiz_sessions"].append({
        "id": str(uuid4()), "user_id": user_id, "bank_id": bank_id,
        "ended_at": ended_at,
    })


def _seed_review(fake, user_id, **fields):
    row = {
        "id": str(uuid4()),
        "user_id": user_id,
        "vocabulary_id": str(uuid4()),
        "next_review_at": _today_iso(),
    }
    row.update(fields)
    fake.tables["flashcard_reviews"].append(row)


# ── Tests ─────────────────────────────────────────────────────────────


def test_active_student_returns_all_skill_cards(fake_db, aggregator):
    """Smoke: a student with activity in every skill gets every card
    populated; Reading/Listening surface as active (launched)."""
    user_id = str(uuid4())
    student_id = str(uuid4())
    fake_db.tables["students"].append({"id": student_id, "user_id": user_id})

    _seed_session(fake_db, user_id, overall_band=6.0, status="completed")
    _seed_essay(fake_db, student_id, status="delivered")
    _seed_article_view(fake_db, user_id)
    _seed_vocab(fake_db, user_id)
    _seed_review(fake_db, user_id, next_review_at=_days_ago_iso(1))

    payload = aggregator.get_home_summary(
        fake_db, user_id, name="Tran", email="tran@x.com",
    )

    assert payload["student"] == {"name": "Tran", "email": "tran@x.com"}
    assert payload["skills"]["speaking"]["status"] == "active"
    assert payload["skills"]["writing"]["status"] == "active"
    assert payload["skills"]["grammar"]["status"] == "active"
    assert payload["skills"]["vocabulary"]["status"] == "active"
    assert payload["skills"]["reading"]["status"] == "active"
    assert payload["skills"]["listening"]["status"] == "active"
    assert payload["totals"]["speaking_sessions"] == 1
    assert payload["totals"]["writing_essays"] == 1
    assert payload["totals"]["grammar_lessons_viewed"] == 1
    assert payload["totals"]["vocab_words_learned"] == 1
    assert payload["skills"]["vocabulary"]["flashcards_due"] == 1


def test_brand_new_student_returns_zeros_not_errors(fake_db, aggregator):
    """No data, no students row — every counter is 0, no error keys."""
    user_id = str(uuid4())

    payload = aggregator.get_home_summary(
        fake_db, user_id, name="Newbie", email="new@x.com",
    )

    assert payload["totals"]["speaking_sessions"] == 0
    assert payload["totals"]["writing_essays"] == 0
    assert payload["skills"]["writing"]["last_activity_at"] is None
    assert payload["skills"]["speaking"]["last_activity_at"] is None
    assert payload["streak"]["current_days"] == 0
    assert payload["streak"]["longest_days"] == 0
    assert "_errors" not in payload, (
        f"Expected no errors for empty student, got {payload.get('_errors')}"
    )


def test_reading_and_listening_are_active(fake_db, aggregator):
    """Reading + Listening launched. Both surface as status='active' with
    their CTA URLs even when the student has no attempts yet."""
    user_id = str(uuid4())
    payload = aggregator.get_home_summary(
        fake_db, user_id, name="X", email="x@x.com",
    )
    assert payload["skills"]["reading"]["status"] == "active"
    assert payload["skills"]["reading"]["primary_cta_url"] == "/reading/vocab"
    assert payload["skills"]["listening"]["status"] == "active"
    assert payload["skills"]["listening"]["primary_cta_url"] == "/listening"


def test_writing_card_returns_empty_when_no_students_row(fake_db, aggregator):
    """A user without a `students` row is a brand-new account that hasn't
    been admin-linked. /api/writing/my-essays returns 403 there, but the
    homepage degrades to a zero card — no point gating the whole page on
    a flow the student doesn't even know exists yet."""
    user_id = str(uuid4())
    # Seed Speaking activity so the rest of the page populates.
    _seed_session(fake_db, user_id, overall_band=5.5, status="completed")

    payload = aggregator.get_home_summary(
        fake_db, user_id, name="X", email="x@x.com",
    )

    assert payload["skills"]["writing"]["essays_count"] == 0
    assert payload["skills"]["writing"]["last_activity_at"] is None
    assert payload["skills"]["speaking"]["sessions_count"] == 1
    assert payload["skills"]["speaking"]["last_band"] == 5.5
    assert "_errors" not in payload


def test_streak_counts_consecutive_days_back_from_today(fake_db, aggregator):
    """Streak = consecutive days walking back from today through any
    cross-skill activity. Today + yesterday + day-before = 3."""
    user_id = str(uuid4())
    _seed_session(fake_db, user_id, started_at=_today_iso())
    _seed_session(fake_db, user_id, started_at=_days_ago_iso(1))
    _seed_article_view(fake_db, user_id, last_viewed_at=_days_ago_iso(2))
    # Gap on day 3 — streak should stop at 3, not include day 4.
    _seed_vocab(fake_db, user_id, created_at=_days_ago_iso(4))

    payload = aggregator.get_home_summary(
        fake_db, user_id, name="X", email="x@x.com",
    )

    assert payload["streak"]["current_days"] == 3
    # Longest run includes the day-4 island plus the today-back-to-day-2
    # block; longest island here is the 3-day current streak.
    assert payload["streak"]["longest_days"] >= 3


def test_streak_cursor_uses_utc_date_not_local_today(fake_db, aggregator, monkeypatch):
    """Regression: the walk-back cursor must be the UTC date, not the LOCAL
    ``date.today()``. ``day_set`` is keyed by UTC date strings (``ts[:10]`` of
    UTC-stored timestamps); using ``date.today()`` on a UTC+ machine just past
    local midnight made the cursor one day AHEAD of the UTC date, so the streak
    collapsed to 0 for ~7h/day (the entire UTC+7 user base, local 00:00–07:00).

    This bug was invisible to CI because GitHub runners are UTC, where
    ``date.today() == datetime.now(timezone.utc).date()``. Pin it with a frozen
    clock that forces ``local != UTC`` so a revert to ``date.today()`` fails
    here regardless of the runner's timezone."""
    user_id = str(uuid4())

    # Frozen instant: UTC reads 2026-06-26 23:30; a UTC+7 wall clock reads
    # 2026-06-27 06:30 — so date.today() (local) would be a day ahead of UTC.
    fixed_utc = datetime(2026, 6, 26, 23, 30, tzinfo=timezone.utc)

    class _FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed_utc if tz is not None else fixed_utc.replace(tzinfo=None)

    class _AheadDate(date):
        @classmethod
        def today(cls):
            return date(2026, 6, 27)  # simulate the local (UTC+7) date

    monkeypatch.setattr(aggregator, "datetime", _FrozenDateTime)
    monkeypatch.setattr(aggregator, "date", _AheadDate)

    # Activity on UTC days 26 → 25 → 24 (consecutive back from the UTC date).
    _seed_session(fake_db, user_id, started_at="2026-06-26T20:00:00+00:00")
    _seed_session(fake_db, user_id, started_at="2026-06-25T08:00:00+00:00")
    _seed_article_view(fake_db, user_id, last_viewed_at="2026-06-24T08:00:00+00:00")

    payload = aggregator.get_home_summary(
        fake_db, user_id, name="X", email="x@x.com",
    )

    # UTC cursor (06-26) counts 26→25→24 = 3. The old date.today()=06-27 cursor
    # is not in day_set → would yield 0.
    assert payload["streak"]["current_days"] == 3


def test_vocabulary_due_count_excludes_future_reviews(fake_db, aggregator):
    """flashcards_due reflects reviews whose next_review_at <= now.
    Future reviews don't count."""
    user_id = str(uuid4())
    _seed_vocab(fake_db, user_id)
    # Due now (1 day overdue):
    _seed_review(fake_db, user_id, next_review_at=_days_ago_iso(1))
    # Not due (5 days from now):
    future = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
    _seed_review(fake_db, user_id, next_review_at=future)

    payload = aggregator.get_home_summary(
        fake_db, user_id, name="X", email="x@x.com",
    )

    assert payload["skills"]["vocabulary"]["flashcards_due"] == 1


def test_vocabulary_excludes_archived_from_word_count(fake_db, aggregator):
    """words_learned is the active wallet — archived rows out."""
    user_id = str(uuid4())
    _seed_vocab(fake_db, user_id, is_archived=False)
    _seed_vocab(fake_db, user_id, is_archived=True)

    payload = aggregator.get_home_summary(
        fake_db, user_id, name="X", email="x@x.com",
    )

    assert payload["skills"]["vocabulary"]["words_learned"] == 1


def test_vocabulary_excludes_skipped_from_word_count(fake_db, aggregator):
    """Sprint 5.2.1 hotfix — pre-5.2.1 the query only filtered
    is_archived, so soft-skipped rows leaked into words_learned and
    inflated the homepage count. Pin: skipped rows must NOT count."""
    user_id = str(uuid4())
    _seed_vocab(fake_db, user_id, is_archived=False, is_skipped=False)
    _seed_vocab(fake_db, user_id, is_archived=False, is_skipped=True)
    _seed_vocab(fake_db, user_id, is_archived=True,  is_skipped=False)

    payload = aggregator.get_home_summary(
        fake_db, user_id, name="X", email="x@x.com",
    )

    # Only the row that's neither archived nor skipped should count.
    assert payload["skills"]["vocabulary"]["words_learned"] == 1


def test_speaking_card_falls_back_to_completed_band_when_latest_ungraded(
    fake_db, aggregator,
):
    """If the most recent session hasn't finished grading, surface the
    most recent *completed* band so the dashboard isn't blank right after
    a recording."""
    user_id = str(uuid4())
    # Latest session: ungraded.
    _seed_session(fake_db, user_id,
        started_at=_today_iso(), overall_band=None, status="grading")
    # Older completed session with a band.
    _seed_session(fake_db, user_id,
        started_at=_days_ago_iso(2), overall_band=6.5, status="completed")

    payload = aggregator.get_home_summary(
        fake_db, user_id, name="X", email="x@x.com",
    )

    assert payload["skills"]["speaking"]["last_band"] == 6.5


def test_listening_full_tests_included_in_attempts_count(fake_db, aggregator):
    """listening_test_attempts (Cambridge full tests) count alongside
    per-exercise listening_attempts in the home card, and the band from
    the most recent submitted full test surfaces as last_band."""
    user_id = str(uuid4())
    fake_db.tables["listening_test_attempts"].append({
        "id": str(uuid4()),
        "user_id": user_id,
        "submitted_at": _today_iso(),
        "status": "submitted",
        "band_estimate": 7.5,
    })
    fake_db.tables["listening_attempts"].append({
        "id": str(uuid4()),
        "user_id": user_id,
        "created_at": _days_ago_iso(1),
    })

    payload = aggregator.get_home_summary(
        fake_db, user_id, name="X", email="x@x.com",
    )
    listening = payload["skills"]["listening"]
    assert listening["attempts_count"] == 2   # 1 full test + 1 exercise
    assert listening["last_band"] == 7.5


def test_reading_and_listening_count_toward_streak(fake_db, aggregator):
    """Reading test submissions and Listening attempts count toward the
    cross-skill streak. A student who practices only those skills still
    sees a non-zero streak."""
    user_id = str(uuid4())
    fake_db.tables["reading_test_attempts"].append({
        "id": str(uuid4()),
        "user_id": user_id,
        "submitted_at": _today_iso(),
        "status": "submitted",
        "band_estimate": 7.0,
    })
    fake_db.tables["listening_test_attempts"].append({
        "id": str(uuid4()),
        "user_id": user_id,
        "submitted_at": _days_ago_iso(1),
        "status": "submitted",
        "band_estimate": 6.5,
    })

    payload = aggregator.get_home_summary(
        fake_db, user_id, name="X", email="x@x.com",
    )
    assert payload["streak"]["current_days"] == 2


def test_per_skill_failure_isolates_to_errors_map(fake_db, aggregator, monkeypatch):
    """A SQL failure in one skill fills the _errors map and leaves the
    rest of the payload intact — same resilience pattern as
    dashboard_aggregator."""
    user_id = str(uuid4())
    _seed_session(fake_db, user_id, overall_band=6.0, status="completed")

    # Force the grammar builder to blow up.
    def explode(*_args, **_kw):
        raise RuntimeError("simulated grammar failure")

    monkeypatch.setattr(aggregator, "_build_grammar", explode)

    payload = aggregator.get_home_summary(
        fake_db, user_id, name="X", email="x@x.com",
    )

    assert "_errors" in payload
    assert "grammar" in payload["_errors"]
    # Speaking still rendered fine.
    assert payload["skills"]["speaking"]["sessions_count"] == 1


# ── Quick-Check mastery feeds the Vocabulary card (audit 2026-07-28) ──
#
# The card used to count ONLY user_vocabulary — the personal wallet behind a
# default-deny feature flag. On prod, 13 learners had quiz-mastered words, 1 had
# any wallet row, and the sets did not overlap: every learner who actually
# practised read "Từ đã học: 0 từ". These pin the fix.


def test_vocabulary_counts_quiz_mastered_words(fake_db, aggregator):
    """A learner with zero wallet rows but mastered Quick-Check words must NOT
    read 0 — that was the exact prod symptom."""
    user_id, bank = str(uuid4()), str(uuid4())
    _seed_quiz_bank(fake_db, bank)
    _seed_word_stat(fake_db, user_id, bank, "Carbon footprint")
    _seed_word_stat(fake_db, user_id, bank, "Biodiversity")

    v = aggregator.get_home_summary(
        fake_db, user_id, name="X", email="x@x.com",
    )["skills"]["vocabulary"]

    assert v["words_learned"] == 2
    assert v["quiz_words_mastered"] == 2


def test_vocabulary_union_does_not_double_count_a_shared_word(fake_db, aggregator):
    """The wallet and the quiz describe the same fact, so a word in both is ONE
    word. Case-insensitive: the wallet stores 'ephemeral', the bank 'Ephemeral'."""
    user_id, bank = str(uuid4()), str(uuid4())
    _seed_vocab(fake_db, user_id)                       # headword 'ephemeral'
    _seed_quiz_bank(fake_db, bank)
    _seed_word_stat(fake_db, user_id, bank, "Ephemeral")
    _seed_word_stat(fake_db, user_id, bank, "Gridlock")

    v = aggregator.get_home_summary(
        fake_db, user_id, name="X", email="x@x.com",
    )["skills"]["vocabulary"]

    assert v["words_learned"] == 2     # ephemeral + gridlock, not 3


def test_vocabulary_quiz_side_ignores_other_skills_and_unmastered(fake_db, aggregator):
    """Only vocab banks count, and only 'mastered' rows — a grammar bank's
    progress must not inflate the vocabulary card."""
    user_id = str(uuid4())
    vocab_bank, grammar_bank = str(uuid4()), str(uuid4())
    _seed_quiz_bank(fake_db, vocab_bank)
    _seed_quiz_bank(fake_db, grammar_bank, skill_area="grammar")
    _seed_word_stat(fake_db, user_id, vocab_bank, "Gridlock")
    _seed_word_stat(fake_db, user_id, vocab_bank, "Mobility", status="carried_over")
    _seed_word_stat(fake_db, user_id, grammar_bank, "art-definite-usage")

    v = aggregator.get_home_summary(
        fake_db, user_id, name="X", email="x@x.com",
    )["skills"]["vocabulary"]

    assert v["words_learned"] == 1
    assert v["quiz_words_mastered"] == 1


def test_vocabulary_still_counts_a_bank_that_was_later_unpublished(fake_db, aggregator):
    """Publication controls whether a learner can START a bank, not whether their
    past practice happened — a word_stats row can only exist because the bank WAS
    playable. Filtering on is_published made the hub tile drop words the stats
    page still counted the moment a bank was unpublished (Codex review, #876)."""
    user_id, retired = str(uuid4()), str(uuid4())
    _seed_quiz_bank(fake_db, retired, is_published=False)
    _seed_word_stat(fake_db, user_id, retired, "Gridlock", wrong_count=2)
    _seed_quiz_session(fake_db, user_id, retired, ended_at=_today_iso())

    v = aggregator.get_home_summary(
        fake_db, user_id, name="X", email="x@x.com",
    )["skills"]["vocabulary"]

    assert v["quiz_words_mastered"] == 1
    assert v["quiz_words_missed"] == 1
    assert v["quiz_sessions"] == 1


def test_vocabulary_missed_and_session_facets(fake_db, aggregator):
    """`quiz_words_missed` counts DISTINCT words ever answered wrong (incl. ones
    later mastered); `quiz_sessions` counts only FINISHED sessions — start_session
    inserts a row the moment the page opens, and 36% of prod rows never finish."""
    user_id, bank = str(uuid4()), str(uuid4())
    _seed_quiz_bank(fake_db, bank)
    _seed_word_stat(fake_db, user_id, bank, "Gridlock", wrong_count=3)
    _seed_word_stat(fake_db, user_id, bank, "Mobility", wrong_count=0)
    _seed_quiz_session(fake_db, user_id, bank, ended_at=_today_iso())
    _seed_quiz_session(fake_db, user_id, bank, ended_at=None)   # abandoned

    v = aggregator.get_home_summary(
        fake_db, user_id, name="X", email="x@x.com",
    )["skills"]["vocabulary"]

    assert v["quiz_words_missed"] == 1
    assert v["quiz_sessions"] == 1


def test_vocabulary_quiz_failure_keeps_the_wallet_number(fake_db, aggregator):
    """The quiz read is best-effort: if it blows up, the card must still render
    the wallet count rather than degrading the whole vocabulary skill."""
    user_id = str(uuid4())
    _seed_vocab(fake_db, user_id)

    real_table = fake_db.table

    def boom(name):
        if name in ("quiz_banks", "quiz_word_stats", "quiz_sessions"):
            raise RuntimeError("quiz tables unavailable")
        return real_table(name)

    fake_db.table = boom
    v = aggregator.get_home_summary(
        fake_db, user_id, name="X", email="x@x.com",
    )["skills"]["vocabulary"]

    assert v["status"] == "active"
    assert v["words_learned"] == 1
    assert v["quiz_words_mastered"] == 0


def test_vocabulary_exposes_both_sources_so_the_home_card_can_label_the_number(
        fake_db, aggregator):
    """`words_learned` is a UNION, so no consumer may describe it as one source.
    The home card called any nonzero value "Wallet từ vựng cá nhân" and would
    have claimed an empty wallet held words (Codex review, PR #876)."""
    user_id, bank = str(uuid4()), str(uuid4())
    _seed_quiz_bank(fake_db, bank)
    _seed_word_stat(fake_db, user_id, bank, "Gridlock")

    v = aggregator.get_home_summary(
        fake_db, user_id, name="X", email="x@x.com",
    )["skills"]["vocabulary"]

    assert v["words_learned"] == 1
    assert v["wallet_words"] == 0            # quiz-only learner
    assert v["quiz_words_mastered"] == 1


def test_vocabulary_wallet_words_counts_only_the_wallet(fake_db, aggregator):
    user_id, bank = str(uuid4()), str(uuid4())
    _seed_vocab(fake_db, user_id)            # headword 'ephemeral'
    _seed_quiz_bank(fake_db, bank)
    _seed_word_stat(fake_db, user_id, bank, "Gridlock")

    v = aggregator.get_home_summary(
        fake_db, user_id, name="X", email="x@x.com",
    )["skills"]["vocabulary"]

    assert v["wallet_words"] == 1
    assert v["quiz_words_mastered"] == 1
    assert v["words_learned"] == 2
