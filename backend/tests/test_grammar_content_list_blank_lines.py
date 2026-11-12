"""G03: authored lists need separation from ordinary prose in Python-Markdown."""
from pathlib import Path
import re

import markdown
from markdown.extensions.fenced_code import FencedBlockPreprocessor
import pytest

_CONTENT = Path(__file__).resolve().parents[1] / "content"
# Quiz-bank sources whose bytes are pinned by the exact-form parser fixture
# (frontend/tests/grammar-exact-form-engine.test.mjs, spec 0019 after_sha256).
# Editing them needs a fixture regeneration, so G03 leaves them unchanged.
_HASH_PINNED = {
    "foundations/phrase-vs-clause.md",
    "tenses/past-perfect.md",
}
_FRONTMATTER = re.compile(r"\A---\n.*?\n---(?:\n|\Z)", re.S)
_LIST = re.compile(r"^(?:[-*+] |\d+[.)] )")
_BOUNDARY = re.compile(r"^ {0,3}(?:=+|-+|(?:[-_*] *){3,})$")


def list_blank_line_candidates(raw):
    """Return safe insertion line indexes and (index, reason) exclusions.

    Blank-delimited list/quote blocks include their lazy continuations. HTML
    ranges and fences use Python-Markdown's own preprocessors; ambiguous syntax
    is excluded rather than interpreted as ordinary prose. Indexes are zero based.
    """
    text = raw.replace("\r\n", "\n")
    frontmatter = _FRONTMATTER.match(text)
    if not frontmatter:
        return [], [(0, "missing/invalid YAML frontmatter; body unknown")]
    start = text[:frontmatter.end()].count("\n")
    lines = text.splitlines()
    body = "\n".join(lines[start:]) + "\n"
    protected = {}

    def protect(begin, end, reason):
        first = start + body[:begin].count("\n")
        last = start + body[:end].count("\n")
        for index in range(first, last + 1):
            protected[index] = reason

    for match in FencedBlockPreprocessor.FENCED_BLOCK_RE.finditer(body):
        protect(match.start(), match.end(), "fenced code")
    parser = markdown.Markdown()
    parser.preprocessors["html_block"].run(body.split("\n"))
    offset = 0
    for block in parser.htmlStash.rawHtmlBlocks:
        position = body.find(block, offset)
        if position >= 0:
            protect(position, position + len(block.rstrip("\n")), "HTML block")
            offset = position + len(block)

    safe, skipped = [], []
    context = None
    uncertain_fence = None
    for i in range(start, len(lines)):
        line = lines[i]
        candidate = _LIST.match(line) and i > start and lines[i - 1].strip()
        reason = protected.get(i)
        fence = re.match(r"^\s*(`{3,}|~{3,})", line)
        if not reason and (uncertain_fence or fence):
            reason = "unmatched/nonstandard fence (uncertain)"
            if uncertain_fence and line.rstrip() == uncertain_fence:
                uncertain_fence = None
            elif not uncertain_fence:
                uncertain_fence = fence.group(1)
        if candidate:
            exclusion = ("heading/thematic break" if _BOUNDARY.match(line) else None)
            exclusion = exclusion or reason or protected.get(i - 1) or context
            if exclusion == "prose":
                end = i
                while end < len(lines) and lines[end].strip():
                    end += 1
                following = end
                while following < len(lines) and not lines[following].strip():
                    following += 1
                if following < len(lines) and (
                    _LIST.match(lines[following]) or lines[following].startswith((" ", "\t"))
                ):
                    skipped.append((i, "list resumes after blank (uncertain existing list)"))
                else:
                    safe.append(i)
            else:
                skipped.append((i, exclusion or "uncertain context"))
        if reason:
            context = reason
        elif not line.strip():
            context = None
        elif re.match(r"^ {0,3}#{1,6}(?:\s|$)", line):
            context = "heading"
        elif re.match(r"^ {0,3}>", line):
            context = "blockquote/lazy continuation"
        elif _LIST.match(line):
            context = "list item/continuation"
        elif line.startswith((" ", "\t")):
            context = "indented/list continuation (uncertain)"
        elif "|" in line:
            context = "table/pipe syntax (uncertain)"
        elif re.match(r"^ {0,3}\[.*?\]:", line):
            context = "reference definition/continuation"
        elif re.search(r"<[!/?A-Za-z]", line):
            context = "HTML syntax (uncertain)"
        elif _BOUNDARY.match(line):
            context = "heading/thematic break"
        elif context in (None, "heading", "heading/thematic break"):
            context = "prose"
    return safe, skipped


def test_grammar_content_lists_are_separated_from_prose():
    failures = []
    for path in sorted(_CONTENT.rglob("*.md")):
        relative = path.relative_to(_CONTENT)
        if "_archive" in relative.parts or relative.as_posix() in _HASH_PINNED:
            continue
        indexes, _ = list_blank_line_candidates(path.read_bytes().decode("utf-8"))
        failures.extend(f"{path.relative_to(_CONTENT)}:{i + 1}" for i in indexes)
    assert not failures, "Add a blank line before these lists:\n" + "\n".join(failures)


@pytest.mark.parametrize("marker", ["- ", "* ", "+ ", "1. ", "1) "])
def test_grammar_list_guard_detects_plain_prose(marker):
    assert list_blank_line_candidates("---\ntitle: x\n---\nProse\n" + marker + "item\n")[0] == [4]


@pytest.mark.parametrize("body", [
    "Prose\n\n- item", "- item\nlazy continuation\n- next",
    "> quote\nlazy continuation\n- item", "### Heading\n- item",
    "A | B\n--- | ---\nx | y\n- item", "[link]: /target\n- item",
    "<div>\n\nProse\n- item\n</div>", "<!--\nProse\n- item\n-->",
    "```python\nProse\n- item\n```", "~~~~\n~~~\nProse\n- item\n~~~~",
    "```\nProse\n- item", "    code\n- item",
    "Prose\n- first\n\n- existing list",
    "Title\n--\n- item", "Prose\n* * *", "Prose\n- - -",
])
def test_grammar_list_guard_excludes_special_or_uncertain_blocks(body):
    assert list_blank_line_candidates("---\ntitle: x\n---\n" + body + "\n")[0] == []
