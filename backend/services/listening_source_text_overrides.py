"""Reviewed display-text corrections for the immutable 80-day source revision.

Package rows are trigger-protected and bound by digests, so stray Chinese
fragments are corrected at the read boundary instead. Each override binds the
active source manifest and the SHA-256 of the exact original text and replaces
one fragment only. Any other manifest or text is returned unchanged. Binding
digests are always computed on the original rows, never on corrected text.
"""
from __future__ import annotations

from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re

CONTENT = Path(__file__).resolve().parents[1] / "content/listening/80-days-text-overrides-v1.json"
FIELDS = re.compile(r"^(instruction\.source_en|description|options\.[A-Za-z0-9]+)$")
CJK = re.compile("[　-〿぀-ヿ㐀-䶿一-鿿가-힯＀-￯]")


@lru_cache(maxsize=1)
def revision() -> dict:
    content = json.loads(CONTENT.read_text(encoding="utf-8"))
    if content.get("schema_version") != "80-days-text-overrides/1":
        raise ValueError("Invalid source text override revision")
    index = {}
    for row in content["overrides"]:
        key = (row["block_id"], row.get("item_id"), row["field"])
        if (key in index or not FIELDS.match(row["field"]) or not CJK.search(row["find"])
                or CJK.search(row["replace"]) or not re.fullmatch(r"[0-9a-f]{64}", row["source_sha256"])):
            raise ValueError("Invalid source text override")
        index[key] = row
    return {"source_manifest_sha256": content["source_manifest_sha256"], "index": index}


def override_text(value, *, field: str, block_id: str | None, manifest_sha256: str | None,
                  item_id: str | None = None):
    """Return the reviewed correction only for this exact source text."""
    content = revision()
    if not isinstance(value, str) or not manifest_sha256 or manifest_sha256 != content["source_manifest_sha256"]:
        return value
    row = content["index"].get((block_id, item_id, field))
    if (not row or hashlib.sha256(value.encode()).hexdigest() != row["source_sha256"]
            or value.count(row["find"]) != 1):
        return value
    return value.replace(row["find"], row["replace"])


def override_question_options(question: dict, *, manifest_sha256: str | None) -> dict:
    options = question.get("options")
    if not isinstance(options, dict):
        return question
    return {**question, "options": {key: override_text(
        label, field=f"options.{key}", block_id=question.get("source_block_id"),
        item_id=question.get("source_item_id"), manifest_sha256=manifest_sha256)
        for key, label in options.items()}}
