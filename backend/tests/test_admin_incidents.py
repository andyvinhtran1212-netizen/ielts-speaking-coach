"""G09-T07 (ADMINIA-0074 FR-070, FR-071): incident grouping and the inbox API —
services/error_log_grouping.py, services/incident_inbox.py, routers/admin_incidents.py.

The database is a small in-memory fake service client; its
``fn_incident_group_transition`` follows the SQL contract of migration 451,
whose SQL itself runs on PostgreSQL in test_migration_451_incident_groups.py.
"""

from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from routers import admin_incidents
from services import error_log_grouping as grouping
from services import incident_inbox

ADMIN = {"id": "11111111-1111-1111-1111-111111111111"}
U1 = "aaaaaaaa-0000-0000-0000-000000000001"
U2 = "aaaaaaaa-0000-0000-0000-000000000002"
NOW = datetime.now(timezone.utc)


def ago(hours: float) -> str:
    return (NOW - timedelta(hours=hours)).isoformat()


# ── fake service client ──────────────────────────────────────────────────


class _Res:
    def __init__(self, data, count=None):
        self.data, self.count = data, count


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters = db, table, []
        self.orders, self.rng, self.limit_n, self.patch, self.head, self._negate = [], None, None, None, False, False

    # chain
    def select(self, *_a, count=None, head=False):
        self.head = head
        return self

    def update(self, patch):
        self.patch = patch
        return self

    @property
    def not_(self):
        self._negate = True
        return self

    def _add(self, fn):
        negate, self._negate = self._negate, False
        self.filters.append((lambda r: not fn(r)) if negate else fn)
        return self

    def eq(self, col, val):
        return self._add(lambda r: r.get(col) == val)

    def neq(self, col, val):
        return self._add(lambda r: r.get(col) != val)

    def in_(self, col, vals):
        vals = set(vals)
        return self._add(lambda r: r.get(col) in vals)

    def lte(self, col, val):
        return self._add(lambda r: r.get(col) is not None
                         and incident_inbox._parse(r.get(col)) <= incident_inbox._parse(val))

    def is_(self, col, val):
        assert val == "null"
        return self._add(lambda r: r.get(col) is None)

    def order(self, col, desc=False):
        self.orders.append((col, desc))
        return self

    def range(self, a, b):
        self.rng = (a, b)
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def execute(self):
        if self.table in self.db.fail:
            raise RuntimeError("db down")
        rows = [r for r in self.db.tables.setdefault(self.table, []) if all(f(r) for f in self.filters)]
        if self.patch is not None:
            self.db.updates.append((self.table, len(rows)))
            for r in rows:
                r.update(self.patch)
            return _Res(copy.deepcopy(rows))
        for col, desc in reversed(self.orders):
            rows.sort(key=lambda r: (r.get(col) is None, str(r.get(col) or "")), reverse=desc)
        if self.rng:
            rows = rows[self.rng[0]:self.rng[1] + 1]
        if self.limit_n is not None:
            rows = rows[: self.limit_n]
        if self.head:
            return _Res([], count=len(rows))
        return _Res(copy.deepcopy(rows))


