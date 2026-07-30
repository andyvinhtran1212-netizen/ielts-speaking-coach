"""Duration floor is per KIND of material, not one global number.

An exam section and a practice drill are different things. A 40-second trap
drill with eight questions is correct at its job; judged against the Cambridge
section floor it reads as a defective upload, which is why only 88 of 1022
generated blocks could be imported at all.

Lowering the floor globally was the tempting fix and the wrong one: it would
stop catching a genuinely truncated Cambridge section. So `validate_section_
audio` takes the test_type and applies the matching floor.
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from services import listening_audio as la


def _bytes(n=200 * 1024):
    return b"\xff\xfb" + b"\0" * n


def _validate(seconds, **kw):
    with patch.object(la, "probe_mp3_duration_seconds", lambda _b: seconds):
        return la.validate_section_audio(_bytes(), **kw)


@pytest.mark.parametrize("kind", ["full", None])
def test_exam_section_keeps_the_one_minute_floor(kind):
    """A truncated Cambridge section must still be caught."""
    assert _validate(45, test_type=kind)["errors"], "45s exam section must fail"
    assert not _validate(300, test_type=kind)["errors"]


@pytest.mark.parametrize("kind", ["mini", "drill"])
def test_practice_item_may_be_short(kind):
    """The whole point: a 40-second drill is valid practice material."""
    assert not _validate(40, test_type=kind)["errors"], f"{kind} 40s must pass"
    assert not _validate(25, test_type=kind)["errors"]


@pytest.mark.parametrize("kind", ["mini", "drill"])
def test_practice_item_still_has_a_floor(kind):
    """Short is allowed; empty is not — a truncated upload must not slip in
    just because the material is practice."""
    assert _validate(5, test_type=kind)["errors"], f"{kind} 5s must fail"


def test_short_practice_item_is_warned_not_silently_accepted():
    out = _validate(30, test_type="drill")
    assert not out["errors"]
    assert out["warnings"], "a 30s item should still be flagged as very short"


def test_ceiling_is_shared():
    for kind in ("full", "mini", "drill"):
        assert _validate(20 * 60, test_type=kind)["errors"], f"{kind} 20min must fail"


def test_default_is_the_strict_exam_floor():
    """Callers that pass nothing keep the old behaviour — a new call site has
    to opt IN to the looser floor rather than inherit it by accident."""
    assert _validate(45)["errors"]
