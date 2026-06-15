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


def _code_is_live(row: dict, now: datetime) -> bool:
    """A code grants nothing once it is revoked, locked, or past expiry."""
    if row.get("is_revoked"):
        return False
    if row.get("is_active") is False:
        return False
    if _is_expired(row.get("expires_at"), now):
        return False
    return True


def _active_code_rows(user_id: UUID | str) -> list[dict]:
    """The deduped set of LIVE access-code rows a user holds — the single
    sourcing used by every request-time gate (permissions AND session_limit).

    Sourcing (matches CLAUDE.md's modern/legacy split):
      - Modern: user_code_assignments (is_active) → access_codes.
      - Legacy: access_codes.used_by, but ONLY for codes the user has NO
        assignment row for (#442 — an inactive assignment row means a deliberate
        per-user revoke, so the immutable used_by must not re-grant).
    Codes that are revoked / locked / expired are filtered out. Rows are deduped
    by id so a code reachable via both routes is counted once (critical for
    summing session_limit). Each row carries: id, permissions, session_limit.
    A lookup failure logs and degrades to whatever the other path returned.
    """
    user_id_str = str(user_id)
    # Compute `now` once — anti-pattern #28 (TOCTOU): don't re-read the clock
    # between the modern and legacy paths.
    now = datetime.now(timezone.utc)
    assigned_code_ids: set = set()       # every code_id with ANY assignment row
    rows_by_id: dict[str, dict] = {}

    # ── Modern path: assignments → codes ─────────────────────────────
    try:
        assignments = (
            supabase_admin.table("user_code_assignments")
            .select("code_id, is_active")
            .eq("user_id", user_id_str)
            .execute()
        )
        code_ids: list = []
        for row in (assignments.data or []):
            cid = row.get("code_id")
            if not cid:
                continue
            assigned_code_ids.add(cid)
            if row.get("is_active"):
                code_ids.append(cid)
        if code_ids:
            codes = (
                supabase_admin.table("access_codes")
                .select("id, permissions, session_limit, is_revoked, is_active, expires_at")
                .in_("id", code_ids)
                .execute()
            )
            for row in codes.data or []:
                if _code_is_live(row, now):
                    rows_by_id[row["id"]] = row
    except Exception as e:
        logger.warning(
            "user_code_assignments lookup failed for user %s: %s", user_id_str, e,
        )

    # ── Legacy fallback: access_codes.used_by ────────────────────────
    # Applies ONLY to codes with no assignment row at all (true legacy). An
    # inactive row → deliberately revoked → the modern path is authoritative.
    try:
        legacy = (
            supabase_admin.table("access_codes")
            .select("id, permissions, session_limit, is_revoked, is_active, expires_at")
            .eq("used_by", user_id_str)
            .execute()
        )
        for row in legacy.data or []:
            if row.get("id") in assigned_code_ids:
                continue
            if row.get("id") in rows_by_id:
                continue
            if _code_is_live(row, now):
                rows_by_id[row["id"]] = row
    except Exception as e:
        logger.warning(
            "legacy access_codes.used_by lookup failed for user %s: %s", user_id_str, e,
        )

    return list(rows_by_id.values())


def get_user_total_session_limit(user_id: UUID | str) -> Optional[int]:
    """Total lifetime session quota across the user's LIVE codes, or None for
    "no per-code cap" (treat as unlimited — the daily cap still applies).

    Sprint 5.2 wish #1 — session_limit becomes enforceable. Chốt C: a user with
    multiple active codes gets the SUM of their limits ("thêm lượt" = raise one
    code's limit and it adds up). Returns None when:
      - the user holds NO live code (no per-code quota to enforce), OR
      - ANY live code has a NULL limit (one unlimited code → unlimited overall).
    A non-integer limit is treated as unlimited (defensive: never wrongly block).
    """
    rows = _active_code_rows(user_id)
    if not rows:
        return None
    total = 0
    for row in rows:
        lim = row.get("session_limit")
        if lim is None:
            return None
        try:
            total += int(lim)
        except (TypeError, ValueError):
            return None
    return total


# ── Canonical session quota (used / limit / remaining) ────────────────────────
# ONE source of truth read by BOTH the admin display AND create_session
# enforcement, so they can never disagree (the bug: admin showed "60 left" while
# enforcement blocked the same student). Two things this fixes:
#   1. "used" counts ONLY completed sessions — an abandoned in_progress (or a
#      grading-failed analysis_failed) does NOT consume a paid lượt. Counting
#      them locked students out unfairly.
#   2. the count is accurate (count='exact' / a GROUP BY RPC) — never the old
#      batched `.in_()` query that PostgREST truncated at db-max-rows (1000).
SESSION_USED_STATUS = "completed"


