"""LIBRARY-0061 T020 (G06-T20): admin Library console API, routers/admin_library.py.

The service client is an in-memory fake; ``require_admin`` is replaced so the
tests exercise the router's own contract (the guard order itself is pinned by
test_staff_guard_inventory.py)."""

from __future__ import annotations

import copy
import json

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from routers import admin_library

ADMIN = {"id": "admin-1"}


class _Res:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], "select", None

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: r.get(col) == val)
        return self

    def in_(self, col, vals):
        self.filters.append(lambda r: r.get(col) in vals)
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def execute(self):
        if (self.table, self.op) in self.db.fail or self.table in self.db.fail:
            raise RuntimeError("db down")
        rows = self.db.tables.setdefault(self.table, [])
        if self.op == "insert":
            rows.append(copy.deepcopy(self.payload))
            return _Res([self.payload])
        hit = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            self.db.updates.append((self.table, copy.deepcopy(self.payload), [r["id"] for r in hit]))
            for r in hit:
                r.update(self.payload)
        return _Res(copy.deepcopy(hit))


class _DB:
    def __init__(self, tables):
        self.tables = tables
        self.fail: set = set()
        self.updates: list = []

    def table(self, name):
        return _Query(self, name)


TOPICS = [
    {"slug": "education", "label_vi": "Giáo dục", "shelves": ["writing", "speaking"], "display_order": 1},
    {"slug": "environment", "label_vi": "Môi trường", "shelves": ["writing"], "display_order": 2},
    {"slug": "hobbies", "label_vi": "Sở thích", "shelves": ["speaking"], "display_order": 3},
]


def _essays():
    return {b: {"text": f"Essay {b}", "word_count": 260} for b in ("7.5", "7.0", "6.0")}


def _writing(id_, *, title, task_type="task2", topic="education", published=False,
             image=None, review="revised_20261017", essays=None, delta=True):
    return {
        "id": id_, "slug": f"slug-{id_}", "title_en": title, "task_type": task_type,
        "question_type": "opinion" if task_type == "task2" else None,
        "task1_subtype": "bar" if task_type == "task1_academic" else None,
        "topic_slug": topic, "prompt_image_path": image, "source_review_status": review,
        "published": published, "published_at": "2026-11-01T00:00:00+00:00" if published else None,
        "updated_at": "2026-11-01T00:00:00+00:00",
        "essays": _essays() if essays is None else essays,
        "delta_75_70": [{"x": 1}] if delta else [], "delta_70_60": [{"y": 1}] if delta else [],
    }


def _speaking(id_, *, title, part=2, topic="hobbies", published=False, sample="An answer."):
    return {
        "id": id_, "slug": f"sp-{id_}", "part": part, "title_en": title, "title_vi": None,
        "topic_slug": topic, "video_source": None, "duration_s": None, "audio_path": "speaking/a.mp3",
        "published": published, "published_at": None, "updated_at": "2026-11-01T00:00:00+00:00",
        "sample_text": sample,
    }


@pytest.fixture
def db(monkeypatch):
    fake = _DB({
        "library_topics": copy.deepcopy(TOPICS),
        "writing_samples": [
            _writing("w1", title="Online learning", published=True),
            _writing("w2", title="Public transport"),
            _writing("w3", title="Bar chart phones", task_type="task1_academic", topic="environment"),
            _writing("w4", title="Unreviewed set", review=None),
            _writing("w5", title="Missing essays", essays={"7.5": {"text": "x"}}, delta=False),
        ],
        "speaking_samples": [
            _speaking("s1", title="Describe a hobby", published=True),
            _speaking("s2", title="Your hometown", part=1, topic=None),
        ],
        "governance_audit": [],
    })
    monkeypatch.setattr(admin_library, "supabase_admin", fake)
    return fake


@pytest.fixture
def client(monkeypatch, db):
    who = {"role": "admin"}

    async def require_admin(_auth):
        if who["role"] != "admin":
            raise HTTPException(403, "admin only")
        return ADMIN

    monkeypatch.setattr(admin_library, "require_admin", require_admin)
    app = FastAPI()
    app.include_router(admin_library.router)
    c = TestClient(app)
    c.who = who
    return c


H = {"Authorization": "Bearer x"}


def _codes(item):
    return [b["code"] for b in item["blockers"]]


