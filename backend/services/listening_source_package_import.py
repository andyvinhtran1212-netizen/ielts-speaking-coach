"""Source-specific pure validation and projection; generic importer stays strict."""
from __future__ import annotations
import hashlib
import json
import math
import mimetypes
import re
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any
from PIL import Image
from models.listening_source_collection import SOURCE_CONTRACT, SOURCE_PROGRAMME, SourceExplanation, SourcePrintedKey, SourceEvidence
from services.listening_package_import import PackageValidationError, _ensure_immutable_object

APPROVED = {"ACCEPTED", "APPROVED"}
VERDICTS = {"CONFIRMED", "SUSPECT", "AMBIGUOUS", "UNRESOLVED"}
CLAIM = "report_only_no_band_cefr_mastery_or_full_progression_claim"
EXPLICIT_PRINTED_KEY_TIERS = {
    "PRINTED", "PRINTED_KEY", "PRINTED_EMBEDDED_KEY",
    "SURVIVING_PRINTED_KEY_PARSED_REVIEW_REQUIRED",
    "SURVIVING_PRINTED_KEY_VISUALLY_CHECKED_PAGE",
}
MAX_BYTES = 2_147_483_648
MAX_FILES = 8000


@dataclass
class SourceImportPlan:
    package: dict
    lessons: list[dict]
    stimuli: list[dict]
    forms: list[dict]
    assets: list[dict]
    report: dict


def _hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1_048_576), b""):
            h.update(chunk)
    return h.hexdigest()


def _relative(value: Any) -> PurePosixPath:
    if not isinstance(value, str) or "\\" in value:
        raise PackageValidationError("Invalid source artifact path")
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(part in {"..", "."} for part in path.parts):
        raise PackageValidationError("Source artifact path traversal")
    return path


def _artifact(root: Path, raw: Any, hashes: dict) -> Path:
    rel = _relative(raw)
    path = root.joinpath(*rel.parts)
    if any(root.joinpath(*rel.parts[:index]).is_symlink() for index in range(1, len(rel.parts) + 1)):
        raise PackageValidationError("Source artifacts may not be symlinks")
    if str(rel) not in hashes or not path.is_file() or _hash(path) != hashes[str(rel)]:
        raise PackageValidationError(f"Source artifact hash/missing mismatch: {rel}")
    return path


def _json(path: Path) -> Any:
    if path.stat().st_size > 20_971_520:
        raise PackageValidationError("Source JSON exceeds limit")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, UnicodeError) as exc:
        raise PackageValidationError(f"Invalid source JSON: {path.name}") from exc


def _media_seconds(path: Path) -> float:
    try:
        result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                 "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
                                check=True, capture_output=True, text=True, timeout=30)
        value = float(result.stdout.strip())
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        raise PackageValidationError("Audio cannot be verified with ffprobe") from exc
    if not math.isfinite(value) or value <= 0:
        raise PackageValidationError("Audio has no finite duration")
    return value


def _review(item: dict) -> tuple[str, dict]:
    review = item.get("independent_review") or {}
    if review.get("status") not in APPROVED or review.get("verdict") not in VERDICTS or not review.get("reviewer"):
        raise PackageValidationError(f"Item requires independent review: {item.get('item_id')}")
    confidence = review.get("confidence")
    if not (isinstance(confidence, str) and confidence in {"HIGH", "MEDIUM", "LOW", "high", "medium", "low"}) and not (
            isinstance(confidence, (int, float)) and not isinstance(confidence, bool) and 0 <= confidence <= 1):
        raise PackageValidationError(f"Item lacks reviewer confidence: {item.get('item_id')}")
    if review.get("instruction_checked") is not True or review.get("alternatives_checked") is not True:
        raise PackageValidationError(f"Item lacks instruction/alternative review: {item.get('item_id')}")
    try:
        authored = dict(item.get("explanation_vi") or {})
        for key in ("paraphrase_vi", "trap_vi", "format_vi"):
            if authored.get(key) is None:
                authored[key] = ""
        explanation = SourceExplanation.model_validate(authored).model_dump()
        printed = (item.get("answer_provenance") or {}).get("printed_key")
        if printed:
            explanation["printed_key"] = SourcePrintedKey.model_validate(printed if isinstance(printed, dict) else {"answer": printed}).model_dump()
    except Exception as exc:
        raise PackageValidationError(f"Invalid authored explanation: {item.get('item_id')}") from exc
    if not explanation["why_vi"].strip() or not explanation["evidence"] or any(not row["quote"].strip() for row in explanation["evidence"]):
        raise PackageValidationError(f"Item lacks sufficient explanation evidence: {item.get('item_id')}")
    if review["verdict"] != "UNRESOLVED" and not explanation.get("answer"):
        raise PackageValidationError(f"Answerable item lacks reviewed reference answer: {item.get('item_id')}")
    if review["verdict"] == "UNRESOLVED" and not (str(explanation.get("next_action_vi") or "").strip()
            and str(explanation.get("source_answer_warning_vi") or "").strip()):
        raise PackageValidationError(f"Unresolved item requires limitation/next action: {item.get('item_id')}")
    return review["verdict"], explanation


