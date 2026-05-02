"""Regression pin: grammar content loader must skip `_archive/` paths.

Sprint 0 (2026-05-02) introduced `backend/content/_archive/` as the
canonical location for archived grammar articles (drops + future merge
sources).  Without an explicit exclusion in `_load_all`, the loader's
`rglob('*.md')` would re-include archived files at runtime, defeating
the archive.

This test creates a temporary `_archive/` subtree containing a sentinel
slug, instantiates a fresh GrammarContent against the real CONTENT_DIR,
and asserts the sentinel is absent from the loaded slug index.
"""
from __future__ import annotations

import sys
from pathlib import Path
import importlib

sys.path.insert(0, str(Path(__file__).parent.parent))

import services.grammar_content as gc_mod


SENTINEL_SLUG = "archive-exclusion-sentinel"
SENTINEL_BODY = """---
slug: archive-exclusion-sentinel
title: "Archive Exclusion Sentinel"
category: foundations
group: foundations
tier: SUPPORTING
status: active
---

This file is a regression sentinel. It lives under `_archive/` and must
NOT be loaded by the grammar service.
"""


def test_loader_skips_archive_subtree(tmp_path):
    archive_dir = gc_mod.CONTENT_DIR / "_archive" / "_test_sentinel"
    sentinel_path = archive_dir / f"{SENTINEL_SLUG}.md"
    archive_dir.mkdir(parents=True, exist_ok=True)
    sentinel_path.write_text(SENTINEL_BODY, encoding="utf-8")

    try:
        importlib.reload(gc_mod)
        service = gc_mod.GrammarContentService()

        assert SENTINEL_SLUG not in service.articles_by_slug, (
            f"Loader picked up `{SENTINEL_SLUG}` from _archive/. "
            "The `_archive` exclusion in services/grammar_content.py "
            "_load_all has regressed."
        )

        assert service.articles_by_slug, "Loader should still load active content"
    finally:
        sentinel_path.unlink(missing_ok=True)
        try:
            archive_dir.rmdir()
            (archive_dir.parent).rmdir()
        except OSError:
            pass
