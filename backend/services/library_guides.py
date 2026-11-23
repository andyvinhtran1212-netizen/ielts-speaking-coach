"""Kiến thức Writing for the public Library (LIBRARY-0061 T011 = G06-T11).

Pure helpers for ``routers/library.py`` (no database access here):

* ``guide_groups``      the four fixed groups of FR-020, mapped from the legacy
                        ``writing_tips`` columns (spec open question 4: mapped
                        in code, no migration).
* ``render_guide``      Markdown -> HTML on the server. Raw HTML in the body is
                        never passed through: it is shown as text. Link and
                        image URLs are limited to safe schemes.
* sample citations      ``[[sample:<slug>#<band>]]`` becomes a quote card (on
                        its own line) or a link (inline) built from the
                        published ``writing_samples`` row, so the quote follows
                        the sample. A citation of a missing or unpublished
                        sample, or of an unknown band, is dropped from the HTML
                        (FR-022).
"""

from __future__ import annotations

import html
import math
import re
import unicodedata
from typing import Any, Callable, Optional
from urllib.parse import quote

import markdown

# FR-020: fixed order Task 1 · Task 2 · Tiêu chí chấm · Dạng đề.
GROUPS: tuple[tuple[str, str], ...] = (
    ("task1", "Task 1"),
    ("task2", "Task 2"),
    ("criteria", "Tiêu chí chấm"),
    ("question-type", "Dạng đề"),
)
GROUP_LABELS = dict(GROUPS)

# Spec open question 4: ``task_1`` -> Task 1, ``task_2`` -> Task 2, ``both`` ->
# both; a ``category`` that names the criteria or the question types adds that
# group. Spelling variants seen in admin input are folded to one key.
_CATEGORY_GROUP = {
    "criteria": "criteria",
    "criterion": "criteria",
    "tieu-chi": "criteria",
    "tieu-chi-cham": "criteria",
    "question-type": "question-type",
    "question-types": "question-type",
    "dang-de": "question-type",
}

BANDS = ("7.5", "7.0", "6.0")
WORDS_PER_MINUTE = 200
SUMMARY_MAX = 180

_CITE_RE = re.compile(r"\[\[sample:([a-z0-9][a-z0-9-]*)#(\d\.\d)\]\]")
_TOKEN = "AVERSAMPLECITE{}Z"
_TOKEN_RE = re.compile(r"AVERSAMPLECITE(\d+)Z")
_BLOCK_TOKEN_RE = re.compile(r"<p>\s*AVERSAMPLECITE(\d+)Z\s*</p>")
_SAFE_URL_RE = re.compile(r"^(?:https?://|mailto:|/(?!/)|#)", re.IGNORECASE)
_URL_ATTR_RE = re.compile(r'\s(href|src)="([^"]*)"')


def _fold(value: Any) -> str:
    """``"Tiêu chí chấm"`` -> ``"tieu-chi-cham"``: no accents, one dash."""
    text = unicodedata.normalize("NFKD", str(value or "").strip().casefold()).replace("đ", "d")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[\s_]+", "-", text)


def guide_groups(row: dict) -> list[str]:
    """Group ids of one guide, in the fixed order of ``GROUPS``."""
    found = set()
    task = row.get("task_type")
    if task in ("task_1", "both"):
        found.add("task1")
    if task in ("task_2", "both"):
        found.add("task2")
    category_group = _CATEGORY_GROUP.get(_fold(row.get("category")))
    if category_group:
        found.add(category_group)
    return [gid for gid, _ in GROUPS if gid in found]


def reading_minutes(text: str) -> int:
    """Minutes for the guide's own words: citations (quoted from a sample) are
    not counted, so the list and the guide page always agree."""
    words = len(re.sub(r"<[^>]+>", " ", _CITE_RE.sub(" ", text or "")).split())
    return max(1, math.ceil(words / WORDS_PER_MINUTE))


def plain_summary(body_markdown: str) -> str:
    """First prose paragraph of the body as plain text, for the list."""
    for block in re.split(r"\n\s*\n", body_markdown or ""):
        text = block.strip()
        if not text or text.startswith(("#", "|", "```", "-", "*", ">", "[[")) or re.match(r"\d+\.\s", text):
            continue
        text = _CITE_RE.sub("", text)
        text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
        text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
        text = re.sub(r"<[^>]*>", "", text)
        text = re.sub(r"[*_`]+", "", text)
        text = " ".join(text.split())
        if not text:
            continue
        if len(text) > SUMMARY_MAX:
            text = text[:SUMMARY_MAX].rsplit(" ", 1)[0].rstrip(",.;:") + "…"
        return text
    return ""


