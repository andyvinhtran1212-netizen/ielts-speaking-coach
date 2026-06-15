"""Tests for services/access_code_permissions.py (Sprint 5.2).

Two layers:

  1. Pure helpers — has_permission, has_writing_permission,
     has_speaking_permission, get_user_permissions_summary,
     validate_permissions_or_raise. All synchronous, no DB. The bulk
     of the tests live here because the helpers are the only piece
     that's actually subtle (allowlist drift, "all" wildcard semantics,
     None handling).

  2. Live lookup — get_user_access_code_permissions /
     get_student_access_code_permissions. Uses an in-memory Supabase
     fake (mirrors the pattern in test_student_home_aggregator.py)
     covering the modern (user_code_assignments) path, the legacy
     (access_codes.used_by) path, and the union of both. Revoked /
     inactive codes must be excluded; orphaned students rows must
     return [].
"""

from __future__ import annotations

from uuid import uuid4

import pytest


# ── Pure helpers ──────────────────────────────────────────────────────


@pytest.fixture
def perms():
    from services import access_code_permissions
    return access_code_permissions


class TestPermissionChecks:
    def test_admin_override_grants_writing(self, perms):
        assert perms.has_writing_permission(["all"]) is True

    def test_admin_override_grants_every_speaking_mode(self, perms):
        for mode in ("practice_single", "practice_part", "practice_full"):
            assert perms.has_speaking_permission(["all"], mode) is True, mode

    def test_explicit_writing_permission(self, perms):
        assert perms.has_writing_permission(["writing"]) is True
        assert perms.has_writing_permission(["writing", "practice_single"]) is True

    def test_writing_permission_missing_when_only_speaking(self, perms):
        assert perms.has_writing_permission(["practice_single"]) is False
        assert perms.has_writing_permission(["practice_full", "practice_part"]) is False

    def test_writing_permission_missing_for_empty_or_none(self, perms):
        assert perms.has_writing_permission([]) is False
        assert perms.has_writing_permission(None) is False

    def test_speaking_mode_check_is_mode_specific(self, perms):
        assert perms.has_speaking_permission(["practice_single"], "practice_single") is True
        assert perms.has_speaking_permission(["practice_single"], "practice_full") is False

    def test_unknown_speaking_mode_raises(self, perms):
        # Caller bug → raise rather than return False, so a typo
        # in a router parameter doesn't silently deny everyone.
        with pytest.raises(ValueError):
            perms.has_speaking_permission(["all"], "unknown_mode")


class TestPermissionsSummary:
    def test_summary_writing_only(self, perms):
        s = perms.get_user_permissions_summary(["writing"])
        assert s["writing"] is True
        assert s["speaking_practice_single"] is False
        assert s["speaking_practice_part"] is False
        assert s["speaking_practice_full"] is False
        assert s["is_admin_override"] is False

    def test_summary_admin_override(self, perms):
        s = perms.get_user_permissions_summary(["all"])
        assert s["writing"] is True
        assert s["speaking_practice_single"] is True
        assert s["speaking_practice_part"] is True
        assert s["speaking_practice_full"] is True
        assert s["is_admin_override"] is True

    def test_summary_empty_list(self, perms):
        s = perms.get_user_permissions_summary([])
        assert all(v is False for v in s.values()), s

    def test_summary_none_input(self, perms):
        s = perms.get_user_permissions_summary(None)
        assert all(v is False for v in s.values()), s

    def test_summary_mixed_writing_plus_one_speaking(self, perms):
        s = perms.get_user_permissions_summary(["writing", "practice_part"])
        assert s["writing"] is True
        assert s["speaking_practice_part"] is True
        assert s["speaking_practice_single"] is False
        assert s["speaking_practice_full"] is False


class TestValidatePermissions:
    def test_known_values_pass(self, perms):
        # Should not raise.
        perms.validate_permissions_or_raise(["all"])
        perms.validate_permissions_or_raise(["writing"])
        perms.validate_permissions_or_raise(["practice_single", "writing"])
        perms.validate_permissions_or_raise([])

    def test_unknown_value_raises_with_listing(self, perms):
        with pytest.raises(ValueError) as exc:
            perms.validate_permissions_or_raise(["writting"])  # typo
        assert "writting" in str(exc.value)
        # Allowlist surface must be visible so the admin can fix the typo.
        assert "writing" in str(exc.value).lower()

    def test_multiple_unknowns_listed_together(self, perms):
        # Spec: surface every offending value at once instead of bisect-style.
        with pytest.raises(ValueError) as exc:
            perms.validate_permissions_or_raise(["foo", "bar", "writing"])
        msg = str(exc.value)
        assert "foo" in msg and "bar" in msg

    def test_non_list_input_raises(self, perms):
        with pytest.raises(ValueError):
            perms.validate_permissions_or_raise("writing")  # type: ignore[arg-type]