class _Rpc:
    def __init__(self, db, name, params):
        self.db, self.name, self.params = db, name, params

    def execute(self):
        assert self.name == "fn_incident_group_transition"
        if "incident_groups" in self.db.fail:
            raise RuntimeError("db down")
        p = self.params
        if p["p_last_seen"] is None and (p["p_closed_before"] or p["p_action"] in ("resolve", "ignore")):
            raise RuntimeError("incident_group_watermark_required")
        groups = self.db.tables.setdefault("incident_groups", [])
        g = next((r for r in groups if r["source"] == p["p_source"] and r["fingerprint"] == p["p_fingerprint"]), None)
        if g is None:
            closed = p["p_closed_before"]
            g = {"source": p["p_source"], "fingerprint": p["p_fingerprint"],
                 "status": "resolved" if closed else "new", "claimed_by": None, "claimed_at": None,
                 "resolved_by": None, "resolved_at": NOW.isoformat() if closed else None,
                 "last_seen_at": p["p_last_seen"]}
            groups.append(g)
        current, reopened = g["status"], False
        seen = incident_inbox._parse(g["last_seen_at"])
        if current in ("resolved", "ignored") and p["p_last_seen"] and incident_inbox._parse(p["p_last_seen"]) > seen:
            current, reopened = "new", True
        target = {"claim": "in_review" if current == "new" else None,
                  "resolve": "resolved" if current != "resolved" else None,
                  "ignore": "ignored" if current != "ignored" else None,
                  "reopen": "new" if current in ("resolved", "ignored") else None}[p["p_action"]]
        notes = self.db.tables.setdefault("incident_group_notes", [])

        def note(body, auto, actor):
            notes.append({"id": len(notes) + 1, "source": g["source"], "fingerprint": g["fingerprint"],
                          "body": body, "auto": auto, "actor_id": actor, "created_at": NOW.isoformat()})
        if reopened and target:
            note("Tự mở lại: có ghi nhận mới sau khi nhóm được đóng.", True, None)
        if target:
            g["status"] = target
            if target == "in_review":
                g["claimed_by"], g["claimed_at"] = p["p_actor"], NOW.isoformat()
            g["resolved_at"] = NOW.isoformat() if target in ("resolved", "ignored") else None
            if p["p_last_seen"] and (not g["last_seen_at"] or incident_inbox._parse(p["p_last_seen"])
                                     > incident_inbox._parse(g["last_seen_at"])):
                g["last_seen_at"] = p["p_last_seen"]
            note({"in_review": "Nhận xử lý.", "resolved": "Đánh dấu đã xử lý.",
                  "ignored": "Bỏ qua nhóm.", "new": "Mở lại nhóm."}[target], True, p["p_actor"])
        if p["p_note"]:
            note(p["p_note"], False, p["p_actor"])
        return _Res({"status": target or current, "changed": target is not None, "reopened": reopened})


class FakeDB:
    def __init__(self):
        self.tables: dict[str, list] = {"users": [
            {"id": ADMIN["id"], "display_name": "Andy", "email": "a@example.test"},
            {"id": U1, "display_name": "Minh Anh", "email": "u1@example.test"},
            {"id": U2, "display_name": "", "email": "u2@example.test"},
        ]}
        self.fail: set[str] = set()
        self.updates: list = []

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):
        return _Rpc(self, name, params)


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()
    monkeypatch.setattr(incident_inbox, "supabase_admin", fake)

    async def _admin(_authorization):
        return ADMIN

    async def _thresholds():
        return {"incident_unclaimed_hours": 24, "feedback_unanswered_hours": 72}

    monkeypatch.setattr(admin_incidents, "require_admin", _admin)
    monkeypatch.setattr(admin_incidents.ops_thresholds, "get", _thresholds)
    return fake


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(admin_incidents.router)
    return TestClient(app)


def err(i, message, url="/practice/session?session_id=x", user=U1, at=None, dismissed=None, level="error"):
    return {"id": f"e{i:05d}", "occurred_at": at or ago(1 + i / 1000), "level": level, "source": "frontend",
            "message": message, "url": url, "user_id": user, "dismissed_at": dismissed}


# ── grouping rules ───────────────────────────────────────────────────────


def test_two_errors_that_differ_only_in_ids_share_a_group():
    a = err(1, "Session 3f1c2a9e-1b2c-4d5e-8f90-1234567890ab not found (code 42)",
            url="https://www.averlearning.com/classes/12/lessons/3f1c2a9e-1b2c-4d5e-8f90-1234567890ab?x=1")
    b = err(2, "Session 9a8b7c6d-1b2c-4d5e-8f90-abcdefabcdef not found (code 7)",
            url="/classes/99/lessons/9a8b7c6d-1b2c-4d5e-8f90-abcdefabcdef")
    c = err(3, "Session 9a8b7c6d-1b2c-4d5e-8f90-abcdefabcdef not found (code 7)", url="/v2/other")
    groups = grouping.group_errors([a, b, c])
    assert len(groups) == 2
    shared = next(g for g in groups.values() if g.count == 2)
    assert shared.technical["path"] == "/classes/:id/lessons/:id"
    assert shared.technical["message"] == "Session ? not found (code ?)"
    assert len(shared.fingerprint) == 40 and shared.learner_ids == {U1}
    assert grouping.normalize_path("/api/v2/x") == "/api/v2/x"     # digits inside a segment stay


