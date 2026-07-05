"""VE1 — vocab_content grid fields. The word-library mini-card needs a VN gloss
(extracted from the body — the 20 words have no structured VN field) + additive
definition_en/example (VC1 forward-compat: a word WITHOUT them must not break).
"""

from __future__ import annotations

from services.vocab_content import vocab_service, _first_paragraph_text


# ── pure gloss extraction ─────────────────────────────────────────────


def test_gloss_strips_markdown_and_skips_headings():
    body = "## Heading\n\n**Tiên tiến nhất, hiện đại nhất** — ở vị trí tiền tiêu.\n\n> a quote"
    assert _first_paragraph_text(body) == "Tiên tiến nhất, hiện đại nhất — ở vị trí tiền tiêu."


def test_gloss_empty_body_is_blank_not_crash():
    assert _first_paragraph_text("") == ""
    assert _first_paragraph_text("## only a heading\n\n> only a quote") == ""


# ── live content (the 20 real words) ──────────────────────────────────


def test_every_article_has_a_nonempty_gloss():
    arts = vocab_service.get_all_articles()
    assert len(arts) == 68, f"expected 68 words, got {len(arts)}"
    missing = [a["slug"] for a in arts if not a.get("gloss_vi")]
    assert not missing, f"words with no VN gloss for the grid: {missing}"


def test_summary_carries_grid_fields():
    a = next(iter(vocab_service.get_all_articles()))
    for k in ("slug", "category", "headword", "level", "part_of_speech", "pronunciation", "gloss_vi"):
        assert k in a, f"summary missing grid field {k!r}"


def test_categories_feed_embeds_word_summaries_with_gloss():
    """GET /api/vocabulary/categories feed: 6 categories, each embeds its words
    (with gloss_vi) — the one-call grid source (no N+1)."""
    cats = vocab_service.get_categories()
    assert len(cats) == 7
    total = 0
    for c in cats:
        assert {"slug", "title", "articles"} <= set(c)
        for w in c["articles"]:
            assert "gloss_vi" in w and "pronunciation" in w
            total += 1
    assert total == 68


# ── additive definition_en/example (VC1 forward-compat) ───────────────


def test_definition_en_example_additive_default_blank():
    """The 20 words have no definition_en/example frontmatter yet → full article
    dict carries "" for them (never KeyError / never breaks)."""
    a = vocab_service.get_article("technology", "cutting-edge")
    assert a is not None
    assert a.get("definition_en") == ""    # additive default
    assert a.get("example") == ""
    # existing fields untouched
    assert a["pronunciation"].startswith("/")
    assert a["part_of_speech"] == "adjective"
