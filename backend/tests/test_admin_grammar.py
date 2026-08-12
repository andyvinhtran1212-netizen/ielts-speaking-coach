"""Tests for Sprint 12.7 — admin Grammar endpoints.

Surfaces under test (routers/admin.py):
    GET  /admin/grammar/articles                     — list with FS + DB JOIN
    GET  /admin/grammar/articles/{slug}/preview      — full article body
    GET  /admin/grammar/analytics                    — aggregate stats
    POST /admin/grammar/recommend-test               — dogfood matcher

The grammar surfaces consume in-memory state from
`services.grammar_content.grammar_service`. Tests monkeypatch the live
singleton with a tiny in-memory fixture so we don't depend on the
real 132-article filesystem corpus.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


# ── In-memory fakes ──────────────────────────────────────────────────


class _Resp:
    def __init__(self, data):
        self.data = data


class _TableQuery:
    def __init__(self, fake, table_name):
        self.fake = fake
        self.table_name = table_name
        self.in_filter: tuple[str, list] | None = None
        self.gt_filter: tuple[str, str] | None = None
        self.limit_value: int | None = None

    def select(self, *_args, **_kw):
        return self

    def in_(self, field, values):
        self.in_filter = (field, list(values))
        return self

    def order(self, *_args, **_kw):
        return self

    def gt(self, field, value):
        self.gt_filter = (field, value)
        return self

    def limit(self, value):
        self.limit_value = value
        return self

    def execute(self):
        rows = self.fake.tables.get(self.table_name, [])
        if self.in_filter:
            f, vals = self.in_filter
            rows = [r for r in rows if r.get(f) in vals]
        rows = sorted(rows, key=lambda row: str(row.get("id") or ""))
        if self.gt_filter:
            field, value = self.gt_filter
            rows = [row for row in rows if str(row.get(field) or "") > str(value)]
        # Match the hosted PostgREST cap so a test without explicit pagination
        # cannot accidentally pass against this fake.
        rows = rows[:self.limit_value or 1000]
        return _Resp(rows)


class _FakeSupabase:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {
            "article_views":  [],
            "saved_articles": [],
        }
        self.fail_tables: set[str] = set()

    def table(self, name):
        if name in self.fail_tables:
            raise RuntimeError(f"{name} unavailable")
        return _TableQuery(self, name)


class _FakeGrammarService:
    """Mimic the subset of GrammarContentService that admin endpoints use."""

    def __init__(self, articles: list[dict]):
        self.articles_by_slug = {a["slug"]: a for a in articles}

    def get_article_by_slug(self, slug: str):
        return self.articles_by_slug.get(slug)

    def find_best_match(self, issue: str):
        # Trivial deterministic matcher for tests: exact substring on title.
        for a in self.articles_by_slug.values():
            if issue.strip().lower() in (a.get("title") or "").lower():
                return {
                    "slug":     a["slug"],
                    "category": a.get("category"),
                    "title":    a.get("title"),
                    "score":    0.9,
                }
        return None


_ARTICLES = [
    {
        "slug":     "past-perfect",
        "title":    "Past Perfect Tense",
        "category": "tenses",
        "summary":  "When to reach for past perfect in IELTS speaking.",
        "band":     7.0,
        "order":    1,
        "tags":     ["tense", "past"],
        "html":     "<h1>Past Perfect</h1><p>Body.</p>",
    },
    {
        "slug":     "modal-verbs",
        "title":    "Modal Verbs for Hedging",
        "category": "verb-patterns",
        "summary":  "Soft opinions via modals.",
        "band":     6.5,
        "order":    2,
        "tags":     ["modal", "hedging"],
        "html":     "<h1>Modals</h1><p>Body.</p>",
    },
    {
        "slug":     "relative-clauses",
        "title":    "Relative Clauses",
        "category": "sentence-structures",
        "summary":  "Stretching sentences with which/who/that.",
        "band":     7.5,
        "order":    3,
        "tags":     ["complex"],
        "html":     "<h1>Relatives</h1><p>Body.</p>",
    },
]

_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa"}
_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}


@pytest.fixture
def fake_db(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr("routers.admin.supabase_admin", fake)
    return fake


@pytest.fixture
def fake_service(monkeypatch):
    svc = _FakeGrammarService(_ARTICLES)
    monkeypatch.setattr("services.grammar_content.grammar_service", svc)
    return svc


@pytest.fixture
def client(fake_db, fake_service):
    from main import app
    with patch("routers.admin.require_admin", new=AsyncMock(return_value=_ADMIN_USER)):
        with TestClient(app) as c:
            yield c


# ── GET /admin/grammar/articles ───────────────────────────────────


class TestArticlesList:
    def test_list_returns_all_articles(self, client):
        r = client.get("/admin/grammar/articles", headers=_ADMIN_AUTH)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total"] == 3
        slugs = [i["slug"] for i in body["items"]]
        assert set(slugs) == {"past-perfect", "modal-verbs", "relative-clauses"}

    def test_returns_categories_sorted(self, client):
        r = client.get("/admin/grammar/articles", headers=_ADMIN_AUTH)
        cats = r.json()["categories"]
        assert cats == sorted(set(a["category"] for a in _ARTICLES))

    def test_filter_by_category(self, client):
        r = client.get("/admin/grammar/articles?category=tenses", headers=_ADMIN_AUTH)
        body = r.json()
        assert body["total"] == 1
        assert body["available_total"] == 3
        assert body["categories"] == sorted(set(a["category"] for a in _ARTICLES))
        assert body["items"][0]["slug"] == "past-perfect"

    def test_search_by_title_substring(self, client):
        r = client.get("/admin/grammar/articles?search=modal", headers=_ADMIN_AUTH)
        body = r.json()
        assert body["total"] == 1
        assert body["items"][0]["slug"] == "modal-verbs"

    def test_view_count_hydration_aggregates_per_slug(self, client, fake_db):
        fake_db.tables["article_views"] = [
            {"article_slug": "past-perfect", "view_count": 4},
            {"article_slug": "past-perfect", "view_count": 7},  # second user
            {"article_slug": "modal-verbs",  "view_count": 2},
        ]
        fake_db.tables["saved_articles"] = [
            {"article_slug": "past-perfect"},
        ]
        r = client.get("/admin/grammar/articles", headers=_ADMIN_AUTH)
        items = {i["slug"]: i for i in r.json()["items"]}
        assert items["past-perfect"]["view_count"] == 11
        assert items["past-perfect"]["save_count"] == 1
        assert items["modal-verbs"]["view_count"] == 2
        assert items["modal-verbs"]["save_count"] == 0

    def test_source_path_carries_category_and_slug(self, client):
        r = client.get("/admin/grammar/articles?category=tenses", headers=_ADMIN_AUTH)
        item = r.json()["items"][0]
        assert item["source_path"] == "backend/content/tenses/past-perfect.md"

    def test_analytics_failure_is_explicit_and_never_becomes_false_zero(self, client, fake_db):
        fake_db.fail_tables.add("article_views")
        r = client.get("/admin/grammar/articles", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        body = r.json()
        assert body["analytics_status"] == {"views": "unavailable", "saves": "complete"}
        assert all(item["view_count"] is None for item in body["items"])
        assert all(item["save_count"] == 0 for item in body["items"])

    def test_analytics_reads_every_postgrest_page_before_marking_complete(self, client, fake_db):
        fake_db.tables["article_views"] = [
            {"id": f"view-{index:04d}", "article_slug": "past-perfect", "view_count": 1}
            for index in range(1205)
        ]
        fake_db.tables["saved_articles"] = [
            {"id": f"save-{index:04d}", "article_slug": "past-perfect"}
            for index in range(1107)
        ]
        r = client.get("/admin/grammar/articles?category=tenses", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        body = r.json()
        assert body["analytics_status"] == {"views": "complete", "saves": "complete"}
        assert body["items"][0]["view_count"] == 1205
        assert body["items"][0]["save_count"] == 1107


# ── GET /admin/grammar/articles/{slug}/preview ────────────────────


class TestArticlePreview:
    def test_preview_returns_full_article(self, client):
        r = client.get("/admin/grammar/articles/past-perfect/preview", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        body = r.json()
        assert body["slug"] == "past-perfect"
        assert "Past Perfect" in body["html"]

    def test_preview_missing_slug_returns_404(self, client):
        r = client.get("/admin/grammar/articles/does-not-exist/preview", headers=_ADMIN_AUTH)
        assert r.status_code == 404


# ── GET /admin/grammar/analytics ──────────────────────────────────


class TestAnalytics:
    def test_empty_db_returns_zero_view_for_all(self, client):
        r = client.get("/admin/grammar/analytics", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        body = r.json()
        assert body["views_total"] == 0
        assert body["saves_total"] == 0
        # All 3 articles are zero-view since DB is empty.
        assert body["zero_view_total"] == 3
        assert body["articles_total"] == 3
        assert body["analytics_status"] == {
            "views": "complete", "recent_activity": "complete", "saves": "complete"
        }

    def test_aggregates_views_and_saves(self, client, fake_db):
        fake_db.tables["article_views"] = [
            {"article_slug": "past-perfect", "view_count": 5, "last_viewed_at": "2099-01-01T00:00:00+00:00"},
            {"article_slug": "modal-verbs",  "view_count": 3, "last_viewed_at": "2099-01-01T00:00:00+00:00"},
        ]
        fake_db.tables["saved_articles"] = [
            {"article_slug": "past-perfect"},
            {"article_slug": "past-perfect"},
            {"article_slug": "modal-verbs"},
        ]
        r = client.get("/admin/grammar/analytics?days=30", headers=_ADMIN_AUTH)
        body = r.json()
        assert body["views_total"] == 8
        assert body["saves_total"] == 3
        # The schema stores one cumulative row per learner/article, not events.
        assert body["active_view_records_recent"] == 2
        assert body["recent_activity_basis"] == "user_article_records_with_last_viewed_at_in_window"
        # relative-clauses has no views → zero-view
        assert body["zero_view_total"] == 1
        zero_slugs = [r["slug"] for r in body["zero_view_slugs"]]
        assert "relative-clauses" in zero_slugs

    def test_top_viewed_sorted_descending(self, client, fake_db):
        fake_db.tables["article_views"] = [
            {"article_slug": "past-perfect",     "view_count": 2, "last_viewed_at": "2099-01-01T00:00:00+00:00"},
            {"article_slug": "modal-verbs",      "view_count": 8, "last_viewed_at": "2099-01-01T00:00:00+00:00"},
            {"article_slug": "relative-clauses", "view_count": 5, "last_viewed_at": "2099-01-01T00:00:00+00:00"},
        ]
        r = client.get("/admin/grammar/analytics", headers=_ADMIN_AUTH)
        top = r.json()["top_viewed"]
        assert [t["slug"] for t in top] == ["modal-verbs", "relative-clauses", "past-perfect"]

    def test_reads_every_postgrest_page_before_marking_sources_complete(self, client, fake_db):
        fake_db.tables["article_views"] = [
            {
                "id": f"view-{index:04d}",
                "article_slug": "past-perfect",
                "view_count": 1,
                "last_viewed_at": "2099-01-01T00:00:00+00:00",
            }
            for index in range(1205)
        ]
        fake_db.tables["saved_articles"] = [
            {"id": f"save-{index:04d}", "article_slug": "past-perfect"}
            for index in range(1107)
        ]
        body = client.get("/admin/grammar/analytics", headers=_ADMIN_AUTH).json()
        assert body["analytics_status"] == {
            "views": "complete", "recent_activity": "complete", "saves": "complete"
        }
        assert body["views_total"] == 1205
        assert body["active_view_records_recent"] == 1205
        assert body["saves_total"] == 1107

    def test_source_failure_is_unknown_not_false_zero(self, client, fake_db):
        fake_db.fail_tables.add("article_views")
        body = client.get("/admin/grammar/analytics", headers=_ADMIN_AUTH).json()
        assert body["analytics_status"] == {
            "views": "unavailable", "recent_activity": "unavailable", "saves": "complete"
        }
        assert body["views_total"] is None
        assert body["active_view_records_recent"] is None
        assert body["top_viewed"] is None
        assert body["zero_view_total"] is None
        assert body["zero_view_slugs"] is None
        assert body["saves_total"] == 0

    def test_invalid_activity_timestamp_only_degrades_window_metric(self, client, fake_db):
        fake_db.tables["article_views"] = [{
            "id": "view-invalid", "article_slug": "past-perfect", "view_count": 4,
            "last_viewed_at": "not-a-timestamp",
        }]
        body = client.get("/admin/grammar/analytics", headers=_ADMIN_AUTH).json()
        assert body["analytics_status"]["views"] == "complete"
        assert body["analytics_status"]["recent_activity"] == "unavailable"
        assert body["views_total"] == 4
        assert body["active_view_records_recent"] is None

    @pytest.mark.parametrize("bad_count", [None, -1])
    def test_invalid_view_count_degrades_view_source(self, client, fake_db, bad_count):
        fake_db.tables["article_views"] = [{
            "id": "view-invalid", "article_slug": "past-perfect", "view_count": bad_count,
            "last_viewed_at": "2099-01-01T00:00:00+00:00",
        }]
        body = client.get("/admin/grammar/analytics", headers=_ADMIN_AUTH).json()
        assert body["analytics_status"]["views"] == "unavailable"
        assert body["analytics_status"]["recent_activity"] == "unavailable"
        assert body["views_total"] is None
        assert body["zero_view_total"] is None


# ── POST /admin/grammar/recommend-test ────────────────────────────


class TestRecommendTester:
    def test_match_returns_article_metadata(self, client):
        r = client.post(
            "/admin/grammar/recommend-test",
            json={"issue": "past perfect"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["issue"] == "past perfect"
        assert body["match"] is not None
        assert body["match"]["slug"] == "past-perfect"
        assert body["match"]["score"] == 0.9
        assert body["match"]["url"].startswith("/pages/grammar-article.html?slug=")

    def test_no_match_returns_match_none(self, client):
        r = client.post(
            "/admin/grammar/recommend-test",
            json={"issue": "completely irrelevant text"},
            headers=_ADMIN_AUTH,
        )
        body = r.json()
        assert body["match"] is None

    def test_blank_issue_returns_422_via_pydantic(self, client):
        r = client.post(
            "/admin/grammar/recommend-test",
            json={"issue": ""},
            headers=_ADMIN_AUTH,
        )
        # min_length=1 on Pydantic field → 422.
        assert r.status_code == 422
