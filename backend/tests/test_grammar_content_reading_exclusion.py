"""Regression pin (audit 2026-07-03 D1): the grammar content loader must NOT
index Reading/Listening content.

`_load_all` rglobs all of `backend/content/**/*.md`. Reading passages/tests live
under `backend/content/reading/` with `content_type: reading_passage_*`. Without a
`content_type` filter in `_parse_file`, those files were indexed as Grammar Wiki
articles (leaking into categories, search, and sitemap). This test drops a
sentinel reading file at the real CONTENT_DIR and asserts it is excluded.
"""
from __future__ import annotations

import sys
from pathlib import Path
import importlib

sys.path.insert(0, str(Path(__file__).parent.parent))

import services.grammar_content as gc_mod


SENTINEL_SLUG = "reading-exclusion-sentinel"
SENTINEL_BODY = """---
content_type: reading_passage_l1
slug: reading-exclusion-sentinel
title: "Reading Exclusion Sentinel"
category: reading
---

This is a Reading passage. It must NOT appear in the Grammar Wiki index.
"""


def test_loader_excludes_reading_content(tmp_path):
    reading_dir = gc_mod.CONTENT_DIR / "_test_reading_sentinel"
    sentinel_path = reading_dir / f"{SENTINEL_SLUG}.md"
    reading_dir.mkdir(parents=True, exist_ok=True)
    sentinel_path.write_text(SENTINEL_BODY, encoding="utf-8")

    try:
        importlib.reload(gc_mod)
        service = gc_mod.GrammarContentService()

        assert SENTINEL_SLUG not in service.articles_by_slug, (
            "Loader indexed a content_type=reading_* file as a grammar article. "
            "The content_type filter in services/grammar_content.py _parse_file "
            "has regressed (audit D1)."
        )
        # A real reading category must never surface from the grammar loader.
        cats = {str(a.get("category", "")).lower() for a in service.articles_by_slug.values()}
        assert "reading" not in cats, f"'reading' leaked into grammar categories: {cats}"

        assert service.articles_by_slug, "Loader should still load active grammar content"
    finally:
        sentinel_path.unlink(missing_ok=True)
        try:
            reading_dir.rmdir()
        except OSError:
            pass