def objective_content_sha256(item: dict) -> str:
    """Bind a separate eligibility decision to exact authored content, before normalization."""
    content = {key: item.get(key) for key in ("item_id", "response", "answer_provenance", "explanation_vi")}
    return hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _objective_eligibility(item: dict, verdict: str, response_type: str) -> dict | None:
    # Semantic acceptance alone never certifies automatic correctness. An explicit
    # authored opt-out wins even if a stale eligibility record is also present.
    if (item.get("safe_for_grading") is not True or item.get("display_mode") != "objective_exact"
            or verdict != "CONFIRMED" or response_type not in {"single_choice", "multiple_choice", "map_label"}):
        return None
    decision = item.get("objective_eligibility") or {}
    if not decision or decision.get("eligible") is not True:
        return None
    if (decision.get("status") not in APPROVED or not decision.get("reviewer")
            or decision.get("reviewed_content_sha256") != objective_content_sha256(item)):
        raise PackageValidationError("Objective eligibility requires separately reviewed exact content binding")
    return {key: decision[key] for key in ("status", "reviewer", "eligible", "reviewed_content_sha256")}


def _resource_image(source: dict, *, asset_id: str, alt_vi: str) -> dict:
    """Vocabulary image adapter preserves every source asset and its visual gate."""
    visual = source.get("visual_review") or {}
    return {"asset_id": source.get("asset_id") or asset_id,
        "path": source.get("derived_path"), "asset_path": source.get("asset_path"),
        "sha256": source.get("derived_sha256"), "alt_vi": source.get("alt_vi") or alt_vi,
        "source_pdf_page": source.get("source_pdf_page") or source.get("pdf_page"),
        "source_image_path": source.get("source_image_path") or source.get("image_path"),
        "source_image_sha256": source.get("source_image_sha256") or source.get("image_sha256"),
        "source_rect": source.get("source_rect"),
        "visual_acceptance": {"independent_review_status": str(visual.get("independent_review", "")).upper(),
            "content_complete": True, "answer_leakage": False}}


def _scan_bound(raw: dict, bindings: list[dict]) -> bool:
    image_hash, image_path = raw.get("source_image_sha256"), raw.get("source_image_path")
    return bool(re.fullmatch(r"[0-9a-f]{64}", str(image_hash or "")) and isinstance(image_path, str)
        and any(binding.get("kind") != "pdf" and binding.get("sha256") == image_hash
                and (str(binding.get("path")) == image_path or str(binding.get("path")).endswith("/" + image_path))
                for binding in bindings))


def _paragraph_evidence(paragraph: dict, bindings: list[dict], pdf_sha256: str) -> dict:
    page = paragraph.get("source_pdf_page")
    line = paragraph.get("line_index_1_based")
    if (not isinstance(page, int) or isinstance(page, bool) or page < 1
            or not isinstance(paragraph.get("text"), str) or not paragraph["text"].strip()):
        raise PackageValidationError("Transcript paragraph needs exact text/Part/source references")
    if line is not None and (not isinstance(line, int) or isinstance(line, bool) or line < 1):
        raise PackageValidationError("Transcript paragraph has invalid OCR line index")
    if line is None:
        region = paragraph.get("source_region") or {}
        image_hash = paragraph.get("source_image_sha256")
        image_path = paragraph.get("source_image_path")
        bound = _scan_bound(paragraph, bindings)
        if ("line_index_1_based" not in paragraph or not str(paragraph.get("line_index_unavailable_reason") or "").strip()
                or paragraph.get("source_pdf_sha256") != pdf_sha256
                or not re.fullmatch(r"[0-9a-f]{64}", str(image_hash or "")) or not bound
                or not isinstance(region, dict) or set(region) != {"x", "y", "width", "height"}
                or any(not isinstance(value, (int, float)) or isinstance(value, bool)
                       or not math.isfinite(value) for value in region.values())
                or region["x"] < 0 or region["y"] < 0 or region["width"] <= 0 or region["height"] <= 0):
            raise PackageValidationError("Null OCR index requires reviewed source scan binding, region and missing-index reason")
    safe = SourceEvidence.model_validate({**paragraph, "source_kind": "printed_transcript",
        "pdf_page": page, "quote": paragraph["text"], "relation": "source_transcript"}).model_dump(exclude_none=True)
    safe.pop("start", None)
    safe.pop("end", None)
    # Preserve explicit null, rather than replacing an honest absent OCR row.
    safe["line_index_1_based"] = line
    return safe | {"text": paragraph["text"]}


def _options(item: dict, block: dict) -> dict[str, str]:
    response = item.get("response") or {}
    raw = response.get("options") or (block.get("shared_options") if response.get("type") == "matching" else []) or []
    if isinstance(raw, dict):
        output = {str(k): str(v) for k, v in raw.items()}
    elif isinstance(raw, list):
        output = {str(option["id"]): str(option.get("text") or option.get("label") or option["id"]) for option in raw}
        if len(output) != len(raw):
            raise PackageValidationError("Duplicate selectable option IDs")
    else:
        raise PackageValidationError("Invalid source options")
    if any(not key.strip() or not value.strip() for key, value in output.items()):
        raise PackageValidationError("Empty source option")
    return output


