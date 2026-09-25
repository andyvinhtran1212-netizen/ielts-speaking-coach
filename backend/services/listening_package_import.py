"""Fail-closed importer for LISTENING-0005 immutable content packages.

The package directory remains the source of truth.  This module verifies the
release-index binding and every declared artifact before projecting learner
content into the existing Listening test/attempt model.  Dry-run is pure local
work; commit uploads immutable derived assets and finishes through one database
RPC.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import re
import wave
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

from services.listening_editorial_validation import (
    APPROVED_STATUSES,
    EditorialValidationError,
    SOURCE_MANIFEST_LOCKS,
    SOURCE_PROGRAMMES,
    build_approved_translation_projection,
)
from services.listening_test_grader import normalize_answer


TRANSFORM_VERSION = "wav-pcm16-mono-24khz-gap500ms-v1"
GAP_SECONDS = 0.5
SAMPLE_RATE = 24_000
SAMPLE_WIDTH = 2
CHANNELS = 1
OBJECTIVE_TYPES = frozenset({"single_choice", "multiple_choice", "map_label"})
SELF_REVIEW_TYPES = frozenset({"short_answer", "written", "open_rubric"})
ALLOWED_RESPONSE_TYPES = OBJECTIVE_TYPES | SELF_REVIEW_TYPES
FORBIDDEN_LEARNER_KEYS = frozenset({
    "answerLetter", "acceptedAnswers", "accepted_answers", "displayAnswer",
    "evidence_quotes", "protected_teacher", "rubric", "script",
})
MAX_FORM_STIMULI = 15
MAX_FORM_ITEMS = 40
MAX_PACKAGE_FILES = 5_000
MAX_PACKAGE_BYTES = 1_073_741_824  # expanded directory size, 1 GiB
MAX_ARTIFACT_BYTES = 33_554_432
MAX_JSON_BYTES = 10_485_760
MAX_VISUAL_BYTES = 5_242_880
ALLOWED_ARTIFACT_SUFFIXES = frozenset({".json", ".wav", ".svg", ".md", ".txt"})


class PackageValidationError(ValueError):
    """The package is not safe or internally consistent enough to import."""


@dataclass(frozen=True)
class PackageLocation:
    release_root: Path
    package_root: Path
    programme_id: str
    package_id: str
    manifest_sha256: str


@dataclass
class ImportPlan:
    location: PackageLocation
    package: dict[str, Any]
    lessons: list[dict[str, Any]]
    stimuli: list[dict[str, Any]]
    forms: list[dict[str, Any]]
    visual_assets: list[dict[str, Any]]
    report: dict[str, Any]


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_json(path: Path) -> Any:
    try:
        if path.stat().st_size > MAX_JSON_BYTES:
            raise PackageValidationError(f"JSON vượt giới hạn {MAX_JSON_BYTES} bytes: {path}")
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PackageValidationError(f"JSON không hợp lệ: {path}") from exc


def _safe_relative_path(raw: object, *, label: str) -> PurePosixPath:
    if not isinstance(raw, str) or not raw.strip() or "\\" in raw:
        raise PackageValidationError(f"{label}: path không hợp lệ")
    raw_parts = raw.split("/")
    if any(part in {"", ".", ".."} for part in raw_parts):
        raise PackageValidationError(f"{label}: path traversal bị từ chối: {raw}")
    path = PurePosixPath(raw)
    if path.is_absolute() or ".." in path.parts or "." in path.parts:
        raise PackageValidationError(f"{label}: path traversal bị từ chối: {raw}")
    return path


def _resolve_declared(package_root: Path, raw: object, *, label: str) -> Path:
    relative = _safe_relative_path(raw, label=label)
    candidate = package_root.joinpath(*relative.parts)
    if candidate.is_symlink() or not candidate.is_file():
        raise PackageValidationError(f"{label}: file không tồn tại hoặc là symlink: {relative}")
    try:
        candidate.resolve(strict=True).relative_to(package_root.resolve(strict=True))
    except (OSError, ValueError) as exc:
        raise PackageValidationError(f"{label}: file vượt ngoài package: {relative}") from exc
    return candidate


def discover_packages(release_root: Path) -> list[PackageLocation]:
    """Return exactly the learner-ready packages bound by release-index.json."""
    release_root = release_root.resolve(strict=True)
    index = _load_json(release_root / "release-index.json")
    if not isinstance(index, dict) or not isinstance(index.get("programmes"), list):
        raise PackageValidationError("release-index.json thiếu programmes[]")
    locations: list[PackageLocation] = []
    seen: set[str] = set()
    for programme in index["programmes"]:
        if not isinstance(programme, dict):
            raise PackageValidationError("release-index programme phải là object")
        programme_id = str(programme.get("id") or "")
        programme_path = _safe_relative_path(programme.get("path"), label=programme_id)
        for entry in programme.get("packages") or []:
            if not isinstance(entry, dict) or entry.get("learner_ready") is not True:
                continue
            package_id = str(entry.get("package_id") or "")
            manifest_sha = str(entry.get("manifest_sha256") or "")
            if not package_id or not re.fullmatch(r"[0-9a-f]{64}", manifest_sha):
                raise PackageValidationError("release-index package identity không hợp lệ")
            if package_id in seen:
                raise PackageValidationError(f"release-index trùng package_id: {package_id}")
            seen.add(package_id)
            package_path = _safe_relative_path(entry.get("path"), label=package_id)
            root = release_root.joinpath(*programme_path.parts, *package_path.parts)
            try:
                root.resolve(strict=True).relative_to(release_root)
            except (OSError, ValueError) as exc:
                raise PackageValidationError(f"Package path không hợp lệ: {package_id}") from exc
            if root.is_symlink() or not root.is_dir():
                raise PackageValidationError(f"Package không tồn tại hoặc là symlink: {package_id}")
            locations.append(PackageLocation(
                release_root=release_root,
                package_root=root,
                programme_id=programme_id,
                package_id=package_id,
                manifest_sha256=manifest_sha,
            ))
    if len(locations) != int(index.get("learner_ready_packages") or -1):
        raise PackageValidationError("Số package learner-ready không khớp release-index")
    return locations


def select_package(release_root: Path, package_id: str) -> PackageLocation:
    matches = [p for p in discover_packages(release_root) if p.package_id == package_id]
    if len(matches) != 1:
        raise PackageValidationError(f"Không tìm thấy đúng một package: {package_id}")
    return matches[0]


def _walk_json_keys(value: Any) -> Iterable[str]:
    if isinstance(value, dict):
        for key, nested in value.items():
            yield str(key)
            yield from _walk_json_keys(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from _walk_json_keys(nested)


def _verify_manifest(location: PackageLocation) -> dict[str, Any]:
    root = location.package_root
    for path in root.rglob("*"):
        if path.is_symlink():
            raise PackageValidationError(f"Package chứa symlink: {path.relative_to(root)}")
    manifest_path = root / "manifest.json"
    actual_manifest_sha = _sha256_file(manifest_path)
    if actual_manifest_sha != location.manifest_sha256:
        raise PackageValidationError("Manifest SHA-256 không khớp release-index")
    manifest = _load_json(manifest_path)
    if not isinstance(manifest, dict):
        raise PackageValidationError("manifest.json phải là object")
    if (manifest.get("package_id") != location.package_id
            or manifest.get("programme_id") != location.programme_id
            or manifest.get("learner_ready") is not True):
        raise PackageValidationError("Manifest identity/learner_ready không khớp")
    hashes = manifest.get("artifact_hashes")
    if not isinstance(hashes, dict) or not hashes:
        raise PackageValidationError("Manifest thiếu artifact_hashes")
    declared: set[str] = set()
    declared_bytes = 0
    for raw_path, expected in hashes.items():
        relative = _safe_relative_path(raw_path, label="artifact_hashes")
        normalized = relative.as_posix()
        if normalized in declared or not re.fullmatch(r"[0-9a-f]{64}", str(expected)):
            raise PackageValidationError(f"Artifact declaration không hợp lệ: {raw_path}")
        declared.add(normalized)
        artifact = _resolve_declared(root, normalized, label="artifact")
        size = artifact.stat().st_size
        if artifact.suffix.casefold() not in ALLOWED_ARTIFACT_SUFFIXES:
            raise PackageValidationError(f"Artifact type không được phép: {normalized}")
        if size > MAX_ARTIFACT_BYTES:
            raise PackageValidationError(f"Artifact vượt giới hạn: {normalized}")
        declared_bytes += size
        if len(declared) > MAX_PACKAGE_FILES or declared_bytes > MAX_PACKAGE_BYTES:
            raise PackageValidationError("Package vượt giới hạn file/expanded bytes")
        if _sha256_file(artifact) != expected:
            raise PackageValidationError(f"Artifact SHA-256 không khớp: {normalized}")
    actual = {
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if path.is_file() and path.name != "manifest.json"
    }
    if actual != declared:
        missing = sorted(declared - actual)[:5]
        undeclared = sorted(actual - declared)[:5]
        raise PackageValidationError(
            f"Inventory không khớp; missing={missing}, undeclared={undeclared}"
        )
    boundaries = manifest.get("payload_boundaries") or {}
    expected_boundaries = {
        "public": "learner/",
        "conditional_accessibility": "controlled-access/",
        "server_or_audit_only": "protected/",
    }
    if boundaries != expected_boundaries:
        raise PackageValidationError("payload_boundaries không đúng contract v1")
    for relative in sorted(declared):
        if relative.startswith("learner/") and relative.endswith(".json"):
            keys = set(_walk_json_keys(_load_json(root / relative)))
            leaked = sorted(keys & FORBIDDEN_LEARNER_KEYS)
            if leaked:
                raise PackageValidationError(f"Learner JSON lộ protected keys {leaked}: {relative}")
    return manifest


def _validate_svg(path: Path) -> None:
    """Accept static SVG only; active/remote content fails closed."""
    if path.suffix.casefold() != ".svg" or path.stat().st_size > MAX_VISUAL_BYTES:
        raise PackageValidationError(f"Visual không phải SVG an toàn: {path}")
    try:
        raw = path.read_bytes()
        text = raw.decode("utf-8")
        lowered = text.casefold()
        if "<!doctype" in lowered or "<!entity" in lowered:
            raise PackageValidationError(f"SVG có DTD/entity bị cấm: {path}")
        root = ET.fromstring(text)
    except (OSError, UnicodeDecodeError, ET.ParseError) as exc:
        raise PackageValidationError(f"SVG hỏng: {path}") from exc
    local_name = lambda value: value.rsplit("}", 1)[-1].casefold()
    if local_name(root.tag) != "svg":
        raise PackageValidationError(f"Visual signature không phải SVG: {path}")
    forbidden_tags = {"script", "foreignobject", "iframe", "object", "embed"}
    for element in root.iter():
        if local_name(element.tag) in forbidden_tags:
            raise PackageValidationError(f"SVG chứa active content: {path}")
        for key, value in element.attrib.items():
            attr = local_name(key)
            if attr.startswith("on"):
                raise PackageValidationError(f"SVG chứa event handler: {path}")
            if attr == "href" and value and not value.startswith("#"):
                raise PackageValidationError(f"SVG chứa external reference: {path}")


def _protected_indexes(root: Path) -> tuple[dict[str, dict], dict[str, dict]]:
    items: dict[str, dict] = {}
    forms: dict[str, dict] = {}
    protected_root = root / "protected" / "source-lessons"

    def register(
        index: dict[str, dict], identity: str, record: dict, *, kind: str, path: Path,
    ) -> None:
        if identity in index:
            raise PackageValidationError(
                f"Trùng protected {kind} id: {identity} ({path.name})"
            )
        index[identity] = record

    for path in sorted(protected_root.glob("*.json")):
        document = _load_json(path)
        if isinstance(document, list):
            local_items: set[str] = set()
            for record in document:
                if not isinstance(record, dict) or not record.get("id"):
                    continue
                item_id = str(record["id"])
                if item_id in local_items:
                    raise PackageValidationError(
                        f"Trùng protected item id: {item_id} ({path.name})"
                    )
                local_items.add(item_id)
                register(items, item_id, {
                    "id": record["id"],
                    "key": {
                        "answers": ([record.get("answerLetter")]
                                    if record.get("answerLetter") else []),
                        "accepted_answers": record.get("acceptedAnswers") or [],
                    },
                    "rationale": record.get("lesson"),
                    "core_info": record.get("coreInfo"),
                    "answer_sentence": record.get("answerSentence"),
                }, kind="item", path=path)
            continue
        if not isinstance(document, dict):
            raise PackageValidationError(f"Protected source không hợp lệ: {path.name}")
        local_forms: set[str] = set()
        for form in document.get("forms") or []:
            if isinstance(form, dict) and form.get("id"):
                form_id = str(form["id"])
                if form_id in local_forms:
                    raise PackageValidationError(
                        f"Trùng protected form id: {form_id} ({path.name})"
                    )
                local_forms.add(form_id)
                register(forms, form_id, form, kind="form", path=path)
        local_items: set[str] = set()
        for item in document.get("items") or []:
            if isinstance(item, dict) and item.get("id"):
                item_id = str(item["id"])
                if item_id in local_items:
                    raise PackageValidationError(
                        f"Trùng protected item id: {item_id} ({path.name})"
                    )
                local_items.add(item_id)
                register(items, item_id, item, kind="item", path=path)
        teacher = document.get("protected_teacher") or {}
        if isinstance(teacher, dict):
            local_teacher_items: set[str] = set()
            for item in teacher.get("items") or []:
                if isinstance(item, dict) and item.get("item_id"):
                    item_id = str(item["item_id"])
                    if item_id in local_teacher_items:
                        raise PackageValidationError(
                            f"Trùng protected teacher item id: {item_id} ({path.name})"
                        )
                    local_teacher_items.add(item_id)
                    teacher_record = {**item, "id": item_id}
                    if item_id in local_items:
                        # The official compatibility documents split one item
                        # deliberately: the top-level record carries the safe
                        # prompt/options and protected_teacher carries the key,
                        # evidence and rubric. Merge that same-document pair
                        # once, but never let a later file overwrite it.
                        items[item_id] = {**items[item_id], **teacher_record}
                    else:
                        register(
                            items, item_id, teacher_record, kind="teacher item", path=path,
                        )
    return items, forms


def _read_wave(path: Path) -> tuple[bytes, int]:
    try:
        with wave.open(str(path), "rb") as source:
            params = (
                source.getnchannels(), source.getsampwidth(), source.getframerate(),
                source.getcomptype(),
            )
            if params != (CHANNELS, SAMPLE_WIDTH, SAMPLE_RATE, "NONE"):
                raise PackageValidationError(f"WAV không phải PCM16 mono 24kHz: {path}")
            declared_frame_count = source.getnframes()
            frames = source.readframes(declared_frame_count)
            expected_bytes = declared_frame_count * SAMPLE_WIDTH * CHANNELS
            if len(frames) != expected_bytes:
                raise PackageValidationError(f"WAV PCM data bị cắt cụt: {path}")
            return frames, declared_frame_count
    except (wave.Error, EOFError) as exc:
        raise PackageValidationError(f"WAV hỏng: {path}") from exc


def assemble_form_audio(paths: list[Path]) -> tuple[bytes, list[dict[str, float]]]:
    """Deterministically concatenate PCM WAVs with a 500ms silence gap."""
    if not 1 <= len(paths) <= MAX_FORM_STIMULI:
        raise PackageValidationError("Form phải có 1..15 stimuli")
    gap_frames = int(SAMPLE_RATE * GAP_SECONDS)
    silence = b"\x00" * gap_frames * SAMPLE_WIDTH * CHANNELS
    frame_groups: list[bytes] = []
    offsets: list[dict[str, float]] = []
    cursor = 0
    for index, path in enumerate(paths):
        frames, frame_count = _read_wave(path)
        start = cursor / SAMPLE_RATE
        cursor += frame_count
        offsets.append({"start": round(start, 6), "end": round(cursor / SAMPLE_RATE, 6)})
        frame_groups.append(frames)
        if index < len(paths) - 1:
            frame_groups.append(silence)
            cursor += gap_frames
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(CHANNELS)
        target.setsampwidth(SAMPLE_WIDTH)
        target.setframerate(SAMPLE_RATE)
        target.setcomptype("NONE", "not compressed")
        target.writeframes(b"".join(frame_groups))
    return output.getvalue(), offsets


def _normalise_answers(raw: object) -> list[str]:
    if isinstance(raw, list):
        return [str(value).strip() for value in raw if str(value).strip()]
    if raw is None:
        return []
    value = str(raw).strip()
    return [value] if value else []


def _key_for_item(protected: dict[str, Any]) -> tuple[list[str], list[str]]:
    key = protected.get("key") or {}
    if not isinstance(key, dict):
        return [], []
    answers = _normalise_answers(key.get("answers"))
    alternatives = _normalise_answers(
        key.get("accepted_answers") or key.get("acceptedAnswers")
    )
    return answers, [value for value in alternatives if value not in answers]


def _evidence_turn_ids(protected: dict[str, Any]) -> list[str]:
    values = _normalise_answers(protected.get("evidence_turn_ids"))
    for key in ("evidence", "evidence_quotes"):
        rows = protected.get(key) or []
        if isinstance(rows, list):
            values.extend(
                str(row.get("turn_id")) for row in rows
                if isinstance(row, dict) and row.get("turn_id")
            )
    return list(dict.fromkeys(values))


def _self_review(protected: dict[str, Any]) -> dict[str, Any]:
    key = protected.get("key") if isinstance(protected.get("key"), dict) else {}
    answers, alternatives = _key_for_item(protected)
    return {
        "reference_answers": answers + alternatives,
        "required_facts": key.get("required_facts") or [],
        "optional_facts": key.get("optional_facts") or [],
        "scoring_rule": key.get("scoring_rule"),
        "rationale": key.get("rationale") or protected.get("rationale"),
        "core_info": protected.get("core_info"),
        "answer_sentence": protected.get("answer_sentence"),
        "word_limit": key.get("word_limit"),
    }


def _validated_segments(
    document: dict[str, Any],
    *,
    stimulus_id: str,
    duration: float,
    label: str,
    require_text: bool = False,
) -> dict[str, tuple[float, float]]:
    """Validate a timestamped segment document before it can drive replay."""
    segments = document.get("segments")
    if not isinstance(segments, list) or not segments:
        raise PackageValidationError(f"{label} segments không hợp lệ: {stimulus_id}")
    validated: dict[str, tuple[float, float]] = {}
    for segment in segments:
        if not isinstance(segment, dict):
            raise PackageValidationError(f"{label} segment không hợp lệ: {stimulus_id}")
        segment_id = segment.get("id")
        if not isinstance(segment_id, str) or not segment_id.strip() or segment_id in validated:
            raise PackageValidationError(f"{label} segment id không hợp lệ: {stimulus_id}")
        try:
            start = float(segment.get("start"))
            end = float(segment.get("end"))
        except (TypeError, ValueError) as exc:
            raise PackageValidationError(f"{label} bounds không hợp lệ: {stimulus_id}") from exc
        if (not math.isfinite(start) or not math.isfinite(end)
                or start < 0 or end <= start or end > duration):
            raise PackageValidationError(f"{label} bounds không hợp lệ: {stimulus_id}")
        if require_text and (
            not isinstance(segment.get("text"), str) or not segment["text"].strip()
        ):
            raise PackageValidationError(f"{label} text không hợp lệ: {stimulus_id}")
        validated[segment_id] = (start, end)
    return validated


def _validate_objective_options(
    item: dict[str, Any],
    response_type: str,
    expected: list[str],
) -> dict[str, str]:
    """Return learner-selectable options or reject an impossible exact key."""
    item_id = str(item.get("id") or "")
    raw = item.get("options")
    if (not isinstance(raw, dict) or len(raw) < 2
            or any(not isinstance(key, str) or not key.strip()
                   or not isinstance(value, str) or not value.strip()
                   for key, value in raw.items())):
        raise PackageValidationError(f"Objective options không hợp lệ: {item_id}")
    normalized_options = [normalize_answer(key) for key in raw]
    normalized_option_set = set(normalized_options)
    if (any(not key for key in normalized_options)
            or len(normalized_option_set) != len(normalized_options)):
        raise PackageValidationError(
            f"Objective option ids trùng sau chuẩn hoá: {item_id}"
        )
    if response_type == "multiple_choice" and any(
        re.search(r"[,;|]", key) for key in raw
    ):
        raise PackageValidationError(
            f"Multiple-choice option id chứa delimiter: {item_id}"
        )
    normalized_expected = [normalize_answer(answer) for answer in expected]
    if (any(not answer for answer in normalized_expected)
            or len(set(normalized_expected)) != len(normalized_expected)
            or any(answer not in normalized_option_set for answer in normalized_expected)):
        raise PackageValidationError(f"Objective key không selectable: {item_id}")
    if response_type == "multiple_choice":
        if len(expected) < 2:
            raise PackageValidationError(f"Multiple-choice cardinality không hợp lệ: {item_id}")
    elif len(expected) != 1:
        raise PackageValidationError(f"Objective cardinality không hợp lệ: {item_id}")
    return raw


def _stable_test_id(package_id: str, form_id: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", form_id.casefold()).strip("-")[:36] or "form"
    identity = f"{package_id}\0{form_id}".encode("utf-8")
    suffix = hashlib.sha256(identity).hexdigest()[:12]
    return f"pkg-{slug}-{suffix}"


def _form_storage_prefix(package_id: str, manifest_sha: str, form_id: str) -> str:
    form_key = hashlib.sha256(form_id.encode("utf-8")).hexdigest()[:24]
    return f"packages/{package_id}/{manifest_sha}/forms/{form_key}"


def _visual_storage_path(package_id: str, manifest_sha: str, source_path: str) -> str:
    name = PurePosixPath(source_path).name
    suffix = hashlib.sha256(source_path.encode("utf-8")).hexdigest()[:12]
    return f"packages/{package_id}/{manifest_sha}/visuals/{suffix}-{name}"


def _approved_editorial_projection(
    location: PackageLocation,
    manifest: dict[str, Any],
    forms: list[dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    """Load only manifest-hashed, owner-approved display data for a new revision."""
    paths = manifest.get("editorial_batches")
    source_package_id = manifest.get("editorial_source_package_id")
    source_manifest_sha = manifest.get("editorial_source_manifest_sha256")
    if paths is None:
        if source_package_id is not None or source_manifest_sha is not None:
            raise PackageValidationError("Editorial source thiếu editorial_batches")
        return {}, {}
    if not isinstance(paths, list) or not paths or len(paths) > 100 or len(paths) != len(set(map(str, paths))):
        raise PackageValidationError("editorial_batches không hợp lệ")
    if (not isinstance(source_package_id, str) or source_package_id == location.package_id
            or SOURCE_PROGRAMMES.get(source_package_id) != location.programme_id
            or source_manifest_sha != SOURCE_MANIFEST_LOCKS.get(source_package_id)):
        raise PackageValidationError("Editorial source identity/hash không hợp lệ")
    declared_hashes = manifest["artifact_hashes"]
    batches = []
    for raw_path in paths:
        relative = _safe_relative_path(raw_path, label="editorial_batch")
        normalized = relative.as_posix()
        if (not normalized.startswith("protected/editorial/")
                or normalized not in declared_hashes or relative.suffix != ".json"):
            raise PackageValidationError(f"Editorial batch không thuộc protected inventory: {normalized}")
        batches.append(_load_json(_resolve_declared(location.package_root, normalized, label="editorial_batch")))
    catalog: dict[str, dict[str, Any]] = {}
    for form in forms:
        for question in form["exercise_payload"]["questions"]:
            item_id = question["source_item_id"]
            if item_id in catalog:
                raise PackageValidationError(f"Editorial source item trùng form: {item_id}")
            catalog[item_id] = {"prompt": question["prompt"], "options": question["options"]}
    try:
        projected, report = build_approved_translation_projection(
            {source_package_id: catalog}, batches,
            expected_manifest_sha256={source_package_id: SOURCE_MANIFEST_LOCKS[source_package_id]},
            actual_manifest_sha256={source_package_id: source_manifest_sha},
        )
    except EditorialValidationError as exc:
        raise PackageValidationError(f"Editorial projection không hợp lệ: {exc}") from exc
    if report["pending_items"] or not report["approved_items"]:
        raise PackageValidationError("Editorial package chứa batch chưa được duyệt hoặc rỗng")
    return {
        item_id: payload for (package_id, item_id), payload in projected.items()
        if package_id == source_package_id
    }, report


def _approved_editorial_metadata(
    location: PackageLocation,
    manifest: dict[str, Any],
    lessons: list[dict[str, Any]],
) -> dict[str, list[str]]:
    """Bind revised learner copy to the protected, manifest-hashed review packet."""
    raw_path = manifest.get("editorial_lesson_metadata")
    if manifest.get("editorial_batches") is None:
        if raw_path is not None:
            raise PackageValidationError("Editorial metadata không có editorial batches")
        return {}
    relative = _safe_relative_path(raw_path, label="editorial_lesson_metadata")
    path = relative.as_posix()
    if (path != "protected/editorial/lesson-metadata.json"
            or path not in manifest["artifact_hashes"]):
        raise PackageValidationError("Editorial metadata không thuộc protected inventory")
    packet = _load_json(_resolve_declared(location.package_root, path, label="editorial_lesson_metadata"))
    if (not isinstance(packet, dict)
            or packet.get("status") not in APPROVED_STATUSES
            or not isinstance(packet.get("source_package_ids"), list)
            or set(packet["source_package_ids"]) != set(SOURCE_MANIFEST_LOCKS)
            or len(packet["source_package_ids"]) != len(SOURCE_MANIFEST_LOCKS)):
        raise PackageValidationError("Editorial metadata review/source không hợp lệ")
    by_learner_id = {lesson["metadata"]["learner_lesson_id"]: lesson for lesson in lessons}
    changed: dict[str, list[str]] = {}
    for packet_field, lesson_field in (
        ("instructions", "instructions"), ("titles", "title"), ("outcomes", "outcomes"),
    ):
        replacements = packet.get(packet_field)
        if not isinstance(replacements, dict):
            raise PackageValidationError(f"Editorial metadata thiếu {packet_field}")
        changed[packet_field] = []
        for lesson_id, value in replacements.items():
            if packet_field == "outcomes":
                valid_value = (
                    isinstance(value, list) and bool(value)
                    and all(isinstance(line, str) and bool(line.strip()) for line in value)
                )
            else:
                valid_value = isinstance(value, str) and bool(value.strip())
            if not isinstance(lesson_id, str) or not lesson_id or not valid_value:
                raise PackageValidationError(f"Editorial metadata value không hợp lệ: {packet_field}")
            if lesson_id not in by_learner_id:
                continue  # The same approved packet covers both source packages.
            if by_learner_id[lesson_id][lesson_field] != value:
                raise PackageValidationError(f"Editorial lesson copy không khớp review: {lesson_id}:{packet_field}")
            changed[packet_field].append(lesson_id)
        changed[packet_field].sort()
    return changed


def _approved_editorial_visuals(
    location: PackageLocation,
    manifest: dict[str, Any],
    visuals: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Register manifest-bound localized SVGs without replacing source visuals."""
    rows = manifest.get("editorial_visuals")
    if rows is None:
        if manifest.get("editorial_visual_review") is not None:
            raise PackageValidationError("Visual review không có editorial_visuals")
        return {}
    if not isinstance(rows, list) or not rows or len(rows) > 20 or not manifest.get("editorial_batches"):
        raise PackageValidationError("editorial_visuals không hợp lệ")
    review_relative = _safe_relative_path(manifest.get("editorial_visual_review"), label="editorial_visual_review")
    review_path = review_relative.as_posix()
    if (not review_path.startswith("protected/editorial/") or review_relative.suffix != ".json"
            or review_path not in manifest["artifact_hashes"]):
        raise PackageValidationError("Visual review không thuộc protected inventory")
    review = _load_json(_resolve_declared(location.package_root, review_path, label="editorial_visual_review"))
    review_rows = review.get("visuals") if isinstance(review, dict) else None
    if (not isinstance(review_rows, list) or len(review_rows) != len(rows)
            or review.get("status") not in APPROVED_STATUSES
            or review.get("source_package_id") != manifest.get("editorial_source_package_id")):
        raise PackageValidationError("Visual review chưa được duyệt hoặc không khớp source")
    if any(not isinstance(item, dict) or not isinstance(item.get("source_path"), str)
           for item in review_rows):
        raise PackageValidationError("Visual review source ID không hợp lệ")
    reviewed_by_source = {item["source_path"]: item for item in review_rows}
    if len(reviewed_by_source) != len(rows):
        raise PackageValidationError("Visual review source ID trùng hoặc thiếu")
    source_assets = dict(visuals)
    approved: dict[str, dict[str, Any]] = {}
    for row in rows:
        if (not isinstance(row, dict) or set(row) != {
            "status", "source_path", "source_sha256", "target_path", "target_sha256",
            "target_language", "visual_accessibility",
        } or row["status"] != "approved" or row["target_language"] != "vi"):
            raise PackageValidationError("Editorial visual review state không hợp lệ")
        source_path = row["source_path"]
        source = source_assets.get(source_path) if isinstance(source_path, str) else None
        reviewed = reviewed_by_source.get(source_path) if isinstance(source_path, str) else None
        if not source or source_path in approved or source["sha256"] != row["source_sha256"]:
            raise PackageValidationError("Editorial visual source mismatch")
        if (not isinstance(reviewed, dict) or reviewed.get("source_sha256") != row["source_sha256"]
                or reviewed.get("draft_variant_sha256") != row["target_sha256"]
                or reviewed.get("image_alt_vi") != row["visual_accessibility"]):
            raise PackageValidationError("Editorial visual không khớp owner review")
        relative = _safe_relative_path(row["target_path"], label="editorial_visual")
        target_path = relative.as_posix()
        expected_target = source_path.removesuffix(".v1.svg") + ".vi.v1.svg" if source_path.endswith(".v1.svg") else None
        if (target_path != expected_target or not target_path.startswith("learner/visuals/")
                or target_path in visuals or target_path not in manifest["artifact_hashes"]
                or row["target_sha256"] != manifest["artifact_hashes"][target_path]
                or row["target_sha256"] == row["source_sha256"]
                or not isinstance(row["visual_accessibility"], str)
                or not row["visual_accessibility"].strip()):
            raise PackageValidationError("Editorial visual target/alt không hợp lệ")
        target = _resolve_declared(location.package_root, target_path, label="editorial_visual")
        _validate_svg(target)
        if _sha256_file(target) != row["target_sha256"]:
            raise PackageValidationError("Editorial visual target hash mismatch")
        original = ET.parse(source["local_path"]).getroot()
        translated = ET.parse(target).getroot()
        original_elements = list(original.iter())
        translated_elements = list(translated.iter())
        if (len(original_elements) != len(translated_elements)
                or any(a.tag != b.tag or a.attrib != b.attrib
                       for a, b in zip(original_elements, translated_elements, strict=True))):
            raise PackageValidationError("Editorial visual geometry changed")
        source_labels = [(element.text or "").strip() for element in original_elements]
        target_labels = [(element.text or "").strip() for element in translated_elements]
        if any(source_labels.count(label) != target_labels.count(label)
               for label in source_labels if re.fullmatch(r"[A-Z]", label)):
            raise PackageValidationError("Editorial visual choice anchors changed")
        visible = reviewed.get("visible_text")
        if not isinstance(visible, list) or not all(isinstance(pair, dict) for pair in visible):
            raise PackageValidationError("Editorial visual wording review thiếu")
        actual_changes = [((a.text or "").strip(), (b.text or "").strip())
                          for a, b in zip(original_elements, translated_elements, strict=True)
                          if (a.text or "").strip() != (b.text or "").strip()]
        expected_changes = [(reviewed.get("title_en"), reviewed.get("title_vi")),
                            (reviewed.get("description_en"), reviewed.get("description_vi"))]
        expected_changes.extend((pair.get("en"), pair.get("vi")) for pair in visible)
        if actual_changes != expected_changes:
            raise PackageValidationError("Editorial visual wording không khớp owner review")
        asset = {
            "source_path": target_path,
            "local_path": str(target),
            "storage_path": _visual_storage_path(location.package_id, location.manifest_sha256, target_path),
            "sha256": row["target_sha256"],
            "content_type": "image/svg+xml",
            "visual_accessibility": row["visual_accessibility"],
            "source_visual_accessibility": f"{reviewed['title_en']}. {reviewed['description_en']}",
        }
        visuals[target_path] = asset
        approved[source_path] = asset
    return approved


