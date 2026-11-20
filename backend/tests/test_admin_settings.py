"""G09-T22 (ADMINIA-0074 FR-080, FR-081, FR-084): the operations-threshold
table — services/ops_thresholds.py and routers/admin_settings.py.

The database is a small in-memory fake service client that implements
fn_admin_settings_merge's contract (merge, log old -> new, no log for a no-op);
the SQL itself runs on PostgreSQL in test_migration_440_admin_settings.py.
"""

from __future__ import annotations

import asyncio
import copy
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from routers import admin_settings
from services import ops_thresholds

ADMIN = {"id": "admin-1"}
TEACHER = {"id": "teacher-1"}


class _Res:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.limit_n, self.desc = db, table, [], None, False

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: r.get(col) == val)
        return self

    def lt(self, col, val):
        self.filters.append(lambda r: r.get(col) < val)
        return self

    def in_(self, col, vals):
        self.filters.append(lambda r: r.get(col) in vals)
        return self

    def order(self, _col, desc=False):
        self.desc = desc
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def execute(self):
        if self.table in self.db.fail:
            raise RuntimeError("db down")
        rows = [r for r in self.db.tables[self.table] if all(f(r) for f in self.filters)]
        if self.desc:
            rows = sorted(rows, key=lambda r: r["id"], reverse=True)
        return _Res(copy.deepcopy(rows[: self.limit_n] if self.limit_n else rows))


class _Rpc:
    def __init__(self, db, name, params):
        self.db, self.name, self.params = db, name, params

    def execute(self):
        if self.name in self.db.fail:
            raise RuntimeError("db down")
        assert self.name == "fn_admin_settings_merge"
        self.db.calls.append(self.params)
        p = self.params
        settings_rows = self.db.tables["admin_settings"]
        row = next((r for r in settings_rows if r["key"] == p["p_key"]), None)
        old = copy.deepcopy(row["value"]) if row else None
        merged = {**(old or {}), **p["p_changes"]}
        if old == merged:
            return _Res(merged)
        if row:
            row["value"] = merged
        else:
            settings_rows.append({"key": p["p_key"], "value": merged})
        log = self.db.tables["admin_settings_log"]
        log.append({"id": len(log) + 1, "key": p["p_key"], "old_value": old, "new_value": merged,
                    "reason": p["p_reason"], "actor_id": p["p_actor"], "created_at": f"2026-11-20T0{len(log)}:00:00Z"})
        return _Res(merged)


class _DB:
    def __init__(self, stored=None):
        self.tables = {
            "admin_settings": [] if stored is None else [{"key": "ops_thresholds", "value": stored}],
            "admin_settings_log": [],
            "users": [{"id": "admin-1", "display_name": "Andy", "email": "a@example.test"}],
        }
        self.calls = []
        self.fail = set()

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):
        return _Rpc(self, name, params)


@pytest.fixture
def db(monkeypatch):
    fake = _DB(stored={t.key: t.default for t in ops_thresholds.EDITABLE})

    monkeypatch.setattr(ops_thresholds, "supabase_admin", fake)
    monkeypatch.setattr(admin_settings, "supabase_admin", fake)
    ops_thresholds.clear_cache()
    yield fake
    ops_thresholds.clear_cache()


@pytest.fixture
def client(monkeypatch, db):
    who = {"role": "admin"}

    async def require_admin(_auth):
        if who["role"] != "admin":
            raise HTTPException(403, "admin only")
        return ADMIN

    async def require_instructor(_auth):
        if who["role"] == "student":
            raise HTTPException(403, "staff only")
        return ADMIN if who["role"] == "admin" else TEACHER

    monkeypatch.setattr(admin_settings, "require_admin", require_admin)
    monkeypatch.setattr(admin_settings, "require_instructor", require_instructor)
    app = FastAPI()
    app.include_router(admin_settings.router)
    c = TestClient(app)
    c.who = who
    return c


def _by_key(body):
    return {i["key"]: i for i in body["items"]}


def _patch(client, changes, reason="Theo quy trình đối chiếu mới"):
    return client.patch("/admin/settings/thresholds", json={"changes": changes, "reason": reason},
                        headers={"Authorization": "Bearer x"})


# ── Service ─────────────────────────────────────────────────────────────────

def test_every_plan_row_is_listed_once_with_a_sane_range():
    keys = [t.key for t in ops_thresholds.THRESHOLDS]
    assert len(keys) == len(set(keys))
    assert {"score_gap_review_band", "score_gap_publish_min_papers"}.isdisjoint(keys)  # GOI-12 not open
    for t in ops_thresholds.EDITABLE:
        assert t.min <= t.max
        assert (t.default is None) == t.nullable, t.key
        assert t.default is None or t.min <= t.default <= t.max, t.key
    assert {t.key for t in ops_thresholds.THRESHOLDS if t.fixed} == {
        "audio_retention_days", "content_retention_after_expiry_days"}