def test_quoted_strings_are_replaced_and_level_splits_groups():
    assert grouping.normalize_message("Cannot read 'title' of \"undefined\" at 12") == "Cannot read ? of ? at ?"
    groups = grouping.group_errors([err(1, "boom"), err(2, "boom", level="warning")])
    assert len(groups) == 2


def test_feedback_groups_skip_answer_reports_and_good_ratings():
    rows = [
        {"id": "f1", "type": "report", "skill": "reading", "test_id": "T1", "status": "new", "created_at": ago(1)},
        {"id": "f2", "type": "rating", "skill": "reading", "test_id": "T1", "rating_de": 5, "status": "new",
         "created_at": ago(1)},
        {"id": "f3", "type": "rating", "skill": "reading", "test_id": "T1", "rating_de": 2, "status": "new",
         "created_by": U1, "created_at": ago(2)},
        {"id": "f4", "type": "rating", "skill": "listening", "test_id": "L1", "rating_de": 4, "rating_audio": 1,
         "status": "new", "created_by": U2, "created_at": ago(3)},
        {"id": "f5", "type": "flag", "skill": "reading", "test_id": "T1", "status": "resolved",
         "created_at": ago(4)},
    ]
    groups = grouping.group_feedback(rows)
    reasons = sorted((g.technical["skill"], g.technical["reason"], g.count) for g in groups.values())
    assert reasons == [("listening", "rating_low", 1), ("reading", "flag", 1), ("reading", "rating_low", 1)]


def test_grading_groups_by_step_and_kind():
    s1 = {"id": "s1", "user_id": U1, "mode": "practice", "part": 2, "error_code": "stt_failed",
          "failed_step": "transcribe", "last_error_at": ago(2)}
    s2 = {"id": "s2", "user_id": U2, "mode": "practice", "part": 2, "error_code": "stt_failed",
          "failed_step": "transcribe", "last_error_at": ago(1)}
    s3 = {"id": "s3", "user_id": U1, "mode": "test_full", "part": 1, "status": "grading_failed", "started_at": ago(5)}
    groups = grouping.group_grading([s1, s2, s3], [({"id": "r1", "stt_status": "ok"}, s3)])
    by = {(g.technical["step"], g.technical["kind"]): g for g in groups.values()}
    assert by[("transcribe", "practice:part2")].count == 2
    assert by[("transcribe", "practice:part2")].area == "Chấm Speaking · Luyện tập · Part 2"
    assert by[("grading_failed", "test_full:part1")].count == 1
    assert by[("grading", "test_full:part1")].count == 1


# ── list ─────────────────────────────────────────────────────────────────


def test_list_groups_counts_learners_and_defaults_to_open(client, db):
    db.tables["error_logs"] = [err(1, "boom 1", user=U1), err(2, "boom 2", user=U2), err(3, "other", user=None),
                               err(4, "old", dismissed=ago(1))]
    db.tables["user_feedback"] = [
        {"id": "f1", "type": "report", "skill": "reading", "test_id": "T1", "status": "new", "created_at": ago(1)},
        {"id": "f2", "type": "report", "skill": "reading", "test_id": "T1", "status": "resolved", "created_at": ago(1)},
    ]
    body = client.get("/admin/incidents/groups").json()
    assert body["counts"] == {"errors": 2, "grading": 0, "feedback": 0}
    assert body["review_items_open"] == 1
    assert body["sources_failed"] == [] and body["truncated"] is False
    first = body["items"][0]
    assert (first["count"], first["learners"], first["status"]) == (2, 2, "new")
    # A group whose every row was dismissed one by one on the old page is closed.
    assert body["total"] == 2
    closed = client.get("/admin/incidents/groups?status=resolved").json()
    assert [i["title"] for i in closed["items"]] == ["old"]