def build_import_plan(location: PackageLocation, *, imported_by: str | None = None) -> ImportPlan:
    root = location.package_root
    manifest = _verify_manifest(location)
    learner_index = _load_json(root / "learner" / "index.json")
    if not isinstance(learner_index, dict):
        raise PackageValidationError("learner/index.json phải là object")
    lesson_ids = learner_index.get("lesson_ids")
    counts = manifest.get("counts") or {}
    if not isinstance(lesson_ids, list) or len(lesson_ids) != int(counts.get("lessons") or -1):
        raise PackageValidationError("learner index/manifest lesson count không khớp")
    protected_items, protected_forms = _protected_indexes(root)

    lesson_documents: list[dict[str, Any]] = []
    by_lesson_id: dict[str, dict[str, Any]] = {}
    for path in sorted((root / "learner" / "content" / "lessons").glob("*.json")):
        document = _load_json(path)
        if not isinstance(document, dict) or not document.get("id"):
            raise PackageValidationError(f"Learner lesson không hợp lệ: {path.name}")
        lesson_id = str(document["id"])
        if lesson_id in by_lesson_id:
            raise PackageValidationError(f"Trùng lesson id: {lesson_id}")
        by_lesson_id[lesson_id] = document
    if set(by_lesson_id) != set(map(str, lesson_ids)):
        raise PackageValidationError("Lesson files không khớp learner/index.json")
    lesson_documents = [by_lesson_id[str(lesson_id)] for lesson_id in lesson_ids]

    lessons: list[dict[str, Any]] = []
    stimuli: list[dict[str, Any]] = []
    forms: list[dict[str, Any]] = []
    visuals: dict[str, dict[str, Any]] = {}
    seen_stimuli: set[str] = set()
    seen_items: set[str] = set()
    seen_forms: set[str] = set()
    timing_segment_count = 0

    for lesson_sequence, lesson in enumerate(lesson_documents, start=1):
        lesson_id = str(lesson["id"])
        source_id = str(lesson.get("source_id") or lesson_id)
        if lesson.get("programme_id") != location.programme_id:
            raise PackageValidationError(f"Programme mismatch: {lesson_id}")
        if lesson.get("claim_policy") != "report_only_no_band_cefr_mastery_or_full_progression_claim":
            raise PackageValidationError(f"Claim policy không hợp lệ: {lesson_id}")
        lessons.append({
            "source_lesson_id": source_id,
            "title": str(lesson.get("title") or source_id),
            "instructions": str(lesson.get("instructions") or ""),
            "outcomes": lesson.get("outcomes") or [],
            "sequence_num": lesson_sequence,
            "metadata": {
                "learner_lesson_id": lesson_id,
                "version": lesson.get("version"),
                "scope": lesson.get("scope"),
            },
        })
        stimulus_map: dict[str, dict[str, Any]] = {}
        controlled_map: dict[str, dict[str, Any]] = {}
        timing_map: dict[str, dict[str, Any]] = {}
        audio_map: dict[str, Path] = {}
        for stimulus in lesson.get("stimuli") or []:
            if not isinstance(stimulus, dict) or not stimulus.get("id"):
                raise PackageValidationError(f"Stimulus không hợp lệ: {lesson_id}")
            stimulus_id = str(stimulus["id"])
            if stimulus_id in seen_stimuli:
                raise PackageValidationError(f"Trùng stimulus id: {stimulus_id}")
            seen_stimuli.add(stimulus_id)
            stimulus_map[stimulus_id] = stimulus
            audio_path = _resolve_declared(root, stimulus.get("audio"), label=stimulus_id)
            timing_path = _resolve_declared(root, stimulus.get("timing"), label=stimulus_id)
            transcript_path = _resolve_declared(
                root, stimulus.get("controlled_transcript"), label=stimulus_id,
            )
            frames, frame_count = _read_wave(audio_path)
            del frames
            duration = frame_count / SAMPLE_RATE
            timing = _load_json(timing_path)
            controlled = _load_json(transcript_path)
            if not isinstance(timing, dict) or not isinstance(controlled, dict):
                raise PackageValidationError(f"Timing/transcript không hợp lệ: {stimulus_id}")
            if timing.get("stimulus_id") != stimulus_id or controlled.get("stimulus_id") != stimulus_id:
                raise PackageValidationError(f"Timing/transcript identity mismatch: {stimulus_id}")
            timing_segments = _validated_segments(
                timing,
                stimulus_id=stimulus_id,
                duration=duration,
                label="Timing",
            )
            transcript_segments = _validated_segments(
                controlled,
                stimulus_id=stimulus_id,
                duration=duration,
                label="Transcript",
                require_text=True,
            )
            if set(timing_segments) != set(transcript_segments):
                raise PackageValidationError(
                    f"Transcript/timing segment mismatch: {stimulus_id}"
                )
            for segment_id, timing_bounds in timing_segments.items():
                transcript_bounds = transcript_segments[segment_id]
                if not all(
                    math.isclose(left, right, abs_tol=0.001)
                    for left, right in zip(timing_bounds, transcript_bounds, strict=True)
                ):
                    raise PackageValidationError(
                        f"Transcript/timing bounds mismatch: {stimulus_id}:{segment_id}"
                    )
            timing_segment_count += len(timing_segments)
            audio_map[stimulus_id] = audio_path
            timing_map[stimulus_id] = timing
            controlled_map[stimulus_id] = controlled
            stimuli.append({
                "source_stimulus_id": stimulus_id,
                "source_audio_path": str(stimulus["audio"]),
                "source_timing_path": str(stimulus["timing"]),
                "controlled_transcript_path": str(stimulus["controlled_transcript"]),
                "source_audio_sha256": _sha256_file(audio_path),
                "source_timing_sha256": _sha256_file(timing_path),
                "controlled_transcript_sha256": _sha256_file(transcript_path),
                "duration_seconds": round(duration, 6),
                "metadata": {
                    "source_lesson_id": source_id,
                    "kind": stimulus.get("kind"),
                    "purpose": stimulus.get("purpose"),
                    "visual": stimulus.get("visual"),
                    "visual_accessibility": stimulus.get("visual_accessibility"),
                    "timing_segment_count": len(timing.get("segments") or []),
                },
            })
            visual = stimulus.get("visual")
            if visual:
                visual_path = _resolve_declared(root, visual, label=f"visual:{stimulus_id}")
                _validate_svg(visual_path)
                storage_path = _visual_storage_path(
                    location.package_id, location.manifest_sha256, str(visual),
                )
                visuals[str(visual)] = {
                    "source_path": str(visual),
                    "local_path": str(visual_path),
                    "storage_path": storage_path,
                    "sha256": _sha256_file(visual_path),
                    "content_type": "image/svg+xml",
                }
                stimuli[-1]["metadata"].update({
                    "visual_source_path": str(visual),
                    "visual_storage_path": visuals[str(visual)]["storage_path"],
                    "visual_sha256": visuals[str(visual)]["sha256"],
                })

        item_map: dict[str, dict[str, Any]] = {}
        for item in lesson.get("items") or []:
            if not isinstance(item, dict) or not item.get("id"):
                raise PackageValidationError(f"Item không hợp lệ: {lesson_id}")
            item_id = str(item["id"])
            if item_id in seen_items:
                raise PackageValidationError(f"Trùng item id: {item_id}")
            seen_items.add(item_id)
            response_type = str(item.get("response_type") or "")
            if response_type not in ALLOWED_RESPONSE_TYPES:
                raise PackageValidationError(f"Response type không hỗ trợ: {response_type}")
            stimulus_ids = item.get("stimulus_ids") or [item.get("stimulus_id")]
            if not all(str(value) in stimulus_map for value in stimulus_ids if value):
                raise PackageValidationError(f"Item trỏ stimulus ngoài lesson: {item_id}")
            item_map[item_id] = item

        for form_sequence, form in enumerate(lesson.get("forms") or [], start=1):
            if not isinstance(form, dict) or not form.get("id"):
                raise PackageValidationError(f"Form không hợp lệ: {lesson_id}")
            form_id = str(form["id"])
            if form_id in seen_forms:
                raise PackageValidationError(f"Trùng form id: {form_id}")
            seen_forms.add(form_id)
            if form.get("scoring_policy") != "report_only":
                raise PackageValidationError(f"Form không phải report_only: {form_id}")
            item_ids = list(map(str, form.get("item_ids") or []))
            if not 1 <= len(item_ids) <= MAX_FORM_ITEMS or len(item_ids) != int(form.get("item_count") or -1):
                raise PackageValidationError(f"Item count không hợp lệ: {form_id}")
            if any(item_id not in item_map for item_id in item_ids):
                raise PackageValidationError(f"Form trỏ item ngoài lesson: {form_id}")
            protected_form = protected_forms.get(form_id) or {}
            form_stimulus_ids = protected_form.get("stimulus_ids")
            if not form_stimulus_ids:
                form_stimulus_ids = []
                for item_id in item_ids:
                    item = item_map[item_id]
                    candidates = item.get("stimulus_ids") or [item.get("stimulus_id")]
                    for candidate in candidates:
                        if candidate and candidate not in form_stimulus_ids:
                            form_stimulus_ids.append(candidate)
            form_stimulus_ids = list(map(str, form_stimulus_ids or []))
            if (not 1 <= len(form_stimulus_ids) <= MAX_FORM_STIMULI
                    or any(value not in stimulus_map for value in form_stimulus_ids)):
                raise PackageValidationError(f"Stimulus order không hợp lệ: {form_id}")
            derived_audio, offsets = assemble_form_audio(
                [audio_map[value] for value in form_stimulus_ids]
            )
            offset_by_stimulus = dict(zip(form_stimulus_ids, offsets, strict=True))
            questions: list[dict[str, Any]] = []
            answers: list[dict[str, Any]] = []
            solutions: dict[str, Any] = {}
            self_review: dict[str, Any] = {}
            audio_windows: dict[str, Any] = {}
            controlled_transcripts: dict[str, Any] = {}
            for q_num, item_id in enumerate(item_ids, start=1):
                item = item_map[item_id]
                response_type = str(item["response_type"])
                protected = protected_items.get(item_id)
                if not protected:
                    raise PackageValidationError(f"Thiếu protected answer/rubric: {item_id}")
                item_stimuli = list(map(
                    str,
                    item.get("stimulus_ids")
                    or protected.get("stimulus_ids")
                    or [item.get("stimulus_id")],
                ))
                if any(stimulus_id not in stimulus_map for stimulus_id in item_stimuli):
                    raise PackageValidationError(f"Protected item trỏ stimulus ngoài lesson: {item_id}")
                source_windows: list[dict[str, Any]] = []
                evidence_ids = set(_evidence_turn_ids(protected))
                available_segment_ids = {
                    str(segment.get("id"))
                    for stimulus_id in item_stimuli
                    for segment in controlled_map[stimulus_id].get("segments") or []
                    if isinstance(segment, dict) and segment.get("id")
                }
                if evidence_ids - available_segment_ids:
                    raise PackageValidationError(f"Evidence turn không tồn tại: {item_id}")
                for stimulus_id in item_stimuli:
                    if stimulus_id not in offset_by_stimulus:
                        raise PackageValidationError(f"Item không được form audio bao phủ: {item_id}")
                    offset = offset_by_stimulus[stimulus_id]["start"]
                    segments = controlled_map[stimulus_id].get("segments") or []
                    evidence = [s for s in segments if isinstance(s, dict) and s.get("id") in evidence_ids]
                    if evidence_ids and not evidence:
                        continue
                    selected = evidence or [s for s in segments if isinstance(s, dict)]
                    if selected:
                        start = max(0.0, min(float(s["start"]) for s in selected) - 0.25)
                        end = min(
                            offset_by_stimulus[stimulus_id]["end"] - offset,
                            max(float(s["end"]) for s in selected) + 0.5,
                        )
                    else:
                        start = 0.0
                        end = offset_by_stimulus[stimulus_id]["end"] - offset
                    source_windows.append({
                        "source_stimulus_id": stimulus_id,
                        "start": round(offset + start, 3),
                        "end": round(offset + end, 3),
                    })
                if not source_windows:
                    raise PackageValidationError(f"Không dựng được replay window: {item_id}")
                merged_window = {
                    "start": min(w["start"] for w in source_windows),
                    "end": max(w["end"] for w in source_windows),
                    "source_windows": source_windows,
                }
                audio_windows[str(q_num)] = merged_window
                expected, alternatives = _key_for_item(protected)
                options = item.get("options") or {}
                if response_type in OBJECTIVE_TYPES:
                    if not expected:
                        raise PackageValidationError(f"Objective item thiếu exact key: {item_id}")
                    options = _validate_objective_options(item, response_type, expected)
                question = {
                    "q_num": q_num,
                    "source_item_id": item_id,
                    "prompt": str(item.get("prompt") or ""),
                    "response_type": response_type,
                    "options": options,
                    "max_score": item.get("max_score"),
                    "evaluation_mode": ("objective_exact" if response_type in OBJECTIVE_TYPES
                                        else "self_review"),
                    "source_stimulus_ids": item_stimuli,
                    "skills": item.get("skills") or [],
                }
                visual = next((stimulus_map[s].get("visual") for s in item_stimuli
                               if stimulus_map[s].get("visual")), None)
                if visual:
                    question["visual_storage_path"] = visuals[str(visual)]["storage_path"]
                    question["visual_accessibility"] = next(
                        (stimulus_map[s].get("visual_accessibility") for s in item_stimuli
                         if stimulus_map[s].get("visual")), None,
                    )
                questions.append(question)
                if response_type in OBJECTIVE_TYPES:
                    answers.append({
                        "q_num": q_num,
                        "answer": ", ".join(expected),
                        "answers": expected,
                        "alternatives": alternatives,
                        "response_type": response_type,
                    })
                    solutions[str(q_num)] = {
                        "expected": expected,
                        "alternatives": alternatives,
                        "rationale": ((protected.get("key") or {}).get("rationale")
                                      if isinstance(protected.get("key"), dict) else None),
                    }
                else:
                    review = _self_review(protected)
                    if not any(value for value in review.values()):
                        raise PackageValidationError(f"Self-review item thiếu rubric/key: {item_id}")
                    self_review[str(q_num)] = review
                for stimulus_id in item_stimuli:
                    if stimulus_id not in controlled_transcripts:
                        shifted = []
                        shift = offset_by_stimulus[stimulus_id]["start"]
                        for segment in controlled_map[stimulus_id].get("segments") or []:
                            if isinstance(segment, dict):
                                shifted.append({
                                    **segment,
                                    "start": round(float(segment["start"]) + shift, 3),
                                    "end": round(float(segment["end"]) + shift, 3),
                                })
                        controlled_transcripts[stimulus_id] = shifted
            prefix = _form_storage_prefix(
                location.package_id, location.manifest_sha256, form_id,
            )
            purpose_labels = {"practice": "Luyện tập", "transfer": "Vận dụng", "checkpoint": "Kiểm tra"}
            title = f"{lesson.get('title') or source_id} — {purpose_labels.get(str(form.get('purpose')), 'Bài nghe')}"
            exercise_payload = {
                "variant": "programme_form_v1",
                "questions": questions,
                "answers": answers,
                "solutions": solutions,
                "self_review": self_review,
                "audio_windows": audio_windows,
                "controlled_transcripts": controlled_transcripts,
                "source_max_score": form.get("max_score"),
                "scoring_policy": "report_only",
                "claim_policy": lesson.get("claim_policy"),
            }
            forms.append({
                "test_id": _stable_test_id(location.package_id, form_id),
                "source_form_id": form_id,
                "source_lesson_id": source_id,
                "title": title,
                "description": str(lesson.get("instructions") or ""),
                "version": str(lesson.get("version") or "1.0"),
                "purpose": form.get("purpose"),
                "replay_policy": form.get("replay_policy"),
                "support_policy": form.get("support_policy"),
                "claim_policy": lesson.get("claim_policy"),
                "item_count": len(item_ids),
                "accent_tag": "other",
                "audio_storage_path": f"{prefix}/audio.wav",
                "audio_duration_seconds": math.ceil(offsets[-1]["end"]),
                "audio_size_bytes": len(derived_audio),
                "metadata": {
                    "source_form_id": form_id,
                    "source_max_score": form.get("max_score"),
                    "checked_item_count": sum(
                        question["evaluation_mode"] == "objective_exact"
                        for question in questions
                    ),
                    "self_review_item_count": sum(
                        question["evaluation_mode"] == "self_review"
                        for question in questions
                    ),
                    "derived_audio_sha256": _sha256_bytes(derived_audio),
                    "transform_version": TRANSFORM_VERSION,
                    "form_sequence": form_sequence,
                },
                "content_metadata": {
                    "source_form_id": form_id,
                    "derived_audio_sha256": _sha256_bytes(derived_audio),
                    "transform_version": TRANSFORM_VERSION,
                },
                "exercise_payload": exercise_payload,
                "stimuli": [
                    {
                        "source_stimulus_id": stimulus_id,
                        "sequence_num": sequence,
                        "derived_offset_seconds": offsets[sequence - 1]["start"],
                        "derived_end_seconds": offsets[sequence - 1]["end"],
                        "metadata": {"gap_after_seconds": (GAP_SECONDS if sequence < len(offsets) else 0)},
                    }
                    for sequence, stimulus_id in enumerate(form_stimulus_ids, start=1)
                ],
            })

    editorial_metadata_changes = _approved_editorial_metadata(location, manifest, lessons)
    editorial_projection, editorial_report = _approved_editorial_projection(
        location, manifest, forms,
    )
    source_visual_paths = {asset["storage_path"]: path for path, asset in visuals.items()}
    editorial_visuals = _approved_editorial_visuals(location, manifest, visuals)
    used_editorial_visuals: set[str] = set()
    if editorial_projection:
        for form in forms:
            for question in form["exercise_payload"]["questions"]:
                translation = editorial_projection.get(question["source_item_id"])
                if translation:
                    source_visual_storage = question.get("visual_storage_path")
                    if source_visual_storage:
                        source_visual_path = source_visual_paths.get(source_visual_storage)
                        if not source_visual_path:
                            raise PackageValidationError("Editorial visual source storage mismatch")
                        visual = editorial_visuals.get(source_visual_path)
                        if not visual:
                            raise PackageValidationError(
                                f"Editorial visual thiếu bản duyệt: {question['source_item_id']}"
                            )
                        if translation["target_language"] == "vi":
                            translation["visual_storage_path"] = visual["storage_path"]
                            translation["visual_accessibility"] = visual["visual_accessibility"]
                        elif translation["target_language"] == "en":
                            # These source prompts are Vietnamese, but the
                            # immutable v1.0 plans themselves have English
                            # labels. Keep the original SVG for English and
                            # show the approved Vietnamese variant with the
                            # source-language question.
                            translation["visual_storage_path"] = source_visual_storage
                            translation["visual_accessibility"] = visual["source_visual_accessibility"]
                            question["visual_storage_path"] = visual["storage_path"]
                            question["visual_accessibility"] = visual["visual_accessibility"]
                        else:
                            raise PackageValidationError("Editorial visual target language mismatch")
                        used_editorial_visuals.add(source_visual_path)
                    question["editorial_translation"] = translation
    if used_editorial_visuals != set(editorial_visuals):
        raise PackageValidationError("Editorial visual không được dùng bởi câu đã duyệt")

    actual_counts = {
        "lessons": len(lessons),
        "forms": len(forms),
        "items": len(seen_items),
        "stimuli": len(stimuli),
        "audio": len(stimuli),
        "timing": len(stimuli),
        "visuals": len(visuals),
    }
    if any(int(counts.get(key, -1)) != value for key, value in actual_counts.items()):
        raise PackageValidationError(f"Manifest counts mismatch: {actual_counts} != {counts}")
    source_counts = {**actual_counts, "timing_segments": timing_segment_count}
    package = {
        "package_id": location.package_id,
        "programme_id": location.programme_id,
        "title": str(learner_index.get("title") or location.programme_id),
        "manifest_sha256": location.manifest_sha256,
        "source_date": manifest.get("date"),
        "source_counts": source_counts,
        "validation_summary": {
            "manifest_bound": True,
            "inventory_verified": True,
            "hashes_verified": len(manifest["artifact_hashes"]),
            "learner_protected_boundary_verified": True,
        },
        "transform_version": TRANSFORM_VERSION,
        "imported_by": imported_by,
    }
    if editorial_report:
        package["validation_summary"]["editorial_approved_items"] = editorial_report["approved_items"]
        package["validation_summary"]["editorial_source_package_id"] = manifest["editorial_source_package_id"]
        package["validation_summary"]["editorial_source_manifest_sha256"] = manifest["editorial_source_manifest_sha256"]
        package["validation_summary"]["editorial_lesson_metadata_changed_ids"] = editorial_metadata_changes
        package["validation_summary"]["editorial_lesson_metadata_sha256"] = manifest["artifact_hashes"][manifest["editorial_lesson_metadata"]]
        package["validation_summary"]["editorial_visual_assets"] = [
            {"storage_path": asset["storage_path"], "sha256": asset["sha256"]}
            for asset in editorial_visuals.values()
        ]
    report = {
        "package_id": location.package_id,
        "programme_id": location.programme_id,
        "manifest_sha256": location.manifest_sha256,
        "counts": source_counts,
        "form_stimulus_references": sum(len(form["stimuli"]) for form in forms),
        "objective_items": sum(
            1 for form in forms for question in form["exercise_payload"]["questions"]
            if question["evaluation_mode"] == "objective_exact"
        ),
        "self_review_items": sum(
            1 for form in forms for question in form["exercise_payload"]["questions"]
            if question["evaluation_mode"] == "self_review"
        ),
        "derived_audio_bytes": sum(form["audio_size_bytes"] for form in forms),
        "transform_version": TRANSFORM_VERSION,
        "dry_run_mutations": 0,
    }
    if editorial_report:
        report["editorial_approved_items"] = editorial_report["approved_items"]
        report["editorial_missing_items"] = editorial_report["missing_items"]
        report["editorial_source_package_id"] = manifest["editorial_source_package_id"]
        report["editorial_source_manifest_sha256"] = manifest["editorial_source_manifest_sha256"]
    return ImportPlan(location, package, lessons, stimuli, forms, list(visuals.values()), report)


