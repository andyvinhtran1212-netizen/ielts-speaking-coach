"""Validated, code-native learning blocks for Grammar Wiki articles.

Article prose remains canonical Markdown.  Editors opt into a small set of
structured blocks in frontmatter and place them with
``<!-- learning-block: block-id -->`` markers.  This module renders only known
fields and escapes every editorial string; arbitrary HTML/script in YAML is
never trusted.
"""
from __future__ import annotations

from html import escape
import re
from typing import Any


BLOCK_MARKER_RE = re.compile(r"<!--\s*learning-block:\s*([\w.\-]+)\s*-->")
ALLOWED_TYPES = frozenset({"check", "visual", "repair", "transfer", "takeaways"})
ALLOWED_VISUALS = frozenset({"decision-tree", "timeline", "sentence-xray", "chart-map", "flow"})
ALLOWED_KINDS = frozenset({"precheck", "microcheck"})
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9.\-]*$")


def _text(value: Any) -> str:
    return str(value or "").strip()


def validate_learning_blocks(raw_blocks: Any, body: str = "") -> tuple[list[dict], list[str]]:
    """Return normalized blocks and human-readable validation errors."""
    if raw_blocks in (None, []):
        marker_ids = BLOCK_MARKER_RE.findall(body)
        return [], [f"marker '{block_id}' has no frontmatter block" for block_id in marker_ids]
    if not isinstance(raw_blocks, list):
        return [], ["learning_blocks must be a list"]

    blocks: list[dict] = []
    errors: list[str] = []
    seen: set[str] = set()
    for index, raw in enumerate(raw_blocks):
        prefix = f"learning_blocks[{index}]"
        if not isinstance(raw, dict):
            errors.append(f"{prefix} must be an object")
            continue
        block_id = _text(raw.get("id"))
        block_type = _text(raw.get("type"))
        if not _ID_RE.fullmatch(block_id):
            errors.append(f"{prefix}.id must be lowercase kebab/dot notation")
            continue
        if block_id in seen:
            errors.append(f"duplicate learning block id '{block_id}'")
            continue
        seen.add(block_id)
        if block_type not in ALLOWED_TYPES:
            errors.append(f"{prefix}.type '{block_type}' is not supported")
            continue

        block = {
            "id": block_id,
            "type": block_type,
            "eyebrow": _text(raw.get("eyebrow")),
            "title": _text(raw.get("title")),
            "intro": _text(raw.get("intro")),
        }
        if not block["title"]:
            errors.append(f"{prefix}.title is required")

        if block_type == "check":
            kind = _text(raw.get("kind")) or "microcheck"
            prompt = _text(raw.get("prompt"))
            options_raw = raw.get("options")
            correct_index = raw.get("correct_index")
            if kind not in ALLOWED_KINDS:
                errors.append(f"{prefix}.kind '{kind}' is not supported")
            if not prompt:
                errors.append(f"{prefix}.prompt is required")
            if not isinstance(options_raw, list) or len(options_raw) < 2:
                errors.append(f"{prefix}.options must contain at least 2 options")
                options_raw = []
            options = []
            for option_index, option in enumerate(options_raw):
                if not isinstance(option, dict) or not _text(option.get("text")):
                    errors.append(f"{prefix}.options[{option_index}].text is required")
                    continue
                options.append({
                    "text": _text(option.get("text")),
                    "feedback": _text(option.get("feedback")),
                })
            if not isinstance(correct_index, int) or not 0 <= correct_index < len(options):
                errors.append(f"{prefix}.correct_index is outside options")
                correct_index = -1
            block.update({
                "kind": kind,
                "prompt": prompt,
                "options": options,
                "correct_index": correct_index,
                "kp_anchor": _text(raw.get("kp_anchor")),
            })
        elif block_type == "visual":
            variant = _text(raw.get("variant"))
            items_raw = raw.get("items")
            if variant not in ALLOWED_VISUALS:
                errors.append(f"{prefix}.variant '{variant}' is not supported")
            if not isinstance(items_raw, list) or len(items_raw) < 2:
                errors.append(f"{prefix}.items must contain at least 2 items")
                items_raw = []
            items = []
            for item_index, item in enumerate(items_raw):
                if not isinstance(item, dict) or not _text(item.get("label")):
                    errors.append(f"{prefix}.items[{item_index}].label is required")
                    continue
                items.append({
                    "label": _text(item.get("label")),
                    "value": _text(item.get("value")),
                    "note": _text(item.get("note")),
                    "tone": _text(item.get("tone")) or "teal",
                })
            block.update({"variant": variant, "items": items})
        elif block_type == "repair":
            for field in ("before", "reason", "after"):
                block[field] = _text(raw.get(field))
                if not block[field]:
                    errors.append(f"{prefix}.{field} is required")
        elif block_type == "transfer":
            block.update({
                "context": _text(raw.get("context")),
                "before": _text(raw.get("before")),
                "after": _text(raw.get("after")),
                "tip": _text(raw.get("tip")),
            })
            if not block["after"]:
                errors.append(f"{prefix}.after is required")
        elif block_type == "takeaways":
            items_raw = raw.get("items")
            if not isinstance(items_raw, list) or not items_raw:
                errors.append(f"{prefix}.items must not be empty")
                items_raw = []
            block["items"] = [_text(item) for item in items_raw if _text(item)]

        blocks.append(block)

    marker_ids = BLOCK_MARKER_RE.findall(body)
    marker_set = set(marker_ids)
    for block_id in seen - marker_set:
        errors.append(f"block '{block_id}' has no body marker")
    for block_id in marker_set - seen:
        errors.append(f"marker '{block_id}' has no frontmatter block")
    for block_id in set(marker_ids):
        if marker_ids.count(block_id) > 1:
            errors.append(f"marker '{block_id}' appears more than once")
    return blocks, errors