def cited_slugs(body_markdown: str) -> list[str]:
    seen: list[str] = []
    for slug, _band in _CITE_RE.findall(body_markdown or ""):
        if slug not in seen:
            seen.append(slug)
    return seen


def _first_paragraph(text: Any) -> str:
    for part in re.split(r"\n\s*\n", str(text or "")):
        part = " ".join(part.split())
        if part:
            return part
    return ""


def sample_href(slug: str, band: str) -> str:
    return f"/library/writing-samples/{quote(slug)}?muc={band}"


def _cite_card(sample: dict, band: str) -> str:
    essays = sample.get("essays") if isinstance(sample.get("essays"), dict) else {}
    essay = essays.get(band) if isinstance(essays.get(band), dict) else {}
    quote_text = _first_paragraph(essay.get("text"))
    title = html.escape(str(sample.get("title_en") or sample.get("slug") or ""))
    href = html.escape(sample_href(str(sample["slug"]), band))
    parts = [
        '<figure class="sample-cite">',
        f'<figcaption>Bài mẫu Writing · {title} · bản {band}</figcaption>',
    ]
    if quote_text:
        parts.append(f'<blockquote lang="en"><p>{html.escape(quote_text)}</p></blockquote>')
    parts.append(f'<a class="sample-cite-open" href="{href}">Mở đề này, bản {band}</a>')
    parts.append("</figure>")
    return "".join(parts)


def _cite_link(sample: dict, band: str) -> str:
    title = html.escape(str(sample.get("title_en") or sample.get("slug") or ""))
    href = html.escape(sample_href(str(sample["slug"]), band))
    return f'<a class="sample-cite-link" href="{href}">{title} (bản {band})</a>'


def _safe_urls(rendered: str) -> str:
    def fix(match: re.Match) -> str:
        url = html.unescape(match.group(2)).strip()
        return match.group(0) if _SAFE_URL_RE.match(url) else f' {match.group(1)}="#"'

    return _URL_ATTR_RE.sub(fix, rendered)


def _markdown() -> markdown.Markdown:
    md = markdown.Markdown(
        extensions=["tables", "toc", "sane_lists"],
        extension_configs={"toc": {"slugify": _slugify, "toc_depth": "2-3"}},
    )
    # Raw HTML is never passed through (T011): block and inline HTML are shown
    # as text instead of being rendered.
    md.preprocessors.deregister("html_block")
    md.inlinePatterns.deregister("html")
    return md


def _slugify(value: str, separator: str) -> str:
    text = unicodedata.normalize("NFKD", value).replace("đ", "d").replace("Đ", "D")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^\w\s-]", "", text).strip().lower()
    return re.sub(r"[\s_-]+", separator, text) or "muc"


def _toc(md: markdown.Markdown) -> list[dict]:
    """Numbered H2 sections (1, 2, …) with their H3 children (2.1, 2.2, …)."""
    out: list[dict] = []
    for i, token in enumerate(getattr(md, "toc_tokens", []) or [], start=1):
        out.append({"id": token["id"], "label": html.unescape(token["name"]), "n": str(i)})
    return out


def render_guide(
    body_markdown: str,
    samples: dict[str, dict],
) -> dict:
    """``{html, toc, reading_minutes}`` for one guide.

    ``samples`` maps slug -> published ``writing_samples`` row (``slug``,
    ``title_en``, ``essays``). A citation whose slug is not in it, or whose
    band is not 7.5/7.0/6.0, is removed.
    """
    resolved: list[Optional[tuple[dict, str]]] = []

    def stash(match: re.Match) -> str:
        slug, band = match.group(1), match.group(2)
        sample = samples.get(slug)
        resolved.append((sample, band) if sample and band in BANDS else None)
        return _TOKEN.format(len(resolved) - 1)

    source = _CITE_RE.sub(stash, body_markdown or "")
    md = _markdown()
    rendered = md.convert(source)

    def block(match: re.Match) -> str:
        item = resolved[int(match.group(1))]
        return _cite_card(*item) if item else ""

    def inline(match: re.Match) -> str:
        item = resolved[int(match.group(1))]
        return _cite_link(*item) if item else ""

    rendered = _BLOCK_TOKEN_RE.sub(block, rendered)
    rendered = _TOKEN_RE.sub(inline, rendered)
    rendered = _safe_urls(rendered)
    return {"html": rendered, "toc": _toc(md), "reading_minutes": reading_minutes(body_markdown or "")}


SampleLoader = Callable[[list[str]], dict[str, dict]]