def _form_audio_bytes(plan: ImportPlan, form: dict[str, Any]) -> bytes:
    source_by_id = {row["source_stimulus_id"]: row for row in plan.stimuli}
    paths = [
        _resolve_declared(
            plan.location.package_root,
            source_by_id[row["source_stimulus_id"]]["source_audio_path"],
            label=str(row["source_stimulus_id"]),
        )
        for row in form["stimuli"]
    ]
    data, _ = assemble_form_audio(paths)
    expected = form["metadata"]["derived_audio_sha256"]
    if _sha256_bytes(data) != expected or len(data) != form["audio_size_bytes"]:
        raise PackageValidationError(f"Derived audio không deterministic: {form['source_form_id']}")
    return data


def _ensure_immutable_object(bucket: Any, path: str, data: bytes, content_type: str) -> str:
    expected = _sha256_bytes(data)
    try:
        existing = bucket.download(path)
    except Exception:  # storage SDK exposes provider-specific not-found errors
        existing = None
    if existing is not None:
        if _sha256_bytes(bytes(existing)) != expected:
            raise PackageValidationError(f"Storage object conflict: {path}")
        return "reused"
    try:
        bucket.upload(path, data, {"content-type": content_type, "x-upsert": "false"})
    except Exception as exc:
        try:
            existing = bucket.download(path)
        except Exception:
            raise PackageValidationError(f"Upload thất bại: {path}") from exc
        if _sha256_bytes(bytes(existing)) != expected:
            raise PackageValidationError(f"Storage object conflict: {path}") from exc
        return "reused"
    stored = bucket.download(path)
    if _sha256_bytes(bytes(stored)) != expected:
        raise PackageValidationError(f"Upload verification thất bại: {path}")
    return "created"


