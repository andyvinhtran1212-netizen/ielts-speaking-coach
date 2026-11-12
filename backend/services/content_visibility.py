"""Generic Listening reads use the namespace views created by migration 381.

The database computes and preserves ``restricted``. Callers must not reconstruct
it from a current catalogue row: attempts and orphaned content can retain a
restriction after that catalogue changes. A missing row/flag fails closed.
"""
from __future__ import annotations

from collections.abc import Mapping


def public_tests(db):
    return db.table("v_listening_tests_public")


def public_content(db):
    return db.table("v_listening_content_public")


def public_attempts(db):
    return db.table("v_listening_attempts_public")


def public_dictation(db):
    return db.table("v_dictation_sessions_public")


def is_restricted(row: Mapping | None) -> bool:
    """Only an explicit database boolean false permits generic access."""
    return not isinstance(row, Mapping) or row.get("restricted") is not False
