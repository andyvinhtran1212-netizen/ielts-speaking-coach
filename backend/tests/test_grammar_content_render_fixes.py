"""Pin: Grammar Wiki rendering fixes from the 2026-10-27 content audit.

- `~~wrong form~~` renders as `<del>` instead of literal tildes (29 spans in
  9 articles showed the raw `~~`).
- Contractions keep the apostrophe attached to the subject: `I**'m living**`
  renders "I'm living", not "I 'm living".
- Internal article links carry their category (`/grammar/<category>/<slug>`)
  and resolve to a live article.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import markdown

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.grammar_content import _MD_EXTENSIONS, grammar_service

_TAG_RE = re.compile(r"<[^>]+>")
_CODE_RE = re.compile(r"<(code|pre)\b.*?</\1>", re.S)
_INTERNAL_HREF_RE = re.compile(r'href="/grammar/([^"#?]+)"')
# App routes under /grammar/ that are not `[category]/[slug]` articles.
_ONE_SEGMENT_ROUTES = {"compare", "exercises", "roadmap", "search"}


def _render(text: str) -> str:
    return markdown.Markdown(extensions=_MD_EXTENSIONS).convert(text)


def _visible_text(html: str) -> str:
    return _TAG_RE.sub("", _CODE_RE.sub("", html))


def test_strikethrough_renders_del_and_keeps_inner_emphasis():
    assert _render("| ~~advices~~ |") .count("<del>advices</del>") == 1
    assert "<del><strong>economical</strong> migrants</del>" in _render("~~**economical** migrants~~")
    # Code spans keep the tildes literally.
    assert "<code>~~x~~</code>" in _render("`~~x~~`")


def test_no_article_shows_literal_strikethrough_markers():
    leaks = [slug for slug, a in grammar_service.articles_by_slug.items()
             if "~~" in _visible_text(a["html"])]
    assert leaks == []


def test_struck_wrong_forms_render_as_del():
    html = grammar_service.articles_by_slug["articles-a-an-sound-rules"]["html"]
    assert "<del>an</del> university" in html
    nouns = grammar_service.articles_by_slug["nouns"]["html"]
    assert "<del>advices</del>" in nouns


def test_contractions_are_not_split_from_their_subject():
    for slug in ("present-continuous", "present-simple"):
        text = _visible_text(grammar_service.articles_by_slug[slug]["html"])
        split = re.findall(r"\b\w+ '(?:m|s|re)\b", text)
        assert split == [], (slug, split)
    pc = grammar_service.articles_by_slug["present-continuous"]["html"]
    assert "I<strong>'m living</strong> with my parents" in pc
    assert "Hold on, I<strong>'m talking</strong> to someone." in pc
    assert "**" not in _visible_text(pc)


def test_internal_article_links_resolve_with_category():
    broken = []
    for slug, a in grammar_service.articles_by_slug.items():
        for target in _INTERNAL_HREF_RE.findall(a["html"]):
            parts = target.strip("/").split("/")
            if len(parts) == 1 and parts[0] in _ONE_SEGMENT_ROUTES:
                continue
            if len(parts) != 2 or grammar_service.get_article(parts[0], parts[1]) is None:
                broken.append((slug, target))
    assert broken == []
    dm = grammar_service.articles_by_slug["discourse-markers"]["html"]
    assert 'href="/grammar/grammar-for-meaning/discourse-markers-spoken"' in dm
