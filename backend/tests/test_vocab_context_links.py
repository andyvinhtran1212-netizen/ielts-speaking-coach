"""Exact authored Reading glossary -> curated Vocab Wiki contracts."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts.seed_vocab_curated import _seed_context_lookups, load_pilot, validate_pilot
from services import vocab_context_links, vocab_context_rules

AUTH = {"Authorization": "Bearer learner.jwt"}
USER_ID = "11111111-1111-4111-8111-111111111111"
UNIT_ID = "22222222-2222-4222-8222-222222222222"


def _client() -> TestClient:
    from main import app
    return TestClient(app)


def _query(data):
    query = MagicMock()
    for method in ("select", "eq", "in_", "limit", "update", "insert"):
        getattr(query, method).return_value = query
    query.execute.return_value = MagicMock(data=data)
    return query


def _published():
    unit = {
        "id": UNIT_ID, "unit_slug": "actually-vs-currently",
        "display_headword": "actually vs currently", "unit_type": "clinic",
        "target_level": "B1", "problem_tags": [], "learner_tags": [],
    }
    version = {
        "version_number": 1, "published_at": "2026-08-27T00:00:00Z",
        "content": {"title_vi": "Actually không có nghĩa là hiện tại", "estimated_minutes": 7},
    }
    return [(unit, version)]


def test_normalization_is_exact_unicode_case_and_whitespace_only():
    assert vocab_context_rules.normalize_context_term("  ＡＣＴＵＡＬＬＹ\n ") == "actually"
    assert vocab_context_rules.normalize_context_term("impact-on") == "impact-on"
    assert vocab_context_rules.normalize_context_term("impact on") == "impact on"


def test_resolver_returns_only_exact_published_safe_summary():
    query = _query([{
        "term": "actually", "normalized_term": "actually", "unit_id": UNIT_ID,
        "rationale_vi": "Phân biệt actually với currently trong ngữ cảnh nói.",
    }])
    with patch.object(vocab_context_links, "supabase_admin") as database, \
         patch.object(vocab_context_links.vocab_units, "_load_published_units", return_value=_published()):
        database.table.return_value = query
        result = vocab_context_links.resolve_context_links([" Actually ", "ACTUALLY"])
    assert len(result["links"]) == 1
    assert result["links"][0]["normalized_term"] == "actually"
    assert result["links"][0]["unit"]["unit_slug"] == "actually-vs-currently"
    assert "content" not in result["links"][0]["unit"]
    query.in_.assert_called_once_with("normalized_term", ["actually"])


def test_resolver_fails_closed_when_target_is_not_published():
    query = _query([{
        "term": "actually", "normalized_term": "actually", "unit_id": UNIT_ID,
        "rationale_vi": "Phân biệt actually với currently trong ngữ cảnh nói.",
    }])
    with patch.object(vocab_context_links, "supabase_admin") as database, \
         patch.object(vocab_context_links.vocab_units, "_load_published_units", return_value=[]):
        database.table.return_value = query
        assert vocab_context_links.resolve_context_links(["actually"]) == {"links": []}


def test_context_route_requires_cohort_and_read_gate():
    expected = {"links": [{"normalized_term": "actually"}]}
    with patch("routers.vocab_units.get_supabase_user", new=AsyncMock(return_value={"id": USER_ID})), \
         patch("routers.vocab_units.is_vocab_curated_enabled", return_value=True), \
         patch("routers.vocab_units.runtime_flags.is_enabled", return_value=True), \
         patch("routers.vocab_units.vocab_context_links.resolve_context_links", return_value=expected) as resolver:
        response = _client().post(
            "/api/me/vocabulary/context-links", headers=AUTH,
            json={"terms": ["actually"]},
        )
    assert response.status_code == 200
    assert response.json() == expected
    resolver.assert_called_once_with(["actually"])


def test_context_route_rejects_invalid_or_uncohorted_requests():
    with patch("routers.vocab_units.get_supabase_user", new=AsyncMock(return_value={"id": USER_ID})), \
         patch("routers.vocab_units.is_vocab_curated_enabled", return_value=False), \
         patch("routers.vocab_units.vocab_context_links.resolve_context_links") as resolver:
        blocked = _client().post(
            "/api/me/vocabulary/context-links", headers=AUTH,
            json={"terms": ["actually"]},
        )
    assert blocked.status_code == 403
    resolver.assert_not_called()
    invalid = _client().post(
        "/api/me/vocabulary/context-links", headers=AUTH,
        json={"terms": ["x" * 161]},
    )
    assert invalid.status_code == 422


def test_seed_catalog_is_unique_intentional_and_does_not_force_current_glossary():
    payload = load_pilot()
    assert validate_pilot(payload) == []
    assert len(payload["context_lookups"]) == 26
    identities = [
        (row["surface_scope"], vocab_context_rules.normalize_context_term(row["term"]))
        for row in payload["context_lookups"]
    ]
    assert len(identities) == len(set(identities))
    # The currently authored pilot glossary has no honest match. Coverage must
    # remain fail-closed instead of forcing a weak CTA merely to show the feature.
    reading_dir = Path(__file__).parent.parent / "content" / "reading"
    current_terms = {
        match.group(1).strip()
        for path in reading_dir.glob("*.md")
        for match in re.finditer(r"^\s*-\s+term:\s*(.+?)\s*$", path.read_text("utf-8"), re.M)
    }
    assert current_terms == {"beverage", "ritual", "apex predator", "ecosystem", "cascade"}
    assert current_terms.isdisjoint({identity[1] for identity in identities})


def test_seed_refresh_preserves_creator_and_deactivates_only_stale_same_source():
    existing = _query([{
        "id": "lookup-1", "unit_id": UNIT_ID,
        "source_key": "pilot_v1", "created_by": "original-admin",
    }])
    updated = _query([{"id": "lookup-1"}])
    stale = _query([
        {"id": "lookup-1", "normalized_term": "actually"},
        {"id": "lookup-old", "normalized_term": "obsolete"},
    ])
    deactivate = _query([{"id": "lookup-old"}])
    lookup = {
        "surface_scope": "reading_glossary", "term": "Actually",
        "unit_slug": "actually-vs-currently",
        "rationale_vi": "Phân biệt actually với currently trong ngữ cảnh nói.",
        "status": "active",
    }
    with patch("database.supabase_admin") as database:
        database.table.side_effect = [existing, updated, stale, deactivate]
        _seed_context_lookups(
            [lookup], {"actually-vs-currently": {"id": UNIT_ID}},
            "refreshing-admin", source_key="pilot_v1",
        )
    refreshed_row = updated.update.call_args.args[0]
    assert "created_by" not in refreshed_row
    assert refreshed_row["normalized_term"] == "actually"
    deactivate.update.assert_called_once_with({"status": "inactive"})
    deactivate.eq.assert_called_once_with("id", "lookup-old")


def test_migration_is_private_atomic_and_exact_identity_is_unique():
    sql = (
        Path(__file__).parent.parent / "migrations" /
        "239_vocab_curated_context_lookups.sql"
    ).read_text("utf-8")
    assert "\nBEGIN;\n" in sql and sql.rstrip().endswith("COMMIT;")
    assert "UNIQUE (surface_scope, normalized_term)" in sql
    assert "ENABLE ROW LEVEL SECURITY" in sql
    assert "REVOKE ALL ON TABLE vocab_context_lookup_terms" in sql
    assert "TO service_role" in sql