def _header(block: dict) -> str:
    eyebrow = escape(block.get("eyebrow") or "Học bằng hình")
    title = escape(block.get("title") or "")
    intro = escape(block.get("intro") or "")
    intro_html = f'<p class="gw-lab-intro">{intro}</p>' if intro else ""
    return (
        f'<div class="gw-lab-heading"><span class="gw-lab-eyebrow">{eyebrow}</span>'
        f'<h3>{title}</h3>{intro_html}</div>'
    )


def render_learning_block(block: dict, *, article_slug: str) -> str:
    """Render one already-normalized block using only escaped values."""
    block_id = escape(block["id"], quote=True)
    block_type = block["type"]
    common = (
        f'<section class="gw-lab gw-lab--{escape(block_type)}" '
        f'data-learning-block="{block_id}" aria-labelledby="{block_id}-title">'
    )
    # Keep an explicit id on the first heading for aria-labelledby.
    header = _header(block).replace("<h3>", f'<h3 id="{block_id}-title">', 1)

    if block_type == "check":
        prompt = escape(block["prompt"])
        options = []
        for index, option in enumerate(block["options"]):
            options.append(
                f'<button type="button" class="gw-check-option" data-option-index="{index}" '
                f'data-feedback="{escape(option.get("feedback") or "", quote=True)}">'
                f'<span class="gw-check-key">{chr(65 + index)}</span>'
                f'<span>{escape(option["text"])}</span></button>'
            )
        body = (
            f'<div class="gw-check" data-correct-index="{block["correct_index"]}" '
            f'data-kp-anchor="{escape(block.get("kp_anchor") or "", quote=True)}" '
            f'data-article-slug="{escape(article_slug, quote=True)}">'
            f'<p class="gw-check-prompt">{prompt}</p>'
            f'<div class="gw-check-options">{"".join(options)}</div>'
            '<p class="gw-check-feedback" role="status" aria-live="polite"></p></div>'
        )
    elif block_type == "visual":
        items = []
        for index, item in enumerate(block["items"]):
            note = f'<small>{escape(item["note"])}</small>' if item.get("note") else ""
            items.append(
                f'<li class="gw-visual-item gw-tone-{escape(item["tone"], quote=True)}">'
                f'<span class="gw-visual-index" aria-hidden="true">{index + 1}</span>'
                f'<div><strong>{escape(item["label"])}</strong>'
                f'<span>{escape(item.get("value") or "")}</span>{note}</div></li>'
            )
        variant = escape(block["variant"], quote=True)
        body = f'<ol class="gw-visual gw-visual--{variant}">{"".join(items)}</ol>'
    elif block_type == "repair":
        body = (
            '<div class="gw-repair-grid">'
            f'<div class="gw-repair-before"><span>Chưa ổn</span><p>{escape(block["before"])}</p></div>'
            f'<div class="gw-repair-reason"><span>Chẩn đoán</span><p>{escape(block["reason"])}</p></div>'
            f'<div class="gw-repair-after"><span>Sửa thành</span><p>{escape(block["after"])}</p></div>'
            '</div>'
        )
    elif block_type == "transfer":
        context = f'<span class="gw-transfer-context">{escape(block["context"])}</span>' if block.get("context") else ""
        before = f'<p class="gw-transfer-before">{escape(block["before"])}</p>' if block.get("before") else ""
        tip = f'<p class="gw-transfer-tip">💡 {escape(block["tip"])}</p>' if block.get("tip") else ""
        body = f'<div class="gw-transfer">{context}{before}<p class="gw-transfer-after">{escape(block["after"])}</p>{tip}</div>'
    else:
        items = "".join(f'<li>{escape(item)}</li>' for item in block["items"])
        body = f'<ul class="gw-takeaways">{items}</ul>'
    return f"{common}{header}{body}</section>"


def inject_learning_blocks(html: str, blocks: list[dict], *, article_slug: str) -> str:
    """Replace known markers in rendered Markdown; leave no executable input."""
    by_id = {block["id"]: block for block in blocks}

    def replace(match: re.Match) -> str:
        block = by_id.get(match.group(1))
        return render_learning_block(block, article_slug=article_slug) if block else ""

    return BLOCK_MARKER_RE.sub(replace, html)
