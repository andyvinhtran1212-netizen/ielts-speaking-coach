"""Reviewed editorial text for immutable source-book question content.

Revisions are bound to both the stable item ID and its original explanation.
Only protected feedback/study delivery opts in; marking and source rows retain
their original answers, evidence and review provenance.
"""
from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

CONTENT = Path(__file__).resolve().parents[1] / "content/listening/80-days-explanations-v2.json"
TEXT_FIELDS = frozenset({"why_vi", "paraphrase_vi", "trap_vi", "format_vi", "next_action_vi", "distractors"})


def explanation_digest(explanation: dict) -> str:
    value = json.dumps(explanation, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@lru_cache(maxsize=1)
def _revision() -> dict:
    content = json.loads(CONTENT.read_text(encoding="utf-8"))
    if content.get("schema_version") != "80-days-explanation-editorial/2":
        raise ValueError("Invalid source explanation editorial revision")
    rows = content["items"]
    for item_id, row in rows.items():
        if not item_id.startswith("80-days:day-") or set(row["changes"]) - TEXT_FIELDS:
            raise ValueError("Editorial revision changes protected source fields")
    return rows


def revised_explanation(explanation: dict, item_id: str | None) -> dict[str, Any]:
    if not item_id:
        return explanation
    row = _revision().get(item_id)
    if not row or explanation_digest(explanation) != row["source_explanation_sha256"]:
        return explanation
    return {**explanation, **row["changes"]}
