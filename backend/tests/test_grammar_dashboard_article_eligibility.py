"""Personalized lesson links follow the canonical content index, not history."""

import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest

from routers import grammar


class ReadOnlyQuery:
    def __init__(self, database, table):
        self.database = database
        self.table = table
        self.operations = []
        database.queries.append(self)

    def select(self, columns):
        self.operations.append(("select", columns))
        return self

    def eq(self, column, value):
        self.operations.append(("eq", column, value))
        return self

    def gte(self, column, value):
        self.operations.append(("gte", column, value))
        return self

    def in_(self, column, values):
        self.operations.append(("in", column, values))
        return self

    def order(self, column, desc=False):
        self.operations.append(("order", column, desc))
        return self

    def limit(self, count):
        self.operations.append(("limit", count))
        return self

    def execute(self):
        rows = deepcopy(self.database.rows[self.table])
        for operation in self.operations:
            action, *arguments = operation
            if action == "eq":
                column, value = arguments
                rows = [row for row in rows if row.get(column) == value]
            elif action == "gte":
                column, value = arguments
                rows = [row for row in rows if row.get(column, "") >= value]
            elif action == "in":
                column, values = arguments
                rows = [row for row in rows if row.get(column) in values]
            elif action == "order":
                column, descending = arguments
                rows.sort(key=lambda row: row[column], reverse=descending)
            elif action == "limit":
                rows = rows[:arguments[0]]
        # PostgREST caps the response after database filters, including queries
        # without a client-side limit. Python eligibility checks happen too late.
        if self.database.row_cap is not None:
            self.operations.append(("response_cap", self.database.row_cap))
            rows = rows[:self.database.row_cap]
        return SimpleNamespace(data=rows)


class ReadOnlyDatabase:
    def __init__(self, rows, row_cap=None):
        self.rows = rows
        self.row_cap = row_cap
        self.queries = []

    def table(self, table):
        return ReadOnlyQuery(self, table)


def run_dashboard(monkeypatch, articles, rows, row_cap=None):
    database = ReadOnlyDatabase(rows, row_cap=row_cap)
    service = SimpleNamespace(articles_by_slug=articles, get_article_by_slug=articles.get)

    async def owner(_authorization):
        return {"id": "owner"}

    monkeypatch.setattr(grammar, "supabase_admin", database)
    monkeypatch.setattr(grammar, "grammar_service", service)
    monkeypatch.setattr(grammar, "get_supabase_user", owner)
    original = deepcopy(rows)
    result = asyncio.run(grammar.get_dashboard_data("Bearer fixture"))
    assert rows == original  # Historical records, including non-articles, stay intact.
    return result, database


def history(articles):
    now = grammar.datetime.now(grammar.timezone.utc)
    def stamp(minutes):
        return (now - grammar.timedelta(minutes=minutes)).isoformat()

    # All five newest rows are ineligible, including the reported README.
    invalid_slugs = ["README", "removed-lesson", "operator-notes", "retired-example", "migration-guide"]
    views = [{"user_id": "owner", "article_slug": slug, "article_title": slug, "article_category": "speaking_bank", "last_viewed_at": stamp(index)} for index, slug in enumerate(invalid_slugs)]
    views.extend({"user_id": "owner", "article_slug": slug, "article_title": "Stale title", "article_category": "wrong-category", "last_viewed_at": stamp(index + 10)} for index, slug in enumerate(articles))
    # Invalid recommendations have larger counts than eligible lessons.
    recommendations = [{"user_id": "owner", "recommended_slug": slug, "recommended_title": "Stored document", "created_at": stamp(index)} for index, slug in enumerate(invalid_slugs * 3)]
    recommendations.extend({"user_id": "owner", "recommended_slug": "lesson-0", "recommended_title": "Stale title", "created_at": stamp(index)} for index in range(2))
    saved = [{"user_id": "owner", "article_slug": slug, "article_title": "Stale title", "saved_at": stamp(index)} for index, slug in enumerate(invalid_slugs + list(articles))]
    return {"article_views": views, "grammar_recommendations": recommendations, "saved_articles": saved}


def test_dashboard_filters_by_canonical_eligibility_before_recent_limit_and_preserves_history(monkeypatch):
    articles = {f"lesson-{index}": {"title": f"Canonical lesson {index}", "category": "tenses", "next_articles": []} for index in range(6)}
    result, database = run_dashboard(monkeypatch, articles, history(articles))

    assert [row["slug"] for row in result["recently_viewed"]] == list(articles)[:5]
    assert [(row["title"], row["category"]) for row in result["recently_viewed"]] == [(f"Canonical lesson {index}", "tenses") for index in range(5)]
    assert [row["slug"] for row in result["saved_articles"]] == list(articles)
    assert all(row["title"] == articles[row["slug"]]["title"] and row["category"] == "tenses" for row in result["saved_articles"])
    assert [row["tag"] for row in result["grammar_focus_this_week"]] == ["lesson-0"]
    assert result["grammar_focus_this_week"][0]["article_count"] == 2
    assert [row["tag"] for row in result["weak_areas"]] == ["lesson-0"]
    assert result["weak_areas"][0]["label_vi"] == "Canonical lesson 0"
    assert result["weak_areas"][0]["occurrence_count"] == 2

    limited_query = next(query for query in database.queries if query.table == "article_views" and ("limit", 5) in query.operations)
    eligibility = ("in", "article_slug", list(articles))
    assert eligibility in limited_query.operations
    assert limited_query.operations.index(eligibility) < limited_query.operations.index(("limit", 5))
    assert all(("eq", "user_id", "owner") in query.operations for query in database.queries)


def test_empty_canonical_catalog_offers_no_historical_links(monkeypatch):
    result, _ = run_dashboard(monkeypatch, {}, history({}))
    assert result == {"grammar_focus_this_week": [], "weak_areas": [], "recently_viewed": [], "saved_articles": []}


@pytest.mark.parametrize("row_cap", [2, 3])
def test_dashboard_filters_all_history_queries_before_postgrest_response_cap(monkeypatch, row_cap):
    articles = {f"lesson-{index}": {"title": f"Canonical lesson {index}", "category": "tenses", "next_articles": []} for index in range(6)}
    articles["lesson-0"]["next_articles"] = ["lesson-1"]
    rows = history(articles)
    # An eligible row from another user also precedes this user's stale rows.
    # Neither obsolete slugs nor another account may consume the response cap.
    for table in rows:
        foreign = deepcopy(rows[table][-1])
        foreign["user_id"] = "another-owner"
        rows[table].insert(0, foreign)
    result, database = run_dashboard(monkeypatch, articles, rows, row_cap=row_cap)

    assert [row["slug"] for row in result["recently_viewed"]] == list(articles)[:row_cap]
    assert [row["slug"] for row in result["saved_articles"]] == list(articles)[:row_cap]
    assert result["grammar_focus_this_week"] == [{
        "tag": "lesson-0", "label_vi": "Canonical lesson 0",
        "article_count": 2, "articles": [],
    }]
    assert [row["tag"] for row in result["weak_areas"]] == ["lesson-0"]
    assert result["weak_areas"][0]["occurrence_count"] == 2
    assert len(database.queries) == 5
    for query in database.queries:
        column = "recommended_slug" if query.table == "grammar_recommendations" else "article_slug"
        eligibility = ("in", column, list(articles))
        assert eligibility in query.operations
        assert query.operations.index(eligibility) < query.operations.index(("response_cap", row_cap))
        assert ("eq", "user_id", "owner") in query.operations