def commit_import_plan(plan: ImportPlan, db: Any, *, bucket_name: str) -> dict[str, Any]:
    """Upload immutable assets, then transactionally persist the whole package."""
    if (plan.report.get("editorial_source_package_id")
            and plan.package.get("validation_summary", {}).get("revision_source_invariants_verified") is not True):
        raise PackageValidationError("Revision chưa qua so sánh bất biến với source v1.0")
    bucket = db.storage.from_(bucket_name)
    created = 0
    reused = 0
    for asset in plan.visual_assets:
        data = Path(asset["local_path"]).read_bytes()
        action = _ensure_immutable_object(
            bucket, asset["storage_path"], data, asset["content_type"],
        )
        created += action == "created"
        reused += action == "reused"
    for form in plan.forms:
        action = _ensure_immutable_object(
            bucket, form["audio_storage_path"], _form_audio_bytes(plan, form), "audio/wav",
        )
        created += action == "created"
        reused += action == "reused"
    response = db.rpc("import_listening_content_package_atomic", {
        "p_package": plan.package,
        "p_lessons": plan.lessons,
        "p_stimuli": plan.stimuli,
        "p_forms": plan.forms,
    }).execute()
    rows = response.data or []
    row = rows[0] if isinstance(rows, list) and rows else rows
    if not isinstance(row, dict) or row.get("action") not in {"created", "reused"}:
        raise PackageValidationError("Import RPC không trả reconciliation hợp lệ")
    expected = plan.package["source_counts"]
    if (int(row.get("lessons_written") or -1) != expected["lessons"]
            or int(row.get("forms_written") or -1) != expected["forms"]
            or int(row.get("items_written") or -1) != expected["items"]
            or int(row.get("stimuli_written") or -1) != expected["stimuli"]):
        raise PackageValidationError("Import RPC counts không khớp package")
    return {**row, "storage_created": created, "storage_reused": reused}


