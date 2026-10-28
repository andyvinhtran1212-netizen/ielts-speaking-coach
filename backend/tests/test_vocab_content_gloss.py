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
    assert len(arts) == 80, f"expected 80 words, got {len(arts)}"
    missing = [a["slug"] for a in arts if not a.get("gloss_vi")]
    assert not missing, f"words with no VN gloss for the grid: {missing}"


def test_summary_carries_grid_fields():
    a = next(iter(vocab_service.get_all_articles()))
    for k in ("slug", "category", "headword", "level", "part_of_speech", "pronunciation", "gloss_vi"):
        assert k in a, f"summary missing grid field {k!r}"


def test_categories_feed_embeds_word_summaries_with_gloss():
    """GET /api/vocabulary/categories feed: the 7 manifest categories, each embeds
    its words (with gloss_vi) — the one-call grid source (no N+1). The feed carries
    the SELF-CURATED words only; exam-list vocab (AWL/TOEIC/THPT) is excluded and
    served by /exam instead, so the embedded total == the curated census."""
    cats = vocab_service.get_categories()
    assert len(cats) == 7
    total = 0
    for c in cats:
        assert {"slug", "title", "articles"} <= set(c)
        for w in c["articles"]:
            assert "gloss_vi" in w and "pronunciation" in w
            total += 1
    curated = len(vocab_service.get_curated_articles())
    assert total == curated
    # Exam-list vocab must NOT leak into the 'my vocab' grid.
    assert curated < len(vocab_service.get_all_articles())


# ── additive definition_en/example (VC1 forward-compat) ───────────────


def test_definition_en_example_additive_default_blank(tmp_path):
    """A word WITHOUT definition_en/example frontmatter → full article dict
    carries "" for them (never KeyError / never breaks). Every live file has
    them since V-FILL, so exercise the default on a temp file."""
    path = tmp_path / "technology" / "no-defs.md"
    path.parent.mkdir()
    path.write_text(
        '---\nheadword: "No Defs"\nslug: "no-defs"\ncategory: "technology"\n'
        'part_of_speech: "adjective"\npronunciation: "/nəʊ/"\n---\n\n**Nghĩa** — giải nghĩa.\n',
        encoding="utf-8",
    )
    a = vocab_service._parse_file(path)
    assert a is not None
    assert a.get("definition_en") == ""    # additive default
    assert a.get("example") == ""
    # existing fields untouched
    assert a["pronunciation"] == "/nəʊ/"
    assert a["part_of_speech"] == "adjective"


def test_definition_en_example_read_from_frontmatter():
    """V-FILL filled definition_en/example for the 20 words; the file path
    carries them verbatim."""
    a = vocab_service.get_article("technology", "cutting-edge")
    assert a is not None
    assert a["definition_en"] == "using the newest and most advanced ideas, methods or technology in a field."
    assert a["example"].startswith("Public funding for cutting-edge research")
    assert a["part_of_speech"] == "adjective"
