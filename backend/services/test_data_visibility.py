"""Staging-only hiding of E2E/QA test data from normal list views (TASK B2).

Staging shares one database between the live staging E2E suites and people
who review the product there. Synthetic rows (``@staging-e2e.averlearning.com``
accounts, ``QA …`` / ``E2E …`` / ``[STAGING] …`` classes and content) are kept
— suites and audits depend on them — but they should not crowd a learner's
catalogue or an admin's roster.

Contract:
  * Off unless ``HIDE_TEST_DATA`` is true AND ``ENVIRONMENT == "staging"``.
    Production never hides anything, even if the flag were copied there.
  * Only list/catalogue reads filter. Detail reads, assigned work and writes
    are untouched, so hiding never breaks a flow that already holds an id.
  * A test identity (staging-e2e e-mail) always sees everything, so the live
    staging suites keep finding the rows they create.
  * An admin sees everything when the browser sends ``X-Show-Test-Data: 1``
    (the admin toggle). The header is ignored for every other role.
"""

from __future__ import annotations

import logging
import re
from contextvars import ContextVar, Token
from typing import Iterable, Optional

from config import settings
from database import supabase_admin

logger = logging.getLogger(__name__)

SHOW_TEST_DATA_HEADER = "X-Show-Test-Data"
TEST_EMAIL_DOMAIN = "staging-e2e.averlearning.com"

# Standalone QA / UXQA / E2E token anywhere ("QA TEST Task 2", "QA-0029 …",
# "VOCAB20-QA-PEER", "E2E Writing Courses …", "ILR-RDG-LSN-L01 — QA Reading
# synthetic"), or a leading bracket tag naming staging/synthetic/internal work
# ("[STAGING] Gate E …", "[SYNTHETIC ENGINEERING ONLY] …", "[INTERNAL QA] …").
_TOKEN_RE = re.compile(r"(?<![0-9a-z])(?:qa|uxqa|e2e)(?![0-9a-z])", re.IGNORECASE)
_TAG_RE = re.compile(r"^\s*\[[^\]]*\b(?:staging|synthetic|internal)\b[^\]]*\]", re.IGNORECASE)

_show_requested: ContextVar[bool] = ContextVar("show_test_data_requested", default=False)


def begin_request(header_value: Optional[str]) -> Token:
    """Record this request's admin opt-in header (reset with ``reset_request``)."""
    return _show_requested.set((header_value or "").strip() == "1")


def reset_request(token: Token) -> None:
    _show_requested.reset(token)


def hiding_enabled() -> bool:
    environment = (settings.ENVIRONMENT or "").strip().lower()
    return bool(settings.HIDE_TEST_DATA) and environment == "staging"


def is_test_email(email: object) -> bool:
    return str(email or "").strip().lower().endswith("@" + TEST_EMAIL_DOMAIN)


def is_test_label(*values: object) -> bool:
    for value in values:
        text = str(value or "")
        if text and (_TOKEN_RE.search(text) or _TAG_RE.search(text)):
            return True
    return False


def _viewer_row(user_id: str) -> dict:
    rows = (
        supabase_admin.table("users")
        .select("email, role")
        .eq("id", user_id)
        .limit(1)
        .execute()
    ).data or []
    return rows[0] if rows else {}


def hide_for(
    *,
    email: Optional[str] = None,
    user_id: Optional[str] = None,
    is_admin: Optional[bool] = None,
) -> bool:
    """Whether list reads for this viewer should drop test data.

    Pass what the route already knows; ``users`` is read only for a missing
    e-mail, or for the role when the admin opt-in header is present. A failed
    lookup shows the data (and logs): hiding is cosmetic, a staging suite
    losing its own rows is not.
    """
    if not hiding_enabled():
        return False
    try:
        row: dict | None = None
        if email is None and user_id:
            row = _viewer_row(user_id)
            email = row.get("email")
        if is_test_email(email):
            return False
        if _show_requested.get():
            if is_admin is None and user_id:
                row = row if row is not None else _viewer_row(user_id)
                is_admin = row.get("role") == "admin"
            if is_admin:
                return False
    except Exception as exc:
        logger.warning("[test-data] viewer lookup failed; showing test data: %s", exc)
        return False
    return True


def _paged(build_query) -> list[dict]:
    out: list[dict] = []
    start, step = 0, 1000
    while True:
        rows = build_query().range(start, start + step - 1).execute().data or []
        out.extend(rows)
        if len(rows) < step:
            return out
        start += step


def test_user_ids() -> set[str]:
    """Ids of every staging-e2e account (one paged read)."""
    rows = _paged(lambda: (
        supabase_admin.table("users")
        .select("id")
        .ilike("email", f"%@{TEST_EMAIL_DOMAIN}")
        .order("id")
    ))
    return {str(row["id"]) for row in rows if row.get("id")}


def is_test_student(row: dict, test_users: set[str]) -> bool:
    return (
        str(row.get("user_id") or "") in test_users
        or is_test_label(row.get("full_name"), row.get("student_code"))
    )


def drop_test_students(rows: Iterable[dict]) -> list[dict]:
    test_users = test_user_ids()
    return [row for row in rows if not is_test_student(row, test_users)]


def hidden_student_ids() -> list[str]:
    """Student ids to exclude in SQL, so paginated rosters keep full pages."""
    test_users = test_user_ids()
    rows = _paged(lambda: (
        supabase_admin.table("students")
        .select("id, user_id, full_name, student_code")
        .order("id")
    ))
    return [str(row["id"]) for row in rows if is_test_student(row, test_users)]


def hidden_title_ids(table: str) -> list[str]:
    """Ids in a catalogue table/view whose title marks them as test data."""
    rows = _paged(lambda: supabase_admin.table(table).select("id, title").order("id"))
    return [str(row["id"]) for row in rows if is_test_label(row.get("title"))]