def test_one_failed_source_still_returns_the_others(client, db):
    db.tables["error_logs"] = [err(1, "boom")]
    db.fail.add("user_feedback")
    res = client.get("/admin/incidents/groups")
    assert res.status_code == 200
    body = res.json()
    assert body["sources_failed"] == ["feedback"]
    assert body["counts"]["feedback"] is None and body["counts"]["errors"] == 1
    assert body["review_items_open"] is None


def test_scan_stops_at_the_limit_and_says_truncated(client, db, monkeypatch):
    monkeypatch.setattr(incident_inbox, "SCAN_LIMIT", 5)
    monkeypatch.setattr(incident_inbox, "_READ_PAGE", 2)
    db.tables["error_logs"] = [err(i, "boom") for i in range(7)]
    body = client.get("/admin/incidents/groups").json()
    assert body["truncated"] is True and body["sources_truncated"] == ["errors"]
    assert body["items"][0]["count"] == 5


def test_overdue_follows_the_unclaimed_threshold(client, db):
    db.tables["error_logs"] = [err(1, "new one", at=ago(2)), err(2, "stale", at=ago(30))]
    items = {i["title"]: i for i in client.get("/admin/incidents/groups").json()["items"]}
    assert items["new one"]["overdue"] is False and items["stale"]["overdue"] is True


# ── bulk + state ─────────────────────────────────────────────────────────


def _only(client, **params):
    items = client.get("/admin/incidents/groups", params=params).json()["items"]
    assert len(items) == 1
    return items[0]


def test_resolved_group_with_a_new_record_reopens_and_keeps_notes(client, db):
    db.tables["error_logs"] = [err(1, "boom", at=ago(3)), err(2, "boom", at=ago(2))]
    group = _only(client)
    ref = {"source": "errors", "fingerprint": group["fingerprint"], "expected_count": 2}
    res = client.post("/admin/incidents/groups/bulk",
                      json={"groups": [ref], "action": "resolve", "note": "Đã sửa"})
    assert res.status_code == 200 and res.json() == {"changed": 1, "conflicts": [], "dismiss_failed": []}
    assert client.get("/admin/incidents/groups").json()["items"] == []
    # Every undismissed row of the group was dismissed with the group.
    assert all(r["dismissed_at"] for r in db.tables["error_logs"])

    # Older than the click, newer than the newest record the resolve was checked against.
    db.tables["error_logs"].append(err(3, "boom", at=ago(1)))
    reopened = _only(client)
    assert reopened["status"] == "new" and reopened["count"] == 3
    detail = client.get(f"/admin/incidents/groups/errors/{group['fingerprint']}").json()
    assert [n["body"] for n in detail["notes"]] == ["Đã sửa", "Đánh dấu đã xử lý."]   # newest first
    assert detail["notes"][1]["actor_name"] == "Andy" and detail["notes"][1]["auto"] is True


def test_reopening_a_group_closed_row_by_row_on_the_old_page(client, db):
    db.tables["error_logs"] = [err(1, "old", dismissed=ago(1))]
    group = _only(client, status="resolved")
    res = client.post("/admin/incidents/groups/bulk", json={
        "groups": [{"source": "errors", "fingerprint": group["fingerprint"], "expected_count": 1}],
        "action": "reopen"})
    assert res.json()["changed"] == 1
    assert _only(client)["status"] == "new"


def test_count_changed_is_a_409_and_nothing_changes(client, db):
    db.tables["error_logs"] = [err(1, "boom"), err(2, "boom")]
    fp = _only(client)["fingerprint"]
    res = client.post("/admin/incidents/groups/bulk", json={
        "groups": [{"source": "errors", "fingerprint": fp, "expected_count": 1}], "action": "resolve"})
    assert res.status_code == 409
    assert res.json()["conflicts"] == [{"source": "errors", "fingerprint": fp, "status": 409,
                                        "code": "count_changed", "expected_count": 1, "actual_count": 2,
                                        "expected_last_at": None, "actual_last_at": ago(1.001)}]
    assert db.tables.get("incident_groups", []) == []
    assert not any(r["dismissed_at"] for r in db.tables["error_logs"])


