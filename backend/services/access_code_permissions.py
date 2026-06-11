"""services/access_code_permissions.py — access-code permission helpers.

Sprint 5.2 introduces per-skill permission gating. Pre-5.2, the only
gates were the three Speaking modes (`practice_single` / `practice_part`
/ `practice_full`) plus the wildcard `all`. Writing endpoints had no
permission check, so a Speaking-only access code could still submit
essays through the admin or student paths.

This module owns:
  - the ALLOWED_PERMISSIONS allowlist (rejection list for typos at the
    admin-create boundary)
  - pure boolean helpers (`has_permission`, `has_writing_permission`,
    `has_speaking_permission`)
  - `get_user_permissions_summary()` — the shape /api/student/permissions
    returns to the frontend
  - `get_user_access_code_permissions()` — the live-query that powers
    request-time gating (queries `user_code_assignments` with the legacy
    `access_codes.used_by` fallback per CLAUDE.md's modern/legacy split)

Why query the live source on every gated request?
  Sprint 5.2 spec acceptance: "Admin: edit code cũ thêm Writing → user
  gain access immediately." The denormalised `users.permissions` column
  is set once at /activate and would never reflect post-activation
  permission edits. Anti-pattern #28 (TOCTOU) reinforces: read
  permissions at the moment of the gated action, not from a cache.
"""

from __future__ import annotations

import logging
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from database import supabase_admin

logger = logging.getLogger(__name__)

# ── Per-request memo (PR1 single-source) ─────────────────────────────────────
# Speaking is a hot path; memoize the live permission lookup WITHIN a single
# request so multiple gates in one request hit the DB once. The memo lives only
# for the request (ContextVar set/reset by the middleware in main.py), so a
# revoke is reflected on the NEXT request — NEVER cached across requests (that
# would re-introduce the stale-revoke bug this PR fixes). Mirrors the proven
# server_timing ContextVar pattern.
_perm_memo: ContextVar[Optional[dict]] = ContextVar("access_perm_memo", default=None)


def begin_request_permission_memo() -> object:
    """Start a fresh per-request permission cache; returns a reset token."""
    return _perm_memo.set({})


def reset_request_permission_memo(token: object) -> None:
    _perm_memo.reset(token)


def get_user_access_code_permissions_cached(user_id: UUID | str) -> list[str]:
    """Per-request-memoized wrapper over get_user_access_code_permissions.

    Returns the same live list; only avoids a duplicate DB round-trip inside one
    request. Falls back to a direct (un-memoized) query when no request memo is
    active (e.g. background tasks, tests)."""
    memo = _perm_memo.get()
    if memo is None:
        return get_user_access_code_permissions(user_id)
    key = str(user_id)
    if key not in memo:
        memo[key] = get_user_access_code_permissions(user_id)
    return memo[key]


def _parse_expires_at(value) -> Optional[datetime]:
    """Coerce a Supabase timestamp value into a tz-aware UTC datetime.

    PostgREST returns timestamptz columns as ISO 8601 strings (with the
    `Z` or `+00:00` suffix). Supabase's Python client occasionally
    materialises them as `datetime` already — handle both. Naïve
    datetimes are assumed UTC, matching how the column is stored.

    Returns None for None / empty input so callers can do
    `if parsed and parsed <= now: skip` without a separate truthiness
    branch.
    """
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        # `Z` is valid ISO 8601 but Python's fromisoformat only learned
        # to parse it in 3.11+. Normalise so older runtimes stay safe.
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    raise TypeError(f"Unsupported expires_at type: {type(value).__name__}")


def _is_expired(value, now: datetime) -> bool:
    """A code with `expires_at <= now` is past its expiry.

    Sprint 5.2.1 hotfix: NULL `expires_at` means "never expires" —
    those codes always pass. Use `<=` rather than `<` so the exact-
    second boundary excludes the code (a code "expiring at NOW" is
    expired).
    """
    parsed = _parse_expires_at(value)
    if parsed is None:
        return False
    return parsed <= now