def test_get_reads_stored_values_over_defaults_and_caches(db):
    asyncio.run(_test_get_reads_stored_values_over_defaults_and_caches(db))


async def _test_get_reads_stored_values_over_defaults_and_caches(db):
    db.tables["admin_settings"][0]["value"]["writing_review_hours"] = 1
    values = await ops_thresholds.get()
    assert values["writing_review_hours"] == 1 and values["regrade_hours"] == 48
    db.tables["admin_settings"][0]["value"]["writing_review_hours"] = 5
    assert (await ops_thresholds.get())["writing_review_hours"] == 1  # cached for the TTL


def test_missing_row_and_invalid_stored_values_use_the_defaults(db):
    asyncio.run(_test_missing_row_and_invalid_stored_values_use_the_defaults(db))


async def _test_missing_row_and_invalid_stored_values_use_the_defaults(db):
    db.tables["admin_settings"] = [{"key": "ops_thresholds", "value": {"inactive_days": "7", "low_credits": True}}]
    values = await ops_thresholds.get()
    assert values["inactive_days"] == 7 and values["low_credits"] == 3
    db.tables["admin_settings"] = []
    ops_thresholds.clear_cache()
    assert await ops_thresholds.get() == {t.key: t.default for t in ops_thresholds.EDITABLE}


def test_a_failed_read_serves_the_previous_copy_or_raises(db):
    asyncio.run(_test_a_failed_read_serves_the_previous_copy_or_raises(db))


async def _test_a_failed_read_serves_the_previous_copy_or_raises(db):
    db.fail.add("admin_settings")
    with pytest.raises(ops_thresholds.ThresholdsUnavailable):
        await ops_thresholds.get()
    db.fail.clear()
    await ops_thresholds.get()
    ops_thresholds._cache = (ops_thresholds._cache[0], 0.0)  # expired
    db.fail.add("admin_settings")
    assert (await ops_thresholds.get())["regrade_hours"] == 48


def test_set_many_refuses_before_writing(db):
    asyncio.run(_test_set_many_refuses_before_writing(db))


async def _test_set_many_refuses_before_writing(db):
    cases = [
        ([("writing_review_hours", 0)], "out_of_range"),
        ([("writing_review_hours", 337)], "out_of_range"),
        ([("writing_review_hours", None)], "out_of_range"),  # not a nullable row
        ([("writing_review_hours", True)], "out_of_range"),
        ([("audio_retention_days", 30)], "fixed"),
        ([("nope", 1)], "unknown_key"),
        ([("regrade_hours", 5), ("regrade_hours", 6)], "duplicate_key"),
        ([], "no_changes"),
    ]
    for changes, code in cases:
        with pytest.raises(ops_thresholds.ThresholdChangeError) as caught:
            await ops_thresholds.set_many(changes, "lý do", "admin-1")
        assert caught.value.code == code, changes
    assert db.calls == [] and db.tables["admin_settings_log"] == []


def test_set_many_merges_logs_and_refreshes_the_cache(db):
    asyncio.run(_test_set_many_merges_logs_and_refreshes_the_cache(db))


async def _test_set_many_merges_logs_and_refreshes_the_cache(db):
    await ops_thresholds.get()  # warm the cache with the old value
    values = await ops_thresholds.set_many([("writing_review_hours", 1), ("too_fast_sec_per_question", 8)],
                                           "Kiểm quá hạn", "admin-1")
    assert values["writing_review_hours"] == 1 and values["too_fast_sec_per_question"] == 8
    assert (await ops_thresholds.get())["writing_review_hours"] == 1  # no stale cache
    assert db.calls == [{"p_key": "ops_thresholds", "p_changes": {"writing_review_hours": 1,
                         "too_fast_sec_per_question": 8}, "p_reason": "Kiểm quá hạn", "p_actor": "admin-1"}]
    # A nullable row goes back to null ("tắt lý do") and stays null.
    values = await ops_thresholds.set_many([("too_fast_sec_per_question", None)], "Tắt lại", "admin-1")
    assert values["too_fast_sec_per_question"] is None


# ── Router ──────────────────────────────────────────────────────────────────