def test_mixed_bulk_changes_the_matching_groups_and_reports_the_rest(client, db):
    db.tables["error_logs"] = [err(1, "a"), err(2, "b")]
    items = client.get("/admin/incidents/groups").json()["items"]
    refs = [{"source": "errors", "fingerprint": i["fingerprint"], "expected_count": i["count"]} for i in items]
    refs[1]["expected_count"] = 9
    refs.append({"source": "errors", "fingerprint": "f" * 40, "expected_count": 1})
    res = client.post("/admin/incidents/groups/bulk", json={"groups": refs, "action": "claim"})
    assert res.status_code == 200
    body = res.json()
    assert body["changed"] == 1
    assert sorted(c["code"] for c in body["conflicts"]) == ["count_changed", "not_found"]
    claimed = client.get("/admin/incidents/groups?status=in_review").json()["items"]
    assert len(claimed) == 1 and claimed[0]["claimed_by_name"] == "Andy"


def test_resolve_dismisses_error_rows_in_batches_of_200(client, db):
    db.tables["error_logs"] = [err(i, "boom") for i in range(450)]
    fp = _only(client)["fingerprint"]
    client.post("/admin/incidents/groups/bulk", json={
        "groups": [{"source": "errors", "fingerprint": fp, "expected_count": 450}], "action": "resolve"})
    assert db.updates == [("error_logs", 200), ("error_logs", 200), ("error_logs", 50)]


def test_a_failed_dismissal_is_reported_not_swallowed(client, db, monkeypatch):
    db.tables["error_logs"] = [err(1, "boom")]
    fp = _only(client)["fingerprint"]

    def boom(*_a):
        raise RuntimeError("db down")
    monkeypatch.setattr(incident_inbox, "dismiss_error_rows", boom)
    body = client.post("/admin/incidents/groups/bulk", json={
        "groups": [{"source": "errors", "fingerprint": fp, "expected_count": 1}], "action": "resolve"}).json()
    assert body["changed"] == 1 and body["dismiss_failed"] == [fp]


def test_grading_and_feedback_groups_are_not_dismissed_row_by_row(client, db):
    db.tables["sessions"] = [{"id": "s1", "user_id": U1, "mode": "practice", "part": 2, "error_code": "stt_failed",
                              "failed_step": "transcribe", "last_error_at": ago(1), "started_at": ago(2),
                              "status": "failed"}]
    db.tables["responses"] = [{"id": "r1", "session_id": "s1", "stt_status": "failed", "grading_status": "failed",
                               "recorded_at": ago(1)}]
    group = _only(client, source="grading")
    assert group["count"] == 1        # the response of an already listed session is not counted twice
    client.post("/admin/incidents/groups/bulk", json={
        "groups": [{"source": "grading", "fingerprint": group["fingerprint"], "expected_count": 1}],
        "action": "ignore"})
    assert db.updates == []
    assert client.get("/admin/incidents/groups?source=grading&status=ignored").json()["total"] == 1


# ── detail ───────────────────────────────────────────────────────────────


def test_detail_links_learners_and_404s_an_unknown_group(client, db):
    db.tables["error_logs"] = [err(1, "boom", user=U1), err(2, "boom", user=U2)]
    fp = _only(client)["fingerprint"]
    detail = client.get(f"/admin/incidents/groups/errors/{fp}").json()
    assert sorted((l["ref"], l["name"]) for l in detail["learner_list"]) == [
        (f"u-{U1}", "Minh Anh"), (f"u-{U2}", "u2@example.test")]
    assert detail["technical"]["path"] == "/practice/session"
    assert "2 lần ghi nhận, 2 học viên" in detail["description"]
    assert detail["notes"] == []
    assert client.get(f"/admin/incidents/groups/errors/{'0' * 40}").status_code == 404


