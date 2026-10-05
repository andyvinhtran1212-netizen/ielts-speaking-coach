"""Private native presentation for the immutable 80-day source revision.

Only this checked-in content is eligible; authoring JSON supplied by a caller
never becomes presentation. Original crops bind the revision but are not signed
or returned as question content. Study material is attached after its guard.
"""
from __future__ import annotations

from functools import lru_cache
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

from models.listening_source_collection import SourceInstruction, SourceNativePresentation, SourceOption, SourceResponseField

CONTENT = Path(__file__).resolve().parents[1] / "content/listening/80-days-native-v1.json"
SVG_TAGS = frozenset({"svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "title", "desc", "defs", "marker"})
SVG_ATTRIBUTES = frozenset({"xmlns", "viewBox", "width", "height", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "font-family", "font-size", "font-weight", "text-anchor", "dominant-baseline", "transform", "opacity", "fill-opacity", "stroke-opacity", "id", "marker-end", "marker-start", "markerWidth", "markerHeight", "refX", "refY", "orient", "role", "aria-labelledby", "aria-label"})


def validate_svg(svg: str) -> None:
    if len(svg) > 200_000 or "<!" in svg:
        raise ValueError("Unsafe native source SVG")
    root = ET.fromstring(svg)
    if root.tag != "{http://www.w3.org/2000/svg}svg":
        raise ValueError("Native figure must be SVG")
    for element in root.iter():
        if element.tag.removeprefix("{http://www.w3.org/2000/svg}") not in SVG_TAGS:
            raise ValueError("Unsafe native SVG element")
        for name, value in element.attrib.items():
            if name not in SVG_ATTRIBUTES or any(token in value.lower() for token in ("javascript:", "data:", "http:", "https:", "@import")):
                raise ValueError("Unsafe native SVG attribute")
            if "url(" in value and not (value.startswith("url(#") and value.endswith(")") and value.count("url(") == 1):
                raise ValueError("External native SVG reference")


def block_digest(block: dict) -> str:
    """Bind content, membership and exact archival asset paths to the source."""
    value = {key: block.get(key) for key in ("block_id", "part_id", "kind", "item_ids", "source_question_numbers", "description", "display_kind")}
    value["instruction"] = SourceInstruction.model_validate(block.get("instruction") or {}).model_dump()
    value["shared_options"] = [SourceOption.model_validate(option).model_dump() for option in block.get("shared_options") or []]
    value["images"] = [{key: image.get(key) for key in ("asset_id", "storage_path", "width", "height", "alt_vi")} for image in block.get("images") or []]
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@lru_cache(maxsize=1)
def revision() -> dict:
    content = json.loads(CONTENT.read_text(encoding="utf-8"))
    if content.get("schema_version") != "80-days-native/1":
        raise ValueError("Invalid native source revision")
    for row in content["blocks"].values():
        presentation = SourceNativePresentation.model_validate(row["presentation"])
        for figure in presentation.figures:
            validate_svg(figure.svg)
    return content


def display_question_digest(question: dict) -> str:
    """Bind only learner display/control fields, never answers or transcripts."""
    value = {key: question.get(key) for key in (
        "q_num", "source_item_id", "source_display_number", "source_block_id",
        "prompt", "response_type", "selection_count", "word_limit", "choice_label_only")}
    value["options"] = question.get("options") or {}
    value["fields"] = [SourceResponseField.model_validate(field).model_dump()
                       for field in question.get("fields") or []]
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _bound_row(block: dict, manifest_sha256: str | None) -> dict | None:
    content = revision()
    if not manifest_sha256 or manifest_sha256 != content["source_manifest_sha256"]:
        return None
    row = content["blocks"].get(block.get("block_id"))
    return row if row and row["source_block_sha256"] == block_digest(block) else None


def native_presentation(block: dict, *, manifest_sha256: str | None = None,
                        study_opened: bool = False, runtime_questions: list[dict] | None = None) -> dict | None:
    if block.get("display_kind") == "source_study" and not study_opened:
        return None
    row = _bound_row(block, manifest_sha256)
    if not row:
        return None
    if runtime_questions is not None:
        expected = row.get("practice_question_sha256") or {}
        identities = [question.get("source_item_id") for question in runtime_questions]
        if (not expected or len(set(identities)) != len(identities) or set(identities) != set(expected)
                or any(question.get("source_block_id") != block["block_id"]
                       or display_question_digest(question) != expected[question["source_item_id"]]
                       for question in runtime_questions)):
            return None
    return SourceNativePresentation.model_validate(row["presentation"]).model_dump()


def native_instruction_vi(block: dict, *, manifest_sha256: str | None = None) -> str | None:
    """Remove obsolete crop directions only for this exact native source block."""
    row = _bound_row(block, manifest_sha256)
    if not row:
        return None
    text = row.get("instruction_vi")
    if text is not None and (not isinstance(text, str) or not text.strip()):
        raise ValueError("Invalid native instruction")
    return text
