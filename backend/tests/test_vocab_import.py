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
    import_vocab_file,
    import_vocab_markdown,
    parse_vocab_markdown,
    split_word_blocks,
    validate_vocab,
)


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}

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
    assert validate_vocab(parse_vocab_markdown(_WORD_MD)) == []


def test_validate_flags_missing_headword():
    md = _WORD_MD.replace('headword: "Cutting-edge"\n', "")
    fields = {e["field"] for e in validate_vocab(parse_vocab_markdown(md))}
    assert "headword" in fields


def test_validate_accepts_any_nonempty_category_no_whitelist():
    """Category-runtime: a category NOT in the old yaml whitelist is now accepted
    (normalized to a slug at parse). Only an empty category is still flagged."""
    md = _WORD_MD.replace('category: "technology"', 'category: "Business Finance"')
    p = parse_vocab_markdown(md)
    assert p.category == "business-finance"            # normalized
    assert validate_vocab(p) == []                       # accepted, not rejected


def test_validate_flags_empty_category():
    md = _WORD_MD.replace('category: "technology"', 'category: ""')
    fields = {e["field"] for e in validate_vocab(parse_vocab_markdown(md))}
    assert "category" in fields


def test_payload_carries_stored_gloss_and_lists():
    payload = build_vocab_payload(parse_vocab_markdown(_WORD_MD))
    assert payload["slug"] == "cutting-edge"
    assert payload["gloss_vi"].startswith("Tiên tiến nhất")
    assert payload["synonyms"] == ["advanced", "pioneering"]
    assert "body_html" in payload


def test_syllables_parsed_when_present_else_empty():
    # Slice-2: `syllables` is an optional scalar — present → stored verbatim;
    # absent → "" (graceful, never breaks the import).
    with_syl = _WORD_MD.replace('category: "technology"',
                                'category: "technology"\nsyllables: "me-TROP-o-lis"')
    assert build_vocab_payload(parse_vocab_markdown(with_syl))["syllables"] == "me-TROP-o-lis"
    assert build_vocab_payload(parse_vocab_markdown(_WORD_MD))["syllables"] == ""


def test_upload_format_doc_matches_reconcile():
    # AG5 — the committed khuôn reflects the reconcile: definition_vi + word_family
    # documented; `stress` no longer a supported field; group marked internal.
    from pathlib import Path
    doc = (Path(__file__).parent.parent / "docs" / "VOCAB_UPLOAD_FORMAT.md").read_text("utf-8")
    assert "definition_vi" in doc and "word_family" in doc
    assert "Removed / not supported" in doc and "stress" in doc  # listed as removed
    assert "internal metadata only" in doc                        # group documented internal


def test_definition_vi_and_word_family_parsed():
    # mig112 field-reconcile: definition_vi (scalar) + word_family (list).
    md = _WORD_MD.replace('category: "technology"',
                          'category: "technology"\n'
                          'definition_vi: "định nghĩa VN curated"\n'
                          'word_family: ["metropolitan (adj)", "metro (n)"]')
    payload = build_vocab_payload(parse_vocab_markdown(md))
    assert payload["definition_vi"] == "định nghĩa VN curated"
    assert payload["word_family"] == ["metropolitan (adj)", "metro (n)"]
    # absent → graceful empty (no break for existing-shape files)
    base = build_vocab_payload(parse_vocab_markdown(_WORD_MD))
    assert base["definition_vi"] == "" and base["word_family"] == []


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
        res = import_vocab_markdown(_WORD_MD, dry_run=False)
    assert res["action"] == "created"
    assert res["committed"] == "cutting-edge"
    db.table.return_value.insert.assert_called_once()
    db.table.return_value.update.assert_not_called()


def test_reimport_same_slug_updates_not_duplicates():
    db = _mock_db_existing()
    with patch("services.vocab_import.supabase_admin", db):
        res = import_vocab_markdown(_WORD_MD, dry_run=False)
    assert res["action"] == "updated"
    db.table.return_value.update.assert_called_once()
    db.table.return_value.insert.assert_not_called()


def test_dry_run_does_not_write():
    db = MagicMock()
    with patch("services.vocab_import.supabase_admin", db):
        res = import_vocab_markdown(_WORD_MD, dry_run=True)
    assert res["dry_run"] is True
    assert res["committed"] is None
    db.table.return_value.insert.assert_not_called()