def test_bulk_refuses_a_malformed_fingerprint(client, db):
    res = client.post("/admin/incidents/groups/bulk", json={
        "groups": [{"source": "errors", "fingerprint": "nope", "expected_count": 1}], "action": "claim"})
    assert res.status_code == 422


def test_every_route_awaits_the_admin_guard(monkeypatch, db):
    async def refuse(_authorization):
        raise HTTPException(403, "admin only")
    monkeypatch.setattr(admin_incidents, "require_admin", refuse)
    app = FastAPI()
    app.include_router(admin_incidents.router)
    c = TestClient(app)
    assert c.get("/admin/incidents/groups").status_code == 403
    assert c.get(f"/admin/incidents/groups/errors/{'a' * 40}").status_code == 403
    assert c.post("/admin/incidents/groups/bulk", json={
        "groups": [{"source": "errors", "fingerprint": "a" * 40, "expected_count": 0}],
        "action": "claim"}).status_code == 403


# ── CR R1 (#2516) ────────────────────────────────────────────────────────


def test_a_record_written_between_the_check_and_the_resolve_reopens(client, db, monkeypatch):
    """B1: the watermark is the checked snapshot's newest record, not now()."""
    db.tables["error_logs"] = [err(1, "boom", at=ago(3))]
    fp = _only(client)["fingerprint"]
    real = incident_inbox.transition

    def racing(*args, **kwargs):
        db.tables["error_logs"].append(err(2, "boom", at=ago(0.5)))   # lands after the count check
        return real(*args, **kwargs)
    monkeypatch.setattr(incident_inbox, "transition", racing)
    res = client.post("/admin/incidents/groups/bulk", json={
        "groups": [{"source": "errors", "fingerprint": fp, "expected_count": 1}], "action": "ignore"})
    assert res.json()["changed"] == 1
    stored = db.tables["incident_groups"][0]
    assert stored["last_seen_at"] == ago(3) and stored["resolved_at"] > ago(0.5)
    group = _only(client)
    assert (group["status"], group["count"]) == ("new", 2)


def test_a_response_failure_carries_the_responses_own_time(client, db):
    """B2: not the session's last_error_at/started_at."""
    session = {"id": "s9", "user_id": U1, "mode": "practice", "part": 1, "status": "completed",
               "started_at": ago(300), "last_error_at": None, "error_code": None}
    groups = grouping.group_grading([], [({"id": "r9", "stt_status": "ok", "recorded_at": ago(2)}, session)])
    assert next(iter(groups.values())).times == [ago(2)]
    regraded = grouping.group_grading([], [({"id": "r9", "stt_status": "ok", "recorded_at": ago(50),
                                             "last_regraded_at": ago(1)}, session)])
    assert next(iter(regraded.values())).times == [ago(1)]
    persisted = grouping.group_grading([], [({"id": "r9", "stt_status": "ok", "persisted_at": ago(3)}, session)])
    assert next(iter(persisted.values())).times == [ago(3)]
    db.tables["sessions"] = [session]
    db.tables["responses"] = [{"id": "r9", "session_id": "s9", "stt_status": "ok", "grading_status": "failed",
                               "recorded_at": ago(2)}]
    item = _only(client, source="grading")
    assert item["last_at"] == ago(2) and item["overdue"] is False   # 300 h old session, 2 h old failure


def test_a_truncated_source_checks_the_last_record_not_the_count(client, db, monkeypatch):
    """M1: past the scan limit a group's count shifts as other rows push it out."""
    monkeypatch.setattr(incident_inbox, "SCAN_LIMIT", 4)
    db.tables["error_logs"] = [err(1, "a", at=ago(1)), err(2, "a", at=ago(2)),
                               err(3, "b", at=ago(3)), err(4, "b", at=ago(4)), err(5, "b", at=ago(5))]
    items = {i["title"]: i for i in client.get("/admin/incidents/groups").json()["items"]}
    b = items["b"]
    assert b["count"] == 2
    db.tables["error_logs"].append(err(6, "a", at=ago(0.5)))     # pushes one "b" out of the window
    ref = {"source": "errors", "fingerprint": b["fingerprint"], "expected_count": 2,
           "expected_last_at": b["last_at"]}
    res = client.post("/admin/incidents/groups/bulk", json={"groups": [ref], "action": "claim"})
    assert res.status_code == 200 and res.json()["changed"] == 1
    a = items["a"]
    ref = {"source": "errors", "fingerprint": a["fingerprint"], "expected_count": a["count"] + 1,
           "expected_last_at": a["last_at"]}
    res = client.post("/admin/incidents/groups/bulk", json={"groups": [ref], "action": "claim"})
    assert res.status_code == 409
    conflict = res.json()["conflicts"][0]
    assert conflict["code"] == "count_changed" and conflict["actual_last_at"] == ago(0.5)


