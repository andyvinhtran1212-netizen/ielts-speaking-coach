"""services/writing_render.py — HTML render for Writing Coach feedback (Sprint W3).

Renders WritingFeedback + essay context into a self-contained HTML
document. The same document is consumed by:
  • clipboard copy (text/html MIME) — Andy pastes into Google Docs
  • Word export — Phase 2 builds .docx natively from the same data,
    not from this HTML, but the template structure is the contract.

Inline CSS lives in the template so headings/tables/highlights survive
clipboard paste into Google Docs.
"""

from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Iterable

from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup

from models.writing_feedback import WritingFeedback


_TEMPLATE_DIR = Path(__file__).parent.parent / "templates"

_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATE_DIR)),
    autoescape=select_autoescape(["html", "j2", "html.j2"]),
    trim_blocks=True,
    lstrip_blocks=True,
)


_TASK_LABELS: dict[str, str] = {
    "task1_academic": "Task 1 Academic Analysis",
    "task1_general":  "Task 1 General Analysis",
    "task2":          "Task 2 Analysis",
}


# ── Public API ───────────────────────────────────────────────────────

def render_feedback_html(
    *,
    feedback: WritingFeedback,
    essay_text: str,
    prompt_text: str,
    task_type: str,
    student_name: str,
) -> str:
    """Render feedback as a self-contained HTML document."""
    template = _env.get_template("writing/output.html.j2")
    highlighted = _highlight_mistakes(essay_text, feedback)
    return template.render(
        feedback=feedback,
        essay_text=essay_text,
        prompt_text=prompt_text,
        task_type=task_type,
        task_type_label=_TASK_LABELS.get(task_type, "Writing Analysis"),
        student_name=student_name,
        highlighted_essay=highlighted,
    )


_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE  = re.compile(r"[ \t\r]+")


def render_plain_text(html_text: str) -> str:
    """Strip HTML to a clipboard-friendly plain-text fallback."""
    # Block-level tags become newline boundaries for readability.
    text = re.sub(r"</(?:p|tr|h1|h2|h3|li|ul|table)>", "\n", html_text, flags=re.I)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = _TAG_RE.sub("", text)
    text = html.unescape(text)
    # Tighten whitespace; keep paragraph blank lines.
    text = _WS_RE.sub(" ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ── Highlighter (escapes input itself, then returns Markup) ──────────

def _highlight_mistakes(essay_text: str, feedback: WritingFeedback) -> Markup:
    """Wrap each mistake's `original` substring in <mark> inside an escaped
    paragraph block. We escape the input ourselves and return Markup so
    Jinja's autoescape leaves the <mark>/<p> tags intact.

    Uses a single non-overlapping regex pass so a longer phrase that
    contains a shorter mistake-substring doesn't end up with nested
    <mark> tags. Sorting alternatives longest-first lets Python's
    left-to-right alternation pick the longer match at any position.
    """
    if not essay_text:
        return Markup("")

    originals: list[str] = []
    seen: set[str] = set()
    for m in feedback.mistakeAnalysis or []:
        s = (m.original or "").strip()
        if s and s not in seen:
            originals.append(s)
            seen.add(s)
    originals.sort(key=len, reverse=True)

    pattern = (
        re.compile("|".join(re.escape(o) for o in originals))
        if originals else None
    )

    paragraphs: list[str] = []
    for raw_para in essay_text.split("\n\n"):
        if not raw_para.strip():
            continue
        if pattern is None:
            paragraphs.append(f"<p>{html.escape(raw_para)}</p>")
            continue
        chunks: list[str] = []
        last = 0
        for match in pattern.finditer(raw_para):
            chunks.append(html.escape(raw_para[last:match.start()]))
            chunks.append(f"<mark>{html.escape(match.group(0))}</mark>")
            last = match.end()
        chunks.append(html.escape(raw_para[last:]))
        paragraphs.append(f"<p>{''.join(chunks)}</p>")

    return Markup("".join(paragraphs))


# ── Internal helpers exposed for tests ───────────────────────────────

def _iter_mistake_originals(feedback: WritingFeedback) -> Iterable[str]:
    for m in feedback.mistakeAnalysis or []:
        if m.original:
            yield m.original