def get_user_completed_session_count(user_id: UUID | str) -> int:
    """Accurate count of a user's COMPLETED sessions — the quota "used" unit.

    Uses count='exact' so PostgREST returns the true total via the Content-Range
    header WITHOUT fetching rows and WITHOUT the 1000-row cap. Raises on DB error
    so the caller decides (enforcement surfaces a 500 rather than silently
    allowing or blocking)."""
    res = (
        supabase_admin.table("sessions")
        .select("id", count="exact")
        .eq("user_id", str(user_id))
        .eq("status", SESSION_USED_STATUS)
        .execute()
    )
    return res.count if res.count is not None else len(res.data or [])


def get_user_session_quota(user_id: UUID | str) -> dict:
    """Canonical per-user session quota — the single source admin + enforcement
    both read.

      used      = completed-session count (accurate, completed-only)
      limit     = SUM of session_limit across the user's live codes (None=unlimited)
      remaining = None when unlimited, else max(0, limit - used)
      unlimited = limit is None
    """
    used = get_user_completed_session_count(user_id)
    limit = get_user_total_session_limit(user_id)
    if limit is None:
        return {"used": used, "limit": None, "remaining": None, "unlimited": True}
    return {"used": used, "limit": limit, "remaining": max(0, limit - used), "unlimited": False}


def get_completed_session_counts(user_ids: list) -> dict:
    """Batched completed-session counts for many users — ONE GROUP BY query via
    the fn_completed_session_counts RPC (no N+1, no 1000-row cap). Used by the
    admin codes list so its "used" matches enforcement exactly.

    Falls back to per-user count='exact' if the RPC is absent (pre-migration 098;
    Lesson 11 — deploy & apply). Returns {user_id: completed_count}; users with
    zero completed sessions are simply absent (callers default to 0)."""
    uids = [str(u) for u in (user_ids or []) if u]
    if not uids:
        return {}
    try:
        res = supabase_admin.rpc("fn_completed_session_counts", {"p_uids": uids}).execute()
        return {row["user_id"]: int(row["n"]) for row in (res.data or [])}
    except Exception as e:
        logger.warning(
            "fn_completed_session_counts RPC unavailable, falling back to per-user "
            "count='exact': %s", e,
        )
        counts: dict[str, int] = {}
        for uid in uids:
            try:
                counts[uid] = get_user_completed_session_count(uid)
            except Exception as e2:
                logger.warning("completed-count fallback failed for %s: %s", uid, e2)
        return counts


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
    # Sourcing (modern assignments + legacy used_by fallback, with the #442
    # inactive-assignment suppression and live/revoked/expired filtering) lives
    # in _active_code_rows — shared with get_user_total_session_limit so both
    # gates read the exact same set of codes.
    permissions: set[str] = set()
    for row in _active_code_rows(user_id):
        for p in row.get("permissions") or []:
            if isinstance(p, str):
                permissions.add(p)
    return sorted(permissions)


def student_has_writing_assignment(student_id: Optional[UUID | str]) -> bool:
    """WF entitlement bridge: True when the student has ≥1 writing assignment
    (ANY status — incl. graded/delivered, so a finished student keeps access to
    review feedback).

    Rationale: a student who was GIVEN writing must be able to DO it, even if
    the access code they logged in with doesn't carry the `writing` permission
    (e.g. a shared mass code). Additive, implicit grant — never touches
    `code.permissions` (code-wide) and adds no per-user permission row.

    Read LIVE on every gated request (no cache — same TOCTOU discipline as the
    permission lookup), so assigning/un-assigning takes effect on the next
    request. A query failure degrades to False, leaving the code-permission
    path authoritative (fail-closed for the bridge)."""
    if not student_id:
        return False
    try:
        r = (
            supabase_admin.table("writing_assignments")
            .select("id")
            .eq("student_id", str(student_id))
            .limit(1)
            .execute()
        )
        return bool(r.data)
    except Exception as e:
        logger.warning(
            "writing_assignments existence check failed for student %s: %s",
            student_id, e,
        )
        return False


def student_id_for_user(user_id: Optional[UUID | str]) -> Optional[str]:
    """users.id → students.id (reverse of get_student_access_code_permissions'
    mapping). Returns None when no linked student row exists. Lets the writing
    gate resolve a student_id when only the auth user is known."""
    if not user_id:
        return None
    try:
        r = (
            supabase_admin.table("students")
            .select("id")
            .eq("user_id", str(user_id))
            .limit(1)
            .execute()
        )
        rows = r.data or []
        return rows[0]["id"] if rows else None
    except Exception as e:
        logger.warning("student lookup by user_id failed for %s: %s", user_id, e)
        return None


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
