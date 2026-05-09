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
from typing import Optional
from uuid import UUID

from database import supabase_admin

logger = logging.getLogger(__name__)


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
                .select("id, permissions, is_revoked, is_active")
                .in_("id", code_ids)
                .execute()
            )
            for row in codes.data or []:
                if row.get("is_revoked"):
                    continue
                if row.get("is_active") is False:
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
            .select("permissions, is_revoked, is_active")
            .eq("used_by", user_id_str)
            .execute()
        )
        for row in legacy.data or []:
            if row.get("is_revoked"):
                continue
            if row.get("is_active") is False:
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