def _expected(item: dict, options: dict, multiple: bool) -> list[str]:
    raw = (item.get("answer_provenance") or {}).get("editorial_answer")
    if raw is None:
        raw = (item.get("explanation_vi") or {}).get("answer")
    values = raw if isinstance(raw, list) else re.split(r"\s*[,;]\s*", str(raw or "")) if multiple else [str(raw or "")]
    # Match exact reviewed selectable ID or word. Never map printed row numbers.
    output = []
    for value in values:
        matches = [key for key, label in options.items() if str(value).strip().casefold() in {key.casefold(), label.casefold()}]
        if len(matches) != 1:
            raise PackageValidationError(f"Reviewed key does not identify one source option: {item['item_id']}")
        output.append(matches[0])
    if not output or len(output) != len(set(output)):
        raise PackageValidationError("Missing/duplicate reviewed objective key")
    explained = (item.get("explanation_vi") or {}).get("answer")
    explained = explained if isinstance(explained, list) else [explained]
    explained_keys = []
    for value in explained:
        matches = [key for key, label in options.items() if str(value or "").strip().casefold() in {key.casefold(), label.casefold()}]
        if len(matches) != 1:
            raise PackageValidationError("Objective explanation answer does not identify one option")
        explained_keys.extend(matches)
    if set(output) != set(explained_keys):
        raise PackageValidationError("Reviewed objective key and explanation disagree")
    return output


def adapt_vocabulary_document(raw: dict) -> dict:
    """Preserve reviewed editorial caveats and source relations in typed resources."""
    review = raw.get("review") or {}
    if str(review.get("status", "")).upper() not in APPROVED or not review.get("reviewer"):
        raise PackageValidationError("Vocabulary resource requires independent acceptance")
    number = raw.get("day")
    if number not in range(61, 71):
        raise PackageValidationError("Vocabulary source day outside 61–70")
    day_id = f"80-days:day-{number:02d}"
    groups = []
    for group in raw.get("groups") or []:
        terms = []
        for term in group.get("terms") or []:
            source_ref = term.get("source_ref") or {}
            terms.append({"term": term.get("display_term") or term.get("source_term") or "",
                "related_terms": term.get("related_terms") or [], "meaning_vi": term.get("meaning_vi"),
                "editorial": term.get("provenance") == "editorial_definition",
                "source_pdf_page": source_ref.get("pdf_page"), "source_line_index_1_based": source_ref.get("line_index_1_based")})
        groups.append({"title": group.get("title_vi") or group.get("source_heading") or "",
            "terms": terms, **{key: group.get(key) for key in ("source_heading", "editorial_heading_en", "editorial_note_vi", "source_layout_note_vi")}})
    if not groups or any(not group["terms"] or any(not term["term"] for term in group["terms"]) for group in groups):
        raise PackageValidationError("Vocabulary resource is empty/incomplete")
    sources = raw.get("source_assets") or [raw.get("source") or {}]
    if raw.get("source") and not any(
            (source.get("derived_path"), source.get("derived_sha256")) ==
            (raw["source"].get("derived_path"), raw["source"].get("derived_sha256")) for source in sources):
        raise PackageValidationError("Vocabulary primary source is omitted from source_assets")
    images = [_resource_image(source, asset_id=f"{day_id}:vocabulary-image-{index}",
                              alt_vi=raw.get("title_vi") or "Từ vựng theo nguồn")
              for index, source in enumerate(sources, 1)]
    resources = []
    for resource in raw.get("study_resources") or []:
        resources.append({**resource, "source_assets": [_resource_image(source,
            asset_id=f"{resource['resource_id']}:image-{index}", alt_vi=resource.get("title_vi") or "Tư liệu tự học")
            for index, source in enumerate(resource.get("source_assets") or [], 1)]})
    return {"schema_version": "80-days-curated-day/1.0", "day_id": day_id, "day": number,
        "group": "vocabulary", "title_vi": raw.get("title_vi"), "source_pdf_sha256": raw.get("source_pdf_sha256"),
        "question_count": 0, "parts": [], "items": [], "audio": {"status": "NOT_EXPECTED"},
        "instructions_vi": raw.get("study_instructions_vi"), "vocabulary_groups": groups,
        "supplemental_resources": resources,
        "blocks": [{"block_id": day_id + ":vocabulary", "part_id": day_id + ":vocabulary", "kind": "vocabulary",
            "display_kind": "vocabulary", "instruction": {"source_en": "", "student_vi": "\n\n".join(
                [raw.get("study_instructions_vi") or "", *(raw.get("editorial_notes_vi") or [])])},
            "source_assets": images, "question_numbers": [], "item_ids": []}]}