def test_get_lists_every_row_for_admin_and_teacher(client, monkeypatch):
    monkeypatch.setattr(ops_thresholds, "settings", SimpleNamespace(RETENTION_AUDIO_DAYS=60))
    for role in ("admin", "teacher"):
        client.who["role"] = role
        res = client.get("/admin/settings/thresholds", headers={"Authorization": "Bearer x"})
        assert res.status_code == 200, role
        items = _by_key(res.json())
        assert list(items) == [t.key for t in ops_thresholds.THRESHOLDS]
        assert items["writing_review_hours"] == {
            "key": "writing_review_hours", "group": "Quá hạn xử lý",
            "label": "Bài Writing chờ giáo viên duyệt (lớp offline)",
            "anchor": "từ lúc AI chấm xong (bài AI lỗi: từ lúc nộp)",
            "value": 48, "unit": "giờ", "min": 1, "max": 336, "fixed": False}
        assert items["audio_retention_days"]["fixed"] is True and items["audio_retention_days"]["value"] == 60
        # G04 has not set this one yet: shown as unknown, never guessed.
        assert items["content_retention_after_expiry_days"]["value"] is None
        assert items["too_fast_sec_per_question"]["value"] is None


def test_get_refuses_a_learner_and_reports_an_unreadable_table(client, db):
    client.who["role"] = "student"
    assert client.get("/admin/settings/thresholds").status_code == 403
    client.who["role"] = "admin"
    db.fail.add("admin_settings")
    res = client.get("/admin/settings/thresholds")
    assert res.status_code == 503 and res.json()["detail"]["code"] == "thresholds_unavailable"


def test_patch_saves_and_the_next_read_shows_it(client, db):
    res = _patch(client, [{"key": "writing_review_hours", "value": 1}])
    assert res.status_code == 200 and _by_key(res.json())["writing_review_hours"]["value"] == 1
    assert _by_key(client.get("/admin/settings/thresholds").json())["writing_review_hours"]["value"] == 1
    (log,) = db.tables["admin_settings_log"]
    assert log["actor_id"] == "admin-1" and log["reason"] == "Theo quy trình đối chiếu mới"


def test_patch_is_admin_only(client, db):
    client.who["role"] = "teacher"
    assert _patch(client, [{"key": "writing_review_hours", "value": 1}]).status_code == 403
    assert db.calls == []


def test_patch_refusals_are_422_with_a_vietnamese_sentence(client, db):
    res = _patch(client, [{"key": "writing_review_hours", "value": 0}])
    assert res.status_code == 422
    assert res.json()["detail"] == {
        "code": "out_of_range", "key": "writing_review_hours",
        "message": "“Bài Writing chờ giáo viên duyệt (lớp offline)” phải là số nguyên từ 1 đến 336."}
    nullable = _patch(client, [{"key": "many_retakes_count", "value": 1}]).json()["detail"]["message"]
    assert nullable.endswith("từ 2 đến 20 hoặc để trống.")
    assert _patch(client, [{"key": "content_retention_after_expiry_days", "value": 30}]).json()["detail"]["code"] == "fixed"
    # A string or a float is refused by the body schema, not coerced.
    assert _patch(client, [{"key": "regrade_hours", "value": "48"}]).status_code == 422
    assert _patch(client, [{"key": "regrade_hours", "value": 48.5}]).status_code == 422
    assert _patch(client, [{"key": "regrade_hours", "value": 5}], reason="   ").json()["detail"]["code"] == "reason_required"
    assert db.calls == []


def test_patch_reports_a_failed_write(client, db):
    db.fail.add("fn_admin_settings_merge")
    res = _patch(client, [{"key": "regrade_hours", "value": 5}])
    assert res.status_code == 503 and res.json()["detail"]["code"] == "settings_write_failed"


def test_log_lists_old_to_new_newest_first_with_paging(client, db, monkeypatch):
    monkeypatch.setattr(admin_settings, "_LOG_PAGE", 2)
    for hours in (12, 24, 36):
        assert _patch(client, [{"key": "regrade_hours", "value": hours}], reason=f"Đổi {hours}").status_code == 200
    first = client.get("/admin/settings/log?section=thresholds").json()
    assert [i["reason"] for i in first["items"]] == ["Đổi 36", "Đổi 24"]
    assert first["items"][0]["changes"] == [
        {"key": "regrade_hours", "label": "Yêu cầu chấm lại", "old": 24, "new": 36}]
    assert first["items"][0]["actor_name"] == "Andy" and first["items"][0]["section"] == "thresholds"
    rest = client.get(f"/admin/settings/log?cursor={first['next_cursor']}").json()
    assert [i["reason"] for i in rest["items"]] == ["Đổi 12"] and rest["next_cursor"] is None
    assert client.get("/admin/settings/log?section=payment").status_code == 422


def test_log_shows_an_unknown_actor_rather_than_failing(client, db):
    _patch(client, [{"key": "regrade_hours", "value": 5}])
    db.fail.add("users")
    (item,) = client.get("/admin/settings/log").json()["items"]
    assert item["actor_name"] is None and item["changes"][0]["new"] == 5


def test_log_is_admin_only(client):
    client.who["role"] = "teacher"
    assert client.get("/admin/settings/log").status_code == 403