# ── Allowlist + canonical names ───────────────────────────────────────


ADMIN_OVERRIDE_PERMISSION = "all"
WRITING_PERMISSION = "writing"
ADMIN_PERMISSION = "admin"

SPEAKING_PERMISSIONS: frozenset[str] = frozenset({
    "practice_single",
    "practice_part",
    "practice_full",
})

# Anything outside this set is rejected at create/update time so a typo
# in the admin UI ("writting") doesn't silently grant nothing-and-no-one.
ALLOWED_PERMISSIONS: frozenset[str] = frozenset({
    ADMIN_OVERRIDE_PERMISSION,
    WRITING_PERMISSION,
    ADMIN_PERMISSION,
} | SPEAKING_PERMISSIONS)


# ── Pure helpers ──────────────────────────────────────────────────────


def has_permission(code_permissions: Optional[list[str]], required: str) -> bool:
    """Does this permission list grant `required`?

    `all` is the wildcard override — if present, every check returns True.
    `None` and `[]` are treated identically (no permissions). The required
    string is compared verbatim; callers pass canonical constants from
    this module rather than raw strings.
    """
    if not code_permissions:
        return False
    if ADMIN_OVERRIDE_PERMISSION in code_permissions:
        return True
    return required in code_permissions


def has_writing_permission(code_permissions: Optional[list[str]]) -> bool:
    return has_permission(code_permissions, WRITING_PERMISSION)


def has_speaking_permission(
    code_permissions: Optional[list[str]],
    mode: str,
) -> bool:
    """Speaking permissions are mode-scoped. `mode` must be one of the
    three known Speaking permission strings — anything else is a caller
    bug, not a runtime failure mode, so we raise."""
    if mode not in SPEAKING_PERMISSIONS:
        raise ValueError(
            f"Unknown speaking mode: {mode!r}. "
            f"Expected one of {sorted(SPEAKING_PERMISSIONS)}."
        )
    return has_permission(code_permissions, mode)


def get_user_permissions_summary(code_permissions: Optional[list[str]]) -> dict:
    """Frontend-facing flag map. Stable shape across calls — adding a new
    skill means adding a new key here and a renderSkillCard branch in
    home.js (no migration). Used by GET /api/student/permissions."""
    return {
        "writing": has_writing_permission(code_permissions),
        "speaking_practice_single": has_permission(code_permissions, "practice_single"),
        "speaking_practice_part":   has_permission(code_permissions, "practice_part"),
        "speaking_practice_full":   has_permission(code_permissions, "practice_full"),
        "is_admin_override":        ADMIN_OVERRIDE_PERMISSION in (code_permissions or []),
    }


def validate_permissions_or_raise(permissions: list[str]) -> None:
    """Fail-loud guard for admin create/update. Raises ValueError listing
    every offending value so the admin UI's error toast can surface them
    all at once instead of one-at-a-time bisect."""
    if not isinstance(permissions, list):
        raise ValueError("permissions must be a list of strings")
    invalid = [p for p in permissions if p not in ALLOWED_PERMISSIONS]
    if invalid:
        raise ValueError(
            f"Unknown permission values: {sorted(set(invalid))}. "
            f"Allowed: {sorted(ALLOWED_PERMISSIONS)}."
        )


# ── Live permission lookup ────────────────────────────────────────────