# ── Guard ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("method,path,body", [
    ("get", "/admin/library/writing-samples", None),
    ("patch", "/admin/library/writing-samples/w2", {"title_en": "New title"}),
    ("post", "/admin/library/writing-samples/publish", {"ids": ["w2"], "published": True}),
    ("get", "/admin/library/speaking-samples", None),
    ("patch", "/admin/library/speaking-samples/s2", {"title_en": "New"}),
    ("post", "/admin/library/speaking-samples/publish", {"ids": ["s2"], "published": True}),
])
def test_non_admin_is_refused_before_any_read(client, db, method, path, body):
    client.who["role"] = "teacher"
    db.fail.update({"writing_samples", "speaking_samples", "library_topics"})
    kwargs = {"headers": H} | ({"json": body} if body is not None else {})
    assert getattr(client, method)(path, **kwargs).status_code == 403
    assert db.updates == [] and db.tables["governance_audit"] == []


# ── Writing list ─────────────────────────────────────────────────────────────

def test_writing_list_counts_and_blockers_come_from_the_server(client):
    body = client.get("/admin/library/writing-samples", headers=H).json()
    assert body["counts"] == {"all": 5, "published": 1, "draft": 4}
    assert body["total"] == 5 and body["page_size"] == 50
    by_id = {i["id"]: i for i in body["items"]}
    assert _codes(by_id["w2"]) == []
    assert _codes(by_id["w3"]) == ["E_FIGURE"]
    assert _codes(by_id["w4"]) == ["E_NO_REVIEW"]
    assert [t["slug"] for t in body["topics"]] == ["education", "environment"]  # writing shelf only
    assert "essays" not in by_id["w2"] and "source_review_status" not in by_id["w2"]


def test_writing_list_filters_keep_counts_of_the_filtered_scope(client):
    body = client.get("/admin/library/writing-samples?task=task1", headers=H).json()
    assert [i["id"] for i in body["items"]] == ["w3"] and body["counts"]["all"] == 1
    body = client.get("/admin/library/writing-samples?status=published", headers=H).json()
    assert [i["id"] for i in body["items"]] == ["w1"]
    assert body["counts"] == {"all": 5, "published": 1, "draft": 4}  # tab counts ignore status
    body = client.get("/admin/library/writing-samples?q=TRANSPORT", headers=H).json()
    assert [i["id"] for i in body["items"]] == ["w2"]


def test_writing_list_failure_is_503_not_empty(client, db):
    db.fail.add("writing_samples")
    r = client.get("/admin/library/writing-samples", headers=H)
    assert r.status_code == 503 and r.json()["detail"]["code"] == "library_unavailable"


# ── Writing edit ─────────────────────────────────────────────────────────────

def test_edit_title_and_topic_updates_row_and_audits(client, db):
    r = client.patch("/admin/library/writing-samples/w2", headers=H,
                     json={"title_en": "  Public transport fares ", "topic_slug": "environment"})
    assert r.status_code == 200
    assert r.json() == {"id": "w2", "changed": ["title_en", "topic_slug"], "audit_logged": True}
    row = next(x for x in db.tables["writing_samples"] if x["id"] == "w2")
    assert row["title_en"] == "Public transport fares" and row["topic_slug"] == "environment"
    assert row["updated_at"] != "2026-11-01T00:00:00+00:00"
    (audit,) = db.tables["governance_audit"]
    assert audit["action"] == "library_edit" and audit["admin_id"] == "admin-1"
    detail = json.loads(audit["detail"])
    assert detail["before"] == {"title_en": "Public transport", "topic_slug": "education"}


@pytest.mark.parametrize("payload,code", [
    ({"title_en": "Đi học"}, "invalid_title"),
    ({"title_en": "ab"}, "invalid_title"),
    ({"title_en": "x" * 71}, "invalid_title"),
    ({"title_en": "online LEARNING"}, "duplicate_title"),
    ({"topic_slug": "hobbies"}, "invalid_topic"),       # speaking-only topic
    ({"topic_slug": None}, "invalid_topic"),
    ({}, "nothing_to_change"),
])
def test_edit_rejects_invalid_values_without_writing(client, db, payload, code):
    r = client.patch("/admin/library/writing-samples/w2", headers=H, json=payload)
    assert r.status_code == 422 and r.json()["detail"]["code"] == code
    assert db.updates == [] and db.tables["governance_audit"] == []


def test_edit_unknown_id_is_404(client):
    r = client.patch("/admin/library/writing-samples/nope", headers=H, json={"title_en": "Valid title"})
    assert r.status_code == 404


def test_edit_same_value_is_a_no_op(client, db):
    r = client.patch("/admin/library/writing-samples/w2", headers=H, json={"title_en": "Public transport"})
    assert r.json()["changed"] == [] and db.updates == [] and db.tables["governance_audit"] == []


def test_edit_reports_a_failed_audit_write(client, db):
    db.fail.add(("governance_audit", "insert"))
    r = client.patch("/admin/library/writing-samples/w2", headers=H, json={"title_en": "Bus fares"})
    assert r.status_code == 200 and r.json()["audit_logged"] is False


