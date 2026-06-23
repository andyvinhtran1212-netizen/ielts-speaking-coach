"""M3 Slice-1 — vocab content importer + admin route + cutover/reload/cache gates.

  • services/vocab_import.py — parse → validate → upsert-by-slug (idempotent)
  • POST /admin/vocabulary/import — auth, dry-run, commit, G1 reload-after-commit
  • services/vocab_content.py — cutover (DB read → 4 shapes), G3 markdown fallback,
    G2 cache key derived from MAX(updated_at)

No live DB: supabase is patched with MagicMock (mirrors test_content_import.py).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from services.vocab_import import (
    build_vocab_payload,
    import_vocab_markdown,
    parse_vocab_markdown,
    validate_vocab,
)


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
_CATS = {"technology", "health", "education"}

_WORD_MD = """---
headword: "Cutting-edge"
slug: "cutting-edge"
category: "technology"
level: "B2"
part_of_speech: "adjective"
pronunciation: "/ˈkʌt.ɪŋ.edʒ/"
synonyms: ["advanced", "pioneering"]
antonyms: ["obsolete"]
collocations: ["cutting-edge technology"]
related_words: ["obsolete"]
---

**Tiên tiến nhất, hiện đại nhất** — ở vị trí tiền tiêu của sự phát triển.

## Ví dụ

