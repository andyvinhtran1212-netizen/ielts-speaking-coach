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


def restricted_programmes(db) -> frozenset[str]:
    """Registry-only programme identities; propagate errors to fail closed."""
    programmes = set()
    offset = 0
    while True:
        rows = (db.table("content_access_namespaces").select("programme_id")
                .eq("scope", "assignment_only").order("programme_id")
                .range(offset, offset + 999).execute().data or [])
        programmes.update(str(row["programme_id"]) for row in rows)
        if len(rows) < 1000:
            return frozenset(programmes)
        offset += 1000


def public_programmes(db, query):
    """Apply the registry boundary before package/lesson count and projection."""
    programmes = restricted_programmes(db)
    if programmes:
        query = query.not_.in_("programme_id", sorted(programmes))
    return query
