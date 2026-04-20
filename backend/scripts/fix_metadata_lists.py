from __future__ import annotations

import glob
from pathlib import Path
from typing import Any

import yaml

TARGET_FIELDS = [
    "tags",
    "band_relevance",
    "common_error_tags",
    "next_articles",
    "pathways",
]

CONTENT_GLOB = "content/**/*.md"


def stringify_list_items(value: Any) -> tuple[Any, bool]:
    """
    If value is a list, convert every non-None item to str.
    Returns (new_value, changed).
    """
    if not isinstance(value, list):
        return value, False

    changed = False
    new_items: list[str] = []

    for item in value:
        if item is None:
            changed = True
            continue
        if not isinstance(item, str):
            changed = True
        new_items.append(str(item))

    return new_items, changed


def split_frontmatter(text: str) -> tuple[str | None, str | None]:
    """
    Returns (frontmatter_text, body_text) if file starts with YAML frontmatter,
    else (None, None).
    """
    if not text.startswith("---\n"):
        return None, None

    parts = text.split("---", 2)
    if len(parts) < 3:
        return None, None

    # parts[1] = frontmatter, parts[2] = body
    return parts[1], parts[2]


def dump_frontmatter(meta: dict[str, Any]) -> str:
    """
    Dump YAML in a readable, stable format.
    """
    return yaml.safe_dump(
        meta,
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=False,
        width=1000,
    ).strip()


def process_file(path: Path) -> bool:
    raw = path.read_text(encoding="utf-8")
    frontmatter_text, body = split_frontmatter(raw)
    if frontmatter_text is None or body is None:
        return False

    meta = yaml.safe_load(frontmatter_text) or {}
    if not isinstance(meta, dict):
        return False

    changed = False

    for field in TARGET_FIELDS:
        if field in meta:
            new_value, field_changed = stringify_list_items(meta[field])
            if field_changed:
                meta[field] = new_value
                changed = True

    if not changed:
        return False

    new_frontmatter = dump_frontmatter(meta)
    new_raw = f"---\n{new_frontmatter}\n---{body}"

    path.write_text(new_raw, encoding="utf-8")
    return True


def main() -> None:
    files = sorted(Path(".").glob(CONTENT_GLOB))
    changed_files: list[str] = []

    for path in files:
        try:
            if process_file(path):
                changed_files.append(str(path))
        except Exception as exc:
            print(f"[ERROR] {path}: {exc}")

    print(f"\nChanged files: {len(changed_files)}")
    for f in changed_files:
        print(f"- {f}")


if __name__ == "__main__":
    main()