> Universities invest in **cutting-edge** research.
"""


# ── Parse + validate (pure) ────────────────────────────────────────────


def test_parse_extracts_fields_and_gloss_from_body():
    p = parse_vocab_markdown(_WORD_MD)
    assert p.headword == "Cutting-edge"
    assert p.slug == "cutting-edge"
    assert p.category == "technology"
    assert p.scalars["part_of_speech"] == "adjective"
    assert p.lists["synonyms"] == ["advanced", "pioneering"]
    # gloss_vi = body first paragraph, markdown stripped (single source — #546).
    assert p.gloss_vi.startswith("Tiên tiến nhất")
    assert "**" not in p.gloss_vi
    assert "<p>" in p.body_html  # markdown → html


def test_slug_auto_generated_from_headword_when_omitted():
    md = _WORD_MD.replace('slug: "cutting-edge"\n', "")
    assert parse_vocab_markdown(md).slug == "cutting-edge"


def test_validate_clean_word_has_no_errors():
    assert validate_vocab(parse_vocab_markdown(_WORD_MD), valid_categories=_CATS) == []


def test_validate_flags_missing_headword():
    md = _WORD_MD.replace('headword: "Cutting-edge"\n', "")
    fields = {e["field"] for e in validate_vocab(parse_vocab_markdown(md), valid_categories=_CATS)}
    assert "headword" in fields


def test_validate_flags_unknown_category():
    md = _WORD_MD.replace('category: "technology"', 'category: "made-up"')
    fields = {e["field"] for e in validate_vocab(parse_vocab_markdown(md), valid_categories=_CATS)}
    assert "category" in fields


def test_payload_carries_stored_gloss_and_lists():
    payload = build_vocab_payload(parse_vocab_markdown(_WORD_MD))
    assert payload["slug"] == "cutting-edge"
    assert payload["gloss_vi"].startswith("Tiên tiến nhất")
    assert payload["synonyms"] == ["advanced", "pioneering"]
    assert "body_html" in payload


# ── upsert idempotency ─────────────────────────────────────────────────


def _mock_db_no_existing():
    db = MagicMock()
    sel = db.table.return_value.select.return_value.eq.return_value.limit.return_value
    sel.execute.return_value = MagicMock(data=[])     # no existing slug → insert
    return db


def _mock_db_existing():
    db = MagicMock()
    sel = db.table.return_value.select.return_value.eq.return_value.limit.return_value
    sel.execute.return_value = MagicMock(data=[{"id": "row-1"}])  # exists → update
    return db


def test_import_commit_inserts_new_slug():
    db = _mock_db_no_existing()
    with patch("services.vocab_import.supabase_admin", db):
        res = import_vocab_markdown(_WORD_MD, dry_run=False, valid_categories=_CATS)
    assert res["action"] == "created"
    assert res["committed"] == "cutting-edge"
    db.table.return_value.insert.assert_called_once()
    db.table.return_value.update.assert_not_called()


def test_reimport_same_slug_updates_not_duplicates():
    db = _mock_db_existing()
    with patch("services.vocab_import.supabase_admin", db):
        res = import_vocab_markdown(_WORD_MD, dry_run=False, valid_categories=_CATS)
    assert res["action"] == "updated"
    db.table.return_value.update.assert_called_once()
    db.table.return_value.insert.assert_not_called()


def test_dry_run_does_not_write():
    db = MagicMock()
    with patch("services.vocab_import.supabase_admin", db):
        res = import_vocab_markdown(_WORD_MD, dry_run=True, valid_categories=_CATS)
    assert res["dry_run"] is True
    assert res["committed"] is None
    db.table.return_value.insert.assert_not_called()


def test_validation_error_blocks_commit():
    bad = _WORD_MD.replace('headword: "Cutting-edge"\n', "")
    db = MagicMock()
    with patch("services.vocab_import.supabase_admin", db):
        res = import_vocab_markdown(bad, dry_run=False, valid_categories=_CATS)
    assert res["committed"] is None
    assert any(e["field"] == "headword" for e in res["validation_errors"])
    db.table.return_value.insert.assert_not_called()


# ── Endpoint: auth + dry-run + commit + G1 reload ──────────────────────


def _client() -> TestClient:
    from main import app
    return TestClient(app)


def _upload(md: str, qs: str = "", headers=None):
    files = {"file": ("word.md", md.encode("utf-8"), "text/markdown")}
    return _client().post("/admin/vocabulary/import" + qs, files=files, headers=headers or {})


def test_endpoint_requires_auth():
    assert _upload(_WORD_MD).status_code == 401


def test_endpoint_dry_run_no_write_no_reload():
    db = MagicMock()
    reload = MagicMock()
    with patch("routers.admin_vocab.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("services.vocab_import.supabase_admin", db), \
         patch("routers.admin_vocab.vocab_service.reload", reload):
        r = _upload(_WORD_MD, "?dry_run=true", _ADMIN_AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["dry_run"] is True
    assert body["committed_ids"] == []
    reload.assert_not_called()


def test_endpoint_commit_writes_and_reloads_G1():
    db = _mock_db_no_existing()
    reload = MagicMock()
    with patch("routers.admin_vocab.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("services.vocab_import.supabase_admin", db), \
         patch("routers.admin_vocab.vocab_service.reload", reload):
        r = _upload(_WORD_MD, "?dry_run=false", _ADMIN_AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["action"] == "created"
    assert body["committed_ids"] == ["cutting-edge"]
    db.table.return_value.insert.assert_called_once()
    reload.assert_called_once()           # G1 — index rebuilt so the word is live


def test_endpoint_validation_error_no_reload():
    bad = _WORD_MD.replace('category: "technology"', 'category: "nope"')
    db = MagicMock()
    reload = MagicMock()
    # category validity comes from the live service categories; force a known set.
    with patch("routers.admin_vocab.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_vocab.vocab_service._valid_categories", _CATS), \
         patch("services.vocab_import.supabase_admin", db), \
         patch("routers.admin_vocab.vocab_service.reload", reload):
        r = _upload(bad, "?dry_run=false", _ADMIN_AUTH)
    assert r.status_code == 200
    assert r.json()["committed_ids"] == []
    reload.assert_not_called()


# ── Cutover: DB read → 4 shapes; empty → markdown fallback (G3) ─────────


_DB_ROW = {
    "slug": "cutting-edge", "headword": "Cutting-edge", "category": "technology",
    "level": "B2", "part_of_speech": "adjective", "pronunciation": "/x/",
    "gloss_vi": "Tiên tiến nhất", "definition_en": "very modern", "example": "ex",
    "synonyms": ["advanced"], "antonyms": ["obsolete"], "collocations": ["c"],
    "related_words": [], "body_html": "<p>body</p>",
    "updated_at": "2026-06-20T10:00:00+00:00",
}


def _fresh_service_with_db(rows):
    """Build a VocabContentService whose DB read returns `rows`."""
    from services import vocab_content as vc
    db = MagicMock()
    db.table.return_value.select.return_value.execute.return_value = MagicMock(data=rows)
    # Patch the database module symbol the local import resolves to.
    with patch("database.supabase_admin", db):
        svc = vc.VocabContentService()
    return svc


def test_cutover_reads_table_into_four_shapes():
    svc = _fresh_service_with_db([_DB_ROW])
    assert svc._source == "db"
    # 1) categories — technology section carries the word summary incl gloss_vi
    cats = {c["slug"]: c for c in svc.get_categories()}
    tech = cats["technology"]["articles"]
    assert any(a["slug"] == "cutting-edge" and a["gloss_vi"] == "Tiên tiến nhất" for a in tech)
    # 2) all articles (summaries) incl gloss_vi
    arts = svc.get_all_articles()
    assert any(a["slug"] == "cutting-edge" and "gloss_vi" in a for a in arts)
    # 3) article detail — html + resolved related_words
    art = svc.get_article("technology", "cutting-edge")
    assert art and art["html"] == "<p>body</p>"
    assert isinstance(art["related_words"], list)
    # 4) search
    assert any(r["slug"] == "cutting-edge" for r in svc.search_prefix("cut"))


def test_cutover_sets_last_modified_from_max_updated_at_G2():
    svc = _fresh_service_with_db([_DB_ROW])
    assert svc.last_modified is not None
    assert svc.last_modified.year == 2026 and svc.last_modified.month == 6


def test_empty_table_falls_back_to_markdown_G3():
    svc = _fresh_service_with_db([])      # table empty → markdown safety net
    assert svc._source == "markdown"
    # the 20 committed markdown words load (content_vocab/** exists in the repo)
    assert len(svc.get_all_articles()) >= 1


def test_db_unavailable_falls_back_to_markdown_G3():
    from services import vocab_content as vc
    db = MagicMock()
    db.table.return_value.select.return_value.execute.side_effect = RuntimeError("no db")
    with patch("database.supabase_admin", db):
        svc = vc.VocabContentService()
    assert svc._source == "markdown"


# ── G2 — router cache key derives from the service ─────────────────────


def test_router_last_modified_is_http_date_string_from_stamp():
    """G2 stays (cache key tracks MAX(updated_at)) but _last_modified MUST return
    a str — cacheable_json puts it straight into the Last-Modified header, which
    Starlette .encode()s. Passing the raw datetime is what 500'd /api/vocabulary/*
    after the DB cutover."""
    from email.utils import format_datetime
    import routers.vocabulary as vr
    svc = _fresh_service_with_db([_DB_ROW])
    with patch("routers.vocabulary.vocab_service", svc):
        lm = vr._last_modified()
    assert isinstance(lm, str)
    assert lm == format_datetime(svc.last_modified, usegmt=True)
    assert lm.endswith("GMT")        # RFC-1123 HTTP-date


def test_router_last_modified_falls_back_when_no_stamp():
    import routers.vocabulary as vr
    svc = MagicMock()
    svc.last_modified = None
    with patch("routers.vocabulary.vocab_service", svc):
        lm = vr._last_modified()
    assert lm == vr._PUBLIC_LAST_MODIFIED
    assert isinstance(lm, str)


# ── Regression: endpoints serving FROM THE TABLE must not 500 on datetime ──
# Pre-fix, a vocab_cards row's datetime updated_at flowed into the Last-Modified
# header unconverted → "'datetime.datetime' object has no attribute 'encode'".
# Cover all endpoints that go through the cache-key/header path, not just /search.


def test_search_endpoint_from_table_does_not_500_on_datetime():
    from main import app
    svc = _fresh_service_with_db([_DB_ROW])
    with patch("routers.vocabulary.vocab_service", svc):
        r = TestClient(app).get("/api/vocabulary/search?q=cut")
    assert r.status_code == 200, r.text
    assert r.headers.get("Last-Modified", "").endswith("GMT")
    assert any(item["slug"] == "cutting-edge" for item in r.json())


def test_categories_endpoint_from_table_does_not_500_on_datetime():
    from main import app
    svc = _fresh_service_with_db([_DB_ROW])
    with patch("routers.vocabulary.vocab_service", svc):
        r = TestClient(app).get("/api/vocabulary/categories")
    assert r.status_code == 200, r.text
    assert r.headers.get("Last-Modified", "").endswith("GMT")


def test_article_endpoint_from_table_does_not_500_on_datetime():
    from main import app
    svc = _fresh_service_with_db([_DB_ROW])
    with patch("routers.vocabulary.vocab_service", svc):
        r = TestClient(app).get("/api/vocabulary/articles/technology/cutting-edge")
    assert r.status_code == 200, r.text
    assert r.headers.get("Last-Modified", "").endswith("GMT")
    assert r.json()["html"] == "<p>body</p>"


def test_articles_list_endpoint_from_table_does_not_500_on_datetime():
    from main import app
    svc = _fresh_service_with_db([_DB_ROW])
    with patch("routers.vocabulary.vocab_service", svc):
        r = TestClient(app).get("/api/vocabulary/articles")
    assert r.status_code == 200, r.text
    assert r.headers.get("Last-Modified", "").endswith("GMT")