def _verify_package_storage_assets(
    db: Any,
    *,
    package_id: str,
    manifest_sha256: str,
    bucket_name: str,
) -> int:
    """Re-download every immutable learner asset immediately before publish.

    Database reconciliation alone can succeed after an operator deletes or
    corrupts a private Storage object.  The package therefore stays unpublished
    unless its current bytes still match the hashes persisted at import time.
    """
    package_rows = (
        db.table("listening_content_packages")
        .select("id,manifest_sha256,source_counts,validation_summary")
        .eq("package_id", package_id)
        .limit(1)
        .execute().data or []
    )
    if not package_rows:
        raise PackageValidationError("Listening package không tồn tại")
    package = package_rows[0]
    if package.get("manifest_sha256") != manifest_sha256:
        raise PackageValidationError("Package manifest không khớp")
    validation = package.get("validation_summary") or {}
    if validation.get("editorial_source_package_id"):
        counts = package.get("source_counts") or {}
        if validation.get("revision_source_invariants_verified") is not True:
            raise PackageValidationError("Revision chưa qua so sánh bất biến với source v1.0")
        if (not isinstance(counts.get("items"), int)
                or counts["items"] < 1
                or validation.get("editorial_approved_items") != counts["items"]):
            raise PackageValidationError("Revision chưa đủ bản dịch được duyệt để publish")
    package_uuid = package.get("id")
    if not package_uuid:
        raise PackageValidationError("Package thiếu canonical id")

    expected: dict[str, tuple[str, int | None]] = {}

    def add(path: Any, digest: Any, size: Any = None) -> None:
        storage_path = str(path or "").strip()
        sha256 = str(digest or "").strip()
        try:
            expected_size = int(size) if size is not None else None
        except (TypeError, ValueError) as exc:
            raise PackageValidationError("Package thiếu storage attestation hợp lệ") from exc
        if (not storage_path or not re.fullmatch(r"[0-9a-f]{64}", sha256)
                or expected_size is not None and expected_size < 1):
            raise PackageValidationError("Package thiếu storage attestation hợp lệ")
        previous = expected.get(storage_path)
        attestation = (sha256, expected_size)
        if previous is not None and previous != attestation:
            raise PackageValidationError(f"Storage attestation conflict: {storage_path}")
        expected[storage_path] = attestation

    tests = (
        db.table("listening_tests")
        .select("full_audio_storage_path,full_audio_size_bytes,metadata")
        .eq("content_package_id", package_uuid)
        .execute().data or []
    )
    if not tests:
        raise PackageValidationError("Package không có form audio để publish")
    for row in tests:
        add(
            row.get("full_audio_storage_path"),
            (row.get("metadata") or {}).get("derived_audio_sha256"),
            row.get("full_audio_size_bytes"),
        )

    stimuli = (
        db.table("listening_package_stimuli")
        .select("metadata")
        .eq("package_id", package_uuid)
        .execute().data or []
    )
    source_visual_paths: set[str] = set()
    for row in stimuli:
        metadata = row.get("metadata") or {}
        if metadata.get("visual_source_path"):
            add(metadata.get("visual_storage_path"), metadata.get("visual_sha256"))
            source_visual_paths.add(metadata["visual_storage_path"])

    if validation.get("editorial_source_package_id"):
        localized = validation.get("editorial_visual_assets")
        visual_count = (package.get("source_counts") or {}).get("visuals")
        if (not isinstance(localized, list) or not isinstance(visual_count, int)
                or visual_count != len(source_visual_paths) + len(localized)):
            raise PackageValidationError("Editorial visual storage attestation thiếu hoặc sai count")
        localized_paths: set[str] = set()
        for asset in localized:
            if not isinstance(asset, dict) or set(asset) != {"storage_path", "sha256"}:
                raise PackageValidationError("Editorial visual storage attestation không hợp lệ")
            path = asset["storage_path"]
            if not isinstance(path, str):
                raise PackageValidationError("Editorial visual storage attestation path không hợp lệ")
            if path in source_visual_paths or path in localized_paths:
                raise PackageValidationError("Editorial visual storage attestation trùng source/path")
            add(path, asset["sha256"])
            localized_paths.add(path)

    bucket = db.storage.from_(bucket_name)
    for storage_path, (sha256, expected_size) in expected.items():
        try:
            data = bytes(bucket.download(storage_path))
        except Exception as exc:
            raise PackageValidationError(f"Storage object bị thiếu: {storage_path}") from exc
        if expected_size is not None and len(data) != expected_size:
            raise PackageValidationError(f"Storage object sai kích thước: {storage_path}")
        if _sha256_bytes(data) != sha256:
            raise PackageValidationError(f"Storage object sai hash: {storage_path}")
    return len(expected)


def set_package_status(
    db: Any,
    *,
    package_id: str,
    manifest_sha256: str,
    action: str,
    actor: str | None,
    bucket_name: str,
) -> dict[str, Any]:
    if action not in {"publish", "archive"}:
        raise PackageValidationError("Action phải là publish hoặc archive")
    if action == "publish":
        _verify_package_storage_assets(
            db,
            package_id=package_id,
            manifest_sha256=manifest_sha256,
            bucket_name=bucket_name,
        )
    response = db.rpc("set_listening_content_package_status", {
        "p_package_id": package_id,
        "p_manifest_sha256": manifest_sha256,
        "p_action": action,
        "p_actor": actor,
    }).execute()
    rows = response.data or []
    row = rows[0] if isinstance(rows, list) and rows else rows
    expected = "published" if action == "publish" else "archived"
    if not isinstance(row, dict) or row.get("status") != expected:
        raise PackageValidationError("Package status RPC không trả canonical state")
    return row
