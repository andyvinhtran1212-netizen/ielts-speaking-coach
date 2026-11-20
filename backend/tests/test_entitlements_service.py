"""COURSEACCESS-0055 T003 — services/entitlements.py (plan 5.4)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from services import entitlements as ent

NOW = datetime.now(timezone.utc)
COURSE = "11111111-1111-1111-1111-111111111111"
OTHER_COURSE = "22222222-2222-2222-2222-222222222222"
ONLINE = {"id": "p-online", "course_id": COURSE, "kind": "online", "features": ["speaking", "writing"],
          "review_mode": "ai_instant", "status": "open", "slug": "ielts-6", "title": "IELTS 6.0"}
CLASS = {"id": "p-class", "course_id": COURSE, "kind": "class", "features": ["writing"],
         "review_mode": "teacher_review", "status": "draft", "slug": "lop-6", "title": "Lớp 6.0"}


def _row(product, *, status="active", starts=-10, expires=20, credits_expire=None, review_mode=None, rid="e1",
         source="enrollment_order"):
    return {"id": rid, "product_id": product["id"], "course_id": product["course_id"], "source": source,
            "status": status, "starts_at": (NOW + timedelta(days=starts)).isoformat(),
            "expires_at": None if expires is None else (NOW + timedelta(days=expires)).isoformat(),
            "credits_expire_at": None if credits_expire is None else (NOW + timedelta(days=credits_expire)).isoformat(),
            "credits_closed_at": None, "review_mode": review_mode}


def _patch(monkeypatch, rows=(), products=(ONLINE, CLASS), memberships=(), codes=()):
    monkeypatch.setattr(ent, "fetch_entitlement_rows", lambda uid: list(rows))
    by_id = {p["id"]: p for p in products}
    monkeypatch.setattr(ent, "fetch_products", lambda ids: {i: by_id[i] for i in set(ids) if i in by_id})
    monkeypatch.setattr(ent, "fetch_membership_course_ids", lambda uid: list(memberships))
    monkeypatch.setattr(ent, "fetch_legacy_code_rows", lambda uid: list(codes))


def test_build_access_merges_three_sources_without_duplicate_class_rows():
    rows = [_row(ONLINE), _row(CLASS, rid="e2", source="class_conversion", expires=None)]
    codes = [{"id": "c1", "permissions": ["practice_part", "writing"], "expires_at": None}]
    items = ent.build_access(rows, {"p-online": ONLINE, "p-class": CLASS}, [COURSE, OTHER_COURSE], codes, NOW)
    sources = [(i.source, i.course_id) for i in items]
    # The cohort of COURSE is not listed again: an entitlements row exists for it.
    assert sources == [("enrollment_order", COURSE), ("class_conversion", COURSE),
                       ("class_membership", OTHER_COURSE), ("legacy_access_code", None)]
    assert items[-1].features == ("speaking", "writing") and items[-1].expires_at is None
    assert items[0].review_mode == "ai_instant" and items[1].review_mode == "teacher_review"


def test_entitlement_state_is_derived_from_expiry():
    assert ent.entitlement_state(_row(ONLINE, expires=1), NOW) == "active"
    assert ent.entitlement_state({"status": "active", "expires_at": NOW.isoformat()}, NOW) == "expired"
    assert ent.entitlement_state(_row(ONLINE, status="revoked"), NOW) == "revoked"
    assert ent.entitlement_state(_row(ONLINE, expires=None), NOW) == "active"


def test_days_left_rounds_up_and_is_zero_at_expiry():
    assert ent.days_left(NOW + timedelta(seconds=1), NOW) == 1
    assert ent.days_left(NOW + timedelta(days=2, seconds=1), NOW) == 3
    assert ent.days_left(NOW + timedelta(days=2), NOW) == 2
    assert ent.days_left(NOW, NOW) == 0
    assert ent.days_left(NOW - timedelta(days=3), NOW) == 0
    assert ent.days_left(None, NOW) is None


def test_can_renew_three_cases_and_guards():
    def renew(**kw):
        args = dict(product=ONLINE, state="active", expires_at=NOW + timedelta(days=90), has_open_order=False,
                    window_days=30, now=NOW)
        return ent.can_renew(**{**args, **kw})

    assert renew() is False                                            # many days left
    assert renew(expires_at=NOW + timedelta(days=30)) is True          # inside the window
    assert renew(expires_at=NOW + timedelta(days=5), has_open_order=True) is False
    assert renew(state="expired", expires_at=NOW - timedelta(days=1)) is True
    assert renew(state="expired", product={**ONLINE, "status": "closed"}) is False
    assert renew(state="expired", product=CLASS) is False
    assert renew(state="revoked") is False


def test_has_ever_had_online_course_counts_expired_and_revoked(monkeypatch):
    _patch(monkeypatch, rows=[_row(ONLINE, expires=-5)])
    assert ent.has_ever_had_online_course("u") is True
    _patch(monkeypatch, rows=[_row(ONLINE, status="revoked")])
    assert ent.has_ever_had_online_course("u") is True
    _patch(monkeypatch, rows=[_row(CLASS)])
    assert ent.has_ever_had_online_course("u") is False
    _patch(monkeypatch, rows=[])
    assert ent.has_ever_had_online_course("u") is False


def test_has_ever_had_online_course_raises_on_read_error(monkeypatch):
    def boom(uid):
        raise RuntimeError("db down")
    monkeypatch.setattr(ent, "fetch_entitlement_rows", boom)
    with pytest.raises(RuntimeError):
        ent.has_ever_had_online_course("u")


def test_legacy_class_member_has_access_but_no_entitlement(monkeypatch):
    _patch(monkeypatch, memberships=[COURSE])
    assert ent.has_course_access("u", COURSE) is True
    assert ent.has_course_entitlement("u", COURSE) is False
    assert ent.has_course_access("u", OTHER_COURSE) is False


def test_has_course_entitlement_only_active_rows_and_kinds(monkeypatch):
    _patch(monkeypatch, rows=[_row(CLASS, expires=-1)])
    assert ent.has_course_entitlement("u", COURSE) is False
    _patch(monkeypatch, rows=[_row(CLASS)])
    assert ent.has_course_entitlement("u", COURSE) is True
    assert ent.has_course_entitlement("u", COURSE, kinds=["class", "repractice"]) is True
    assert ent.has_course_entitlement("u", COURSE, kinds=["online"]) is False


def test_has_course_access_ignores_expired_and_not_started(monkeypatch):
    _patch(monkeypatch, rows=[_row(ONLINE, expires=-1)])
    assert ent.has_course_access("u", COURSE) is False
    _patch(monkeypatch, rows=[_row(ONLINE, starts=2, expires=40)])
    assert ent.has_course_access("u", COURSE) is False


def test_resolve_review_mode(monkeypatch):
    _patch(monkeypatch, rows=[_row(ONLINE, credits_expire=30)])
    assert ent.resolve_review_mode("u", context={"writing_assignment_id": "w"}) == "legacy"
    assert ent.resolve_review_mode("u", context={"class_assignment_item_id": "i"}) == "legacy"
    assert ent.resolve_review_mode("u") == "ai_instant"
    # The row's override wins over the product.
    _patch(monkeypatch, rows=[_row(ONLINE, review_mode="teacher_review")])
    assert ent.resolve_review_mode("u") == "teacher_review"
    # The usable Writing entitlement whose credits lapse first decides.
    online2 = {**ONLINE, "id": "p-online2", "review_mode": "teacher_review"}
    _patch(monkeypatch, rows=[_row(ONLINE, expires=60, rid="late"), _row(online2, expires=10, rid="soon")],
           products=(ONLINE, online2))
    assert ent.resolve_review_mode("u") == "teacher_review"
    assert ent.resolve_review_mode("u", entitlement_id="late") == "ai_instant"
    # No usable Writing entitlement: the review flow of today.
    _patch(monkeypatch, rows=[_row(ONLINE, expires=-1)])
    assert ent.resolve_review_mode("u") == "legacy"


def test_legacy_code_rows_fail_closed_and_skip_product_codes(monkeypatch):
    client = MagicMock()

    def table(name):
        t = MagicMock()
        if name == "user_code_assignments":
            t.select.return_value.eq.return_value.execute.return_value.data = [
                {"code_id": "c-legacy", "is_active": True}, {"code_id": "c-product", "is_active": True}]
        else:
            t.select.return_value.in_.return_value.execute.return_value.data = [
                {"id": "c-legacy", "permissions": ["writing"], "is_revoked": False, "is_active": True,
                 "expires_at": None, "product_id": None},
                {"id": "c-product", "permissions": ["writing"], "is_revoked": False, "is_active": True,
                 "expires_at": None, "product_id": "p-class"}]
            t.select.return_value.eq.return_value.execute.return_value.data = []
        return t

    client.table.side_effect = table
    monkeypatch.setattr(ent, "supabase_admin", client)
    assert [r["id"] for r in ent.fetch_legacy_code_rows("u")] == ["c-legacy"]

    broken = MagicMock()
    broken.table.return_value.select.return_value.eq.return_value.execute.side_effect = RuntimeError("down")
    monkeypatch.setattr(ent, "supabase_admin", broken)
    with pytest.raises(RuntimeError):
        ent.fetch_legacy_code_rows("u")
