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

from models.listening_source_collection import SourceInstruction, SourceNativePresentation, SourceOption

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


def native_presentation(block: dict, *, study_opened: bool = False) -> dict | None:
    if block.get("display_kind") == "source_study" and not study_opened:
        return None
    row = revision()["blocks"].get(block.get("block_id"))
    if not row or row["source_block_sha256"] != block_digest(block):
        return None
    return SourceNativePresentation.model_validate(row["presentation"]).model_dump()