def build_source_import_plan(release_root: Path, *, imported_by: str | None = None) -> SourceImportPlan:
    root = release_root.resolve(strict=True)
    if release_root.is_symlink():
        raise PackageValidationError("Source release root may not be a symlink")
    manifest_path = root / "manifest.json"
    manifest = _json(manifest_path)
    hashes = manifest.get("artifact_hashes") or {}
    if (manifest.get("schema_version") != "80-days-source-release/1.0"
            or manifest.get("programme_id") != SOURCE_PROGRAMME
            or not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,100}", str(manifest.get("package_id") or ""))
            or not isinstance(hashes, dict) or not hashes or len(hashes) > MAX_FILES
            or not re.fullmatch(r"[0-9a-f]{64}", str(manifest.get("source_pdf_sha256") or ""))):
        raise PackageValidationError("Invalid source release manifest")
    bindings = manifest.get("source_bindings") or []
    if not isinstance(bindings, list) or not any(binding.get("kind") == "pdf" and binding.get("sha256") == manifest["source_pdf_sha256"] for binding in bindings if isinstance(binding, dict)):
        raise PackageValidationError("Source PDF original binding is required")
    for binding in bindings:
        if not isinstance(binding, dict) or not isinstance(binding.get("path"), str):
            raise PackageValidationError("Source original binding is malformed")
        path = Path(binding["path"])
        if not path.is_absolute():
            path = root / _relative(binding["path"])
        if path.is_symlink() or not path.is_file() or _hash(path) != binding.get("sha256"):
            raise PackageValidationError("Original source hash/missing mismatch")
    declared = {_artifact(root, path, hashes).relative_to(root).as_posix() for path in hashes}
    present = {path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file() and path != manifest_path}
    if present != declared or sum((root / path).stat().st_size for path in declared) > MAX_BYTES:
        raise PackageValidationError("Source artifact inventory/size mismatch")
    day_paths = manifest.get("days") or []
    if len(day_paths) != 80 or len(set(day_paths)) != 80:
        raise PackageValidationError("Source release must bind exactly 80 distinct day files")
    manifest_sha = _hash(manifest_path)
    package_id = manifest["package_id"]
    prefix = f"source-collections/{package_id}/{manifest_sha}/"
    assets: dict[str, dict] = {}
    lessons, forms, stimuli = [], [], []
    seen_items, seen_blocks, source_count = set(), set(), 0

    def runtime_asset(raw: dict, *, day_path: Path, kind: str) -> dict:
        raw_path = raw.get("asset_path")
        if not raw_path:
            local = _relative(raw.get("path") or raw.get("source_relative_path"))
            raw_path = (day_path.parent.relative_to(root) / Path(*local.parts)).as_posix()
        path = _artifact(root, raw_path, hashes)
        if raw.get("sha256") and raw["sha256"] != _hash(path):
            raise PackageValidationError("Media author/source hash mismatch")
        digest = _hash(path)
        suffix = path.suffix.casefold()
        if kind == "image":
            if suffix not in {".png", ".jpg", ".jpeg", ".webp"} or path.stat().st_size > 10_485_760:
                raise PackageValidationError("Source image format/size rejected")
            try:
                with Image.open(path) as image:
                    width, height = image.size
                    image.verify()
            except Exception as exc:
                raise PackageValidationError("Invalid source raster image") from exc
            if not 1 <= width <= 10000 or not 1 <= height <= 10000:
                raise PackageValidationError("Source image dimensions rejected")
        elif kind == "transcript":
            if suffix != ".json" or path.stat().st_size > 20_971_520:
                raise PackageValidationError("Source transcript format/size rejected")
        elif suffix not in {".mp3", ".wav", ".m4a"} or path.stat().st_size > 134_217_728:
            raise PackageValidationError("Source audio format/size rejected")
        key = path.relative_to(root).as_posix()
        if key not in assets:
            assets[key] = {"local_path": str(path), "storage_path": prefix + digest + suffix,
                "sha256": digest, "size_bytes": path.stat().st_size,
                "content_type": mimetypes.guess_type(path.name)[0] or "application/octet-stream", "kind": kind}
        return assets[key]

    for expected_day, relative in enumerate(day_paths, 1):
        day_path = _artifact(root, relative, hashes)
        day = _json(day_path)
        if day.get("schema") == "listening-source-vocabulary-day/1.0":
            day = adapt_vocabulary_document(day)
        if day.get("schema_version") != "80-days-curated-day/1.0" or day.get("day") != expected_day:
            raise PackageValidationError("Source day identity/order mismatch")
        if day.get("source_pdf_sha256") != manifest["source_pdf_sha256"]:
            raise PackageValidationError("Source PDF binding mismatch")
        day_id = day.get("day_id")
        if day_id != f"80-days:day-{expected_day:02d}":
            raise PackageValidationError("Source day stable identity mismatch")
        group = "short_practice" if expected_day <= 50 else "teaching" if expected_day <= 60 else "vocabulary" if expected_day <= 70 else "mock"
        if day.get("group") != group:
            raise PackageValidationError("Source day group mismatch")
        raw_blocks = day.get("blocks") or []
        supplemental = day.get("supplemental_resources") or []
        if not isinstance(supplemental, list):
            raise PackageValidationError("Supplemental resource inventory must be a list")
        resource_by_id = {}
        raw_blocks = list(raw_blocks)
        for resource in supplemental:
            review = resource.get("review") or resource.get("independent_review") or {}
            resource_id = resource.get("resource_id")
            if (review.get("status") not in APPROVED or not review.get("reviewer")
                    or not isinstance(resource_id, str) or not resource_id.startswith(day_id + ":")
                    or resource_id in resource_by_id or not resource.get("source_assets")
                    or resource.get("scored") is True):
                raise PackageValidationError("Supplemental resource requires independent acceptance and unique unscored identity")
            summary = resource.get("editorial_summary_vi") or resource.get("instruction_vi") or ""
            note = resource.get("editorial_note_vi") or ""
            if not isinstance(summary, str) or not isinstance(note, str) or not (summary.strip() or resource.get("paragraphs")):
                raise PackageValidationError("Supplemental resource lacks source study content")
            resource_by_id[resource_id] = resource
            raw_blocks.append({"block_id": resource_id, "part_id": resource_id + ":resource",
                "kind": resource.get("kind") or "source_resource", "display_kind": "source_study",
                "instruction": {"source_en": resource.get("source_heading") or "",
                    "student_vi": "Tài liệu tự học đã có nội dung giải; không tính câu hỏi hoặc điểm luyện nghe."},
                "description_vi": resource.get("title_vi") or "Tư liệu bổ sung", "source_assets": resource["source_assets"],
                "item_ids": [], "question_numbers": []})
        raw_items = day.get("items") or []
        if day.get("question_count") != len(raw_items):
            raise PackageValidationError("Source day position count mismatch")
        source_count += len(raw_items)
        blocks, block_by_id, study, positions, reviewed = [], {}, {}, [], {}
        for raw in raw_blocks:
            block_id = raw.get("block_id")
            if not isinstance(block_id, str) or not block_id.startswith(day_id + ":") or block_id in seen_blocks:
                raise PackageValidationError("Source block identity missing/duplicate")
            seen_blocks.add(block_id)
            display = raw.get("display_kind") or "practice"
            images = []
            for image in raw.get("source_assets") or []:
                acceptance = image.get("visual_acceptance") or {}
                if (acceptance.get("independent_review_status") not in APPROVED
                        or acceptance.get("content_complete") is not True
                        or (display == "practice" and acceptance.get("answer_leakage") is not False)):
                    raise PackageValidationError(f"Source crop requires independent acceptance: {block_id}")
                if (block_id in resource_by_id or display == "vocabulary") and not _scan_bound(image, bindings):
                    raise PackageValidationError("Source resource image requires exact original scan binding")
                asset = runtime_asset(image, day_path=day_path, kind="image")
                with Image.open(asset["local_path"]) as picture:
                    width, height = picture.size
                images.append({"asset_id": image["asset_id"], "storage_path": asset["storage_path"],
                    "width": width, "height": height, "alt_vi": image["alt_vi"]})
            safe = {"block_id": block_id, "part_id": raw["part_id"], "kind": raw["kind"],
                "instruction": raw["instruction"], "item_ids": list(raw.get("item_ids") or []),
                "source_question_numbers": list(raw.get("question_numbers") or []), "images": images,
                "shared_options": [{"id": str(value["id"]), "label": str(value.get("label") or value.get("text"))}
                    for value in raw.get("shared_options") or []],
                "description": str(raw.get("description_vi") or ""), "display_kind": display}
            blocks.append(safe)
            block_by_id[block_id] = (raw, safe)
        for item in raw_items:
            item_id = item.get("item_id")
            if not isinstance(item_id, str) or not item_id.startswith(day_id + ":") or item_id in seen_items:
                raise PackageValidationError("Source item identity missing/duplicate")
            seen_items.add(item_id)
            if item.get("block_id") not in block_by_id or item_id not in block_by_id[item["block_id"]][1]["item_ids"]:
                raise PackageValidationError("Source item/block membership mismatch")
            verdict, explanation = _review(item)
            raw_block, _safe = block_by_id[item["block_id"]]
            options = _options(item, raw_block)
            response_type = (item.get("response") or {}).get("type")
            if response_type in {"single_choice", "multiple_choice", "matching", "map_label"} and verdict != "UNRESOLVED":
                answer = explanation.get("answer")
                answer_values = answer if isinstance(answer, list) else [answer]
                answer_keys = set()
                for value in answer_values:
                    answer_keys.update(key for key, label in options.items() if str(value or "").casefold() in {key.casefold(), label.casefold()})
                considered = {str(row["option"]).casefold() for row in explanation["distractors"] if row["reason_vi"].strip()}
                for key, label in options.items():
                    if key not in answer_keys and key.casefold() not in considered and label.casefold() not in considered:
                        raise PackageValidationError(f"Unreviewed distractor: {item_id}:{key}")
            reviewed[item_id] = (item, verdict, explanation, options)
        if sum(len(block["item_ids"]) for block in blocks) != len(raw_items) or {value for block in blocks for value in block["item_ids"]} != {item["item_id"] for item in raw_items}:
            raise PackageValidationError("Source block coverage mismatch")
        transcript_rows, transcript_asset = [], None
        transcript = day.get("transcript") or {}
        if raw_items:
            if transcript.get("independent_review_status") not in APPROVED or not transcript.get("reviewer"):
                raise PackageValidationError("Source day requires independently reviewed transcript companion")
            transcript_asset = runtime_asset(transcript, day_path=day_path, kind="transcript")
            companion = _json(Path(transcript_asset["local_path"]))
            if companion.get("day_id") != day_id or companion.get("source_pdf_sha256") != manifest["source_pdf_sha256"]:
                raise PackageValidationError("Transcript source identity mismatch")
            raw_paragraphs = companion.get("paragraphs") or []
            if not raw_paragraphs or transcript.get("paragraphs") != raw_paragraphs:
                raise PackageValidationError("Transcript projection differs from bound companion")
            part_ids = {part["part_id"] for part in day.get("parts") or []}
            for paragraph in raw_paragraphs:
                if paragraph.get("part_id") not in part_ids:
                    raise PackageValidationError("Transcript paragraph needs exact text/Part/source references")
                transcript_rows.append({"part_id": paragraph["part_id"], **_paragraph_evidence(paragraph, bindings, manifest["source_pdf_sha256"])})
            if {row["part_id"] for row in transcript_rows} != part_ids:
                raise PackageValidationError("Transcript does not cover authentic Parts")
        audio = day.get("audio") or {}
        available = audio.get("status") in {"AVAILABLE", "PARTIAL"} and expected_day not in [*range(61, 71), 77]
        audio_asset = None
        duration = 0
        if available:
            audio_asset = runtime_asset(audio, day_path=day_path, kind="audio")
            if "verified_duration" not in audio_asset:
                audio_asset["verified_duration"] = _media_seconds(Path(audio_asset["local_path"]))
            duration = audio_asset["verified_duration"]
            if abs(duration - float(audio.get("duration_seconds") or 0)) > 0.5:
                raise PackageValidationError("Audio duration/source coverage mismatch")
            stimulus_id = day_id + ":audio"
            stimuli.append({"source_stimulus_id": stimulus_id, "source_audio_path": audio_asset["storage_path"],
                "source_audio_sha256": audio_asset["sha256"], "source_timing_path": None, "source_timing_sha256": None,
                "controlled_transcript_path": transcript_asset["storage_path"], "controlled_transcript_sha256": transcript_asset["sha256"],
                "duration_seconds": duration, "metadata": {"timing_segment_count": 0, "timing_granularity": "whole_day",
                    "source_intervals": audio.get("source_intervals") or []}})
        parts, eligible_ids = [], set()
        raw_parts = day.get("parts") or []
        if len({part.get("part_id") for part in raw_parts}) != len(raw_parts):
            raise PackageValidationError("Duplicate source Part identity")
        for part in day.get("parts") or []:
            part_id = part["part_id"]
            part_items = [value for value in raw_items if value["part_id"] == part_id]
            part_available = available and (expected_day != 76 or part.get("source_label") in {"Section 1", "Section 2"})
            part_items_eligible = [item for item in part_items if reviewed[item["item_id"]][1] != "UNRESOLVED"
                and block_by_id[item["block_id"]][1]["display_kind"] == "practice"] if part_available else []
            if len(part_items_eligible) > 40:
                raise PackageValidationError("Source Part/Section exceeds 40; preserve authentic split")
            part_meta = {"part_id": part_id, "source_label": part["source_label"],
                "item_count": len(part_items_eligible), "source_position_count": len(part_items),
                "audio_status": "available" if part_available else "missing", "timing_granularity": "whole_day" if part_available else "none"}
            if part_items_eligible:
                form_id = part_id + ":practice"
                part_meta["source_form_id"] = form_id
                questions, answers, solutions, self_review = [], [], {}, {}
                for q_num, item in enumerate(part_items_eligible, 1):
                    item_id = item["item_id"]
                    _item, verdict, explanation, options = reviewed[item_id]
                    response = item["response"]
                    if not isinstance(response.get("prompt", ""), str):
                        raise PackageValidationError("Source prompt must be curated text")
                    response_type = {"matching": "single_choice", "gap_completion": "short_answer"}.get(response["type"], response["type"])
                    if response_type not in {"single_choice", "multiple_choice", "map_label", "short_answer", "written", "open_rubric", "multi_gap_completion"}:
                        raise PackageValidationError("Unsupported source response type")
                    eligibility = _objective_eligibility(item, verdict, response_type)
                    objective = eligibility is not None
                    mode = "objective_exact" if objective else "self_review"
                    questions.append({"q_num": q_num, "source_item_id": item_id,
                        "source_display_number": str(item["source_display_number"]), "source_block_id": item["block_id"],
                        "prompt": response.get("prompt") or "", "response_type": response_type, "options": options,
                        "selection_count": response.get("select_count"), "word_limit": response.get("word_limit"),
                        "evaluation_mode": mode, "review_status": verdict,
                        "choice_label_only": response["type"] == "matching",
                        "fields": [{key: field[key] for key in ("field_id", "prompt", "word_limit") if key in field} for field in response.get("fields") or []]})
                    provenance = "editorial_verified" if verdict == "CONFIRMED" else "provisional"
                    printed = (item.get("answer_provenance") or {}).get("printed_key")
                    printed_answer = printed.get("answer") if isinstance(printed, dict) else printed
                    if verdict == "CONFIRMED" and printed_answer is not None and printed_answer == explanation.get("answer"):
                        tier = printed.get("evidence_tier") if isinstance(printed, dict) else None
                        if tier == "EXPLANATION_DERIVED":
                            provenance = "explanation_derived_verified"
                        elif tier in EXPLICIT_PRINTED_KEY_TIERS:
                            provenance = "printed_key_verified"
                    protected = {"review_status": verdict, "review_accepted": True,
                        "reviewer": item["independent_review"]["reviewer"], "answer_provenance": provenance,
                        "source_printed_key": printed, "explanation": explanation, "rationale": explanation["why_vi"]}
                    if objective:
                        protected["objective_eligibility"] = eligibility
                        expected = _expected(item, options, response_type == "multiple_choice")
                        if response_type != "multiple_choice" and len(expected) != 1:
                            raise PackageValidationError("Single-choice key must contain exactly one option")
                        if response_type == "multiple_choice" and len(expected) != response.get("select_count"):
                            raise PackageValidationError("Multiple-selection key count differs from source instruction")
                        answers.append({"q_num": q_num, "answers": expected, "answer": ", ".join(expected), "response_type": response_type})
                        solutions[str(q_num)] = protected | {"expected": expected}
                    else:
                        raw_answer = explanation.get("answer")
                        references = ([f"{field}: {value}" for field, value in raw_answer.items()] if isinstance(raw_answer, dict)
                                      else raw_answer if isinstance(raw_answer, list) else [str(raw_answer)] if raw_answer is not None else [])
                        if response_type == "multi_gap_completion":
                            fields = response.get("fields") or []
                            field_ids = [field.get("field_id") for field in fields]
                            if not fields or len(set(field_ids)) != len(fields) or not isinstance(raw_answer, dict) or set(raw_answer) != set(field_ids):
                                raise PackageValidationError("Multi-blank reference/field identity mismatch")
                        self_review[str(q_num)] = protected | {"reference_answers": references}
                    eligible_ids.add(item_id)
                used_blocks = list(dict.fromkeys(question["source_block_id"] for question in questions))
                payload = {"variant": "programme_form_v1", "source_contract": SOURCE_CONTRACT,
                    "source_collection_id": "80-days", "source_day": expected_day, "source_part_label": part["source_label"],
                    "questions": questions, "answers": answers, "solutions": solutions, "self_review": self_review,
                    "source_blocks": [block_by_id[block_id][1] for block_id in used_blocks],
                    "controlled_transcripts": {stimulus_id: [{key: value for key, value in row.items() if key != "part_id"} for row in transcript_rows if row["part_id"] == part_id]}, "audio_windows": {}, "scoring_policy": "report_only", "claim_policy": CLAIM}
                forms.append({"test_id": "source-" + str(uuid.uuid5(uuid.NAMESPACE_URL, package_id + ":" + form_id)),
                    "source_form_id": form_id, "source_lesson_id": day_id, "title": f"Day {expected_day} — {part['source_label']}",
                    "description": "Luyện nghe theo nguồn; tự đối chiếu và sửa câu trả lời.", "version": "1.0.0",
                    "purpose": "practice", "replay_policy": "allowed", "support_policy": "available", "claim_policy": CLAIM,
                    "item_count": len(questions), "accent_tag": "other", "audio_storage_path": audio_asset["storage_path"],
                    "audio_duration_seconds": math.ceil(duration), "audio_size_bytes": audio_asset["size_bytes"],
                    "metadata": {"source_contract": SOURCE_CONTRACT, "source_day": expected_day,
                        "part_id": part_id, "timing_granularity": "whole_day", "derived_audio_sha256": audio_asset["sha256"],
                        "checked_item_count": len(answers), "self_review_item_count": len(self_review)},
                    "content_metadata": {"source_contract": SOURCE_CONTRACT}, "exercise_payload": payload,
                    "stimuli": [{"source_stimulus_id": stimulus_id, "sequence_num": 1,
                        "derived_offset_seconds": 0, "derived_end_seconds": duration, "metadata": {"timing_granularity": "whole_day"}}]})
            parts.append(part_meta)
        for item in raw_items:
            if item["item_id"] not in eligible_ids:
                _item, verdict, explanation, _options_value = reviewed[item["item_id"]]
                positions.append({"item_id": item["item_id"], "source_display_number": str(item["source_display_number"]),
                    "part_id": item["part_id"], "block_id": item["block_id"], "review_status": verdict,
                    "reason_vi": explanation.get("source_answer_warning_vi") or "Nguồn này hiện được mở ở chế độ tài liệu tham khảo."})
        for block in blocks:
            ids = set(block["item_ids"])
            excluded = [item_id for item_id in block["item_ids"] if item_id not in eligible_ids]
            block["study_available"] = bool(excluded)
            if block["block_id"] in resource_by_id:
                resource = resource_by_id[block["block_id"]]
                block["study_available"] = True
                rows = []
                for paragraph in resource.get("paragraphs") or []:
                    ref = paragraph.get("source_ref") or {}
                    evidence = _paragraph_evidence({**ref, "source_pdf_page": ref.get("pdf_page"),
                        "text": paragraph.get("text"), "source_pdf_sha256": manifest["source_pdf_sha256"]}, bindings, manifest["source_pdf_sha256"])
                    rows.append({**evidence, "source_kind": "source_resource"})
                study[block["block_id"]] = {"resource_only": True, "items": [], "transcript": rows,
                    "description": "\n\n".join(value for value in (resource.get("editorial_summary_vi") or resource.get("instruction_vi"),
                        resource.get("editorial_note_vi")) if value)}
            if excluded:
                whole_block = not (ids & eligible_ids)
                if whole_block:
                    block["display_kind"] = "source_study"
                study[block["block_id"]] = {"items": [{"item_id": item_id,
                    "source_display_number": str(reviewed[item_id][0]["source_display_number"]),
                    "review_status": reviewed[item_id][1], "answer_provenance": "source_study",
                    "explanation": reviewed[item_id][2]} for item_id in excluded],
                    "transcript": [{key: value for key, value in row.items() if key not in {"part_id", "text"}}
                        for row in transcript_rows if whole_block and not any(reviewed[item_id][0]["part_id"] == block["part_id"] for item_id in eligible_ids) and row["part_id"] == block["part_id"]]}
        if raw_items and not parts:
            raise PackageValidationError("Source positions are not assigned to authentic parts")
        if len({item["item_id"] for part in parts for item in raw_items if item["part_id"] == part["part_id"]}) != len(raw_items):
            raise PackageValidationError("Source position/part coverage mismatch")
        if group == "vocabulary" and not day.get("vocabulary_groups"):
            raise PackageValidationError("Vocabulary day requires reviewed grouped content")
        lessons.append({"source_lesson_id": day_id, "title": day.get("title_vi") or f"Day {expected_day}",
            "instructions": day.get("instructions_vi") or "Chọn Part hoặc mở tài liệu nguồn theo trạng thái hiện có.",
            "outcomes": day.get("outcomes") or [], "sequence_num": expected_day,
            "metadata": {"source_book": {"source_contract": SOURCE_CONTRACT, "day": expected_day,
                "group": group, "availability": {"questions": "available", "audio": "not_expected" if group == "vocabulary" else "partial" if expected_day == 76 else "available" if available else "missing",
                    "transcript": "available" if transcript_rows else "not_expected" if group == "vocabulary" else "missing",
                    "printed_key": "not_expected" if group == "vocabulary" else "available" if any((item.get("answer_provenance") or {}).get("printed_key") for item in raw_items) else "missing",
                    "explanations": "reviewed"}, "source_position_count": len(raw_items),
                "source_only_count": len(positions), "parts": parts, "blocks": blocks,
                "vocabulary_groups": day.get("vocabulary_groups") or [], "source_only_positions": positions},
                "source_study": study, "authored_document_sha256": hashes[str(_relative(relative))]}})
    if source_count < 1676 or (manifest.get("counts") or {}).get("source_positions") != source_count:
        raise PackageValidationError("Full source position inventory is incomplete/mismatched")
    if not forms or not stimuli:
        raise PackageValidationError("Source collection has no eligible real audio practice")
    unique_assets = {asset["storage_path"]: asset for asset in assets.values()}
    asset_rows = list(unique_assets.values())
    counts = {"lessons": 80, "forms": len(forms), "items": sum(form["item_count"] for form in forms),
              "stimuli": len(stimuli), "timing_segments": 0}
    validation = {"source_contract": SOURCE_CONTRACT, "review_complete": True, "day_count": 80,
        "source_position_count": source_count, "source_only_count": source_count - counts["items"],
        "runtime_assets": [{key: asset[key] for key in ("storage_path", "sha256", "size_bytes", "content_type", "kind")} for asset in asset_rows]}
    package = {"package_id": package_id, "programme_id": SOURCE_PROGRAMME, "title": manifest.get("title") or "80 ngày luyện Listening",
        "manifest_sha256": manifest_sha, "source_date": manifest.get("source_date"), "source_counts": counts,
        "validation_summary": validation, "transform_version": "source-book-projection-v1", "imported_by": imported_by}
    return SourceImportPlan(package, lessons, stimuli, forms, asset_rows,
        {"package_id": package_id, "manifest_sha256": manifest_sha, **counts, "source_positions": source_count,
         "source_only_positions": source_count - counts["items"], "runtime_assets": len(asset_rows), "review_complete": True})


def commit_source_import_plan(plan: SourceImportPlan, db: Any, *, bucket_name: str) -> dict:
    actions = {"created": 0, "reused": 0}
    for asset in plan.assets:
        path = Path(asset["local_path"])
        if _hash(path) != asset["sha256"] or path.stat().st_size != asset["size_bytes"]:
            raise PackageValidationError("Source assets changed after dry run")
        action = _ensure_immutable_object(db.storage.from_(bucket_name), asset["storage_path"], path.read_bytes(), asset["content_type"])
        actions[action] += 1
    response = db.rpc("import_listening_content_package_atomic", {
        "p_package": plan.package, "p_lessons": plan.lessons, "p_stimuli": plan.stimuli, "p_forms": plan.forms,
    }).execute()
    rows = response.data or []
    row = rows[0] if isinstance(rows, list) and rows else rows
    if not isinstance(row, dict) or row.get("action") not in {"created", "reused"}:
        raise PackageValidationError("Source import did not return canonical state")
    for name, count in plan.package["source_counts"].items():
        if name != "timing_segments" and row.get(name + "_written") != count:
            raise PackageValidationError("Source import reconciliation failed")
    return row | {"storage_created": actions["created"], "storage_reused": actions["reused"]}
