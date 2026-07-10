"""Unit tests for services/d1_item_stats — difficulty + discrimination."""

from services import d1_item_stats as s


def att(u, ex, correct):
    return {"user_id": u, "exercise_id": ex, "is_correct": correct}


def test_difficulty_is_fraction_correct():
    attempts = [att("u1", "X", True), att("u2", "X", True), att("u3", "X", False), att("u4", "X", False)]
    st = s.item_stats(attempts, min_attempts=1)
    assert st["X"]["difficulty"] == 0.5
    assert st["X"]["n"] == 4


def test_positive_discrimination():
    # high-ability users (right on A) get X right; low-ability get X wrong
    attempts = [
        att("u1", "A", True),  att("u1", "X", True),
        att("u2", "A", True),  att("u2", "X", True),
        att("u3", "A", False), att("u3", "X", False),
        att("u4", "A", False), att("u4", "X", False),
    ]
    st = s.item_stats(attempts, group_frac=0.5, min_attempts=1)
    assert st["X"]["discrimination"] == 1.0


def test_negative_discrimination_flagged():
    # ability set by A,B; on X the weak users beat the strong ones ⇒ broken item
    attempts = [
        att("u1", "A", True),  att("u1", "B", True),  att("u1", "X", False),
        att("u2", "A", True),  att("u2", "B", True),  att("u2", "X", False),
        att("u3", "A", False), att("u3", "B", False), att("u3", "X", True),
        att("u4", "A", False), att("u4", "B", False), att("u4", "X", True),
    ]
    st = s.item_stats(attempts, group_frac=0.5, min_attempts=1)
    assert st["X"]["discrimination"] == -1.0
    assert "negative_discrimination" in st["X"]["flags"]


def test_too_easy_and_too_hard_flags():
    easy = [att(f"u{i}", "E", True) for i in range(10)]
    hard = [att(f"u{i}", "H", False) for i in range(10)]
    st = s.item_stats(easy + hard, min_attempts=1)
    assert "too_easy" in st["E"]["flags"]
    assert "too_hard" in st["H"]["flags"]


def test_low_n_flag():
    st = s.item_stats([att("u1", "X", True), att("u2", "X", False)], min_attempts=5)
    assert "low_n" in st["X"]["flags"]


def test_discrimination_none_without_distinct_groups():
    # single user → no high/low split possible
    st = s.item_stats([att("u1", "X", True)], min_attempts=1)
    assert st["X"]["discrimination"] is None


def test_groups_are_disjoint_small_n():
    # 3 users, group_frac 0.5 → k = min(1, 1) = 1; top and bottom must not overlap
    attempts = [
        att("u1", "A", True),  att("u1", "X", True),
        att("u2", "A", True),  att("u2", "X", False),
        att("u3", "A", False), att("u3", "X", False),
    ]
    st = s.item_stats(attempts, group_frac=0.5, min_attempts=1)
    # u1 (top) right, u3 (bottom) wrong → disc 1.0, computed without error
    assert st["X"]["discrimination"] == 1.0