# ── Writing publish ──────────────────────────────────────────────────────────

def test_publish_rechecks_conditions_and_returns_refusals(client, db):
    r = client.post("/admin/library/writing-samples/publish", headers=H,
                    json={"ids": ["w2", "w3", "w4", "w5", "w1", "missing", "w2"], "published": True})
    body = r.json()
    assert body["changed"] == ["w2"] and body["unchanged"] == ["w1"]
    rejected = {x["id"]: [c["code"] for c in x["reasons"]] for x in body["rejected"]}
    assert rejected == {"w3": ["E_FIGURE"], "w4": ["E_NO_REVIEW"], "w5": ["E_ESSAYS", "E_PAIR"],
                        "missing": ["E_NOT_FOUND"]}
    rows = {x["id"]: x for x in db.tables["writing_samples"]}
    assert rows["w2"]["published"] is True and rows["w2"]["published_at"]
    assert not any(rows[i]["published"] for i in ("w3", "w4", "w5"))  # refused rows untouched
    (audit,) = db.tables["governance_audit"]
    assert audit["action"] == "library_publish"
    assert json.loads(audit["detail"])["ids"] == ["w2"]


def test_publish_refuses_a_title_another_set_already_uses(client, db):
    db.tables["writing_samples"][1]["title_en"] = "Online Learning"
    body = client.post("/admin/library/writing-samples/publish", headers=H,
                       json={"ids": ["w2"], "published": True}).json()
    assert body["changed"] == [] and body["rejected"][0]["reasons"][0]["code"] == "E_NO_TITLE"
    assert db.updates == [] and db.tables["governance_audit"] == []


def test_unpublish_has_no_conditions_and_keeps_published_at(client, db):
    body = client.post("/admin/library/writing-samples/publish", headers=H,
                       json={"ids": ["w1", "w2"], "published": False}).json()
    assert body["changed"] == ["w1"] and body["unchanged"] == ["w2"] and body["rejected"] == []
    row = next(x for x in db.tables["writing_samples"] if x["id"] == "w1")
    assert row["published"] is False and row["published_at"] == "2026-11-01T00:00:00+00:00"
    assert db.tables["governance_audit"][0]["action"] == "library_unpublish"


@pytest.mark.parametrize("ids", [[], [f"id-{i}" for i in range(51)]])
def test_publish_batch_size_is_bounded(client, ids):
    r = client.post("/admin/library/writing-samples/publish", headers=H, json={"ids": ids, "published": True})
    assert r.status_code == 422


def test_publish_write_failure_is_503(client, db):
    db.fail.add(("writing_samples", "update"))
    r = client.post("/admin/library/writing-samples/publish", headers=H, json={"ids": ["w2"], "published": True})
    assert r.status_code == 503 and db.tables["governance_audit"] == []


# ── Speaking ─────────────────────────────────────────────────────────────────

def test_speaking_list_and_null_topic_is_allowed(client):
    body = client.get("/admin/library/speaking-samples", headers=H).json()
    assert body["counts"] == {"all": 2, "published": 1, "draft": 1}
    assert [i["id"] for i in body["items"]] == ["s2", "s1"]  # Part 1 before Part 2
    assert all(i["blockers"] == [] for i in body["items"])
    assert body["items"][1]["has_audio"] is True
    assert [t["slug"] for t in body["topics"]] == ["education", "hobbies"]
    assert [i["id"] for i in client.get("/admin/library/speaking-samples?part=2", headers=H).json()["items"]] == ["s1"]


def test_speaking_edit_allows_clearing_topic_but_not_a_writing_only_topic(client, db):
    r = client.patch("/admin/library/speaking-samples/s1", headers=H, json={"topic_slug": None})
    assert r.status_code == 200 and r.json()["changed"] == ["topic_slug"]
    r = client.patch("/admin/library/speaking-samples/s1", headers=H, json={"topic_slug": "environment"})
    assert r.status_code == 422


def test_speaking_publish_refuses_vietnamese_title(client, db):
    db.tables["speaking_samples"][1]["title_en"] = "Quê hương"
    body = client.post("/admin/library/speaking-samples/publish", headers=H,
                       json={"ids": ["s2"], "published": True}).json()
    assert body["changed"] == [] and body["rejected"][0]["reasons"][0]["code"] == "E_NO_TITLE"
    db.tables["speaking_samples"][1]["title_en"] = "Your hometown"
    body = client.post("/admin/library/speaking-samples/publish", headers=H,
                       json={"ids": ["s2"], "published": True}).json()
    assert body["changed"] == ["s2"]
