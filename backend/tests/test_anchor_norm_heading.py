"""Unit pin for verify_anchor_drift._norm_heading.

Tiny pure helper — drop leading '#' markers + surrounding whitespace — used by
the anchor body-marker audit to compare a frontmatter `location:` against the
real body headings. A direct unit pin so a refactor of the matcher can't
silently change normalization (which would make location-mismatch warnings
appear/disappear wrongly). Test-only; no production change.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts.verify_anchor_drift import _norm_heading


@pytest.mark.parametrize("raw, expected", [
    ("## Tóm tắt", "Tóm tắt"),                 # H2 marker stripped, text trimmed
    ("### Plural bất quy tắc", "Plural bất quy tắc"),
    ("#### Deep heading", "Deep heading"),     # any depth of leading '#'
    ("Tóm tắt", "Tóm tắt"),                    # no marker → just trimmed
    ("##", ""),                                 # markers only → empty
    ("", ""),                                    # empty → empty
    ("# A # B", "A # B"),                       # only LEADING '#' dropped; internal kept
    ("  ##  Spaced  ", "##  Spaced"),           # leading WHITESPACE precedes '#':
    #                                             lstrip('#') is a no-op, only the
    #                                             outer whitespace is trimmed.
])
def test_norm_heading(raw, expected):
    assert _norm_heading(raw) == expected


def test_norm_heading_is_idempotent():
    once = _norm_heading("## Heading")
    assert _norm_heading(once) == once