# ── Live lookup with in-memory Supabase fake ─────────────────────────


class _Resp:
    def __init__(self, data):
        self.data = data


class _TableQuery:
    def __init__(self, fake, table_name):
        self.fake = fake
        self.table_name = table_name
        self.filters: list[tuple[str, str, object]] = []
        self.in_filter: tuple[str, list] | None = None
        self.limit_n = None

    def select(self, *_args, **_kw):
        return self

    def eq(self, field, value):
        self.filters.append((field, "eq", value))
        return self

    def in_(self, field, values):
        self.in_filter = (field, list(values))
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def execute(self):
        rows = self.fake.tables.get(self.table_name, [])
        matched = [r for r in rows if self._matches(r)]
        if self.limit_n is not None:
            matched = matched[: self.limit_n]
        return _Resp(matched)

    def _matches(self, row):
        for field, _op, value in self.filters:
            if row.get(field) != value:
                return False
        if self.in_filter:
            field, values = self.in_filter
            if row.get(field) not in values:
                return False
        return True


class _FakeSupabase:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {
            "user_code_assignments": [],
            "access_codes": [],
            "students": [],
        }

    def table(self, name: str):
        return _TableQuery(self, name)


@pytest.fixture
def fake_db(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr(
        "services.access_code_permissions.supabase_admin", fake,
    )
    return fake


def _seed_assignment(fake, user_id, code_id, **fields):
    row = {"user_id": user_id, "code_id": code_id, "is_active": True}
    row.update(fields)
    fake.tables["user_code_assignments"].append(row)


def _seed_code(fake, code_id, permissions, **fields):
    row = {
        "id": code_id,
        "permissions": permissions,
        "is_revoked": False,
        "is_active": True,
        "used_by": None,
    }
    row.update(fields)
    fake.tables["access_codes"].append(row)


class TestGetUserAccessCodePermissions:
    def test_modern_path_single_active_code(self, fake_db, perms):
        user_id = str(uuid4())
        code_id = str(uuid4())
        _seed_assignment(fake_db, user_id, code_id)
        _seed_code(fake_db, code_id, ["writing", "practice_single"])

        result = perms.get_user_access_code_permissions(user_id)
        assert set(result) == {"writing", "practice_single"}

    def test_revoked_code_excluded(self, fake_db, perms):
        user_id = str(uuid4())
        code_id = str(uuid4())
        _seed_assignment(fake_db, user_id, code_id)
        _seed_code(fake_db, code_id, ["writing"], is_revoked=True)

        assert perms.get_user_access_code_permissions(user_id) == []

    def test_inactive_code_excluded(self, fake_db, perms):
        user_id = str(uuid4())
        code_id = str(uuid4())
        _seed_assignment(fake_db, user_id, code_id)
        _seed_code(fake_db, code_id, ["writing"], is_active=False)

        assert perms.get_user_access_code_permissions(user_id) == []

    def test_inactive_assignment_excluded(self, fake_db, perms):
        user_id = str(uuid4())
        code_id = str(uuid4())
        _seed_assignment(fake_db, user_id, code_id, is_active=False)
        _seed_code(fake_db, code_id, ["writing"])

        # The code itself is fine but the user's link to it is dormant.
        assert perms.get_user_access_code_permissions(user_id) == []

    def test_legacy_used_by_path(self, fake_db, perms):
        """Code never made it into user_code_assignments but
        access_codes.used_by points at the user — must still resolve."""
        user_id = str(uuid4())
        code_id = str(uuid4())
        _seed_code(fake_db, code_id, ["practice_full"], used_by=user_id)

        assert perms.get_user_access_code_permissions(user_id) == ["practice_full"]

    def test_union_across_modern_plus_legacy(self, fake_db, perms):
        user_id = str(uuid4())
        modern_id = str(uuid4())
        legacy_id = str(uuid4())
        _seed_assignment(fake_db, user_id, modern_id)
        _seed_code(fake_db, modern_id, ["writing"])
        _seed_code(fake_db, legacy_id, ["practice_part"], used_by=user_id)

        result = perms.get_user_access_code_permissions(user_id)
        assert set(result) == {"writing", "practice_part"}

    def test_no_codes_returns_empty(self, fake_db, perms):
        user_id = str(uuid4())
        assert perms.get_user_access_code_permissions(user_id) == []

    def test_dedupe_when_same_permission_in_two_codes(self, fake_db, perms):
        user_id = str(uuid4())
        code_a = str(uuid4())
        code_b = str(uuid4())
        _seed_assignment(fake_db, user_id, code_a)
        _seed_assignment(fake_db, user_id, code_b)
        _seed_code(fake_db, code_a, ["writing"])
        _seed_code(fake_db, code_b, ["writing"])

        result = perms.get_user_access_code_permissions(user_id)
        assert result == ["writing"]


class TestGetStudentAccessCodePermissions:
    def test_resolves_through_students_user_id(self, fake_db, perms):
        student_id = str(uuid4())
        user_id = str(uuid4())
        code_id = str(uuid4())
        fake_db.tables["students"].append(
            {"id": student_id, "user_id": user_id},
        )
        _seed_assignment(fake_db, user_id, code_id)
        _seed_code(fake_db, code_id, ["writing"])

        result = perms.get_student_access_code_permissions(student_id)
        assert result == ["writing"]

    def test_returns_empty_when_student_missing(self, fake_db, perms):
        # Defensive: a student_id that doesn't exist in students must
        # not leak access (return []).
        assert perms.get_student_access_code_permissions(str(uuid4())) == []

    def test_returns_empty_when_student_has_no_user_id(self, fake_db, perms):
        # /activate hasn't run yet — students row exists but isn't
        # linked. Treat as no permissions.
        student_id = str(uuid4())
        fake_db.tables["students"].append(
            {"id": student_id, "user_id": None},
        )
        assert perms.get_student_access_code_permissions(student_id) == []


# ── Sprint 5.2.1 — expires_at enforcement ────────────────────────────


class TestExpiryHelpers:
    """The expiry parser + comparator are isolated from the supabase
    layer so the corner cases (None, naive datetime, Z suffix, exact
    boundary) are easy to pin without seeding a fake DB."""

    def test_parse_expires_at_handles_iso_string_with_z(self, perms):
        from datetime import datetime, timezone
        parsed = perms._parse_expires_at("2026-05-09T12:00:00Z")
        assert parsed == datetime(2026, 5, 9, 12, 0, tzinfo=timezone.utc)

    def test_parse_expires_at_handles_iso_string_with_offset(self, perms):
        from datetime import datetime, timezone
        parsed = perms._parse_expires_at("2026-05-09T12:00:00+00:00")
        assert parsed == datetime(2026, 5, 9, 12, 0, tzinfo=timezone.utc)

    def test_parse_expires_at_returns_none_for_null_or_empty(self, perms):
        assert perms._parse_expires_at(None) is None
        assert perms._parse_expires_at("") is None

    def test_parse_expires_at_assumes_utc_for_naive_datetime(self, perms):
        from datetime import datetime, timezone
        naive = datetime(2026, 5, 9, 12, 0)
        parsed = perms._parse_expires_at(naive)
        assert parsed.tzinfo == timezone.utc

    def test_is_expired_yesterday_true_tomorrow_false(self, perms):
        from datetime import datetime, timedelta, timezone
        now = datetime(2026, 5, 9, 12, 0, tzinfo=timezone.utc)
        yesterday = (now - timedelta(days=1)).isoformat()
        tomorrow = (now + timedelta(days=1)).isoformat()
        assert perms._is_expired(yesterday, now) is True
        assert perms._is_expired(tomorrow, now) is False

    def test_is_expired_null_means_never_expires(self, perms):
        from datetime import datetime, timezone
        now = datetime(2026, 5, 9, 12, 0, tzinfo=timezone.utc)
        assert perms._is_expired(None, now) is False

    def test_is_expired_at_exact_now_is_excluded(self, perms):
        """Edge case the spec calls out: a code that expires AT now is
        already expired (use <= comparison, not <)."""
        from datetime import datetime, timezone
        now = datetime(2026, 5, 9, 12, 0, tzinfo=timezone.utc)
        assert perms._is_expired(now.isoformat(), now) is True


class TestExpiryEnforcementInLookup:
    """Modern + legacy paths must both filter expired codes. A fix that
    only patches one path leaves a backdoor depending on how the code
    was assigned (user_code_assignments vs legacy access_codes.used_by).
    """

    def _yesterday_iso(self):
        from datetime import datetime, timedelta, timezone
        return (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()

    def _tomorrow_iso(self):
        from datetime import datetime, timedelta, timezone
        return (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

    def test_expired_code_modern_path_excluded(self, fake_db, perms):
        user_id = str(uuid4())
        code_id = str(uuid4())
        _seed_assignment(fake_db, user_id, code_id)
        _seed_code(fake_db, code_id, ["writing"], expires_at=self._yesterday_iso())

        assert perms.get_user_access_code_permissions(user_id) == []

    def test_expired_code_legacy_path_excluded(self, fake_db, perms):
        user_id = str(uuid4())
        code_id = str(uuid4())
        _seed_code(
            fake_db, code_id, ["writing"],
            used_by=user_id, expires_at=self._yesterday_iso(),
        )

        assert perms.get_user_access_code_permissions(user_id) == []

    def test_unexpired_code_still_included(self, fake_db, perms):
        user_id = str(uuid4())
        code_id = str(uuid4())
        _seed_assignment(fake_db, user_id, code_id)
        _seed_code(fake_db, code_id, ["writing"], expires_at=self._tomorrow_iso())

        assert perms.get_user_access_code_permissions(user_id) == ["writing"]

    def test_null_expires_at_treated_as_never_expires(self, perms, fake_db):
        # Default _seed_code doesn't set expires_at → defaults to None
        # in the fixture, matching the production `expires_at IS NULL`
        # case. The lookup must NOT exclude these.
        user_id = str(uuid4())
        code_id = str(uuid4())
        _seed_assignment(fake_db, user_id, code_id)
        _seed_code(fake_db, code_id, ["practice_part"])  # no expires_at kw
        assert perms.get_user_access_code_permissions(user_id) == ["practice_part"]

    def test_expired_modern_plus_unexpired_legacy_returns_only_legacy(
        self, fake_db, perms,
    ):
        """Mixed: one path expired, the other valid — the union must
        carry only the valid one. Catches regressions where one branch
        skipped the filter and produced a "bonus" permission."""
        user_id = str(uuid4())
        modern_id = str(uuid4())
        legacy_id = str(uuid4())
        _seed_assignment(fake_db, user_id, modern_id)
        _seed_code(
            fake_db, modern_id, ["writing"], expires_at=self._yesterday_iso(),
        )
        _seed_code(
            fake_db, legacy_id, ["practice_full"],
            used_by=user_id, expires_at=self._tomorrow_iso(),
        )

        result = perms.get_user_access_code_permissions(user_id)
        assert result == ["practice_full"]


class TestGetUsersCodeSummary:
    """Batched user→active-code summary for the merged admin "Người dùng" tab.
    Same sourcing as the per-user gate (modern + #442 legacy fallback +
    live-only), but for many users in a fixed number of queries."""

    def test_batched_union_status_and_type(self, fake_db, perms):
        u1, u2 = str(uuid4()), str(uuid4())
        c1, c2 = str(uuid4()), str(uuid4())
        _seed_assignment(fake_db, u1, c1)
        _seed_code(fake_db, c1, ["writing", "practice_single"], code="W-1", code_type="direct")
        _seed_assignment(fake_db, u2, c2)
        _seed_code(fake_db, c2, ["practice_part"], code="S-1", code_type="mass")

        out = perms.get_users_code_summary([u1, u2])
        assert out[u1]["has_active_code"] is True
        assert set(out[u1]["permissions"]) == {"writing", "practice_single"}
        assert out[u1]["code_type"] == "direct"
        assert out[u1]["code_count"] == 1
        assert out[u1]["codes"][0]["code"] == "W-1"
        assert set(out[u2]["permissions"]) == {"practice_part"}

    def test_revoked_code_not_counted_active(self, fake_db, perms):
        u, c = str(uuid4()), str(uuid4())
        _seed_assignment(fake_db, u, c)
        _seed_code(fake_db, c, ["writing"], is_revoked=True, code="X")
        out = perms.get_users_code_summary([u])
        assert out[u]["has_active_code"] is False
        assert out[u]["codes"] == [] and out[u]["permissions"] == []

    def test_442_inactive_assignment_blocks_used_by_fallback(self, fake_db, perms):
        # Inactive assignment row + code.used_by=user → deliberate per-user
        # revoke → must NOT re-grant via the immutable used_by.
        u, c = str(uuid4()), str(uuid4())
        _seed_assignment(fake_db, u, c, is_active=False)
        _seed_code(fake_db, c, ["writing"], used_by=u, is_used=True, code="L")
        out = perms.get_users_code_summary([u])
        assert out[u]["has_active_code"] is False

    def test_legacy_used_by_fallback_when_no_assignment_row(self, fake_db, perms):
        u, c = str(uuid4()), str(uuid4())
        _seed_code(fake_db, c, ["writing"], used_by=u, is_used=True, code="L2")  # no uca row
        out = perms.get_users_code_summary([u])
        assert out[u]["has_active_code"] is True
        assert set(out[u]["permissions"]) == {"writing"}

    def test_user_with_no_code_present_and_empty(self, fake_db, perms):
        u = str(uuid4())
        out = perms.get_users_code_summary([u])
        assert out[u] == {"codes": [], "code_count": 0, "code_type": None,
                          "permissions": [], "has_active_code": False}