def test_validation_error_blocks_commit():
    bad = _WORD_MD.replace('headword: "Cutting-edge"\n', "")
    db = MagicMock()
    with patch("services.vocab_import.supabase_admin", db):
        res = import_vocab_markdown(bad, dry_run=False)
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
    # Category-runtime: no whitelist → an empty (required) category is the
    # remaining validation error that blocks a commit.
    bad = _WORD_MD.replace('category: "technology"', 'category: ""')
    db = MagicMock()
    reload = MagicMock()
    with patch("routers.admin_vocab.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
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


# ── Multi-word (one-lesson-per-file) import ────────────────────────────


def _word(headword, slug, category="health", *, body="**Nghĩa VN** — giải thích.", drop=None):
    """Build one word block. `drop` omits a frontmatter line (to force an error)."""
    fm = {"headword": headword, "slug": slug, "category": category,
          "part_of_speech": "noun"}
    if drop:
        fm.pop(drop, None)
    lines = "\n".join(f'{k}: "{v}"' for k, v in fm.items())
    return f"---\n{lines}\n---\n\n{body}\n\n## Ví dụ\n\n> Example for {headword}.\n"


def _file(*blocks):
    return "\n".join(blocks)


# split_word_blocks

def test_split_single_block_is_backward_compatible():
    blocks = split_word_blocks(_WORD_MD)
    assert len(blocks) == 1
    # the single chunk still parses to the same word
    assert parse_vocab_markdown(blocks[0]).slug == "cutting-edge"


def test_split_three_blocks():
    text = _file(_word("Holistic", "holistic"), _word("Sedentary", "sedentary"),
                 _word("Epidemic", "epidemic"))
    blocks = split_word_blocks(text)
    assert len(blocks) == 3
    assert [parse_vocab_markdown(b).slug for b in blocks] == ["holistic", "sedentary", "epidemic"]


def test_split_ignores_body_horizontal_rule():
    """Blind-spot guard: a markdown HR `---` inside a body (between-fences text is
    NOT a YAML dict) must not be treated as a new block boundary."""
    body = "**Nghĩa** — giải thích.\n\n---\nMột ghi chú có gạch ngang.\n---\n\nĐoạn cuối."
    text = _file(_word("Holistic", "holistic", body=body), _word("Sedentary", "sedentary"))
    blocks = split_word_blocks(text)
    assert len(blocks) == 2                       # NOT 3 — the body HR isn't a block
    assert parse_vocab_markdown(blocks[0]).slug == "holistic"
    assert parse_vocab_markdown(blocks[1]).slug == "sedentary"


# import_vocab_file

def test_import_file_three_valid_blocks_commits_all():
    text = _file(_word("Holistic", "holistic"), _word("Sedentary", "sedentary"),
                 _word("Epidemic", "epidemic"))
    db = _mock_db_no_existing()
    with patch("services.vocab_import.supabase_admin", db):
        res = import_vocab_file(text, dry_run=False)
    assert res["summary"] == {"total": 3, "created": 3, "updated": 0, "errors": 0,
                               "forecast_created": 0, "forecast_updated": 0}
    assert res["committed_ids"] == ["holistic", "sedentary", "epidemic"]
    assert res["validation_errors"] == []
    assert db.table.return_value.insert.call_count == 3


def test_import_file_one_bad_block_reports_that_block_others_ok():
    """A single bad block reports its error WITHOUT aborting the others; nothing
    commits (all-or-nothing) so the lesson is never half-imported."""
    text = _file(
        _word("Holistic", "holistic"),
        _word("Bad", "bad", drop="category"),     # missing category → block 1 error
        _word("Epidemic", "epidemic"),
    )
    db = MagicMock()
    with patch("services.vocab_import.supabase_admin", db):
        res = import_vocab_file(text, dry_run=False)
    # the error is tagged to the RIGHT block (index 1, headword "Bad")
    errs = res["validation_errors"]
    assert any(e["block"] == 1 and e["headword"] == "Bad" and e["field"] == "category" for e in errs)
    # the other two blocks parsed cleanly (preview shows them, no errors)
    assert res["blocks"][0]["validation_errors"] == []
    assert res["blocks"][2]["validation_errors"] == []
    assert res["blocks"][0]["parsed_data"]["slug"] == "holistic"
    # all-or-nothing: nothing written
    assert res["committed_ids"] == []
    db.table.return_value.insert.assert_not_called()


def test_import_file_duplicate_slug_in_batch_is_an_error():
    text = _file(_word("Holistic", "dup"), _word("Sedentary", "dup"))
    db = MagicMock()
    with patch("services.vocab_import.supabase_admin", db):
        res = import_vocab_file(text, dry_run=False)
    assert res["duplicate_slugs"] == ["dup"]
    # both colliding blocks carry the duplicate error
    assert all(any(e["field"] == "slug" for e in b["validation_errors"]) for b in res["blocks"])
    assert res["committed_ids"] == []
    db.table.return_value.insert.assert_not_called()


def test_import_file_single_block_backward_compat():
    """A 1-word file (the original content_vocab shape) still imports + still
    exposes the single-block mirrors parsed_data/action."""
    db = _mock_db_no_existing()
    with patch("services.vocab_import.supabase_admin", db):
        res = import_vocab_file(_WORD_MD, dry_run=False)
    assert res["summary"]["total"] == 1
    assert res["committed_ids"] == ["cutting-edge"]
    assert res["action"] == "created"
    assert res["parsed_data"]["slug"] == "cutting-edge"


def test_import_file_dry_run_validates_without_writing():
    text = _file(_word("Holistic", "holistic"), _word("Sedentary", "sedentary"))
    db = MagicMock()
    with patch("services.vocab_import.supabase_admin", db):
        res = import_vocab_file(text, dry_run=True)
    assert res["dry_run"] is True
    assert res["committed_ids"] == []
    assert res["summary"]["total"] == 2
    assert res["validation_errors"] == []
    db.table.return_value.insert.assert_not_called()


# endpoint — multi-word upload commits all + reloads once (G1)

def test_endpoint_multiblock_commits_all_and_reloads():
    from main import app
    text = _file(_word("Holistic", "holistic"), _word("Sedentary", "sedentary"),
                 _word("Epidemic", "epidemic"))
    db = _mock_db_no_existing()
    reload = MagicMock()
    files = {"file": ("lesson.md", text.encode("utf-8"), "text/markdown")}
    with patch("routers.admin_vocab.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("services.vocab_import.supabase_admin", db), \
         patch("routers.admin_vocab.vocab_service.reload", reload):
        r = TestClient(app).post("/admin/vocabulary/import?dry_run=false", files=files, headers=_ADMIN_AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["committed_ids"] == ["holistic", "sedentary", "epidemic"]
    assert body["summary"]["created"] == 3
    reload.assert_called_once()


# ── Category-runtime (Slice-A): normalize + DB-driven categories + auto-title ──

from services.vocab_import import _normalize_category   # noqa: E402


def test_normalize_category_collapses_case_space_underscore():
    # CG5 — case / trailing space / underscore / multi-space → one stable slug.
    for raw in ("Technology", "technology ", " Technology ", "TECHNOLOGY"):
        assert _normalize_category(raw) == "technology"
    for raw in ("Business Finance", "business_finance", "Business  Finance",
                "  business-finance "):
        assert _normalize_category(raw) == "business-finance"


def test_normalize_category_strips_vietnamese_accents_to_ascii():
    # dấu tiếng Việt → ASCII slug (clean URL path segment)
    assert _normalize_category("Kinh Tế") == "kinh-te"
    assert _normalize_category("Đời sống") == "doi-song"


def test_normalize_blank_category_stays_empty_for_required_check():
    assert _normalize_category("   ") == ""
    assert _normalize_category(None) == ""


def test_parse_normalizes_new_category_and_import_accepts_it():
    # CG1 — "Business Finance" → "business-finance", ACCEPTED (no whitelist reject).
    md = _WORD_MD.replace('category: "technology"', 'category: "Business Finance"')
    db = _mock_db_no_existing()
    with patch("services.vocab_import.supabase_admin", db):
        res = import_vocab_file(md, dry_run=False)
    assert res["validation_errors"] == []
    assert res["committed_ids"] == ["cutting-edge"]
    assert res["blocks"][0]["parsed_data"]["category"] == "business-finance"


_NEW_CAT_ROW = {
    "slug": "stock-market", "headword": "Stock market", "category": "business-finance",
    "gloss_vi": "Thị trường chứng khoán", "body_html": "<p>x</p>",
    "synonyms": [], "antonyms": [], "collocations": [], "related_words": [],
    "updated_at": "2026-06-21T10:00:00+00:00",
}


def test_new_category_auto_surfaces_in_get_categories_with_prettify_title():
    # CG2 — a category present ONLY in the DB surfaces via DISTINCT-from-DB, and
    # its title auto-derives from the slug (prettify), no yaml entry needed.
    svc = _fresh_service_with_db([_NEW_CAT_ROW])
    cats = {c["slug"]: c for c in svc.get_categories()}
    assert "business-finance" in cats
    assert cats["business-finance"]["title"] == "Business Finance"
    assert any(a["slug"] == "stock-market" for a in cats["business-finance"]["articles"])


def test_known_category_keeps_yaml_title_override():
    # CG3 — a category in the yaml manifest keeps its curated title (not prettify).
    svc = _fresh_service_with_db([_DB_ROW])      # category "technology"
    cats = {c["slug"]: c for c in svc.get_categories()}
    assert cats["technology"]["title"] == "Technology"   # yaml override, not prettify


def test_build_indexes_merges_yaml_titles_and_new_distinct_categories():
    # CG2 + CG3 together — yaml-title group AND a brand-new prettify group both
    # appear; manifest order first, new categories appended after.
    svc = _fresh_service_with_db([_DB_ROW, _NEW_CAT_ROW])
    cats = svc.get_categories()
    by_slug = {c["slug"]: c for c in cats}
    assert by_slug["technology"]["title"] == "Technology"          # yaml
    assert by_slug["business-finance"]["title"] == "Business Finance"  # prettify
    slugs = [c["slug"] for c in cats]
    # the 6 manifest categories precede the new DISTINCT-from-DB one
    assert slugs.index("business-finance") > slugs.index("technology")


def test_backward_compat_markdown_fallback_keeps_six_categories():
    # CG3 — empty table → markdown fallback still renders the original 6 groups +
    # the 20 seeded words, titles intact.
    svc = _fresh_service_with_db([])
    cats = svc.get_categories()
    assert len(cats) >= 6
    titles = {c["slug"]: c["title"] for c in cats}
    assert titles.get("technology") == "Technology"
    assert titles.get("work-career") == "Work & Career"   # yaml title preserved
    assert sum(c["article_count"] for c in cats) == 20
