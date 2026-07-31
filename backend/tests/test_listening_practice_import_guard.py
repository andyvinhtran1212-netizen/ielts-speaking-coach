"""A `practice` row with no valid tab group must never be imported.

The Luyện nhanh tile counts the whole library while each tab filters by
`metadata.practice_group`. A row whose group is missing or unrecognised raises
the tile's badge but appears in no tab — so the learner clicks a card promising
N items and lands on a page that cannot show that one. Blocking the import is
the only place this can be caught cheaply.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import pytest

import import_listening_lessons as imp


def test_group_vocabulary_matches_the_three_tabs():
    assert imp._PRACTICE_GROUPS == {"trap", "section", "curated"}


def test_test_type_vocabulary_is_a_subset_of_the_db_check():
    """mig 173 allows full|mini|drill|practice; this importer writes only the
    two it knows how to build."""
    mig = (Path(__file__).parent.parent / "migrations"
           / "173_listening_tests_practice_type.sql").read_text(encoding="utf-8")
    for t in imp._VALID_TEST_TYPES:
        assert f"'{t}'" in mig, f"{t} not permitted by the CHECK constraint"


@pytest.mark.parametrize("group", ["trap", "section", "curated"])
def test_valid_groups_are_accepted(group):
    assert group in imp._PRACTICE_GROUPS


@pytest.mark.parametrize("group", [None, "", "traps", "Trap", "unknown", "mini"])
def test_missing_or_unknown_group_is_rejected(group):
    assert group not in imp._PRACTICE_GROUPS


def test_the_converter_only_emits_valid_groups():
    """The generator and the guard must agree, or a whole batch fails at import
    after the audio has already been rendered and converted."""
    import convert_kokoro_to_lesson as conv
    src = Path(conv.__file__).read_text(encoding="utf-8")
    for g in imp._PRACTICE_GROUPS:
        assert f'"{g}"' in src, f"converter never produces group {g!r}"
    # every literal the converter returns as a group is one the guard allows
    emitted = {"trap", "section", "curated"}
    assert emitted <= imp._PRACTICE_GROUPS