def get_user_access_code_permissions(user_id: UUID | str) -> list[str]:
    """Return the union of permissions across every active access code
    the user is associated with.

    Sourcing rule (matches CLAUDE.md):
      Modern: rows in `user_code_assignments` with `is_active=true` →
              join `access_codes` for permissions, filter out revoked
              and inactive codes.
      Legacy: codes where `access_codes.used_by = user_id` AND no row
              exists in user_code_assignments — pre-Sprint W backfill
              left some legacy codes outside the assignment table.
              (Migration 009 backfilled most, but defensive fallback
              keeps the gate honest.)

    Why union instead of any-one-code semantics?
      A user with a Speaking-only code AND a Writing-only code should
      have both. Restricting to "first code" or "newest code" silently
      loses access. Union is the only behaviour that doesn't surprise.

    Returns:
      Sorted, de-duplicated permission list. Empty list if the user has
      no active codes (treat as no-permissions).
    """
    user_id_str = str(user_id)
    permissions: set[str] = set()
    # Compute `now` once per request — anti-pattern #28 (TOCTOU) says
    # don't re-read the clock between the modern and legacy paths.
    now = datetime.now(timezone.utc)

    # ── Modern path: assignments → codes ─────────────────────────────
    try:
        # Two queries (fetch active assignments, then fetch the codes by
        # id) instead of a join. PostgREST supports nested selects but
        # the column-name binding gets fragile — explicit two-step is
        # easier to debug and keeps schema coupling minimal.
        assignments = (
            supabase_admin.table("user_code_assignments")
            .select("code_id")
            .eq("user_id", user_id_str)
            .eq("is_active", True)
            .execute()
        )
        code_ids = [
            row["code_id"]
            for row in (assignments.data or [])
            if row.get("code_id")
        ]
        if code_ids:
            codes = (
                supabase_admin.table("access_codes")
                .select("id, permissions, is_revoked, is_active, expires_at")
                .in_("id", code_ids)
                .execute()
            )
            for row in codes.data or []:
                if row.get("is_revoked"):
                    continue
                if row.get("is_active") is False:
                    continue
                # Sprint 5.2.1 RED hotfix — expired codes must not
                # grant permissions even when is_active=true.
                if _is_expired(row.get("expires_at"), now):
                    continue
                for p in row.get("permissions") or []:
                    if isinstance(p, str):
                        permissions.add(p)
    except Exception as e:
        # Don't fail the whole request if assignments lookup blows up —
        # fall through to the legacy path. Log so the operator knows.
        logger.warning(
            "user_code_assignments lookup failed for user %s: %s",
            user_id_str, e,
        )

    # ── Legacy fallback: access_codes.used_by ────────────────────────
    # The CLAUDE.md guidance: "Legacy codes: fallback is
    # access_codes.used_by — synthesized when no active assignment row
    # exists." We unconditionally union here (don't gate on whether the
    # modern path returned anything) because a user can plausibly have
    # one modern + one legacy code at once.
    try:
        legacy = (
            supabase_admin.table("access_codes")
            .select("permissions, is_revoked, is_active, expires_at")
            .eq("used_by", user_id_str)
            .execute()
        )
        for row in legacy.data or []:
            if row.get("is_revoked"):
                continue
            if row.get("is_active") is False:
                continue
            # Sprint 5.2.1 RED hotfix — same expiry guard as the modern
            # path. A code reachable via either route gets the same gate.
            if _is_expired(row.get("expires_at"), now):
                continue
            for p in row.get("permissions") or []:
                if isinstance(p, str):
                    permissions.add(p)
    except Exception as e:
        logger.warning(
            "legacy access_codes.used_by lookup failed for user %s: %s",
            user_id_str, e,
        )

    return sorted(permissions)


def get_student_access_code_permissions(student_id: UUID | str) -> list[str]:
    """Resolve permissions for a Writing-side `students.id`.

    Writing endpoints identify essay ownership via `students.id`, not
    `users.id`. The mapping is `students.user_id` → users.id, populated
    by /activate's Step 6 (see routers/auth.py). When the link is
    missing we return [] — gating treats that as "no permissions",
    which keeps newly-created students.id rows from leaking access
    until /activate completes.
    """
    try:
        result = (
            supabase_admin.table("students")
            .select("user_id")
            .eq("id", str(student_id))
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.warning("students lookup failed for %s: %s", student_id, e)
        return []

    rows = result.data or []
    if not rows:
        return []
    user_id = rows[0].get("user_id")
    if not user_id:
        return []
    return get_user_access_code_permissions(user_id)