def test_resolving_a_truncated_errors_group_dismisses_rows_past_the_window(client, db, monkeypatch):
    """Nit c: every undismissed row of the group, not only the scanned ones."""
    monkeypatch.setattr(incident_inbox, "SCAN_LIMIT", 3)
    db.tables["error_logs"] = [err(i, "boom", at=ago(i)) for i in range(1, 7)]
    g = _only(client)
    client.post("/admin/incidents/groups/bulk", json={"groups": [
        {"source": "errors", "fingerprint": g["fingerprint"], "expected_count": 3,
         "expected_last_at": g["last_at"]}], "action": "resolve"})
    assert all(r["dismissed_at"] for r in db.tables["error_logs"])


def test_staff_accounts_are_not_counted_as_learners(client, db):
    """Nit a."""
    db.tables["users"][0]["role"] = "admin"
    db.tables["error_logs"] = [err(1, "boom", user=U1), err(2, "boom", user=ADMIN["id"])]
    item = _only(client)
    assert (item["count"], item["learners"]) == (2, 1)


def test_http_status_codes_split_groups():
    """Nit b: a 500 and a 404 are different incidents; other numbers still merge."""
    assert grouping.normalize_message("Request failed with status code 500") != \
        grouping.normalize_message("Request failed with status code 404")
    assert grouping.normalize_message("HTTP 503 for item 12") == "HTTP 503 for item ?"
    assert grouping.normalize_message("404 Not Found") == "404 Not Found"
    assert grouping.normalize_message("took 250 ms") == "took ? ms"


def test_closing_a_group_with_no_record_time_is_refused_before_writing(client, db):
    db.tables["incident_groups"] = [{"source": "errors", "fingerprint": "c" * 40, "status": "in_review",
                                     "resolved_at": None, "last_seen_at": None}]
    res = client.post("/admin/incidents/groups/bulk", json={
        "groups": [{"source": "errors", "fingerprint": "c" * 40, "expected_count": 0}], "action": "resolve"})
    assert res.status_code == 409 and res.json()["conflicts"][0]["code"] == "not_found"
    assert db.tables["incident_groups"][0]["status"] == "in_review"


def test_a_truncated_resolve_dismisses_old_rows_but_not_one_after_the_check(client, db, monkeypatch):
    """B3 (R2): rows past the scan window up to the watermark are dismissed; a row
    that lands after the check stays open and the group reads new."""
    monkeypatch.setattr(incident_inbox, "SCAN_LIMIT", 2)
    db.tables["error_logs"] = [err(i, "boom", at=ago(i)) for i in range(1, 5)]   # 3 and 4: outside the window
    g = _only(client)
    real = incident_inbox.transition

    def racing(*args, **kwargs):
        db.tables["error_logs"].append(err(9, "boom", at=ago(0.5)))
        return real(*args, **kwargs)
    monkeypatch.setattr(incident_inbox, "transition", racing)
    res = client.post("/admin/incidents/groups/bulk", json={"groups": [
        {"source": "errors", "fingerprint": g["fingerprint"], "expected_count": 2,
         "expected_last_at": g["last_at"]}], "action": "resolve"})
    assert res.json()["changed"] == 1
    open_ids = [r["id"] for r in db.tables["error_logs"] if not r["dismissed_at"]]
    assert open_ids == ["e00009"]
    assert _only(client)["status"] == "new"
